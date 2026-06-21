-- Per-channel preferred stream audio language (admin-controlled).
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS audio_language VARCHAR(16) NOT NULL DEFAULT 'sw';

UPDATE channels
   SET audio_language = 'sw'
 WHERE audio_language IS NULL
    OR TRIM(audio_language) = ''
    OR audio_language = 'auto';
