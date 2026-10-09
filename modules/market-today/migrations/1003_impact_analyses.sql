-- 高价值新闻的市场影响分析（每篇至多一份；content 是 impact.ts schema 的 JSON）。
CREATE TABLE IF NOT EXISTS impact_analyses (
  article_id   text PRIMARY KEY REFERENCES articles (id) ON DELETE CASCADE,
  story_id     bigint,
  content      jsonb NOT NULL,
  model        text,
  receipt_id   bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
