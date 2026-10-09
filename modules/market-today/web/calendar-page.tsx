// /calendar：未来 7 天的经济数据日历。按北京时间分日，美东时间对照（夏令时自动换算），
// 前值/预期/实际只显示信源给的值，缺失一律“暂无数据”。
import { useLoaderData } from "react-router";
import { cachedPage, loadOr404 } from "@aihot/web/lib/api.server";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta, titled } from "@aihot/web/lib/seo";
import { bjClock, bjDay, dayKey, etClock, shown, StatusChip } from "./format.tsx";

interface EventItem {
  id: number;
  eventKey: string;
  title: string;
  country: string | null;
  impactLevel: string | null;
  releaseAt: string;
  referencePeriod: string | null;
  previousValue: string | null;
  consensusValue: string | null;
  actualValue: string | null;
  status: string;
  revised: boolean;
  sourceName: string | null;
  feedUpdatedAt: string | null;
}

export const handle = { name: "经济日历" };
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  const data = await loadOr404<{ events: EventItem[]; generatedAt: string }>("/api/market-today/events?days=7", { signal: request.signal });
  return cachedPage(120, { data });
}

export function meta() {
  return pageMeta({ path: "/calendar", title: titled("经济日历：未来 7 天") });
}

/** 高影响在前；同一时刻按名称。 */
const byImpact = (a: EventItem, b: EventItem) =>
  (b.impactLevel?.toLowerCase() === "high" ? 1 : 0) - (a.impactLevel?.toLowerCase() === "high" ? 1 : 0) || a.releaseAt.localeCompare(b.releaseAt) || a.title.localeCompare(b.title);

function Row({ e }: { e: EventItem }) {
  return (
    <tr className="border-t border-line-soft align-top text-[13px]">
      <td className="whitespace-nowrap py-1.5 pr-2 text-ink-3">
        {bjClock(e.releaseAt)}
        <span className="block text-[11px] text-ink-4">{etClock(e.releaseAt)} ET</span>
      </td>
      <td className="py-1.5 pr-2 text-ink">
        {e.title}
        {e.referencePeriod ? <span className="ml-1 text-[11px] text-ink-4">{e.referencePeriod}</span> : null}
        {e.impactLevel?.toLowerCase() === "high" ? <span className="ml-1 rounded bg-accent-soft px-1 text-[10px] font-medium text-accent">高</span> : null}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-2 text-ink-2">{shown(e.previousValue)}</td>
      <td className="whitespace-nowrap py-1.5 pr-2 text-ink-2">{shown(e.consensusValue)}</td>
      <td className="whitespace-nowrap py-1.5 pr-2 font-medium text-ink">{shown(e.actualValue)}</td>
      <td className="whitespace-nowrap py-1.5 pr-2">
        <StatusChip status={e.status} revised={e.revised} />
      </td>
      <td className="py-1.5 text-[11.5px] text-ink-4">
        {e.sourceName ?? "—"}
        {e.feedUpdatedAt ? <span className="block">更新于 {bjDay(e.feedUpdatedAt)} {bjClock(e.feedUpdatedAt)}</span> : null}
      </td>
    </tr>
  );
}

export default function CalendarPage() {
  const { data } = useLoaderData<typeof loader>();
  const days: Array<{ key: string; label: string; events: EventItem[] }> = [];
  for (const e of [...data.events].sort(byImpact)) {
    const key = dayKey(e.releaseAt);
    let bucket = days.find((d) => d.key === key);
    if (!bucket) days.push((bucket = { key, label: bjDay(e.releaseAt), events: [] }));
    bucket.events.push(e);
  }
  return (
    <div className="pb-6">
      <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">经济日历：未来 7 天</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
        覆盖 CPI、PCE、非农就业、失业率、GDP、零售销售、ISM PMI、JOLTS 与 FOMC。时间为北京时间（附美东时间，夏令时自动换算）；
        前值、预期、实际值来自数据供应商的原始 feed，本站不做推算——供应商没给的或还没有的，一律显示“暂无数据”而不是 0。
        数据可能被修订或延期，以官方发布为准。
      </p>
      {days.length ? (
        <div className="mt-3 space-y-4">
          {days.map((d) => (
            <section key={d.key} aria-label={d.label}>
              <h2 className="mb-1 text-[14px] font-semibold text-ink">{d.label}</h2>
              <div className="card overflow-x-auto px-3 py-1">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead>
                    <tr className="text-left text-[11px] font-medium text-ink-4">
                      <th className="py-1 pr-2 font-medium">时间</th>
                      <th className="py-1 pr-2 font-medium">事件</th>
                      <th className="py-1 pr-2 font-medium">前值</th>
                      <th className="py-1 pr-2 font-medium">预期</th>
                      <th className="py-1 pr-2 font-medium">实际</th>
                      <th className="py-1 pr-2 font-medium">状态</th>
                      <th className="py-1 font-medium">来源 / 更新</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.events.map((e) => (
                      <Row key={e.id} e={e} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <p className="card mt-3 px-4 py-3 text-[13px] text-ink-3">暂无数据：日历信源还没有未来 7 天的事件（信源抓取需开启 MARKET_TODAY_CALENDAR_ENABLED）。</p>
      )}
      <p className="mt-3 text-[12px] text-ink-3">最后更新：{bjDay(data.generatedAt)} {bjClock(data.generatedAt)}（北京时间）。本页每 2 分钟缓存一次。</p>
    </div>
  );
}
