// 读取层：今日速览（首页条与 /today 页）与 QQQ 主题页部件要用的查询。
// 只读已公开（visibility='public'）的精选内容；事件读模块自己的表。全部是纯读，无模型调用。
import { sql } from "@aihot/backend/db";
import type { ImpactContent } from "./impact.ts";

export interface EventRow {
  id: number;
  eventKey: string;
  title: string;
  country: string | null;
  impactLevel: string | null;
  releaseAt: Date;
  referencePeriod: string | null;
  previousValue: string | null;
  consensusValue: string | null;
  actualValue: string | null;
  status: string;
  revised: boolean;
  sourceName: string | null;
  feedUpdatedAt: Date | null;
  updatedAt: Date;
}

/** 未来 days 天的待公布事件（过去 hoursBack 以内已公布的也算进来，方便首页同时看到“刚公布”）。 */
export async function upcomingEvents(days: number, hoursBack = 0): Promise<EventRow[]> {
  return sql<EventRow[]>`
    SELECT id, event_key AS "eventKey", title, country, impact_level AS "impactLevel", release_at AS "releaseAt",
           reference_period AS "referencePeriod", previous_value AS "previousValue", consensus_value AS "consensusValue",
           actual_value AS "actualValue", status, revised, source_name AS "sourceName",
           feed_updated_at AS "feedUpdatedAt", updated_at AS "updatedAt"
    FROM econ_events
    WHERE release_at >= now() - make_interval(hours => ${hoursBack})
      AND release_at < now() + make_interval(days => ${days})
      AND status <> 'cancelled'
    ORDER BY release_at ASC, event_key ASC`;
}

export interface ImpactRow {
  articleId: string;
  storyId: number | null;
  storyPublicId: string | null;
  title: string;
  summary: string | null;
  url: string;
  sourceName: string;
  publishedAt: Date | null;
  category: string | null;
  tags: string[];
  score: number | null;
  generatedAt: Date;
  content: ImpactContent;
}

/** 最近生成的影响分析，连带条目的公开信息（原文链接、发布时间都在）。 */
export async function recentImpacts(limit: number): Promise<ImpactRow[]> {
  return sql<ImpactRow[]>`
    SELECT ia.article_id AS "articleId", p.story_id AS "storyId", st.public_id AS "storyPublicId",
           p.title, p.summary, p.url, s.name AS "sourceName", p.published_at AS "publishedAt",
           p.category, p.tags, p.score, ia.created_at AS "generatedAt", ia.content
    FROM impact_analyses ia
    JOIN publications p ON p.article_id = ia.article_id AND p.visibility = 'public'
    JOIN sources s ON s.id = p.source_id
    LEFT JOIN stories st ON st.id = p.story_id
    ORDER BY ia.created_at DESC
    LIMIT ${limit}`;
}

/** QQQ 主题页部件：指数成分股与宏观驱动因素的近期精选（各自按标签收，最多 limit 条）。 */
export async function recentTagged(tags: string[], limit: number, days: number): Promise<Array<{ articleId: string; storyPublicId: string | null; title: string; summary: string | null; publishedAt: Date | null }>> {
  return sql`
    SELECT p.article_id AS "articleId", st.public_id AS "storyPublicId", p.title, p.summary, p.published_at AS "publishedAt"
    FROM publications p
    JOIN stories st ON st.id = p.story_id
    WHERE p.visibility = 'public' AND p.selected AND p.tags && ${tags}
      AND p.timeline_at >= now() - make_interval(days => ${days})
    ORDER BY p.timeline_at DESC
    LIMIT ${limit}`;
}

/** 今日速览：未来 7 天事件（按天去重，每天最多几件高影响的）+ 最近的影响分析。 */
export async function todayBrief(): Promise<{ events: EventRow[]; impacts: ImpactRow[]; generatedAt: string }> {
  const [events, impacts] = await Promise.all([upcomingEvents(7), recentImpacts(6)]);
  return { events, impacts, generatedAt: new Date().toISOString() };
}

/** QQQ 主题页的部件数据：宏观催化剂（日历）+ 成分股财报/公司动态 + 宏观驱动 + 科技股主线。 */
export async function qqqPart(): Promise<{
  upcoming: EventRow[];
  constituents: Array<{ articleId: string; storyPublicId: string | null; title: string; summary: string | null; publishedAt: Date | null }>;
  drivers: Array<{ articleId: string; storyPublicId: string | null; title: string; summary: string | null; publishedAt: Date | null }>;
  chain: Array<{ articleId: string; storyPublicId: string | null; title: string; summary: string | null; publishedAt: Date | null }>;
  generatedAt: string;
}> {
  const macroKeys = ["fomc", "cpi", "pce", "nfp", "unemployment", "gdp", "retail_sales", "ism_mfg", "ism_services", "jolts"];
  const [upcoming, constituents, drivers, chain] = await Promise.all([
    sql<EventRow[]>`
      SELECT id, event_key AS "eventKey", title, country, impact_level AS "impactLevel", release_at AS "releaseAt",
             reference_period AS "referencePeriod", previous_value AS "previousValue", consensus_value AS "consensusValue",
             actual_value AS "actualValue", status, revised, source_name AS "sourceName",
             feed_updated_at AS "feedUpdatedAt", updated_at AS "updatedAt"
      FROM econ_events
      WHERE release_at >= now() AND release_at < now() + interval '7 days'
        AND status <> 'cancelled' AND event_key IN ${sql(macroKeys)}
      ORDER BY release_at ASC LIMIT 12`,
    recentTagged(["苹果", "微软", "英伟达", "特斯拉", "亚马逊", "谷歌", "Meta", "博通"], 10, 7),
    recentTagged(["利率", "通胀", "就业", "国债", "美元"], 8, 7),
    recentTagged(["科技股", "波动率", "市场风险"], 8, 7),
  ]);
  return { upcoming, constituents, drivers, chain, generatedAt: new Date().toISOString() };
}
