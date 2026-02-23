/**
 * ========================================================================
 * PLAYER TYPES & INTERFACES - React Native Edition
 * ========================================================================
 * Converted from Kotlin/Flutter player architecture
 * ========================================================================
 */

export enum PlaybackState {
  IDLE = 'IDLE',
  BUFFERING = 'BUFFERING',
  READY = 'READY',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  ENDED = 'ENDED',
  ERROR = 'ERROR',
}

export enum PlayerMode {
  NATIVE = 'NATIVE', // Uses react-native-video
  WEBVIEW = 'WEBVIEW', // Uses WebView for special cases
}

export enum DrmType {
  WIDEVINE = 'WIDEVINE',
  WIDEVINE_L1 = 'WIDEVINE_L1',
  WIDEVINE_L3 = 'WIDEVINE_L3',
  CLEARKEY = 'CLEARKEY',
  PLAYREADY = 'PLAYREADY',
  FAIRPLAY = 'FAIRPLAY', // iOS only
  NONE = 'NONE',
}

export enum StreamQuality {
  AUTO = 'AUTO',
  QUALITY_240P = '240p',
  QUALITY_360P = '360p',
  QUALITY_480P = '480p',
  QUALITY_720P = '720p',
  QUALITY_1080P = '1080p',
}

export interface ClearKey {
  kid: string;
  k: string;
}

export interface DrmData {
  keyId?: string;
  key?: string;
  headers?: Record<string, string>;
  keys?: ClearKey[];
}

export interface StreamSession {
  mpdUrl: string; // Can be DASH (.mpd), HLS (.m3u8), MP4, or any video URL
  licenseUrl?: string;
  token?: string;
  expiresAt?: number; // Unix timestamp in seconds

  /** Optional: if omitted, mode is auto-selected based on URL */
  playerMode?: PlayerMode;

  /** Optional: if omitted, DRM is disabled */
  drmType?: DrmType;

  drmData?: DrmData;
  headers?: Record<string, string>;
  sessionId?: string;
  channelIsPremium?: boolean;
  trialRemaining?: number;
}

export interface AudioTrack {
  id: string;
  language: string;
  label: string;
  isDefault?: boolean;
}

export interface VideoTrack {
  width: number;
  height: number;
  bitrate: number;
  codecs?: string;
}

export interface PlayerConfig {
  selectedQuality: StreamQuality;
  selectedAudioLanguage?: string;
  isABREnabled: boolean;
  availableQualities: StreamQuality[];
  availableAudioTracks: AudioTrack[];
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
}

export interface PlayerError {
  code: string;
  message: string;
  details?: any;
}

export interface PlayerProgress {
  currentTime: number; // seconds
  duration: number; // seconds
  playableDuration: number; // seconds (buffered)
}
