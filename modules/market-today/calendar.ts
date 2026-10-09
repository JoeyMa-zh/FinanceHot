// 经济事件日历的纯逻辑：把日历信源的条目归一化成站内事件，再按（事件, 公布时间）幂等导入。
// 数值一律保留信源原文文本；缺失就是 null（页面显示“暂无数据”），绝不补 0，也绝不由模型猜预期值。
import { sql } from "@aihot/backend/db";

/** 站内跟踪的事件种类（event_key），按关键词从标题识别。 */
export const EVENT_KEYS = ["cpi", "pce", "nfp", "unemployment", "gdp", "retail_sales", "ism_mfg", "ism_services", "jolts", "fomc"] as const;
export type EventKey = (typeof EVENT_KEYS)[number];
export type EventStatus = "upcoming" | "released" | "delayed" | "cancelled";

export interface CalendarEvent {
  eventKey: EventKey | null;
  title: string;
  country: string | null;
  impactLevel: string | null;
  /** 公布时刻（带时区）。 */
  releaseAt: Date;
  /** 所属统计期间（口径后缀如 m/m、q/q、年份月份；信源没写就是 null）。 */
  referencePeriod: string | null;
  previousValue: string | null;
  consensusValue: string | null;
  actualValue: string | null;
  status: EventStatus;
}

/** 标题 → 事件种类。关键词按长匹配优先，避免 “Core CPI” 之外误吞。 */
export function eventKeyForTitle(title: string): EventKey | null {
  const t = title.toLowerCase();
  if (/jolts|job openings/.test(t)) return "jolts";
  // FOMC 的决议类沟通才算是事件；官员演讲、证词是日常日程，不进日历。
  const fomcSpeech = /speaks|speech|testif|testimony|interview/.test(t);
  if (!fomcSpeech && (/fomc|federal funds rate|fed (?:interest )?rate decision|fed statement/.test(t))) return "fomc";
  if (/core cpi|cpi/.test(t)) return "cpi";
  if (/core pce|pce price index|pce\b/.test(t)) return "pce";
  if (/non-?farm payrolls|nonfarm payrolls|\bnfp\b/.test(t)) return "nfp";
  if (/unemployment rate|jobless rate/.test(t)) return "unemployment";
  if (/\bgdp\b|gross domestic product/.test(t)) return "gdp";
  if (/retail sales(?! control)/.test(t)) return "retail_sales";
  if (/ism.{0,20}manufacturing|manufacturing pmi/.test(t)) return "ism_mfg";
  if (/ism.{0,20}services|services pmi/.test(t)) return "ism_services";
  return null;
}

/** 信源里的公布时间：ISO 字符串（自带时区偏移，夏令时由偏移表达）。解析不了返回 null。 */
export function parseReleaseAt(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** 口径后缀（m/m、y/y、q/q、MoM、YoY、QoQ），没有就 null。 */
function referencePeriodOf(title: string): string | null {
  const m = /\b(m\/m|y\/y|q\/q|w\/w|mom|yoy|qoq|wow)\b/i.exec(title);
  return m ? m[1]!.toLowerCase() : null;
}

/** 缺失/空串/null 一律变 null；字符串值去掉首尾空白。绝不能出现 "0" 冒充数据。 */
function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" || /^(n\/?a|--|—|none)$/i.test(s) ? null : s;
}

const FEED_STATUSES: Readonly<Record<string, EventStatus>> = { delayed: "delayed", postponed: "delayed", cancelled: "cancelled", canceled: "cancelled" };

/** 状态推导：信源明确给了延期/取消就用它；有实际值即已公布；其余（含已过点未公布）都是待公布。 */
export function deriveStatus(actual: string | null, feedStatus: unknown): EventStatus {
  const fed = typeof feedStatus === "string" ? FEED_STATUSES[feedStatus.toLowerCase()] : undefined;
  if (fed) return fed;
  return actual ? "released" : "upcoming";
}

/** 日历信源的一条原始条目（ForexFactory 风格 JSON）→ 站内事件；不是跟踪的事件种类返回 null。 */
export function normalizeFeedItem(raw: unknown, feedName: string): CalendarEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) return null;
  const releaseAt = parseReleaseAt(r.date);
  if (!releaseAt) return null;
  const eventKey = eventKeyForTitle(title);
  if (!eventKey) return null;
  const actualValue = textOrNull(r.actual);
  return {
    eventKey,
    title,
    country: textOrNull(r.country),
    impactLevel: textOrNull(r.impact),
    releaseAt,
    referencePeriod: referencePeriodOf(title),
    previousValue: textOrNull(r.previous),
    consensusValue: textOrNull(r.forecast),
    actualValue,
    status: deriveStatus(actualValue, r.status),
  };
}

/** 同一批里（事件, 公布时间）去重：重复导入只留一条，后面的不覆盖前面的。 */
function dedupeBatch(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Map<string, CalendarEvent>();
  for (const e of events) {
    if (!e.eventKey) continue;
    const key = `${e.eventKey}@${e.releaseAt.toISOString()}`;
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.values()];
}

export interface ImportResult {
  /** 本次新插入的事件数。 */
  inserted: number;
  /** 本次更新的既有事件数。 */
  updated: number;
  /** 已公布之后实际值又被改动（数据修订）的事件数。 */
  revised: number;
}

/**
 * 幂等导入：同一 (event_key, release_at) 只有一行。实际值在“已公布”之后变化 → revised=true（数据修订）；
 * 预期值/前值缺失保持 null，等待信源补齐，不落 0。
 */
export async function importEvents(events: CalendarEvent[], feedName: string | null): Promise<ImportResult> {
  const batch = dedupeBatch(events);
  if (!batch.length) return { inserted: 0, updated: 0, revised: 0 };
  const existing = new Set(
    (await sql<{ key: string }[]>`
      SELECT event_key || '@' || EXTRACT(EPOCH FROM release_at)::bigint AS key FROM econ_events
      WHERE release_at >= ${batch[0]!.releaseAt} AND release_at <= ${batch.reduce((a, b) => (a.releaseAt > b.releaseAt ? a : b)).releaseAt}
    `).map((r) => r.key),
  );
  let inserted = 0;
  let updated = 0;
  let revised = 0;
  for (const e of batch) {
    const key = `${e.eventKey}@${e.releaseAt.getTime() / 1000}`;
    const isNew = !existing.has(key);
    const rows = await sql<{ revised: boolean }[]>`
      INSERT INTO econ_events (event_key, title, country, impact_level, release_at, reference_period, previous_value, consensus_value, actual_value, status, source_name, feed_updated_at)
      VALUES (${e.eventKey}, ${e.title}, ${e.country}, ${e.impactLevel}, ${e.releaseAt}, ${e.referencePeriod}, ${e.previousValue}, ${e.consensusValue}, ${e.actualValue}, ${e.status}, ${feedName}, now())
      ON CONFLICT (event_key, release_at) DO UPDATE SET
        title = EXCLUDED.title,
        country = EXCLUDED.country,
        impact_level = EXCLUDED.impact_level,
        reference_period = COALESCE(EXCLUDED.reference_period, econ_events.reference_period),
        previous_value = COALESCE(EXCLUDED.previous_value, econ_events.previous_value),
        consensus_value = COALESCE(EXCLUDED.consensus_value, econ_events.consensus_value),
        actual_value = COALESCE(EXCLUDED.actual_value, econ_events.actual_value),
        status = EXCLUDED.status,
        source_name = EXCLUDED.source_name,
        feed_updated_at = now(),
        updated_at = now(),
        revised = econ_events.status = 'released'
          AND EXCLUDED.actual_value IS NOT NULL
          AND econ_events.actual_value IS DISTINCT FROM EXCLUDED.actual_value
      RETURNING revised
    `;
    if (isNew) inserted += 1;
    else updated += 1;
    if (rows[0]?.revised) revised += 1;
  }
  return { inserted, updated, revised };
}
