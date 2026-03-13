-- PostgreSQL schema for EaMax backend
-- Run this once on your Railway PostgreSQL instance

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  external_id VARCHAR(64) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_premium BOOLEAN NOT NULL DEFAULT FALSE,
  premium_expires_at TIMESTAMPTZ,
  points INTEGER NOT NULL DEFAULT 0,
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  uninstalled_at TIMESTAMPTZ,
  fcm_token TEXT,
  fcm_token_updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS channels (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(32) NOT NULL, -- football | movies | habari | tamthilia | wanyama | katuni | sayansi
  stream_url TEXT NOT NULL,
  thumbnail_url TEXT,
  thumbnail_emoji VARCHAR(8),
  color VARCHAR(16),
  points_required INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  drm_protected BOOLEAN NOT NULL DEFAULT FALSE,
  drm_type VARCHAR(32) DEFAULT 'NONE',  -- NONE | CLEARKEY | WIDEVINE | PLAYREADY; CLEARKEY uses drm_clear_key (kid:key)
  drm_clear_key TEXT,                   -- kid:key (hex) when drm_type = CLEARKEY
  owner_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_unlocked_channels (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS ad_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  watched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  points_earned INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ad_events_user ON ad_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_events_watched_at ON ad_events(watched_at);

CREATE TABLE IF NOT EXISTS channel_watch_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  watched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_channel_watch_events_channel ON channel_watch_events(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_watch_events_watched_at ON channel_watch_events(watched_at);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan VARCHAR(16) NOT NULL, -- week | month | year
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'TZS',
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending | completed | failed
  provider_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category VARCHAR(32) NOT NULL, -- kabumbu | movies | habari
  type VARCHAR(16) NOT NULL DEFAULT 'normal', -- normal | scheduled
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carousel_slides (
  id SERIAL PRIMARY KEY,
  title TEXT,
  subtitle TEXT,
  badge TEXT,
  image_url TEXT,
  video_url TEXT,
  gradient_start VARCHAR(16) NOT NULL DEFAULT '#14532d',
  gradient_mid VARCHAR(16),
  gradient_end VARCHAR(16) NOT NULL DEFAULT '#000000',
  info_icon TEXT,
  info_text TEXT,
  category VARCHAR(32) NOT NULL DEFAULT 'football', -- football | movies | habari
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upcoming_matches (
  id SERIAL PRIMARY KEY,
  league TEXT NOT NULL,
  team1 TEXT NOT NULL,
  team2 TEXT NOT NULL,
  match_time TIMESTAMPTZ NOT NULL,
  points_required INTEGER NOT NULL DEFAULT 15,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
