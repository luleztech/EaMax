-- Track when users start watching a channel (for "Most Watched" analytics)
CREATE TABLE IF NOT EXISTS channel_watch_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  watched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_watch_events_channel ON channel_watch_events(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_watch_events_watched_at ON channel_watch_events(watched_at);
