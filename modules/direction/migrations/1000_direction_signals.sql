-- 新闻方向信号（TypeSafe/Jev 判读，影子阶段只入库不展示；一篇至多一份，重试幂等）。
CREATE TABLE IF NOT EXISTS direction_signals (
  article_id   text PRIMARY KEY REFERENCES articles (id) ON DELETE CASCADE,
  direction    text NOT NULL,
  scope        text,
  confidence   real NOT NULL,
  probabilities jsonb NOT NULL,
  model        text NOT NULL,
  receipt_id   bigint,
  created_at   timestamptz NOT NULL DEFAULT now());
