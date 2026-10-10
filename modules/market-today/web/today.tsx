// /today：今日市场。未来 7 天的大事、最近的高价值新闻影响分析、大型科技公司与 QQQ。
// 数据都来自模块只读接口（纯数据库读，页面打开不触发模型调用）。
import { useLoaderData } from "react-router";
import { Link } from "react-router";
import { SITE } from "@aihot/site";
import { cachedPage, loadOr404 } from "@aihot/web/lib/api.server";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta, titled } from "@aihot/web/lib/seo";
import { bjClock, bjDay, etClock, shown, StatusChip } from "./format.tsx";

interface EventItem {
  id: number;
  title: string;
  releaseAt: string;
  referencePeriod: string | null;
  previousValue: string | null;
  consensusValue: string | null;
  actualValue: string | null;
  status: string;
  revised: boolean;
  sourceName: string | null;
  feedUpdatedAt: string | null;
  impactLevel: string | null;
}

interface ImpactItem {
  articleId: string;
  storyPublicId: string | null;
  title: string;
  summary: string | null;
  url: string;
  sourceName: string;
  publishedAt: string | null;
  generatedAt: string;
  content: {
    coreFacts?: string[];
    whyItMatters?: string;
    transmission?: string[];
    ndx100?: string;
    qqq?: string;
    companies?: Array<{ name: string; note: string }>;
    bullish?: { view: string; conditions: string } | null;
    bearish?: { view: string; conditions: string } | null;
    confirmed?: string[];
    expectations?: string[];
    inferences?: string[];
    unknowns?: string[];
  };
}

interface Brief {
  events: EventItem[];
  impacts: ImpactItem[];
  quotes: QuotesSnapshot | null;
  generatedAt: string;
}

interface QuotesSnapshot {
  fearGreed: { score: number; rating: string; previousClose: number | null } | null;
  regions: Array<{ region: string; sentiment: string; indices: Array<{ name: string; price: number; change: number; changePct: number }> }>;
  sectors: {
    industries: Array<{ name: string; changePct: number }>;
    concepts: Array<{ name: string; changePct: number }>;
    topIndustries: Array<{ name: string; changePct: number }>;
    bottomIndustries: Array<{ name: string; changePct: number }>;
  } | null;
  fetchedAt: string;
}

/** 中国行情惯例：红涨绿跌。 */
function pctClass(pct: number): string {
  if (pct > 0) return "text-red-600";
  if (pct < 0) return "text-emerald-600";
  return "text-ink-3";
}

function pctText(pct: number): string {
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

const FG_RATING_ZH: Record<string, string> = {
  "extreme fear": "极度恐惧",
  fear: "恐惧",
  neutral: "中性",
  greed: "贪婪",
  "extreme greed": "极度贪婪",
};

const SENTIMENT_COLOR: Record<string, string> = {
  贪婪: "text-red-600",
  乐观: "text-red-500",
  中性: "text-ink-2",
  谨慎: "text-emerald-500",
  恐惧: "text-emerald-600",
};

function FearGreedGauge({ fg }: { fg: NonNullable<QuotesSnapshot["fearGreed"]> }) {
  const zh = FG_RATING_ZH[fg.rating] ?? fg.rating;
  return (
    <div className="card flex items-center gap-4 px-4 py-3">
      <div className="text-center">
        <div className={`text-[28px] font-semibold leading-none ${fg.score >= 55 ? "text-red-600" : fg.score <= 45 ? "text-emerald-600" : "text-ink"}`}>{fg.score}</div>
        <div className="mt-0.5 text-[11px] text-ink-3">{zh}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-2 rounded-full bg-gradient-to-r from-emerald-500 via-ink-3/40 to-red-500">
          <span className="absolute top-[-3px] h-3.5 w-1 rounded bg-ink" style={{ left: `calc(${Math.min(100, Math.max(0, fg.score))}% - 2px)` }} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-ink-4">
          <span>0 极度恐惧</span>
          <span>100 极度贪婪</span>
        </div>
        {fg.previousClose !== null ? <p className="mt-0.5 text-[12px] text-ink-3">上一收盘 {fg.previousClose}（CNN Fear & Greed，美股口径）</p> : null}
      </div>
    </div>
  );
}

function RegionCards({ regions }: { regions: QuotesSnapshot["regions"] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {regions.map((r) => (
        <div key={r.region} className="card px-3 py-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-ink">{r.region}</span>
            <span className={`text-[12px] font-medium ${SENTIMENT_COLOR[r.sentiment] ?? "text-ink-2"}`}>{r.sentiment}</span>
          </div>
          <ul className="mt-1 space-y-0.5">
            {r.indices.map((q) => (
              <li key={q.name} className="flex items-baseline justify-between text-[12.5px]">
                <span className="text-ink-2">{q.name}</span>
                <span className="tabular-nums">
                  <span className="text-ink">{q.price.toLocaleString("en-US")}</span>{" "}
                  <span className={pctClass(q.changePct)}>{pctText(q.changePct)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SectorChips({ title, boards }: { title: string; boards: Array<{ name: string; changePct: number }> }) {
  if (!boards.length) return null;
  return (
    <div>
      <h4 className="text-[12px] font-medium text-ink-3">{title}</h4>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {boards.map((b) => (
          <span key={b.name} className="rounded border border-line-soft px-2 py-0.5 text-[12px] text-ink">
            {b.name} <span className={`tabular-nums font-medium ${pctClass(b.changePct)}`}>{pctText(b.changePct)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export const handle = { name: "今日市场" };
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  const data = await loadOr404<Brief>("/api/market-today/brief", { signal: request.signal });
  return cachedPage(120, { data });
}

export function meta() {
  return pageMeta({ path: "/today", title: titled("今日市场") });
}

function ImpactCard({ item }: { item: ImpactItem }) {
  const c = item.content;
  const link = item.storyPublicId ? `/story/${item.storyPublicId}` : `/items/${item.articleId}`;
  return (
    <article className="card mb-3 px-4 py-3">
      <h3 className="text-[15px] font-semibold leading-snug text-ink">
        <Link to={link} className="hover:text-accent">
          {item.title}
        </Link>
      </h3>
      <p className="mt-0.5 text-[12px] text-ink-3">
        {item.sourceName}
        {item.publishedAt ? ` · ${bjDay(item.publishedAt)} ${bjClock(item.publishedAt)}` : ""} · 分析生成于 {bjClock(item.generatedAt)}（北京时间）
      </p>
      {c.whyItMatters ? <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">{c.whyItMatters}</p> : null}
      {c.coreFacts?.length ? (
        <div className="mt-2">
          <h4 className="text-[12px] font-medium text-ink-3">核心事实</h4>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-[13px] leading-relaxed text-ink">
            {c.coreFacts.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {c.transmission?.length ? (
        <div className="mt-2">
          <h4 className="text-[12px] font-medium text-ink-3">潜在传导路径</h4>
          <ol className="mt-0.5 list-decimal space-y-0.5 pl-5 text-[13px] leading-relaxed text-ink">
            {c.transmission.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {(c.ndx100 || c.qqq) && (
        <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-[13px] leading-relaxed sm:grid-cols-2">
          {c.ndx100 ? (
            <>
              <dt className="text-[12px] font-medium text-ink-3">纳斯达克 100</dt>
              <dd className="text-ink">{c.ndx100}</dd>
            </>
          ) : null}
          {c.qqq ? (
            <>
              <dt className="text-[12px] font-medium text-ink-3">QQQ</dt>
              <dd className="text-ink">{c.qqq}</dd>
            </>
          ) : null}
        </dl>
      )}
      {c.companies?.length ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink">
          <span className="text-[12px] font-medium text-ink-3">受影响公司：</span>
          {c.companies.map((x) => `${x.name}（${x.note}）`).join("；")}
        </p>
      ) : null}
      {(c.bullish || c.bearish) && (
        <div className="mt-2 space-y-1 text-[13px] leading-relaxed">
          {c.bullish ? (
            <p>
              <span className="rounded bg-accent-soft px-1.5 text-[11px] font-medium text-accent">正向情景</span>{" "}
              <span className="text-ink">{c.bullish.view}</span>
              <span className="text-ink-3">（条件：{c.bullish.conditions}）</span>
            </p>
          ) : null}
          {c.bearish ? (
            <p>
              <span className="rounded bg-amber-soft px-1.5 text-[11px] font-medium text-amber-ink">反向情景</span>{" "}
              <span className="text-ink">{c.bearish.view}</span>
              <span className="text-ink-3">（条件：{c.bearish.conditions}）</span>
            </p>
          ) : null}
        </div>
      )}
      {(c.confirmed?.length || c.expectations?.length || c.inferences?.length || c.unknowns?.length) && (
        <dl className="mt-2 grid gap-x-4 gap-y-1 border-t border-line-soft pt-2 text-[12.5px] leading-relaxed sm:grid-cols-2">
          {[
            ["已确认事实", c.confirmed],
            ["市场预期", c.expectations],
            ["模型推断", c.inferences],
            ["尚不确定", c.unknowns],
          ]
            .filter(([, v]) => Array.isArray(v) && v.length)
            .map(([label, v]) => (
              <div key={label as string}>
                <dt className="text-[11.5px] font-medium text-ink-3">{label as string}</dt>
                <dd className="text-ink-2 text-[12.5px]">{(v as string[]).join("；")}</dd>
              </div>
            ))}
        </dl>
      )}
      <p className="mt-2 text-[12px] text-ink-3">
        原文：
        <a href={item.url} rel="nofollow noopener" target="_blank" className="hover:text-accent">
          {item.sourceName}
        </a>
        。分析由模型根据原文生成，不构成投资建议。
      </p>
    </article>
  );
}

export default function Today() {
  const { data } = useLoaderData<typeof loader>();
  return (
    <div className="pb-6">
      <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">今日市场</h1>
      <section aria-labelledby="today-mood" className="mt-3">
        <h2 id="today-mood" className="text-[16px] font-semibold text-ink">
          市场贪婪恐惧指数
        </h2>
        {data.quotes?.fearGreed ? (
          <div className="mt-2">
            <FearGreedGauge fg={data.quotes.fearGreed} />
          </div>
        ) : (
          <p className="card mt-2 px-4 py-3 text-[13px] text-ink-3">
            行情快照未接入或暂无数据。开启 MARKET_TODAY_QUOTES_ENABLED 并等第一轮导入后，这里会显示 CNN 恐惧贪婪指数。
          </p>
        )}
      </section>
      <section aria-labelledby="today-regions" className="mt-5">
        <h2 id="today-regions" className="text-[16px] font-semibold text-ink">
          全球市场情绪
        </h2>
        {data.quotes?.regions.length ? (
          <div className="mt-2">
            <RegionCards regions={data.quotes.regions} />
          </div>
        ) : (
          <p className="card mt-2 px-4 py-3 text-[13px] text-ink-3">暂无全球指数快照。情绪由各区域主指数当天的涨跌幅分档得出。</p>
        )}
      </section>
      <section aria-labelledby="today-sectors" className="mt-5">
        <h2 id="today-sectors" className="text-[16px] font-semibold text-ink">
          A 股板块涨跌
        </h2>
        {data.quotes?.sectors ? (
          <div className="card mt-2 space-y-3 px-4 py-3">
            <SectorChips title="核心行业" boards={data.quotes.sectors.industries} />
            <SectorChips title="热门概念" boards={data.quotes.sectors.concepts} />
            <div className="grid gap-3 border-t border-line-soft pt-2 sm:grid-cols-2">
              <SectorChips title="领涨行业" boards={data.quotes.sectors.topIndustries} />
              <SectorChips title="领跌行业" boards={data.quotes.sectors.bottomIndustries} />
            </div>
            <p className="text-[11.5px] text-ink-4">板块口径为腾讯财经申万行业与概念板块，涨跌幅为当日实时快照，可能有延迟。</p>
          </div>
        ) : (
          <p className="card mt-2 px-4 py-3 text-[13px] text-ink-3">暂无板块快照。</p>
        )}
      </section>
      <section aria-labelledby="today-events" className="mt-5">
        <div className="flex items-baseline justify-between">
          <h2 id="today-events" className="text-[16px] font-semibold text-ink">
            未来 7 天大事
          </h2>
          <Link to="/calendar" className="text-[12.5px] text-ink-3 hover:text-accent">
            完整日历与口径 →
          </Link>
        </div>
        {data.events.length ? (
          <ul className="card mt-2 divide-y divide-line-soft px-4">
            {data.events.slice(0, 12).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-[13px]">
                <span className="w-[120px] shrink-0 text-ink-3">
                  {bjDay(e.releaseAt)} {bjClock(e.releaseAt)}
                </span>
                <span className="w-[52px] shrink-0 text-[11px] text-ink-4" title="美东时间">
                  {etClock(e.releaseAt)} ET
                </span>
                <span className="min-w-0 flex-1 text-ink">
                  {e.title}
                  {e.referencePeriod ? <span className="ml-1 text-[11px] text-ink-4">{e.referencePeriod}</span> : null}
                </span>
                <span className="text-[12px] text-ink-3">
                  前值 {shown(e.previousValue)} · 预期 {shown(e.consensusValue)} · 实际 {shown(e.actualValue)}
                </span>
                <StatusChip status={e.status} revised={e.revised} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="card mt-2 px-4 py-3 text-[13px] text-ink-3">
            日历尚未接入或暂无未来 7 天的事件。开启信源抓取（MARKET_TODAY_CALENDAR_ENABLED）并等到第一轮导入后，这里会显示官方日程与数据供应商的预期值。
          </p>
        )}
      </section>
      <section aria-labelledby="today-impacts" className="mt-5">
        <h2 id="today-impacts" className="text-[16px] font-semibold text-ink">
          重要新闻的市场影响
        </h2>
        {data.impacts.length ? (
          <div className="mt-2">
            {data.impacts.map((i) => (
              <ImpactCard key={i.articleId} item={i} />
            ))}
          </div>
        ) : (
          <p className="card mt-2 px-4 py-3 text-[13px] text-ink-3">
            暂无影响分析。入选且平均分达到门槛（默认 80 分）的新闻会自动生成一份，只依据原文与事件背景，不接入行情数据。
          </p>
        )}
      </section>
      <section aria-labelledby="today-qqq" className="mt-5">
        <div className="flex items-baseline justify-between">
          <h2 id="today-qqq" className="text-[16px] font-semibold text-ink">
            大型科技公司与 QQQ
          </h2>
          <Link to="/topics/qqq" className="text-[12.5px] text-ink-3 hover:text-accent">
            QQQ 主题页 →
          </Link>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          {SITE.name} 按 QQQ（纳斯达克 100 ETF）视角归组科技股与宏观报道；成分股新闻、宏观驱动与一般市场评论在主题页分开呈现，单家公司表现不等同于指数整体表现。
        </p>
      </section>
    </div>
  );
}
