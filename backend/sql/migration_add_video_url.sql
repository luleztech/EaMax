-- Migration: Add video_url column to carousel_slides table
-- Run this on your Railway PostgreSQL database

ALTER TABLE carousel_slides 
ADD COLUMN IF NOT EXISTS video_url TEXT;

-- Update category enum to include 'habari' (if needed)
-- Note: PostgreSQL doesn't have enum types in this schema, so category is VARCHAR
-- No changes needed for category column
