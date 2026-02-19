-- Run this on your Railway PostgreSQL database to fix:
-- 1. column "fcm_token" does not exist (push notifications)
-- 2. relation "user_unlocked_channels" does not exist (special access / unlock channels)

-- Add FCM columns to users if missing (safe to run multiple times)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'fcm_token'
  ) THEN
    ALTER TABLE users ADD COLUMN fcm_token TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'fcm_token_updated_at'
  ) THEN
    ALTER TABLE users ADD COLUMN fcm_token_updated_at TIMESTAMPTZ;
  END IF;
END $$;

-- Create user_unlocked_channels if missing (safe to run multiple times)
CREATE TABLE IF NOT EXISTS user_unlocked_channels (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, channel_id)
);
