/** Shared player engine list — must match backend VALID_ENGINES and Control Center. */
export const PLAYER_ENGINES = [
  {
    id: 'default',
    label: 'Default (global)',
    icon: 'cog-outline',
  },
  {
    id: 'auto',
    label: 'Smart Auto',
    icon: 'auto-fix',
  },
  {
    id: 'kotlin',
    label: 'Kotlin Native',
    icon: 'language-kotlin',
  },
  {
    id: 'exo',
    label: 'ExoPlayer',
    icon: 'play-box',
  },
  {
    id: 'webview',
    label: 'WebView',
    icon: 'web',
  },
  {
    id: 'webplayer',
    label: 'Web Player',
    icon: 'television-play',
  },
  {
    id: 'shaka',
    label: 'Shaka Player',
    icon: 'play-box-outline',
  },
];

/** Control Center global player list (no per-channel “default” option). */
export const GLOBAL_PLAYER_ENGINES = PLAYER_ENGINES.filter((e) => e.id !== 'default');

export const DEPRECATED_PLAYER_ENGINES = new Set([
  'flutter',
  'chewie',
  'native_video',
  'webrtc',
  'vlc',
  'mx',
]);

/** Suggest player from stream URL shape (admin hint only). */
export function suggestPlayerForUrl(url) {
  const u = String(url || '').trim().toLowerCase();
  if (!u) return 'default';
  if (u.includes('.php') || u.includes('/player/') || u.includes('gateway')) return 'webview';
  if (u.includes('.mpd') || u.includes('dash')) return 'exo';
  if (u.includes('.m3u8') || u.includes('hls')) return 'auto';
  return 'default';
}

export function playerEngineLabel(id) {
  if (!id || id === 'default') return 'Default (global)';
  if (DEPRECATED_PLAYER_ENGINES.has(String(id).toLowerCase())) return 'Default (global)';
  const found = PLAYER_ENGINES.find((e) => e.id === id);
  return found ? found.label : id;
}

export function normalizePlayerEngine(id) {
  const e = String(id || 'default').trim().toLowerCase();
  if (!e || e === 'default' || e === 'global') return 'default';
  if (DEPRECATED_PLAYER_ENGINES.has(e)) return 'default';
  return PLAYER_ENGINES.some((engine) => engine.id === e) ? e : 'default';
}
