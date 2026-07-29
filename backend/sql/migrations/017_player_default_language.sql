-- Global default stream audio language (sw | en). Admin Control tab.
ALTER TABLE player_config_global
  ADD COLUMN IF NOT EXISTS default_language VARCHAR(8) NOT NULL DEFAULT 'sw';

UPDATE player_config_global
   SET default_language = 'sw'
 WHERE default_language IS NULL
    OR TRIM(default_language) = ''
    OR default_language NOT IN ('sw', 'en');

UPDATE player_config_global
   SET languages_allowed = '["sw","en"]'::jsonb;
