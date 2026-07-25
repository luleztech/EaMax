-- A successful subscription is atomic: premium status and access to every
-- channel are recorded together. This also repairs installations created
-- before the unlock table was part of the base schema.
CREATE TABLE IF NOT EXISTS user_unlocked_channels (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, channel_id)
);
