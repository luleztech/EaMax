-- Leotena-style TV schedule (programmes + matches) for the Ratiba tab.
CREATE TABLE IF NOT EXISTS schedule_items (
  id SERIAL PRIMARY KEY,
  date_time TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  team1 TEXT NOT NULL DEFAULT '',
  team2 TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'live_tv_rounded',
  live BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  gradient_start VARCHAR(8) NOT NULL DEFAULT '1D4A82',
  gradient_end VARCHAR(8) NOT NULL DEFAULT '2C6DB5',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_items_date_time ON schedule_items (date_time);
CREATE INDEX IF NOT EXISTS idx_schedule_items_active_date ON schedule_items (active, date_time);

-- One-time backfill from legacy football matches (skip if already migrated).
INSERT INTO schedule_items (
  date_time, title, subtitle, channel, team1, team2, icon, live, active,
  gradient_start, gradient_end
)
SELECT
  m.match_time,
  TRIM(BOTH FROM (m.team1 || ' vs ' || m.team2)),
  COALESCE(m.league, ''),
  '',
  COALESCE(m.team1, ''),
  COALESCE(m.team2, ''),
  'sports_soccer_rounded',
  FALSE,
  COALESCE(m.is_active, TRUE),
  'E8002D',
  '7F1D1D'
FROM upcoming_matches m
WHERE NOT EXISTS (SELECT 1 FROM schedule_items LIMIT 1);
