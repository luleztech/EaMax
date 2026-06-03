ALTER TABLE promotions ADD COLUMN IF NOT EXISTS offer_amount_tsh INTEGER;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS offer_period_days INTEGER;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS offer_countdown_minutes INTEGER;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS offer_ends_at TIMESTAMPTZ;
