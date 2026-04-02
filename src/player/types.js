export const PlaybackState = Object.freeze({
  IDLE: 'IDLE',
  BUFFERING: 'BUFFERING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  ENDED: 'ENDED',
  ERROR: 'ERROR',
});

export const PlayerMode = Object.freeze({
  NATIVE: 'NATIVE',
  WEBVIEW: 'WEBVIEW',
});

export const DrmType = Object.freeze({
  WIDEVINE: 'WIDEVINE',
  WIDEVINE_L1: 'WIDEVINE_L1',
  WIDEVINE_L3: 'WIDEVINE_L3',
  CLEARKEY: 'CLEARKEY',
  PLAYREADY: 'PLAYREADY',
  FAIRPLAY: 'FAIRPLAY',
  NONE: 'NONE',
});

export const StreamQuality = Object.freeze({
  AUTO: 'AUTO',
  QUALITY_240P: '240p',
  QUALITY_360P: '360p',
  QUALITY_480P: '480p',
  QUALITY_720P: '720p',
  QUALITY_1080P: '1080p',
});
