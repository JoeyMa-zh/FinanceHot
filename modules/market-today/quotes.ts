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
  topIndustries: Array<{ name: string; changePct: number }>;
  bottomIndustries: Array<{ name: string; changePct: number }>;
}

export interface QuotesSnapshot {
  fearGreed: FearGreedSnapshot | null;
  regions: RegionSentiment[];
  sectors: SectorsSnapshot | null;
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

/** 页面点名的板块：按名称子串在东财板块列表里挑（列表随全市场，展示固定这一组）。 */
const INDUSTRY_KEYS = ["半导体", "食品饮料", "白酒", "银行", "证券", "保险", "光伏", "医药", "汽车", "房地产", "通信设备", "软件"];
const CONCEPT_KEYS = ["人工智能", "CPO", "光模块", "算力", "机器人", "固态电池", "低空经济", "数据要素"];

function pickBoards(all: Array<{ name: string; changePct: number }>, keys: string[]): Array<{ name: string; changePct: number }> {
  const out: Array<{ name: string; changePct: number }> = [];
  for (const key of keys) {
    const hit = all.find((b) => b.name.includes(key));
    if (hit) out.push(hit);
  }
  return out;
}

export async function fetchSectors(): Promise<SectorsSnapshot> {
  const grab = async (fs: string) => {
    const res = await guardedFetch(`https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&fid=f3&fs=${fs}&fields=f14,f3`, {
      headers: { ...BROWSER_HEADERS, referer: "https://quote.eastmoney.com" },
      timeoutMs: 15_000,
      maxBytes: 1024 * 1024,
      route: "egress",
    });
    if (res.status !== 200) throw new Error(`eastmoney boards: HTTP ${res.status}`);
    const body = JSON.parse(res.text()) as { data?: { diff?: Array<{ f14?: string; f3?: number }> } };
    return (body.data?.diff ?? [])
      .filter((d): d is { f14: string; f3: number } => typeof d.f14 === "string" && typeof d.f3 === "number")
      .map((d) => ({ name: d.f14, changePct: d.f3 }));
  };
  const industries = await grab("m:90+t:2");
  const concepts = await grab("m:90+t:3");
  if (!industries.length) throw new Error("eastmoney boards: empty industry list");
  const sorted = [...industries].sort((a, b) => b.changePct - a.changePct);
  return {
    industries: pickBoards(industries, INDUSTRY_KEYS),
    concepts: pickBoards(concepts, CONCEPT_KEYS),
    topIndustries: sorted.slice(0, 5),
    bottomIndustries: sorted.slice(-5).reverse(),
  };
}

/** 抓三组数据并写快照；单组失败不影响其他组，全部失败时抛错让 job_runs 记录。 */
export async function importQuotes(): Promise<{ fearGreed: boolean; indices: number; sectors: boolean }> {
  const results = await Promise.allSettled([fetchFearGreed(), fetchIndices(), fetchSectors()]);
  const snapshot: QuotesSnapshot = {
    fearGreed: results[0].status === "fulfilled" ? results[0].value : null,
    regions: results[1].status === "fulfilled" ? groupRegions(results[1].value) : [],
    sectors: results[2].status === "fulfilled" ? results[2].value : null,
    fetchedAt: new Date().toISOString(),
  };
  if (!snapshot.fearGreed && !snapshot.regions.length && !snapshot.sectors) {
    throw new Error(results.map((r) => (r.status === "rejected" ? String(r.reason) : "")).filter(Boolean).join("; "));
  }
  // 部分失败保留上次成功的组；失败原因打进日志便于排查信源连通性。
  const names = ["fear&greed", "indices", "sectors"] as const;
  results.forEach((r, i) => {
    if (r.status === "rejected") console.warn(`[market-today] quotes ${names[i]}: ${String(r.reason).slice(0, 300)}`);
  });
  await sql`
    INSERT INTO market_snapshots (kind, data, updated_at)
    VALUES ('today', ${JSON.stringify(snapshot)}, now())
    ON CONFLICT (kind) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  return { fearGreed: !!snapshot.fearGreed, indices: snapshot.regions.reduce((n, r) => n + r.indices.length, 0), sectors: !!snapshot.sectors };
}

/** 页面读取：最新一份快照（纯库读）。 */
export async function loadQuotes(): Promise<QuotesSnapshot | null> {
  const [row] = await sql<{ data: QuotesSnapshot }[]>`SELECT data FROM market_snapshots WHERE kind = 'today' LIMIT 1`;
  return row?.data ?? null;
}
