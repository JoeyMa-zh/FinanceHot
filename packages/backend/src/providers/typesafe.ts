// TypeSafe SystemOne（Jev）：类型化判断接口，返回带概率的 choice/score 而不是聊天文本。
// 按请求计费，走回执与预算熔断；key 缺失时调用方应整体跳过（模块保持关闭）。
import { credential } from "../config.ts";
import { guardedFetch } from "../lib/http-fetch.ts";
import { assertAccepted, paidRequest } from "./receipts.ts";

export const TYPESAFE_MODEL = "jev-latest";

/** 一次 SystemOne 请求里的问题（choice 的 criteria：选项 → 描述）。 */
export interface TypesafeQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface TypesafeAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface TypesafeResult {
  answers: Record<string, TypesafeAnswer>;
  model: string;
  receiptId: number;
}

/**
 * 发起一次 SystemOne 判断。回执身份是完整的请求内容（state + questions），同一身份的重试复用回执；
 * usage 记 token，单价未公开所以不估算成本。
 */
export async function typesafeJudge(
  state: unknown,
  questions: Record<string, TypesafeQuestion>,
  opts: { purpose: string; subject: string; attemptTag?: string },
): Promise<TypesafeResult> {
  const key = credential("collectors", "TYPESAFE_API_KEY");
  if (!key) throw new Error("TYPESAFE_API_KEY is not configured");
  const base = (credential("collectors", "TYPESAFE_BASE_URL") ?? "https://api.typesafe.ai/v1").replace(/\/$/, "");
  const receipt = await paidRequest(
    { service: "typesafe", model: TYPESAFE_MODEL, purpose: opts.purpose, subject: opts.subject, identity: { state, questions }, attemptTag: opts.attemptTag },
    async () => {
      const res = await guardedFetch(`${base}/systemone`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ model: TYPESAFE_MODEL, state, questions }),
        timeoutMs: 30_000,
        maxBytes: 1 * 1024 * 1024,
        route: "egress",
      });
      const body = res.text();
      assertAccepted("typesafe", res.status, body);
      const parsed = JSON.parse(body) as { answers?: unknown; model?: unknown; usage?: { input_tokens?: number; output_tokens?: number } };
      if (!parsed.answers || typeof parsed.answers !== "object") throw new Error("typesafe: response has no answers");
      const tokens = (parsed.usage?.input_tokens ?? 0) + (parsed.usage?.output_tokens ?? 0) || null;
      return { response: parsed, requestId: null, usage: { tokens }, cost: null };
    },
  );
  const out = receipt.response as { answers: Record<string, TypesafeAnswer>; model?: string };
  return { answers: out.answers, model: out.model ?? TYPESAFE_MODEL, receiptId: receipt.receiptId };
}
