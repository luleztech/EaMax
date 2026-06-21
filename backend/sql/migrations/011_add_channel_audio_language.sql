-- Per-channel preferred stream audio language (admin-controlled).
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS audio_language VARCHAR(16) NOT NULL DEFAULT 'auto';

UPDATE channels SET audio_language = 'auto' WHERE audio_language IS NULL OR TRIM(audio_language) = '';
