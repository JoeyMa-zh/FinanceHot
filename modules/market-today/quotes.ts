// 今日市场的行情快照：恐惧贪婪指数（CNN）、全球指数涨跌（腾讯+新浪）、A 股行业与概念板块（东方财富）。
// 全部是免费公开接口；worker 定时导入快照进 market_snapshots，页面只读库，打开不触发外部请求。
// 数值保留信源口径（百分比一位小数由信源给出）；接口失败保留上一次快照，页面显示快照时间。
import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";

const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "application/json, text/plain, */*",
};

export interface FearGreedSnapshot {
  score: number;
  rating: string;
  previousClose: number | null;
}

export interface IndexQuote {
  name: string;
  price: number;
  change: number;
  changePct: number;
  /** 当日（无当日数据时近 5 日）走势，降采样到 ≤60 点；拿不到就没有。 */
  trend?: number[];
}

export interface RegionSentiment {
  region: string;
  /** 该区域主指数当日的情绪词，由涨跌幅分档得出。 */
  sentiment: string;
  indices: IndexQuote[];
}

export interface SectorsSnapshot {
  industries: Array<{ name: string; changePct: number }>;
  concepts: Array<{ name: string; changePct: number }>;
  /** 申万一级全量（31 个），页面用来画领涨/领跌泡泡池。 */
  allIndustries: Array<{ name: string; changePct: number }> | null;
  topIndustries: Array<{ name: string; changePct: number }>;
  bottomIndustries: Array<{ name: string; changePct: number }>;
}

export interface QuotesSnapshot {
  fearGreed: FearGreedSnapshot | null;
  regions: RegionSentiment[];
  sectors: SectorsSnapshot | null;
  /** 美股大公司（纳斯达克 100 市值前 20 成分股加闪迪），按涨跌幅降序；取不到时为 null。 */
  usSectors: Array<{ name: string; changePct: number }> | null;
  fetchedAt: string;
}

/** 抓取 CNN 恐惧贪婪指数（0–100，rating：extreme fear/fear/neutral/greed/extreme greed）。 */
export async function fetchFearGreed(): Promise<FearGreedSnapshot | null> {
  const res = await guardedFetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
    headers: { ...BROWSER_HEADERS, referer: "https://edition.cnn.com/markets/fear-and-greed" },
    timeoutMs: 20_000,
    maxBytes: 2 * 1024 * 1024,
    route: "egress",
  });
  if (res.status !== 200) throw new Error(`fear&greed: HTTP ${res.status}`);
  const body = JSON.parse(res.text()) as { fear_and_greed?: { score?: number; rating?: string; previous_close?: number } };
  const f = body.fear_and_greed;
  if (typeof f?.score !== "number" || typeof f?.rating !== "string") throw new Error("fear&greed: no score in payload");
  return { score: Math.round(f.score * 10) / 10, rating: f.rating, previousClose: typeof f.previous_close === "number" ? Math.round(f.previous_close * 10) / 10 : null };
}

/** 涨跌幅 → 情绪词（中国习惯：红涨绿跌由页面渲染，这里只给词）。 */
export function sentimentOf(changePct: number): string {
  if (changePct >= 1) return "贪婪";
  if (changePct >= 0.3) return "乐观";
  if (changePct > -0.3) return "中性";
  if (changePct > -1) return "谨慎";
  return "恐惧";
}

function parseQuotes(text: string): Map<string, IndexQuote> {
  const out = new Map<string, IndexQuote>();
  for (const m of text.matchAll(/="([^"]*)"/g)) {
    const f = m[1]!.split("~");
    // 腾讯 s_ 简版行：市场~名称~代码~价~涨跌~涨跌幅
    if (f.length >= 6 && Number.isFinite(Number(f[3]))) {
      const name = f[1]!;
      if (name) out.set(name, { name, price: Number(f[3]), change: Number(f[4]), changePct: Number(f[5]) });
    }
  }
  return out;
}

function parseSinaQuotes(text: string): Map<string, IndexQuote> {
  const out = new Map<string, IndexQuote>();
  for (const m of text.matchAll(/var hq_str_[A-Za-z0-9_]+="([^"]*)"/g)) {
    const f = m[1]!.split(",");
    // 新浪 znb_ 国际指数行：名称,点位,涨跌,涨跌幅,…
    if (f.length >= 4 && Number.isFinite(Number(f[1])) && f[0]) {
      out.set(f[0]!, { name: f[0]!, price: Number(f[1]), change: Number(f[2]), changePct: Number(f[3]) });
    }
  }
  return out;
}

/** 各区域的指数清单与主指数（定情绪）；名称用信源原文，缺哪个指数就少显示哪个。 */
const REGIONS: Array<{ region: string; primary: string; names: string[] }> = [
  { region: "中国大陆", primary: "上证指数", names: ["上证指数", "深证成指", "创业板指"] },
  { region: "香港", primary: "恒生指数", names: ["恒生指数", "恒生科技指数"] },
  { region: "美国", primary: "标普500", names: ["道琼斯", "纳斯达克", "标普500"] },
  { region: "日本", primary: "日经225", names: ["日经225"] },
  { region: "韩国", primary: "首尔综合指数", names: ["首尔综合指数"] },
  { region: "德国", primary: "德国DAX30", names: ["德国DAX30"] },
  { region: "英国", primary: "富时100指数", names: ["富时100指数"] },
];

export function groupRegions(quotes: IndexQuote[]): RegionSentiment[] {
  const byName = new Map(quotes.map((q) => [q.name, q]));
  const regions: RegionSentiment[] = [];
  for (const { region, primary, names } of REGIONS) {
    const indices = names.map((n) => byName.get(n)).filter((q): q is IndexQuote => !!q);
    const primaryQuote = byName.get(primary);
    if (!indices.length || !primaryQuote) continue;
    regions.push({ region, sentiment: sentimentOf(primaryQuote.changePct), indices });
  }
  return regions;
}

export async function fetchIndices(): Promise<IndexQuote[]> {
  // 腾讯：A股/港股/美股；新浪 znb_：日韩欧。GBK 编码，分别解码合并。
  const tencent = await guardedFetch("https://qt.gtimg.cn/q=s_sh000001,s_sz399001,s_sz399006,s_hkHSI,s_hkHSTECH,s_usDJI,s_usIXIC,s_usINX", {
    headers: { ...BROWSER_HEADERS, referer: "https://gu.qq.com/" },
    timeoutMs: 15_000,
    maxBytes: 512 * 1024,
    route: "egress",
  });
  if (tencent.status !== 200) throw new Error(`tencent quotes: HTTP ${tencent.status}`);
  const sina = await guardedFetch("https://hq.sinajs.cn/list=znb_NKY,znb_KOSPI,znb_DAX,znb_FTSE", {
    headers: { ...BROWSER_HEADERS, referer: "https://finance.sina.com.cn" },
    timeoutMs: 15_000,
    maxBytes: 512 * 1024,
    route: "egress",
  });
  if (sina.status !== 200) throw new Error(`sina quotes: HTTP ${sina.status}`);
  const gbk = new TextDecoder("gbk");
  const merged = [...parseQuotes(gbk.decode(tencent.body)).values(), ...parseSinaQuotes(gbk.decode(sina.body)).values()];
  if (merged.length < 5) throw new Error(`quotes: only ${merged.length} indices parsed`);
  return merged;
}

// ── 指数走势（页面小走势图） ────────────────────────────────────────────────────────

/** 每个指数的走势来源，全部走腾讯：A股/港股当日分时，美股近 5 日日K（腾讯没有美股分时，
 *  也没有日韩欧指数的K线；Yahoo chart 对数据中心 IP 一律 429，所以日韩欧暂不画线）。 */
const TREND_SOURCES: Array<{ name: string; kind: "qq-minute" | "qq-kline"; code: string }> = [
  { name: "上证指数", kind: "qq-minute", code: "sh000001" },
  { name: "深证成指", kind: "qq-minute", code: "sz399001" },
  { name: "创业板指", kind: "qq-minute", code: "sz399006" },
  { name: "恒生指数", kind: "qq-minute", code: "hkHSI" },
  { name: "恒生科技指数", kind: "qq-minute", code: "hkHSTECH" },
  { name: "道琼斯", kind: "qq-kline", code: "usDJI" },
  { name: "纳斯达克", kind: "qq-kline", code: "usIXIC" },
  { name: "标普500", kind: "qq-kline", code: "usINX" },
];

/** 均匀降采样到 ≤60 点，走势形状不变，快照体积可控。 */
function downsample(prices: number[]): number[] {
  if (prices.length <= 60) return prices.map((p) => Math.round(p * 100) / 100);
  const step = prices.length / 60;
  return Array.from({ length: 60 }, (_, i) => Math.round(prices[Math.floor(i * step)]! * 100) / 100);
}

async function qqMinuteTrend(code: string): Promise<number[]> {
  const res = await guardedFetch(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`, {
    headers: { ...BROWSER_HEADERS, referer: "https://gu.qq.com/" },
    timeoutMs: 15_000,
    maxBytes: 1024 * 1024,
    route: "egress",
  });
  if (res.status !== 200) throw new Error(`qq minute ${code}: HTTP ${res.status}`);
  const body = JSON.parse(res.text()) as { data?: Record<string, { data?: { data?: string[] } }> };
  const rows = body.data?.[code]?.data?.data ?? [];
  const prices = rows.map((row) => Number(row.split(" ")[1])).filter((p) => Number.isFinite(p));
  if (prices.length < 5) throw new Error(`qq minute ${code}: only ${prices.length} points`);
  return downsample(prices);
}

async function qqKlineTrend(code: string): Promise<number[]> {
  const res = await guardedFetch(`https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${code},day,,,6,`, {
    headers: { ...BROWSER_HEADERS, referer: "https://gu.qq.com/" },
    timeoutMs: 15_000,
    maxBytes: 1024 * 1024,
    route: "egress",
  });
  if (res.status !== 200) throw new Error(`qq kline ${code}: HTTP ${res.status}`);
  const body = JSON.parse(res.text()) as { data?: Record<string, { day?: string[][] }> };
  const rows = Object.values(body.data ?? {})[0]?.day ?? [];
  const closes = rows.map((row) => Number(row[2])).filter((p) => Number.isFinite(p));
  if (closes.length < 2) throw new Error(`qq kline ${code}: only ${closes.length} days`);
  return downsample(closes);
}

/** 拉全部指数的走势；单个指数失败只少它自己的线，全部失败才算这组失败。
 *  Yahoo 一次并发多个会 429，串行慢慢问；腾讯分时没有这个限制，并行。 */
export async function fetchTrends(): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {};
  const failures: string[] = [];
  const qq = TREND_SOURCES.filter((s) => s.kind === "qq-minute");
  const rest = TREND_SOURCES.filter((s) => s.kind !== "qq-minute");
  await Promise.all(
    qq.map(async (s) => {
      try {
        out[s.name] = await qqMinuteTrend(s.code);
      } catch (error) {
        failures.push(`${s.name}: ${String(error instanceof Error ? error.message : error)}`);
      }
    }),
  );
  for (const s of rest) {
    try {
      out[s.name] = s.kind === "qq-kline" ? await qqKlineTrend(s.code) : await qqMinuteTrend(s.code);
    } catch (error) {
      failures.push(`${s.name}: ${String(error instanceof Error ? error.message : error)}`);
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  if (!Object.keys(out).length) throw new Error(failures.join("; "));
  if (failures.length) console.warn(`[market-today] index trends partial: ${failures.join("; ").slice(0, 300)}`);
  return out;
}

/** 页面点名的板块：按名称子串在腾讯板块列表里挑（列表随全市场，展示固定这一组）。
 *  行业是申万一级（31 个），半导体/AI/CPO 这类细分在概念板块里。 */
const INDUSTRY_KEYS = ["电子", "计算机", "通信", "食品饮料", "医药生物", "汽车", "银行", "非银金融", "电力设备", "房地产", "有色金属", "传媒"];
const CONCEPT_KEYS = ["芯片概念", "人工智能", "共封装光模块", "AI算力芯片", "机器人概念", "固态电池", "低空经济", "数据要素", "白酒概念", "国产软件", "光芯片", "云计算"];

function pickBoards(all: Array<{ name: string; changePct: number }>, keys: string[]): Array<{ name: string; changePct: number }> {
  const out: Array<{ name: string; changePct: number }> = [];
  for (const key of keys) {
    const hit = all.find((b) => b.name.includes(key));
    if (hit) out.push(hit);
  }
  return out;
}

/** 腾讯财经板块排行（gu.qq.com 网页同款接口，海外可达；东财 push2 对海外 IP 连接层拦截）。
 *  board_type：hy=行业、gn=概念；每页 100 条，翻到空页为止。 */
export async function fetchSectors(): Promise<SectorsSnapshot> {
  const grab = async (boardType: string): Promise<Array<{ name: string; changePct: number }>> => {
    const out: Array<{ name: string; changePct: number }> = [];
    for (let offset = 0; ; offset += 100) {
      const res = await guardedFetch(`https://proxy.finance.qq.com/cgi/cgi-bin/rank/pt/getRank?board_type=${boardType}&sort_type=price&direct=down&offset=${offset}&count=100`, {
        headers: { ...BROWSER_HEADERS, referer: "https://gu.qq.com/" },
        timeoutMs: 15_000,
        maxBytes: 1024 * 1024,
        route: "egress",
      });
      if (res.status !== 200) throw new Error(`qq boards ${boardType}: HTTP ${res.status}`);
      const body = JSON.parse(res.text()) as { data?: { rank_list?: Array<{ name?: string; zdf?: string }> } };
      const list = body.data?.rank_list ?? [];
      for (const b of list) {
        if (typeof b.name === "string" && b.name && Number.isFinite(Number(b.zdf))) out.push({ name: b.name, changePct: Number(b.zdf) });
      }
      if (list.length < 100) break;
    }
    if (!out.length) throw new Error(`qq boards ${boardType}: empty list`);
    return out;
  };
  const industries = await grab("hy");
  const concepts = await grab("gn");
  const sortedIndustries = [...industries].sort((a, b) => b.changePct - a.changePct);
  return {
    industries: pickBoards(industries, INDUSTRY_KEYS),
    concepts: pickBoards(concepts, CONCEPT_KEYS),
    allIndustries: sortedIndustries,
    topIndustries: sortedIndustries.slice(0, 5),
    bottomIndustries: sortedIndustries.slice(-5).reverse(),
  };
}

/** 美股大公司：纳斯达克 100 按市值前 20 的成分股（固定清单，行情每轮快照刷新；名单随季
 *  度调整变化时手动更新）加站长点名的闪迪。腾讯 s_us 代码，返回中文公司名与当日涨跌幅，按涨跌幅降序。 */
const US_TOP20: string[] = [
  "s_usAAPL", "s_usMSFT", "s_usNVDA", "s_usAMZN", "s_usGOOGL", "s_usMETA", "s_usAVGO", "s_usTSLA",
  "s_usCOST", "s_usNFLX", "s_usGOOG", "s_usAMD", "s_usLIN", "s_usPEP", "s_usMU", "s_usINTU",
  "s_usCSCO", "s_usTMUS", "s_usTXN", "s_usAMGN", "s_usSNDK",
];

export async function fetchUsSectors(): Promise<Array<{ name: string; changePct: number }>> {
  const res = await guardedFetch(`https://qt.gtimg.cn/q=${US_TOP20.join(",")}`, {
    headers: { ...BROWSER_HEADERS, referer: "https://gu.qq.com/" },
    timeoutMs: 15_000,
    maxBytes: 512 * 1024,
    route: "egress",
  });
  if (res.status !== 200) throw new Error(`us top stocks: HTTP ${res.status}`);
  const out: Array<{ name: string; changePct: number }> = [];
  for (const m of new TextDecoder("gbk").decode(res.body).matchAll(/v_s_us([A-Za-z.]+)="([^"]*)"/g)) {
    const f = m[2]!.split("~");
    // 与指数同一个 s_ 简版行：市场~名称~代码~价~涨跌~涨跌幅
    if (f.length >= 6 && f[1] && Number.isFinite(Number(f[5]))) out.push({ name: f[1]!, changePct: Number(f[5]) });
  }
  if (out.length < 10) throw new Error(`us top stocks: only ${out.length} parsed`);
  return out.sort((a, b) => b.changePct - a.changePct);
}

/** 抓四组数据并写快照；单组失败沿用上一次快照的该组（信源偶发失败时不冲掉已有数据），全部失败时抛错让 job_runs 记录。 */
export async function importQuotes(): Promise<{ fearGreed: boolean; indices: number; sectors: boolean }> {
  const results = await Promise.allSettled([fetchFearGreed(), fetchIndices(), fetchSectors(), fetchUsSectors(), fetchTrends()]);
  const [previous] = await sql<{ data: QuotesSnapshot }[]>`SELECT data FROM market_snapshots WHERE kind = 'today' LIMIT 1`;
  // 指数走势挂到对应的指数上；这轮没拿到的沿用上一轮的（信源偶发失败时小图不会闪没）
  const trends = results[4].status === "fulfilled" ? results[4].value : null;
  const prevTrendOf = (name: string): number[] | undefined =>
    trends?.[name] ?? previous?.data.regions.flatMap((r) => r.indices).find((q) => q.name === name)?.trend;
  const regions =
    results[1].status === "fulfilled"
      ? groupRegions(results[1].value).map((r) => ({ ...r, indices: r.indices.map((q) => ({ ...q, trend: prevTrendOf(q.name) })) }))
      : (previous?.data.regions ?? []);
  const snapshot: QuotesSnapshot = {
    fearGreed: results[0].status === "fulfilled" ? results[0].value : (previous?.data.fearGreed ?? null),
    regions,
    sectors: results[2].status === "fulfilled" ? results[2].value : (previous?.data.sectors ?? null),
    usSectors: results[3].status === "fulfilled" ? results[3].value : (previous?.data.usSectors ?? null),
    fetchedAt: new Date().toISOString(),
  };
  if (!snapshot.fearGreed && !snapshot.regions.length && !snapshot.sectors && !snapshot.usSectors) {
    throw new Error(results.map((r) => (r.status === "rejected" ? String(r.reason) : "")).filter(Boolean).join("; "));
  }
  // 部分失败保留上次成功的组；失败原因打进日志便于排查信源连通性。
  const names = ["fear&greed", "indices", "sectors", "us sectors", "index trends"] as const;
  results.forEach((r, i) => {
    if (r.status === "rejected") console.warn(`[market-today] quotes ${names[i]}: ${String(r.reason).slice(0, 300)}`);
  });
  await sql`
    INSERT INTO market_snapshots (kind, data, updated_at)
    VALUES ('today', ${sql.json(snapshot as never)}, now())
    ON CONFLICT (kind) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  return { fearGreed: !!snapshot.fearGreed, indices: snapshot.regions.reduce((n, r) => n + r.indices.length, 0), sectors: !!snapshot.sectors };
}

/** 页面读取：最新一份快照（纯库读）。 */
export async function loadQuotes(): Promise<QuotesSnapshot | null> {
  const [row] = await sql<{ data: QuotesSnapshot }[]>`SELECT data FROM market_snapshots WHERE kind = 'today' LIMIT 1`;
  return row?.data ?? null;
}
