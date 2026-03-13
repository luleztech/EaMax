-- DRM type: NONE | CLEARKEY | WIDEVINE | PLAYREADY
-- When CLEARKEY, drm_clear_key stores kid:key (hex). Used by app and web.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS drm_type VARCHAR(32) DEFAULT 'NONE';
UPDATE channels SET drm_type = 'CLEARKEY' WHERE drm_protected = true AND (drm_type IS NULL OR drm_type = 'NONE');
