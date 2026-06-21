/** Player engine IDs — must match admin Control Center, Flutter, and Kotlin. */
const VALID_ENGINES = new Set([
  'auto',
  'kotlin',
  'exo',
  'webview',
  'webplayer',
  'shaka',
]);

const DEPRECATED_ENGINES = new Set([
  'flutter',
  'chewie',
  'native_video',
  'webrtc',
  'vlc',
  'mx',
]);

function normalizeEngineId(raw) {
  const e = String(raw || '').trim().toLowerCase();
  if (!e || e === 'default' || e === 'global') return null;
  if (DEPRECATED_ENGINES.has(e)) return 'auto';
  return VALID_ENGINES.has(e) ? e : 'auto';
}

/** Channel override: null/empty/default → use global config. */
function sanitizeChannelPlaybackEngine(raw) {
  if (raw == null || raw === '' || raw === 'default' || raw === 'global') return null;
  const normalized = normalizeEngineId(raw);
  if (!normalized || normalized === 'auto') return null;
  return normalized;
}

function resolvePlaybackEngine(channelOverride, globalDefault) {
  const channel = sanitizeChannelPlaybackEngine(channelOverride);
  if (channel) return channel;
  return normalizeEngineId(globalDefault) || 'auto';
}

function sanitizeGlobalPlaybackEngine(raw) {
  return normalizeEngineId(raw) || 'auto';
}

module.exports = {
  VALID_ENGINES,
  DEPRECATED_ENGINES,
  normalizeEngineId,
  sanitizeChannelPlaybackEngine,
  sanitizeGlobalPlaybackEngine,
  resolvePlaybackEngine,
};
