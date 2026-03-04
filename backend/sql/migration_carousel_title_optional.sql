-- Migration: Allow NULL title (and optional subtitle/badge) on carousel_slides
-- Run this on your Railway PostgreSQL database so slides can be saved without a title

ALTER TABLE carousel_slides
ALTER COLUMN title DROP NOT NULL;
