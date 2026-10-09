// 经济日历与影响分析的测试：时区偏移（含夏令时）、缺失值绝不落 0、重复导入幂等、
// 延期/取消、公布后数值修订（revised）、事件识别，以及影响分析的资格门槛与容错解析。
import { tag } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import {
  deriveStatus,
  eventKeyForTitle,
  importEvents,
  normalizeFeedItem,
  parseReleaseAt,
  EVENT_KEYS,
  type CalendarEvent,
} from "../calendar.ts";
import { ImpactSchema, qualifies, impactUser, type ImpactArticle } from "../impact.ts";

const feed = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: "CPI m/m", country: "US", date: "2026-07-15T08:30:00-04:00", impact: "high",
  forecast: "0.3%", previous: "0.2%", ...over,
});

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  eventKey: "cpi", title: "CPI m/m", country: "US", impactLevel: "high",
  releaseAt: new Date("2026-07-15T12:30:00Z"), referencePeriod: "m/m",
  previousValue: "0.2%", consensusValue: "0.3%", actualValue: null, status: "upcoming", ...over,
});

test("parseReleaseAt keeps the feed's own offset, so DST is expressed by the data", () => {
  // 夏令时（7 月，美东 -04:00）与冬令时（12 月，-05:00）：换算成 UTC 差一小时。
  assert.equal(parseReleaseAt("2026-07-15T08:30:00-04:00")?.toISOString(), "2026-07-15T12:30:00.000Z");
  assert.equal(parseReleaseAt("2026-12-15T08:30:00-05:00")?.toISOString(), "2026-12-15T13:30:00.000Z");
  assert.equal(parseReleaseAt("not a date"), null);
  assert.equal(parseReleaseAt(""), null);
  assert.equal(parseReleaseAt(undefined), null);
});

test("eventKeyForTitle tells the ten tracked events apart and rejects the rest", () => {
  const cases: Array<[string, (typeof EVENT_KEYS)[number] | null]> = [
    ["Core CPI m/m", "cpi"], ["CPI y/y", "cpi"], ["Core PCE Price Index m/m", "pce"],
    ["Non-Farm Payrolls (NFP)", "nfp"], ["Unemployment Rate", "unemployment"], ["GDP q/q (advance)", "gdp"],
    ["Retail Sales m/m", "retail_sales"], ["Retail Sales Control Group", null],
    ["ISM Manufacturing PMI", "ism_mfg"], ["ISM Services PMI", "ism_services"],
    ["JOLTS Job Openings", "jolts"], ["FOMC Statement", "fomc"], ["Fed Interest Rate Decision", "fomc"],
    ["FOMC Meeting Minutes", "fomc"], ["FOMC Member Waller Speaks", null], ["Fed official testifies on policy", null],
    ["CPI m/m", "cpi"], ["Federal Funds Rate", "fomc"],
    ["Earnings: Apple Q3", null], ["FOMTC typo", null],
  ];
  for (const [title, key] of cases) assert.equal(eventKeyForTitle(title), key, title);
});

test("normalizeFeedItem keeps feed text as-is; missing values become null, never '0'-like placeholders", () => {
  const e = normalizeFeedItem(feed(), "test")!;
  assert.equal(e.eventKey, "cpi");
  assert.equal(e.releaseAt.toISOString(), "2026-07-15T12:30:00.000Z");
  assert.equal(e.consensusValue, "0.3%");
  assert.equal(e.status, "upcoming");
  assert.equal(e.referencePeriod, "m/m");
  // 预期缺失：空串、n/a、--、缺字段都一样是 null（页面上显示“暂无数据”）。
  for (const forecast of ["", "n/a", "N/A", "--", "—", "none", null, undefined]) {
    const x = normalizeFeedItem(feed({ forecast }), "test")!;
    assert.equal(x.consensusValue, null, String(forecast));
  }
  // 信源真的给了 0 就是数据（比如失业率 0 不现实但规则上一视同仁），本站绝不自己造 0。
  assert.equal(normalizeFeedItem(feed({ forecast: 0 }), "test")!.consensusValue, "0");
  assert.equal(normalizeFeedItem(feed({ title: "Speech by regional Fed president" }), "test"), null, "untracked kinds are dropped");
  assert.equal(normalizeFeedItem(feed({ date: "sometime" }), "test"), null, "no parseable time, no event");
  assert.equal(normalizeFeedItem(feed({ title: "  " }), "test"), null);
});

test("deriveStatus: feed delay/cancel wins, then actual means released", () => {
  assert.equal(deriveStatus("3.2%", "delayed"), "delayed");
  assert.equal(deriveStatus("3.2%", "postponed"), "delayed");
  assert.equal(deriveStatus(null, "cancelled"), "cancelled");
  assert.equal(deriveStatus(null, "canceled"), "cancelled");
  assert.equal(deriveStatus("3.2%", undefined), "released");
  assert.equal(deriveStatus(null, undefined), "upcoming");
  assert.equal(deriveStatus(null, "completed"), "upcoming");
});

before(async () => {
  await sql`DELETE FROM econ_events WHERE source_name = 'test'`;
});

after(async () => {
  await sql`DELETE FROM econ_events WHERE source_name = 'test'`;
  await closeDb();
});

test("importEvents is idempotent: duplicates in a batch and re-imports update instead of duplicating", async () => {
  const day = (h: number) => new Date(Date.UTC(2026, 6, 10 + h, 12, 30));
  const batch = [
    event({ releaseAt: day(0), actualValue: null }),
    event({ releaseAt: day(0), consensusValue: "0.4%" }), // 同一批里的重复条目
    event({ releaseAt: day(1), eventKey: "fomc", title: "FOMC Statement" }),
  ];
  const first = await importEvents(batch, "test");
  assert.equal(first.inserted, 2, "the duplicate merges into one row");
  const second = await importEvents(batch, "test");
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 2);
  assert.equal(second.revised, 0);
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM econ_events WHERE source_name = 'test' AND release_at = ${day(0)}`;
  assert.equal(rows[0]!.n, 1);
});

test("a released value that later changes is a revision; missing consensus stays null in the database", async () => {
  const at = new Date(Date.UTC(2026, 6, 20, 12, 30));
  await importEvents([event({ releaseAt: at, consensusValue: null })], "test");
  const stored = await sql<{ consensus_value: string | null; status: string }[]>`
    SELECT consensus_value, status FROM econ_events WHERE source_name = 'test' AND release_at = ${at}`;
  assert.equal(stored[0]!.consensus_value, null, "no consensus from the feed stays null (shown as 暂无数据)");
  assert.equal(stored[0]!.status, "upcoming");
  // 第一次公布：有实际值 → released，不算修订。
  const release = await importEvents([event({ releaseAt: at, consensusValue: null, actualValue: "3.0%", status: "released" })], "test");
  assert.equal(release.revised, 0);
  // 数据修订：已公布之后实际值又被改动 → revised。
  const revise = await importEvents([event({ releaseAt: at, consensusValue: null, actualValue: "3.1%", status: "released" })], "test");
  assert.equal(revise.revised, 1);
  const final = await sql<{ actual_value: string | null; revised: boolean }[]>`
    SELECT actual_value, revised FROM econ_events WHERE source_name = 'test' AND release_at = ${at}`;
  assert.equal(final[0]!.actual_value, "3.1%");
  assert.equal(final[0]!.revised, true, "the row carries the revision marker");
  // 延期：信源改了公布时间（新 release_at）→ 新的一行，旧的不冒充新时间。
  const delayed = await importEvents([event({ releaseAt: new Date(Date.UTC(2026, 6, 27, 12, 30)), status: "delayed" })], "test");
  assert.equal(delayed.inserted, 1);
});

test("impact analysis: the gate, the catch-all schema and the prompt material", () => {
  const row = { selected: true, visibility: "public", category: "macro", score: "82" };
  assert.equal(qualifies(row, 80), true);
  assert.equal(qualifies({ ...row, score: "79.9" }, 80), false);
  assert.equal(qualifies({ ...row, selected: false }, 80), false, "not selected, not analyzed");
  assert.equal(qualifies({ ...row, visibility: "summary-only" }, 80), false);
  assert.equal(qualifies({ ...row, category: "opinion" }, 80), false, "commentary never gets a scenario analysis");
  assert.equal(qualifies({ ...row, score: null }, 80), false);
  // 模型输出不合规矩时也不炸：全字段兜底。
  const parsed = ImpactSchema.parse({ coreFacts: "not an array", bullish: { view: "x" } });
  assert.deepEqual(parsed.coreFacts, []);
  assert.deepEqual(parsed.bullish, { view: "x", conditions: "" });
  assert.equal(parsed.bearish, null);
  const article: ImpactArticle = {
    articleId: "a1", title: "美联储维持利率不变", summary: null, url: "https://example.org/a1",
    sourceName: "Example", publishedAt: new Date("2026-07-15T18:00:00Z"), selected: true, visibility: "public",
    category: "macro", tags: ["利率", "美联储"], score: 90, storyId: null, storyTitle: null, storyDigest: null,
  };
  const user = impactUser(article);
  assert.match(user, /美联储维持利率不变/);
  assert.match(user, /利率、美联储/);
  assert.doesNotMatch(user, /行情|涨跌/, "no market data is attached: the site has none");
});
