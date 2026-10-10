-- 今日市场的行情快照（恐惧贪婪指数、全球指数、板块涨跌；worker 定时覆盖写，页面只读）。
CREATE TABLE IF NOT EXISTS market_snapshots (
  kind       text PRIMARY KEY,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
