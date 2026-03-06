-- Add ClearKey storage for DRM-protected channels (run on existing DBs)
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS drm_clear_key TEXT;

COMMENT ON COLUMN channels.drm_clear_key IS 'ClearKey value: base64 key, or "kidBase64,keyBase64", or license server URL';
