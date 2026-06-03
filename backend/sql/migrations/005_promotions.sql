-- Promotion Center: admin-managed popups for user app launch

CREATE TABLE IF NOT EXISTS promotions (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  button_text TEXT NOT NULL DEFAULT 'Learn More',
  button_url TEXT,
  type VARCHAR(24) NOT NULL DEFAULT 'text',
  priority INTEGER NOT NULL DEFAULT 3,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  show_mode VARCHAR(16) NOT NULL DEFAULT 'daily',
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  target_audience VARCHAR(24) NOT NULL DEFAULT 'all',
  target_max_version VARCHAR(16),
  target_min_version VARCHAR(16),
  background_style VARCHAR(24) NOT NULL DEFAULT 'dark_glass',
  force_update BOOLEAN NOT NULL DEFAULT FALSE,
  min_required_version VARCHAR(16),
  views_count INTEGER NOT NULL DEFAULT 0,
  clicks_count INTEGER NOT NULL DEFAULT 0,
  close_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promotion_events (
  id SERIAL PRIMARY KEY,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  external_id VARCHAR(64),
  event_type VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotions_active_dates ON promotions (is_active, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_promotions_priority ON promotions (priority ASC, id DESC);
CREATE INDEX IF NOT EXISTS idx_promotion_events_promotion ON promotion_events (promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_events_type ON promotion_events (promotion_id, event_type);
