// 首页顶部的市场条：未来 7 天的大事 + 最近的影响分析速览。数据从模块接口取（纯读、有缓存），
// 取不到或没有内容时整块不显示，不挤占首页。
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { bjClock, bjDay, etClock, shown, StatusChip } from "./format.tsx";

interface BriefEvent {
  id: number;
  eventKey: string;
  title: string;
  releaseAt: string;
  status: string;
  revised: boolean;
  impactLevel: string | null;
  actualValue: string | null;
  consensusValue: string | null;
}

interface BriefImpact {
  articleId: string;
  storyPublicId: string | null;
  title: string;
  content: { whyItMatters?: string };
}

interface Brief {
  events: BriefEvent[];
  impacts: BriefImpact[];
  generatedAt: string;
}

/** 影响级别排序：High 在前。 */
const impactRank = (e: BriefEvent) => (e.impactLevel?.toLowerCase() === "high" ? 0 : 1);

export default function HomeBrief() {
  const [brief, setBrief] = useState<Brief | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/market-today/brief")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Brief | null) => {
        if (live) setBrief(data && (data.events.length || data.impacts.length) ? data : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!brief) return null;
  const events = [...brief.events].sort((a, b) => impactRank(a) - impactRank(b) || a.releaseAt.localeCompare(b.releaseAt)).slice(0, 5);
  return (
    <section aria-labelledby="market-brief" className="card mb-4 px-3.5 py-2.5 lg:mb-6 lg:px-5 lg:py-3">
      <div className="flex items-baseline justify-between">
        <h2 id="market-brief" className="text-[14px] font-semibold text-ink">
          未来 7 天大事
        </h2>
        <Link to="/calendar" className="text-[12px] text-ink-3 hover:text-accent">
          完整日历 →
        </Link>
      </div>
      <ul className="mt-1.5 divide-y divide-line-soft">
        {events.map((e) => (
          <li key={e.id} className="flex items-center gap-2 py-1 text-[13px]">
            <span className="w-[92px] shrink-0 text-ink-3">
              {bjDay(e.releaseAt)} {bjClock(e.releaseAt)}
            </span>
            <span className="hidden w-[52px] shrink-0 text-[11px] text-ink-4 sm:inline" title="美东时间">
              {etClock(e.releaseAt)} ET
            </span>
            <span className="min-w-0 flex-1 truncate text-ink">{e.title}</span>
            <span className="hidden shrink-0 text-[12px] text-ink-3 md:inline">
              预期 {shown(e.consensusValue)} · 前值 {shown(e.actualValue) === "暂无数据" ? "暂无" : shown(e.actualValue)}
            </span>
            <StatusChip status={e.status} revised={e.revised} />
          </li>
        ))}
      </ul>
      {brief.impacts.length > 0 && (
        <div className="mt-2 border-t border-line-soft pt-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[12.5px] font-medium text-ink">影响速览</h3>
            <Link to="/today" className="text-[12px] text-ink-3 hover:text-accent">
              今日市场 →
            </Link>
          </div>
          <ul className="mt-1 space-y-1">
            {brief.impacts.slice(0, 3).map((i) => (
              <li key={i.articleId} className="truncate text-[13px]">
                <Link to={i.storyPublicId ? `/story/${i.storyPublicId}` : `/items/${i.articleId}`} className="text-ink hover:text-accent">
                  {i.title}
                </Link>
                {i.content.whyItMatters ? <span className="ml-2 text-[12px] text-ink-3">{i.content.whyItMatters.slice(0, 60)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
