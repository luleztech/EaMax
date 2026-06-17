/** Shared player engine list — must match backend VALID_ENGINES and Control Center. */
export const PLAYER_ENGINES = [
  {
    id: 'default',
    label: 'Default (global)',
    icon: 'cog-outline',
    formats: 'Uses Control Center player setting',
  },
  {
    id: 'auto',
    label: 'Smart Auto',
    icon: 'auto-fix',
    formats: 'HLS · DASH · MP4 · PHP · ClearKey · Widevine',
  },
  {
    id: 'kotlin',
    label: 'Kotlin Native',
    icon: 'language-kotlin',
    formats: 'Native stack · probe · failover · all DRM',
  },
  {
    id: 'exo',
    label: 'ExoPlayer',
    icon: 'play-box',
    formats: 'HLS · DASH · MP4 · ClearKey · Widevine',
  },
  {
    id: 'webview',
    label: 'WebView',
    icon: 'web',
    formats: 'PHP gateways · HTML · embedded players',
  },
  {
    id: 'webplayer',
    label: 'Web Player',
    icon: 'television-play',
    formats: 'HTML5 · HLS · DASH · ClearKey · Widevine',
  },
  {
    id: 'shaka',
    label: 'Shaka Player',
    icon: 'play-box-outline',
    formats: 'Shaka · HLS · DASH · ClearKey · Widevine · PHP',
  },
  {
    id: 'flutter',
    label: 'Flutter Player',
    icon: 'flutter',
    formats: 'media_kit · HLS · DASH · MP4',
  },
  {
    id: 'chewie',
    label: 'Chewie',
    icon: 'play-circle-outline',
    formats: 'video_player · HLS · MP4 · controls',
  },
  {
    id: 'native_video',
    label: 'Native Video',
    icon: 'cellphone-play',
    formats: 'Platform video_player · MP4 · HLS',
  },
  {
    id: 'webrtc',
    label: 'Flutter WebRTC',
    icon: 'broadcast',
    formats: 'WHEP/WHIP · low-latency WebRTC',
  },
  {
    id: 'vlc',
    label: 'VLC Player',
    icon: 'volume-high',
    formats: 'In-app native player (VLC-style URLs)',
  },
  {
    id: 'mx',
    label: 'MX Player',
    icon: 'movie-open-play',
    formats: 'In-app native player (MX-style URLs)',
  },
];

/** Suggest player from stream URL shape (admin hint only). */
export function suggestPlayerForUrl(url) {
  const u = String(url || '').trim().toLowerCase();
  if (!u) return 'default';
  if (u.includes('webrtc') || u.includes('/whep') || u.includes('/whip')) return 'webrtc';
  if (u.includes('.php') || u.includes('/player/') || u.includes('gateway')) return 'webview';
  if (u.includes('.mpd') || u.includes('dash')) return 'exo';
  if (u.includes('.m3u8') || u.includes('hls')) return 'auto';
  if (u.includes('.mp4') || u.includes('.webm')) return 'flutter';
  return 'default';
}

export function playerEngineLabel(id) {
  if (!id || id === 'default') return 'Default (global)';
  const found = PLAYER_ENGINES.find((e) => e.id === id);
  return found ? found.label : id;
}
