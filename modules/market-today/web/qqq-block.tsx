// QQQ 主题页的模块部件：把日历上的宏观催化剂、成分股公司动态、宏观驱动与科技股主线放在一起，
// 明确区分“成分股新闻 / 宏观驱动 / 一般评论”，并注明在接入真实行情前只有定性内容。
import type { ComponentType } from "react";
import { Link } from "react-router";
import type { TopicSummary } from "@aihot/contracts/site";
import { bjDay, bjClock, shown } from "./format.tsx";

interface TaggedItem {
  articleId: string;
  storyPublicId: string | null;
  title: string;
  summary: string | null;
  publishedAt: string | null;
}

interface UpcomingEvent {
  id: number;
  title: string;
  releaseAt: string;
  referencePeriod: string | null;
  consensusValue: string | null;
  actualValue: string | null;
  status: string;
  revised: boolean;
}

interface QqqData {
  upcoming: UpcomingEvent[];
  constituents: TaggedItem[];
  drivers: TaggedItem[];
  chain: TaggedItem[];
  generatedAt: string;
}

const link = (i: { articleId: string; storyPublicId: string | null }) => (i.storyPublicId ? `/story/${i.storyPublicId}` : `/items/${i.articleId}`);

function List({ items }: { items: TaggedItem[] }) {
  if (!items.length) return <p className="text-[13px] text-ink-3">暂无数据：最近 7 天没有该类别的精选报道。</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li key={i.articleId} className="text-[13px] leading-relaxed">
          <Link to={link(i)} className="text-ink hover:text-accent">
            {i.title}
          </Link>
          {i.publishedAt ? <span className="ml-1.5 whitespace-nowrap text-[11.5px] text-ink-4">{bjDay(i.publishedAt)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Block({ data }: { data: unknown; topic: TopicSummary }) {
  const d = data as QqqData;
  return (
    <section aria-label="QQQ 视角" className="card mb-5 px-4 py-3">
      <h2 className="text-[15px] font-semibold text-ink">QQQ 视角</h2>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">
        从 QQQ（纳斯达克 100 ETF）的持有视角归组报道：成分股新闻、宏观驱动与一般市场评论分开列，单家公司的表现不能直接推及指数。
        未接入行情数据前只有定性内容，不提供涨跌与估值数字。
      </p>
      {d.upcoming.length > 0 && (
        <div className="mt-2.5">
          <h3 className="text-[12.5px] font-medium text-ink-3">未来 7 天的宏观催化剂</h3>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
            {d.upcoming.slice(0, 6).map((e) => (
              <li key={e.id} className="text-ink-2">
                <span className="text-ink-4">
                  {bjDay(e.releaseAt)} {bjClock(e.releaseAt)}
                </span>{" "}
                {e.title}
                <span className="text-ink-4">（预期 {shown(e.consensusValue)}）</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 grid gap-x-6 gap-y-3 md:grid-cols-3">
        <div>
          <h3 className="text-[12.5px] font-medium text-ink-3">成分股与大型科技公司</h3>
          <div className="mt-1">
            <List items={d.constituents} />
          </div>
        </div>
        <div>
          <h3 className="text-[12.5px] font-medium text-ink-3">宏观驱动（利率 / 通胀 / 就业 / 国债 / 美元）</h3>
          <div className="mt-1">
            <List items={d.drivers} />
          </div>
        </div>
        <div>
          <h3 className="text-[12.5px] font-medium text-ink-3">科技股主线与风险（一般评论）</h3>
          <div className="mt-1">
            <List items={d.chain} />
          </div>
        </div>
      </div>
    </section>
  );
}

const part = {
  name: "QQQ 视角",
  shows: (data: unknown) => {
    const d = data as QqqData | undefined;
    return !!d && (d.upcoming.length > 0 || d.constituents.length > 0 || d.drivers.length > 0 || d.chain.length > 0);
  },
  Block: Block as ComponentType<{ data: unknown; topic: TopicSummary }>,
  entries: (data: unknown) =>
    ((data as QqqData)?.constituents ?? []).slice(0, 8).map((i) => ({ title: i.title, href: link(i) })),
  news: (data: unknown) => ((data as QqqData)?.constituents ?? []).slice(0, 2).map((i) => i.title),
};

export default part;
