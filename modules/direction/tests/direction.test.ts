// 方向判读纯逻辑的测试：答案归一化（缺字段/非法值兜底）、neutral 时 scope 必空、展示闸门、请求组装。
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRequest, mapAnswers, shouldDisplay, DISPLAY_CONFIDENCE } from "../judgment.ts";

test("mapAnswers: 正常答案原样归一", () => {
  const v = mapAnswers({
    direction: { choice: "bullish", confidence: 0.9, probabilities: { bullish: 0.92, bearish: 0.07, neutral: 0.01 } },
    scope: { choice: "stock_us", confidence: 0.94, probabilities: { stock_us: 0.9 } },
  });
  assert.equal(v.direction, "bullish");
  assert.equal(v.scope, "stock_us");
  assert.equal(v.confidence, 0.9);
  assert.ok(shouldDisplay(v));
});

test("mapAnswers: neutral 时 scope 必为 null（含 none 选项）", () => {
  const v = mapAnswers({
    direction: { choice: "neutral", confidence: 0.64, probabilities: {} },
    scope: { choice: "none", confidence: 0.97, probabilities: {} },
  });
  assert.equal(v.direction, "neutral");
  assert.equal(v.scope, null);
  assert.equal(shouldDisplay(v), false);
});

test("mapAnswers: 缺字段与非法值兜底为 neutral，不抛错", () => {
  assert.equal(mapAnswers({}).direction, "neutral");
  assert.equal(mapAnswers({ direction: { choice: "very_bullish", confidence: 0.9 } }).direction, "neutral");
  assert.equal(mapAnswers({ direction: { choice: "bullish", confidence: "oops" } }).confidence, 0);
  // 方向合法但 scope 非法：scope 兜底 null，方向保留
  const v = mapAnswers({ direction: { choice: "bearish", confidence: 0.9 }, scope: { choice: "stocks" } });
  assert.equal(v.direction, "bearish");
  assert.equal(v.scope, null);
});

test("展示闸门：低于置信度线的不展示，non-neutral 且达标才展示", () => {
  const low = mapAnswers({ direction: { choice: "bullish", confidence: DISPLAY_CONFIDENCE - 0.01 }, scope: { choice: "gold" } });
  assert.equal(shouldDisplay(low), false);
  const edge = mapAnswers({ direction: { choice: "bearish", confidence: DISPLAY_CONFIDENCE }, scope: { choice: "oil" } });
  assert.equal(shouldDisplay(edge), true);
});

test("buildRequest: state 带齐材料，两个问题都是 choice 且有 criteria", () => {
  const { state, questions } = buildRequest({
    articleId: "a1", title: "美联储宣布降息25个基点", summary: "FOMC 下调利率。", sourceName: "美联储新闻稿", category: "央行政策", tags: ["央行政策"],
  });
  assert.equal(state.title, "美联储宣布降息25个基点");
  assert.ok(questions.direction.criteria.bullish);
  assert.ok(questions.scope.criteria["stock_cn"]);
  assert.ok(questions.scope.instructions.includes("stock_us"));
});
