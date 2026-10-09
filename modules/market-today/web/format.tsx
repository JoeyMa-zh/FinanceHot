// market-today 模块的日期与数值显示：北京时间为主、美东时间为辅（夏令时由 Intl 按时刻自动换算），
// 缺失值一律显示“暂无数据”（数据库里就是 null，绝不显示 0）。
const bj = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", weekday: "short" });
const bjTime = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false });
const etTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const bjDateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });

/** 接口里是 ISO 字符串，服务端类型里是 Date：统一成 Date 再交给 Intl。 */
const date = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

/** 北京时间的“10月14日 周二”。 */
export const bjDay = (v: Date | string): string => bj.format(date(v));

/** 北京时间的 HH:mm。 */
export const bjClock = (v: Date | string): string => bjTime.format(date(v));

/** 美东时间的 HH:mm（随夏令时换算）。 */
export const etClock = (v: Date | string): string => etTime.format(date(v));

/** 按北京时间分组的日期键（YYYY-MM-DD）。 */
export const dayKey = (v: Date | string): string => bjDateKey.format(date(v));

/** 数值显示：缺失 → “暂无数据”。 */
export const shown = (v: string | null | undefined): string => (v === null || v === undefined || v === "" ? "暂无数据" : v);

export const STATUS_TEXT: Record<string, string> = { upcoming: "待公布", released: "已公布", delayed: "延期", cancelled: "取消" };

const STATUS_CLASS: Record<string, string> = {
  upcoming: "bg-bg-muted text-ink-3",
  released: "bg-accent-soft text-accent",
  delayed: "bg-amber-soft text-amber",
  cancelled: "bg-bg-muted text-ink-4 line-through",
};

export function StatusChip({ status, revised }: { status: string; revised?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 text-[11px] font-medium leading-5 ${STATUS_CLASS[status] ?? STATUS_CLASS.upcoming}`}>
      {STATUS_TEXT[status] ?? status}
      {revised ? <span title="公布后数值有过修订">已修订</span> : null}
    </span>
  );
}
