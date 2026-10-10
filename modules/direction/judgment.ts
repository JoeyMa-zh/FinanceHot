// 方向判读的纯逻辑：把一篇已发布新闻组装成 TypeSafe（Jev）判断请求，再把类型化答案归一化。
// 拿不准就不给方向（neutral）：宁可没有角标，不给错误信号；置信度门槛决定是否对外展示。
import type { TypesafeQuestion } from "@aihot/backend/providers/typesafe";

/** 方向取值与资产类别（本站的口径：宏观政策/数据类新闻按股市大盘判断）。 */
export const DIRECTIONS = ["bullish", "bearish", "neutral"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const SCOPES = ["stock_cn", "stock_us", "gold", "oil", "bitcoin", "bond", "forex", "none"] as const;
export type Scope = (typeof SCOPES)[number];

/** 置信度达到它才对外展示角标；0.5–0.75 的判断留在库里当校准样本。 */
export const DISPLAY_CONFIDENCE = 0.75;

/** 判读请求的输入材料（来自 publications 的已发布版本）。 */
export interface DirectionInput {
  articleId: string;
  title: string;
  summary: string | null;
  sourceName: string;
  category: string | null;
  tags: string[];
}

const DIRECTION_QUESTION: TypesafeQuestion = {
  type: "choice",
  instructions:
    "该新闻的方向信号：选出最直接受影响的资产类别并给出利好还是利空。宏观数据、央行政策、政策监管类新闻一律按对股市大盘的影响判断；市场行情类新闻按报道的涨跌事实。与资产价格关联太弱、方向不明确就选 neutral。",
  criteria: {
    bullish: "对所选资产为上行推动（利好）",
    bearish: "对所选资产为下行压力（利空）",
    neutral: "方向不明确、多空交织或关联太弱",
  },
};

const SCOPE_QUESTION: TypesafeQuestion = {
  type: "choice",
  instructions:
    "最直接受影响的单一资产类别。宏观数据、央行政策、政策监管类新闻优先选股市：美国宏观事件选 stock_us，中国宏观事件选 stock_cn。",
  criteria: {
    stock_cn: "中国A股/港股股市",
    stock_us: "美股股市",
    gold: "黄金等贵金属",
    oil: "原油",
    bitcoin: "比特币等加密资产",
    bond: "债券/利率",
    forex: "外汇",
    none: "无明确受影响资产（与 neutral 搭配）",
  },
};

/** 组装一次判断请求（state + 两个问题）。 */
export function buildRequest(input: DirectionInput): { state: Record<string, unknown>; questions: Record<string, TypesafeQuestion> } {
  const state = {
    title: input.title,
    summary: input.summary,
    source: input.sourceName,
    category: input.category,
    tags: input.tags,
  };
  return { state, questions: { direction: DIRECTION_QUESTION, scope: SCOPE_QUESTION } };
}

export interface DirectionVerdict {
  direction: Direction;
  scope: Scope | null;
  confidence: number;
  probabilities: { direction: Record<string, number>; scope: Record<string, number> | null };
}

/** 把 TypeSafe 的答案归一化；方向缺失/非法一律 neutral，scope 在 neutral 或 none 时为 null。 */
export function mapAnswers(answers: {
  direction?: { choice?: unknown; confidence?: unknown; probabilities?: unknown };
  scope?: { choice?: unknown; confidence?: unknown; probabilities?: unknown };
}): DirectionVerdict {
  const d = answers.direction?.choice;
  const direction: Direction = DIRECTIONS.includes(d as Direction) ? (d as Direction) : "neutral";
  const s = answers.scope?.choice;
  const scope: Scope | null = direction === "neutral" || !SCOPES.includes(s as Scope) || s === "none" ? null : (s as Scope);
  const confidence = Number.isFinite(Number(answers.direction?.confidence)) ? Number(answers.direction!.confidence) : 0;
  return {
    direction,
    scope,
    confidence,
    probabilities: {
      direction: isRecord(answers.direction?.probabilities) ? (answers.direction!.probabilities as Record<string, number>) : {},
      scope: isRecord(answers.scope?.probabilities) ? (answers.scope!.probabilities as Record<string, number>) : null,
    },
  };
}

/** 展示闸门：非中性且置信度达标。0.5–0.75 的判断入库不展示（影子区，攒校准样本）。 */
export function shouldDisplay(v: DirectionVerdict): boolean {
  return v.direction !== "neutral" && v.scope !== null && v.confidence >= DISPLAY_CONFIDENCE;
}

function isRecord(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
