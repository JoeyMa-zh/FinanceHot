CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS econ_events_key_time_uidx ON econ_events (event_key, release_at);
