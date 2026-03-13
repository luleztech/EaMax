-- Per-channel override: when global "channels premium only" is ON, admin can still
-- set individual channels to "unlock to free" (free to watch, no ads).
ALTER TABLE channels ADD COLUMN IF NOT EXISTS unlock_to_free BOOLEAN NOT NULL DEFAULT FALSE;
