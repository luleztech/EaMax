const { getGlobalPlayerConfig } = require('./playerConfigService');
const { resolvePlaybackEngine } = require('../constants/playerEngines');
const { sanitizeChannelAudioLanguage, sanitizeDefaultLanguage } = require('../constants/streamLanguages');

const VALID_STREAM_TYPES = new Set([
  'auto', 'hls', 'm3u8', 'dash', 'mp4', 'rtmp', 'rtsp', 'mpegts',
]);

const VALID_RECONNECTION_POLICIES = new Set(['aggressive', 'balanced', 'conservative']);

function sanitizeStreamType(raw) {
  if (raw == null || raw === '') return 'auto';
  const t = String(raw).trim().toLowerCase();
  return VALID_STREAM_TYPES.has(t) ? t : 'auto';
}

function sanitizeReconnectionPolicy(raw) {
  if (raw == null || raw === '') return 'balanced';
  const p = String(raw).trim().toLowerCase();
  return VALID_RECONNECTION_POLICIES.has(p) ? p : 'balanced';
}

function sanitizeQuality(raw, fallback = '360p') {
  const q = String(raw || fallback).trim().toLowerCase();
  const allowed = new Set(['auto', '240p', '360p', '480p', '720p', '1080p', '2k', '4k']);
  return allowed.has(q) ? q : fallback;
}

function parseJsonArray(raw, fallback) {
  if (Array.isArray(raw)) return raw.map((e) => String(e).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((e) => String(e).trim()).filter(Boolean);
    } catch (_) { /* ignore */ }
  }
  return fallback;
}

/**
 * Merges global player_config_global with optional per-channel overrides.
 */
async function resolvePlaybackPolicy(channelRow) {
  const global = await getGlobalPlayerConfig();

  const channelEngine = channelRow?.playback_engine || null;
  const effectiveEngine = resolvePlaybackEngine(channelEngine, global.preferredEngine);

  const bufferMinMs = channelRow?.buffer_min_ms_override != null
    ? Number(channelRow.buffer_min_ms_override)
    : global.bufferMinMs;
  const bufferMaxMs = channelRow?.buffer_max_ms_override != null
    ? Number(channelRow.buffer_max_ms_override)
    : global.bufferMaxMs;
  const retryMax = channelRow?.retry_max_override != null
    ? Number(channelRow.retry_max_override)
    : global.retryMax;
  const retryDelayMs = channelRow?.retry_delay_ms_override != null
    ? Number(channelRow.retry_delay_ms_override)
    : global.retryDelayMs;

  const audioLanguage = channelRow?.audio_language
    ? sanitizeChannelAudioLanguage(channelRow.audio_language, global.defaultLanguage || 'sw')
    : sanitizeDefaultLanguage(global.defaultLanguage || 'sw');

  return {
    preferredEngine: effectiveEngine,
    effectiveEngine,
    playbackEngine: channelEngine,
    bufferMinMs: Math.max(500, bufferMinMs || 800),
    bufferMaxMs: Math.max(bufferMinMs + 500, bufferMaxMs || 12000),
    initialBufferMs: global.initialBufferMs || 1500,
    retryMax: Math.min(12, Math.max(1, retryMax || 4)),
    retryDelayMs: Math.min(15000, Math.max(200, retryDelayMs || 1200)),
    reconnectEnabled: global.reconnectEnabled !== false,
    autoPlay: global.autoPlay !== false,
    defaultQuality: sanitizeQuality(
      channelRow?.preferred_quality || global.defaultQuality,
      global.defaultQuality || '360p',
    ),
    defaultLanguage: sanitizeDefaultLanguage(global.defaultLanguage || 'sw'),
    failoverToWebview: global.failoverToWebview !== false,
    hardwareAcceleration: global.hardwareAcceleration !== false,
    softwareDecodeFallback: global.softwareDecodeFallback !== false,
    backgroundPlayback: global.backgroundPlayback === true,
    resumePlayback: global.resumePlayback !== false,
    networkTimeoutMs: global.networkTimeoutMs || 15000,
    reconnectionPolicy: sanitizeReconnectionPolicy(global.reconnectionPolicy),
    qualitiesAllowed: parseJsonArray(
      global.qualitiesAllowed,
      ['auto', '240p', '360p', '480p', '720p', '1080p'],
    ),
    languagesAllowed: ['sw', 'en'],
    streamType: sanitizeStreamType(channelRow?.stream_type),
    audioLanguage,
    defaultLanguage: sanitizeDefaultLanguage(global.defaultLanguage || 'sw'),
    audio_language: audioLanguage,
    regionRules: channelRow?.region_rules_json && typeof channelRow.region_rules_json === 'object'
      ? channelRow.region_rules_json
      : {},
  };
}

module.exports = {
  resolvePlaybackPolicy,
  sanitizeStreamType,
  sanitizeReconnectionPolicy,
  sanitizeQuality,
};
