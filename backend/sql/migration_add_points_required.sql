-- Run this on your Railway PostgreSQL database if channel points are not saving.
-- This adds the points_required column to channels if it doesn't exist.
-- Safe to run multiple times.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'channels' AND column_name = 'points_required'
  ) THEN
    ALTER TABLE channels ADD COLUMN points_required INTEGER NOT NULL DEFAULT 0;
    RAISE NOTICE 'Added column channels.points_required';
  ELSE
    RAISE NOTICE 'Column channels.points_required already exists';
  END IF;
END $$;
