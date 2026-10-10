// market-today 模块的后端：日历导入的定时任务、HTTP 只读接口、影响分析的队列与模型步骤、
// articleChanged 钩子和 QQQ 主题页部件。默认全部关闭/空闲：日历抓取要显式设
// MARKET_TODAY_CALENDAR_ENABLED=true，模型调用沿用全站的安全阀（MODEL_CALLS_ENABLED）与预算熔断。
import type { FastifyInstance, FastifyReply } from "fastify";
import { sql } from "@aihot/backend/db";
import { defineServerModule, type ModuleQueue, type TopicPageAsk } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { SITE } from "@aihot/site";
import { importEvents, normalizeFeedItem, type CalendarEvent } from "./calendar.ts";
import { importQuotes } from "./quotes.ts";
import { loadImpactArticle, qualifies, runImpactAnalysis, shouldQueueImpact, MIN_SCORE } from "./impact.ts";
import { recentImpacts, todayBrief, upcomingEvents, qqqPart } from "./brief.ts";

// ── 日历导入 ────────────────────────────────────────────────────────────────────────

/** 默认用 ForexFactory（faireconomy）的本周/下周 JSON：免费公开接口，自带市场预期与前值。
 *  可用环境变量 MARKET_TODAY_CALENDAR_FEEDS（逗号分隔的 JSON 地址）换成别的数据供应商。
 *  预期值永远来自信源原文，模型不参与日历。 */
const DEFAULT_FEEDS = ["https://nfs.faireconomy.media/ff_calendar_thisweek.json", "https://nfs.faireconomy.media/ff_calendar_nextweek.json"];

const feedUrls = (): string[] => (process.env.MARKET_TODAY_CALENDAR_FEEDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

async function fetchFeed(url: string): Promise<CalendarEvent[]> {
  const res = await guardedFetch(url, { timeoutMs: 20_000, route: "egress" });
  if (res.status !== 200) throw new Error(`calendar feed ${url}: HTTP ${res.status}`);
  const body = JSON.parse(res.text()) as unknown;
  if (!Array.isArray(body)) throw new Error(`calendar feed ${url}: expected a JSON array`);
  return body.flatMap((item) => {
    const event = normalizeFeedItem(item, url);
    return event ? [event] : [];
  });
}

/** 抓全部信源并导入；单个信源失败不影响其他信源，全部失败时抛错让 job_runs 记录。 */
export async function importCalendar(): Promise<{ feeds: number; events: number; inserted: number; updated: number; revised: number }> {
  const urls = feedUrls().length ? feedUrls() : DEFAULT_FEEDS;
  let feeds = 0;
  const events: CalendarEvent[] = [];
  const errors: string[] = [];
  for (const url of urls) {
    try {
      events.push(...(await fetchFeed(url)));
      feeds += 1;
    } catch (error) {
      errors.push(`${url}: ${String(error)}`);
    }
  }
  if (!feeds && errors.length) throw new Error(errors.join("; "));
  const result = await importEvents(events, urls.length === 1 ? urls[0]! : DEFAULT_FEEDS[0]!);
  if (errors.length) console.warn(`[market-today] calendar feed warnings: ${errors.join("; ")}`);
  return { feeds, events: events.length, ...result };
}

// ── 影响分析队列 ────────────────────────────────────────────────────────────────────

interface ImpactJob {
  articleId: string;
}

const IMPACT_QUEUE: ModuleQueue<ImpactJob> = {
  name: "market-today.impact",
  options: {},
  worker: {},
  run: async (jobs) => {
    for (const { articleId } of jobs) {
      const article = await loadImpactArticle(articleId);
      // 排队期间被撤稿/降级、或已分析过（一篇一份）都直接跳过；资格以运行时的门槛再核一遍。
      if (!article || !qualifies(article, MIN_SCORE())) continue;
      await runImpactAnalysis(article);
    }
  },
};

async function onArticleChanged(change: { id: string; kind: string; reduced?: boolean }): Promise<void> {
  if (change.kind !== "content" || change.reduced) return;
  if (process.env.MODEL_CALLS_ENABLED !== "true") return;
  if (!(await shouldQueueImpact(change.id))) return;
  await enqueueOn(IMPACT_QUEUE, { articleId: change.id });
}

/**
 * 周期扫描够格做影响分析的文章并入队。光挂 articleChanged 不够：新文章的首次发布不发该事件
 * （只有修订与管理操作才发），队列要靠扫描喂。批量一次 20 篇；门槛在运行时再核一遍。
 */
async function sweepImpacts(): Promise<{ queued: number }> {
  if (process.env.MODEL_CALLS_ENABLED !== "true") return { queued: 0 };
  const rows = await sql<{ article_id: string }[]>`
    SELECT p.article_id FROM publications p
    WHERE p.selected AND p.visibility = 'public' AND p.category IS DISTINCT FROM 'opinion'
      AND p.score >= ${MIN_SCORE()} AND p.published_at > now() - interval '7 days'
      AND NOT EXISTS (SELECT 1 FROM impact_analyses i WHERE i.article_id = p.article_id)
    ORDER BY p.score DESC NULLS LAST LIMIT 20`;
  for (const { article_id } of rows) await enqueueOn(IMPACT_QUEUE, { articleId: article_id });
  return { queued: rows.length };
}

// ── HTTP 只读接口 ───────────────────────────────────────────────────────────────────

function registerHttp(app: FastifyInstance): void {
  const send = (reply: FastifyReply, body: unknown) => reply.header("cache-control", "public, max-age=120").send(body);

  app.get("/api/market-today/events", async (req, reply) => {
    const days = Math.min(Math.max(Number(new URL(req.url, "http://localhost").searchParams.get("days") ?? 7), 1), 14);
    return send(reply, { events: await upcomingEvents(days, 48), generatedAt: new Date().toISOString() });
  });

  app.get("/api/market-today/brief", async (_req, reply) => send(reply, await todayBrief()));}

// ── QQQ 主题页部件（服务端部分） ────────────────────────────────────────────────────

/** index 随主题索引一起算（最多一分钟旧），read 把它原样交给页面；成员的可见性由部件自己的查询在读取时过滤。 */
function qqqTopicPart(ask: TopicPageAsk) {
  if (ask.topic.slug !== "qqq") return null;
  return { recheck: ask.members.map((m) => m.id), part: () => ask.index };
}

const qqqIndex = async () => {
  const data = await qqqPart();
  const impacts = (await recentImpacts(6)).filter((i) => i.content.ndx100 || i.content.qqq).slice(0, 3);
  return { ...data, impacts };
};

// ── 组装 ────────────────────────────────────────────────────────────────────────────

export default defineServerModule({
  name: "market-today",
  http: registerHttp,
  schedules: [
    {
      name: "market-today.calendar-import",
      cron: "41 * * * *",
      when: () => process.env.MARKET_TODAY_CALENDAR_ENABLED === "true",
      run: importCalendar,
    },
    {
      // 行情快照：免费公开接口，每 5 分钟一轮（错开整点 2 分起）。
      name: "market-today.quotes",
      cron: "2-59/5 * * * *",
      when: () => process.env.MARKET_TODAY_QUOTES_ENABLED === "true",
      run: importQuotes,
    },
    {
      // 影响分析扫描：门槛内未分析的高分文章入队（安全阀在 run 里核 MODEL_CALLS_ENABLED）。
      name: "market-today.impact-sweep",
      cron: "7-59/10 * * * *",
      run: sweepImpacts,
    },
  ],
  queues: [IMPACT_QUEUE],
  models: {
    impact: { label: "市场影响分析（高价值事件的传导路径与情景）", env: "IMPACT_MODEL", purposes: ["impact_analysis"] },
  },
  on: { articleChanged: onArticleChanged },
  topics: {
    page: {
      index: qqqIndex,
      read: qqqTopicPart,
    },
  },
  sitemap: { pages: [{ loc: "/today" }, { loc: "/calendar" }] },
  llms: () => ({
    api: [`${SITE.name} 提供未来 7 天经济事件日历（GET /api/market-today/events，含前值、市场预期、实际值与状态）。`],
    pages: ["今日市场速览：/today（未来 7 天大事与影响分析）。经济事件日历：/calendar。"],
    pace: ["经济事件日历的接口答案缓存 2 分钟；"],
  }),
});
