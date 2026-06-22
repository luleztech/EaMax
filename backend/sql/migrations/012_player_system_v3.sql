-- EaMax Player System v3 — extended admin-controlled playback policy + analytics.
-- Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- Global player config extensions
ALTER TABLE player_config_global ADD COLUMN IF NOT EXISTS initial_buffer_ms INT NOT NULL DEFAULT 1500;
ALTER TABLE player_config_global ADD COLUMN IF NOT EXISTS hardware_acceleration BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE player_config_global ADD COLUMN IF NOT EXISTS software_decode_fallback BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE player_config_global ADD COLUMN IF NOT EXISTS background_playback BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE player_config_global ADD COLUMN IF NOT EXISTS resume_playback BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE player_config_global ADD COLUMN IF NOT EXISTS network_timeout_ms INT NOT NULL DEFAULT 15000;
ALTER TABLE player_config_global ADD COLUMN IF NOT EXISTS reconnection_policy VARCHAR(32) NOT NULL DEFAULT 'balanced';
ALTER TABLE player_config_global ADD COLUMN IF NOT EXISTS qualities_allowed JSONB NOT NULL DEFAULT '["auto","240p","360p","480p","720p","1080p"]'::jsonb;
ALTER TABLE player_config_global ADD COLUMN IF NOT EXISTS languages_allowed JSONB NOT NULL DEFAULT '["sw","en"]'::jsonb;

-- Per-channel playback overrides
ALTER TABLE channels ADD COLUMN IF NOT EXISTS preferred_quality VARCHAR(16);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS stream_type VARCHAR(32) NOT NULL DEFAULT 'auto';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS buffer_min_ms_override INT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS buffer_max_ms_override INT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS retry_max_override INT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS retry_delay_ms_override INT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS region_rules_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Playback analytics events (client → admin dashboard)
CREATE TABLE IF NOT EXISTS player_analytics_events (
  id            BIGSERIAL PRIMARY KEY,
  user_external_id VARCHAR(128),
  channel_id    INT REFERENCES channels(id) ON DELETE SET NULL,
  event_type    VARCHAR(64) NOT NULL,
  payload_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  device_info   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_analytics_channel ON player_analytics_events(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_analytics_type ON player_analytics_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_analytics_created ON player_analytics_events(created_at DESC);
