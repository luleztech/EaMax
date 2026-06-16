-- EaMax Enterprise Control Plane — Phase 1
-- Safe to run multiple times (IF NOT EXISTS / ON CONFLICT).

CREATE TABLE IF NOT EXISTS subscription_plans (
  id            SERIAL PRIMARY KEY,
  slug          VARCHAR(32) UNIQUE NOT NULL,
  name_sw       VARCHAR(128) NOT NULL,
  name_en       VARCHAR(128),
  price_tzs     INTEGER NOT NULL CHECK (price_tzs > 0),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  duration_label_sw VARCHAR(64),
  price_line_sw VARCHAR(128),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  is_popular    BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT NOT NULL DEFAULT 0,
  badge_text    VARCHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO subscription_plans
  (slug, name_sw, name_en, price_tzs, duration_days, duration_label_sw, price_line_sw, is_popular, sort_order)
VALUES
  ('week',  'Kwa Wiki',  'Weekly',  2000,  7,  '7 siku',    'Tsh.2,000/= wiki moja',       false, 0),
  ('month', 'Mwezi',     'Monthly', 5000,  30, '30 siku',   'Tsh.5,000/= mwezi mmoja',     true,  1),
  ('year',  'Miezi 3',   'Quarter', 12000, 90, 'miezi 3',   'Tsh.12,000/= miezi mitatu',   false, 2)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS channel_streams (
  id            SERIAL PRIMARY KEY,
  channel_id    INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  priority      SMALLINT NOT NULL DEFAULT 0,
  stream_url    TEXT,
  stream_alias  VARCHAR(128),
  drm_type      VARCHAR(32) DEFAULT 'NONE',
  drm_clear_key TEXT,
  license_url   TEXT,
  headers_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_ok_at    TIMESTAMPTZ,
  fail_count    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(channel_id, priority)
);

CREATE TABLE IF NOT EXISTS player_config_global (
  id                    SERIAL PRIMARY KEY,
  preferred_engine      VARCHAR(32) NOT NULL DEFAULT 'auto',
  buffer_min_ms         INT NOT NULL DEFAULT 1500,
  buffer_max_ms         INT NOT NULL DEFAULT 30000,
  retry_max             INT NOT NULL DEFAULT 4,
  retry_delay_ms        INT NOT NULL DEFAULT 1200,
  reconnect_enabled     BOOLEAN NOT NULL DEFAULT true,
  auto_play             BOOLEAN NOT NULL DEFAULT true,
  default_quality       VARCHAR(16) NOT NULL DEFAULT '360p',
  failover_to_webview   BOOLEAN NOT NULL DEFAULT true,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO player_config_global (id)
SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM player_config_global WHERE id = 1);

CREATE TABLE IF NOT EXISTS remote_config_meta (
  key         VARCHAR(128) PRIMARY KEY,
  value_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  version     INT NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emergency_controls (
  id                     SERIAL PRIMARY KEY,
  maintenance_mode       BOOLEAN NOT NULL DEFAULT false,
  maintenance_message_sw TEXT,
  disable_payments       BOOLEAN NOT NULL DEFAULT false,
  disable_channels       BOOLEAN NOT NULL DEFAULT false,
  disabled_channel_ids   INT[] NOT NULL DEFAULT '{}',
  disabled_features      TEXT[] NOT NULL DEFAULT '{}',
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO emergency_controls (id)
SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM emergency_controls WHERE id = 1);

CREATE TABLE IF NOT EXISTS subscription_ledger (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(id),
  action          VARCHAR(32) NOT NULL,
  plan_slug       VARCHAR(32),
  days_added      INT,
  expires_before  TIMESTAMPTZ,
  expires_after   TIMESTAMPTZ,
  source          VARCHAR(32),
  payment_id      INT REFERENCES subscription_payments(id),
  admin_note      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_queue (
  id                    BIGSERIAL PRIMARY KEY,
  order_id              VARCHAR(64) UNIQUE NOT NULL,
  user_id               INT NOT NULL REFERENCES users(id),
  plan_slug             VARCHAR(32) NOT NULL,
  amount_tzs            INT NOT NULL,
  phone                 VARCHAR(20),
  provider              VARCHAR(32),
  status                VARCHAR(32) NOT NULL DEFAULT 'pending',
  provider_ref            VARCHAR(128),
  webhook_payload       JSONB,
  retry_count           INT NOT NULL DEFAULT 0,
  next_retry_at         TIMESTAMPTZ,
  entitlement_granted   BOOLEAN NOT NULL DEFAULT false,
  admin_notes           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_queue_status ON payment_queue(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_subscription_ledger_user ON subscription_ledger(user_id, created_at DESC);

-- Seed primary stream rows from existing channels (priority 0).
INSERT INTO channel_streams (channel_id, priority, stream_url, stream_alias, drm_type, drm_clear_key, license_url)
SELECT
  c.id,
  0,
  COALESCE(c.stream_url, t.stream_url),
  c.stream_alias,
  COALESCE(c.drm_type, 'NONE'),
  c.drm_clear_key,
  c.license_url
FROM channels c
LEFT JOIN stream_aliases a ON a.alias = c.stream_alias AND a.is_active = TRUE
LEFT JOIN channels t ON t.id = a.channel_id AND t.is_active = TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM channel_streams cs WHERE cs.channel_id = c.id AND cs.priority = 0
);
