// /today：今日市场。未来 7 天的大事、最近的高价值新闻影响分析、大型科技公司与 QQQ。
// 数据都来自模块只读接口（纯数据库读，页面打开不触发模型调用）。
import { useLoaderData } from "react-router";
import { Link } from "react-router";
import { useEffect, useRef } from "react";
import { forceCollide, forceRadial, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
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
  regions: Array<{ region: string; sentiment: string; indices: Array<{ name: string; price: number; change: number; changePct: number; trend?: number[] }> }>;
  sectors: {
    industries: Array<{ name: string; changePct: number }>;
    concepts: Array<{ name: string; changePct: number }>;
    allIndustries: Array<{ name: string; changePct: number }> | null;
    topIndustries: Array<{ name: string; changePct: number }>;
    bottomIndustries: Array<{ name: string; changePct: number }>;
    topConcepts: Array<{ name: string; changePct: number }> | null;
    bottomConcepts: Array<{ name: string; changePct: number }> | null;
  } | null;
  usSectors: Array<{ name: string; changePct: number }> | null;
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

/** 指数小走势图：归一化的折线，颜色跟当日涨跌（红涨绿跌）；没数据就不渲染。 */
function Sparkline({ pts, up }: { pts: number[] | undefined; up: boolean }) {
  if (!pts || pts.length < 2) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const xy = pts.map((p, i) => [((i / (pts.length - 1)) * 64).toFixed(1), (20 - ((p - min) / span) * 18 + 1).toFixed(1)] as const);
  // 二次贝塞尔平滑：以数据点为控制点、中点为锚点，点少的日K也顺滑
  let line = `M ${xy[0]![0]},${xy[0]![1]}`;
  for (let i = 1; i < xy.length - 1; i++) {
    const [cx, cy] = xy[i]!;
    const [nx, ny] = xy[i + 1]!;
    line += ` Q ${cx},${cy} ${((Number(cx) + Number(nx)) / 2).toFixed(1)},${((Number(cy) + Number(ny)) / 2).toFixed(1)}`;
  }
  const [lx, ly] = xy.at(-1)!;
  line += ` L ${lx},${ly}`;
  const stroke = up ? "#dc2626" : "#059669";
  const area = `${line} L ${lx},22 L ${xy[0]![0]},22 Z`;
  const gid = up ? "spark-up" : "spark-down";
  return (
    <svg viewBox="0 0 64 22" width="64" height="22" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
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
              <li key={q.name} className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="text-ink-2">{q.name}</span>
                <span className="tabular-nums">
                  <span className="text-ink">{q.price.toLocaleString("en-US")}</span>{" "}
                  <span className={pctClass(q.changePct)}>{pctText(q.changePct)}</span>
                </span>
                <Sparkline pts={q.trend} up={q.changePct >= 0} />
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

type Board = { name: string; changePct: number };

interface BubbleNode extends SimulationNodeDatum {
  name: string;
  changePct: number;
  r: number;
  ring: number;
  el?: SVGGElement;
}

/**
 * 泡泡簇（d3-force）：涨跌幅最大的泡在圆心，其余按幅度依次向外包围，碰撞收紧不重叠；
 * 泡泡可以鼠标/手指拖走，松手后力导向会让它们重新靠拢。viewBox 按收敛后的实际内容取，
 * 不会出界裁切。
 */
function BubbleCluster({ boards, positive }: { boards: Board[]; positive: boolean }) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const sorted = [...boards].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    const max = Math.max(0.01, ...sorted.map((b) => Math.abs(b.changePct)));
    const nodes: BubbleNode[] = sorted.map((b, i) => ({
      name: b.name,
      changePct: b.changePct,
      r: 20 + 40 * Math.sqrt(Math.abs(b.changePct) / max),
      // 名次越靠外圈半径越大，第一颗在圆心
      ring: i === 0 ? 0 : 24 + 96 * Math.sqrt(i / Math.max(1, sorted.length - 1)),
      x: (Math.random() - 0.5) * 10,
      y: (Math.random() - 0.5) * 10,
    }));
    const sim = forceSimulation(nodes)
      .force("radial", forceRadial<BubbleNode>((d) => d.ring, 0, 0).strength(0.8))
      .force("collide", forceCollide<BubbleNode>((d) => d.r).iterations(4))
      .force("x", forceX(0).strength(0.03))
      .force("y", forceY(0).strength(0.05))
      .stop();
    for (let i = 0; i < 500; i++) sim.tick();
    const extent = Math.max(10, ...nodes.map((n) => Math.hypot(n.x ?? 0, n.y ?? 0) + n.r)) + 2;
    svg.setAttribute("viewBox", `${-extent} ${-extent} ${extent * 2} ${extent * 2}`);

    const color = positive ? "#e11d48" : "#059669";
    const ns = "http://www.w3.org/2000/svg";
    for (const n of nodes) {
      const g = document.createElementNS(ns, "g");
      g.style.cursor = "grab";
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("r", String(n.r));
      circle.setAttribute("fill", color);
      const name = document.createElementNS(ns, "text");
      name.setAttribute("text-anchor", "middle");
      name.setAttribute("fill", "#fff");
      name.setAttribute("font-size", String(Math.max(10, n.r / 4.4)));
      name.setAttribute("y", n.r > 30 ? String(-n.r / 8) : "0");
      name.textContent = n.name.length > 8 && n.r < 34 ? `${n.name.slice(0, 7)}…` : n.name;
      const pct = document.createElementNS(ns, "text");
      pct.setAttribute("text-anchor", "middle");
      pct.setAttribute("fill", "#fff");
      pct.setAttribute("font-weight", "600");
      pct.setAttribute("font-size", String(Math.max(9, n.r / 4.8)));
      pct.setAttribute("y", String(n.r / 3));
      pct.textContent = pctText(n.changePct);
      if (n.r <= 30) pct.setAttribute("display", "none"); // 小泡放不下两行，悬停看完整值
      g.append(circle, name, pct);
      svg.append(g);
      n.el = g;
    }
    const place = () => {
      for (const n of nodes) n.el?.setAttribute("transform", `translate(${n.x},${n.y})`);
    };
    place();
    sim.on("tick", place);

    // 屏幕 → viewBox 坐标。svg 有 maxHeight 且 preserveAspectRatio=meet：内容按 min(宽,高) 等比
    // 缩放后居中，换算要按这个实际渲染尺寸来，否则 X 轴会偏移。
    const toXY = (e: PointerEvent): [number, number] => {
      const rect = svg.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height);
      const scale = (extent * 2) / size;
      return [(e.clientX - rect.left - (rect.width - size) / 2) * scale, (e.clientY - rect.top - (rect.height - size) / 2) * scale];
    };
    for (const n of nodes) {
      const g = n.el!;
      // 记下按下时指针到泡中心的偏移，拖动时泡保持被抓的位置而不是跳到指针中心
      let grabDX = 0;
      let grabDY = 0;
      g.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        g.setPointerCapture(e.pointerId);
        g.style.cursor = "grabbing";
        const [x, y] = toXY(e);
        grabDX = x - (n.x ?? 0);
        grabDY = y - (n.y ?? 0);
        n.fx = n.x;
        n.fy = n.y;
        sim.alphaTarget(0.3).restart();
      });
      g.addEventListener("pointermove", (e) => {
        if (n.fx === null || n.fx === undefined) return;
        const [x, y] = toXY(e);
        n.fx = x - grabDX;
        n.fy = y - grabDY;
      });
      const release = () => {
        if (n.fx === null || n.fx === undefined) return;
        n.fx = null;
        n.fy = null;
        g.style.cursor = "grab";
        sim.alphaTarget(0);
      };
      g.addEventListener("pointerup", release);
      g.addEventListener("pointercancel", release);
    }
    return () => {
      sim.stop();
      svg.replaceChildren();
    };
  }, [boards, positive]);

  return <svg ref={ref} className="mx-auto block w-full touch-none select-none" style={{ maxHeight: 320 }} role="img" aria-label={positive ? "领涨板块泡泡图" : "领跌板块泡泡图"} />;
}

/** 泡泡池：领涨/领跌各一簇。 */
function BubblePool({ up, down }: { up: Board[]; down: Board[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded border border-line-soft px-3 py-2">
        <h4 className="text-[11.5px] font-medium text-red-600">↑ 领涨</h4>
        <BubbleCluster boards={up} positive />
      </div>
      <div className="rounded border border-line-soft px-3 py-2">
        <h4 className="text-[11.5px] font-medium text-emerald-600">↓ 领跌</h4>
        <BubbleCluster boards={down} positive={false} />
      </div>
    </div>
  );
}

const splitBoards = (boards: Board[]): { up: Board[]; down: Board[] } => ({
  up: boards.filter((b) => b.changePct > 0).sort((a, b) => b.changePct - a.changePct),
  down: boards.filter((b) => b.changePct < 0).sort((a, b) => a.changePct - b.changePct),
});

export const handle = { tab: "market", name: "今日市场" };
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
          <div className="mt-2 space-y-3">
            <div className="card space-y-3 px-4 py-3">
              <SectorChips title="核心行业" boards={data.quotes.sectors.industries} />
              <SectorChips title="热门概念" boards={data.quotes.sectors.concepts} />
            </div>
            {data.quotes.sectors.allIndustries?.length ? (
              <div>
                <h3 className="text-[13px] font-medium text-ink-2">行业领涨 · 领跌（申万一级）</h3>
                <div className="mt-1.5">
                  <BubblePool {...splitBoards(data.quotes.sectors.allIndustries)} />
                </div>
              </div>
            ) : (
              <div className="card grid gap-3 px-4 py-3 sm:grid-cols-2">
                <SectorChips title="领涨行业" boards={data.quotes.sectors.topIndustries} />
                <SectorChips title="领跌行业" boards={data.quotes.sectors.bottomIndustries} />
              </div>
            )}
            <p className="text-[11.5px] text-ink-4">板块口径为腾讯财经申万行业与概念板块，涨跌幅为当日实时快照，可能有延迟。</p>
          </div>
        ) : (
          <p className="card mt-2 px-4 py-3 text-[13px] text-ink-3">暂无板块快照。</p>
        )}
      </section>
      <section aria-labelledby="today-us-sectors" className="mt-5">
        <h2 id="today-us-sectors" className="text-[16px] font-semibold text-ink">
          美股大盘股
        </h2>
        {data.quotes?.usSectors?.length ? (
          <div className="mt-2">
            <BubblePool {...splitBoards(data.quotes.usSectors)} />
            <p className="mt-2 text-[11.5px] text-ink-4">纳斯达克 100 市值前 20 成分股加闪迪，按当日涨跌幅排布；名单随指数季度调整变化时手动更新。</p>
          </div>
        ) : (
          <p className="card mt-2 px-4 py-3 text-[13px] text-ink-3">暂无美股行情快照。</p>
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
