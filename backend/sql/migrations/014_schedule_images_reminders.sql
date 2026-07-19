-- Ratiba event artwork + linked channel for timed live opens.
ALTER TABLE schedule_items
  ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS live_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_schedule_items_channel_id ON schedule_items (channel_id);
CREATE INDEX IF NOT EXISTS idx_schedule_items_live_notify
  ON schedule_items (date_time)
  WHERE active = TRUE AND live_notified_at IS NULL;

-- Per-user bell reminders (only these users get FCM when event goes live).
CREATE TABLE IF NOT EXISTS schedule_reminders (
  id SERIAL PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES schedule_items(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_reminders_external
  ON schedule_reminders (external_id);
CREATE INDEX IF NOT EXISTS idx_schedule_reminders_schedule
  ON schedule_reminders (schedule_id);
