-- 经济事件日历：一次官方发布或市场日程事件（CPI、非农、FOMC……）。
-- 数值全部按信源原文存文本（含单位口径），缺失为 NULL，绝不补 0。
CREATE TABLE IF NOT EXISTS econ_events (
  id               bigserial PRIMARY KEY,
  event_key        text NOT NULL,
  title            text NOT NULL,
  country          text,
  impact_level     text,
  release_at       timestamptz NOT NULL,
  reference_period text,
  previous_value   text,
  consensus_value  text,
  actual_value     text,
  status           text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'released', 'delayed', 'cancelled')),
  revised          boolean NOT NULL DEFAULT false,
  source_name      text,
  feed_updated_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
