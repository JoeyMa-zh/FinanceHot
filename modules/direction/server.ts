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

function configured(): boolean {
  return !!credential("collectors", "TYPESAFE_API_KEY");
}

/**
 * 周期扫描待判读的文章并入队。不挂 articleChanged：新文章的首次发布不发该事件（只有修订与
 * 管理操作才发），队列必须由扫描来喂。批量上限一次 60 篇，让积压在几轮内消化而不是挤占队列。
 */
async function sweep(): Promise<{ queued: number }> {
  if (!configured() || process.env.MODEL_CALLS_ENABLED !== "true") return { queued: 0 };
  const rows = await sql<{ id: string }[]>`
    SELECT p.article_id AS id
    FROM publications p JOIN articles a ON a.id = p.article_id
    WHERE p.selected AND p.visibility = 'public' AND p.category IS DISTINCT FROM 'opinion'
      AND a.backfill = false AND a.published_at > now() - interval '7 days'
      AND NOT EXISTS (SELECT 1 FROM direction_signals d WHERE d.article_id = p.article_id)
    ORDER BY p.timeline_at DESC LIMIT 60`;
  for (const { id } of rows) await enqueueOn(DIRECTION_QUEUE, { articleId: id });
  return { queued: rows.length };
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
            ${sql.json(verdict.probabilities)}, ${result.model}, ${result.receiptId})
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
  schedules: [
    {
      name: "direction.sweep",
      cron: "3-59/10 * * * *",
      when: () => !!credential("collectors", "TYPESAFE_API_KEY") && process.env.MODEL_CALLS_ENABLED === "true",
      run: sweep,
    },
  ],
  queues: [DIRECTION_QUEUE],
});
