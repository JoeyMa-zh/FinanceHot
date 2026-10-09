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
  generatedAt: string;
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
        。分析由模型根据原文生成，不构成投资建议；本站未接入行情数据，不提供涨跌验证。
      </p>
    </article>
  );
}

export default function Today() {
  const { data } = useLoaderData<typeof loader>();
  return (
    <div className="pb-6">
      <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">今日市场</h1>
      <section aria-labelledby="today-events" className="mt-3">
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
