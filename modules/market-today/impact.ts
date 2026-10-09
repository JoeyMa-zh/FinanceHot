// 高价值新闻的市场影响分析：一篇至多一份（表格主键约束），只对入选且高分的事件调模型，
// 结果是结构化 JSON（industry/prompts/impact-analysis.md），页面只展示、不再加工。
import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { chatJson } from "@aihot/backend/providers/llm";
import { modelFor } from "@aihot/backend/editorial/models";
import { promptText, promptVersion } from "@aihot/backend/editorial/prompts";

export const ImpactSchema = z.object({
  coreFacts: z.array(z.string()).catch([]),
  whyItMatters: z.string().catch(""),
  transmission: z.array(z.string()).catch([]),
  ndx100: z.string().catch(""),
  qqq: z.string().catch(""),
  companies: z.array(z.object({ name: z.string(), note: z.string() })).catch([]),
  // 情景对象内部字段各自兜底：模型少给了条件时保留观点本身，而不是整块丢掉。
  bullish: z.object({ view: z.string().catch(""), conditions: z.string().catch("") }).nullable().catch(null),
  bearish: z.object({ view: z.string().catch(""), conditions: z.string().catch("") }).nullable().catch(null),
  confirmed: z.array(z.string()).catch([]),
  expectations: z.array(z.string()).catch([]),
  inferences: z.array(z.string()).catch([]),
  unknowns: z.array(z.string()).catch([]),
});
export type ImpactContent = z.infer<typeof ImpactSchema>;

/** 只对入选、公开、非评论类、分数达到门槛的事件做深入分析（成本控制；门槛可用 IMPACT_MIN_SCORE 调）。 */
export function qualifies(row: { selected: boolean | null; visibility: string | null; category: string | null; score: string | number | null }, minScore: number): boolean {
  if (!row.selected || row.visibility !== "public" || row.category === "opinion") return false;
  const score = row.score === null ? 0 : Number(row.score);
  return score >= minScore;
}

/** 门槛（环境变量 IMPACT_MIN_SCORE 可调）：只分析平均分不低于它的高价值事件。 */
export const MIN_SCORE = (): number => Number(process.env.IMPACT_MIN_SCORE ?? 80);

export interface ImpactArticle {
  articleId: string;
  title: string;
  summary: string | null;
  url: string;
  sourceName: string;
  publishedAt: Date | null;
  selected: boolean;
  visibility: string;
  category: string | null;
  tags: string[];
  score: number | null;
  storyId: number | null;
  storyTitle: string | null;
  storyDigest: string | null;
}

export async function loadImpactArticle(articleId: string): Promise<ImpactArticle | null> {
  const rows = await sql<ImpactArticle[]>`
    SELECT p.article_id, p.title, p.summary, p.url, s.name AS source_name, p.published_at, p.selected, p.visibility,
           p.category, p.tags, p.score, p.story_id, st.title AS story_title, st.digest AS story_digest
    FROM publications p
    JOIN sources s ON s.id = p.source_id
    LEFT JOIN stories st ON st.id = p.story_id
    WHERE p.article_id = ${articleId} LIMIT 1`;
  return rows[0] ?? null;
}

/** 组装给模型的材料：原文事实 + 同事件背景；不附加任何行情数据（站内没有接入行情源）。 */
export function impactUser(a: ImpactArticle): string {
  const parts = [
    `标题：${a.title}`,
    a.summary ? `摘要：${a.summary}` : null,
    `来源：${a.sourceName}`,
    `原文链接：${a.url}`,
    a.publishedAt ? `发布时间：${a.publishedAt.toISOString()}` : null,
    a.category ? `分类：${a.category}` : null,
    a.tags.length ? `标签：${a.tags.join("、")}` : null,
    a.storyTitle ? `所属事件：${a.storyTitle}` : null,
    a.storyDigest ? `事件背景综述：${a.storyDigest}` : null,
  ].filter(Boolean);
  return parts.join("\n");
}

const SYSTEM = () => promptText("impact-analysis", {});

export async function runImpactAnalysis(a: ImpactArticle): Promise<ImpactContent | null> {
  const model = await modelFor("impact");
  const res = await chatJson({
    model,
    purpose: "impact_analysis",
    subject: `article:${a.articleId}`,
    promptVersion: promptVersion("impact-analysis"),
    system: SYSTEM(),
    user: impactUser(a),
    schema: ImpactSchema,
    temperature: 0,
    maxTokens: 2048,
  });
  const exists = await sql`SELECT 1 FROM impact_analyses WHERE article_id = ${a.articleId} LIMIT 1`;
  if (exists.length) return null; // 一篇一份：重放/重试不重复计费
  const [row] = await sql<{ article_id: string }[]>`
    INSERT INTO impact_analyses (article_id, story_id, content, model, receipt_id)
    VALUES (${a.articleId}, ${a.storyId}, ${JSON.stringify(res.data)}, ${res.model}, ${res.receiptId})
    ON CONFLICT (article_id) DO NOTHING
    RETURNING article_id`;
  return row ? res.data : null;
}

/** 是否值得为它排一次分析（供 articleChanged 钩子判断）。 */
export async function shouldQueueImpact(articleId: string): Promise<boolean> {
  const rows = await sql<{ selected: boolean; visibility: string; category: string | null; score: string | number | null }[]>`
    SELECT selected, visibility, category, score FROM publications WHERE article_id = ${articleId} LIMIT 1`;
  const row = rows[0];
  return !!row && qualifies(row, MIN_SCORE());
}
