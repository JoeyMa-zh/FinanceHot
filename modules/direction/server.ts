// direction 模块的后端：新闻方向信号的 TypeSafe（Jev）判断队列与 articleChanged 钩子。
// 影子模式：结果只入库（direction_signals），页面上还没有任何展示。
// 开关：沿用全站安全阀 MODEL_CALLS_ENABLED；没配 TYPESAFE_API_KEY 时整个模块空闲。
import { sql } from "@aihot/backend/db";
import { defineServerModule, type ModuleQueue } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { credential } from "@aihot/backend/config";
import { typesafeJudge } from "@aihot/backend/providers/typesafe";
import { buildRequest, mapAnswers, type DirectionInput } from "./judgment.ts";

interface DirectionJob {
  articleId: string;
}

const DIRECTION_QUEUE: ModuleQueue<DirectionJob> = {
  name: "direction.signals",
  options: {},
  worker: {},
  run: async (jobs) => {
    for (const { articleId } of jobs) {
      await judgeArticle(articleId);
    }
  },
};

/** 判读资格：已发布（publications 里有行）、公开入选、非评论类、非历史回填、还没有判过。 */
async function shouldQueueDirection(articleId: string): Promise<boolean> {
  if (!configured()) return false;
  const [row] = await sql<{ ok: boolean }[]>`
    SELECT (p.article_id IS NOT NULL) AS ok
    FROM publications p JOIN articles a ON a.id = p.article_id
    WHERE p.article_id = ${articleId} AND p.selected AND p.visibility = 'public' AND p.category IS DISTINCT FROM 'opinion'
      AND a.backfill = false
      AND NOT EXISTS (SELECT 1 FROM direction_signals d WHERE d.article_id = ${articleId})
    LIMIT 1`;
  return !!row?.ok;
}

async function onArticleChanged(change: { id: string; kind: string; reduced?: boolean }): Promise<void> {
  if (change.kind !== "content" || change.reduced) return;
  if (process.env.MODEL_CALLS_ENABLED !== "true") return;
  if (!(await shouldQueueDirection(change.id))) return;
  await enqueueOn(DIRECTION_QUEUE, { articleId: change.id });
}

function configured(): boolean {
  return !!credential("collectors", "TYPESAFE_API_KEY");
}

/** 对一篇新闻做方向判读并落库；已判过（并发/重放）就跳过。 */
async function judgeArticle(articleId: string): Promise<void> {
  if (!configured()) return;
  const input = await loadInput(articleId);
  if (!input) return;
  const { state, questions } = buildRequest(input);
  const result = await typesafeJudge(state, questions, { purpose: "direction", subject: articleId });
  const verdict = mapAnswers(result.answers);
  await sql`
    INSERT INTO direction_signals (article_id, direction, scope, confidence, probabilities, model, receipt_id)
    VALUES (${articleId}, ${verdict.direction}, ${verdict.scope}, ${verdict.confidence},
            ${JSON.stringify(verdict.probabilities)}, ${result.model}, ${result.receiptId})
    ON CONFLICT (article_id) DO NOTHING`;
}

async function loadInput(articleId: string): Promise<DirectionInput | null> {
  const [row] = await sql<DirectionInput[]>`
    SELECT p.article_id, p.title, p.summary, s.name AS source_name, p.category, p.tags
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE p.article_id = ${articleId} AND p.selected AND p.visibility = 'public' LIMIT 1`;
  return row ?? null;
}

export default defineServerModule({
  name: "direction",
  queues: [DIRECTION_QUEUE],
  on: { articleChanged: onArticleChanged },
});
