/** Player engine IDs — must match admin Control Center, Flutter, and Kotlin. */
const VALID_ENGINES = new Set([
  'auto',
  'kotlin',
  'exo',
  'webview',
  'webplayer',
  'shaka',
  'flutter',
  'chewie',
  'native_video',
  'webrtc',
  'vlc',
  'mx',
]);

/** Channel override: null/empty/default → use global config. */
function sanitizeChannelPlaybackEngine(raw) {
  if (raw == null || raw === '' || raw === 'default' || raw === 'global') return null;
  const e = String(raw).trim().toLowerCase();
  return VALID_ENGINES.has(e) ? e : null;
}

function resolvePlaybackEngine(channelOverride, globalDefault) {
  const channel = sanitizeChannelPlaybackEngine(channelOverride);
  if (channel) return channel;
  const global = sanitizeChannelPlaybackEngine(globalDefault);
  return global || 'auto';
}

module.exports = {
  VALID_ENGINES,
  sanitizeChannelPlaybackEngine,
  resolvePlaybackEngine,
};
