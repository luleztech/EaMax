const { query } = require('../db');
const { VALID_ENGINES, sanitizeGlobalPlaybackEngine } = require('../constants/playerEngines');
const { sanitizeDefaultLanguage } = require('../constants/streamLanguages');

const DEFAULT_PLAYER_CONFIG = {
  preferredEngine: 'auto',
  bufferMinMs: 800,
  bufferMaxMs: 12000,
  initialBufferMs: 1500,
  retryMax: 4,
  retryDelayMs: 1200,
  reconnectEnabled: true,
  autoPlay: true,
  defaultQuality: '360p',
  defaultLanguage: 'sw',
  failoverToWebview: true,
  hardwareAcceleration: true,
  softwareDecodeFallback: true,
  backgroundPlayback: false,
  resumePlayback: true,
  networkTimeoutMs: 15000,
  reconnectionPolicy: 'balanced',
  qualitiesAllowed: ['auto', '240p', '360p', '480p', '720p', '1080p'],
  languagesAllowed: ['sw', 'en'],
};

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

function mapRow(row) {
  if (!row) return { ...DEFAULT_PLAYER_CONFIG };
  return {
    preferredEngine: sanitizeGlobalPlaybackEngine(row.preferred_engine),
    bufferMinMs: Number(row.buffer_min_ms) || 800,
    bufferMaxMs: Number(row.buffer_max_ms) || 12000,
    initialBufferMs: Number(row.initial_buffer_ms) || 1500,
    retryMax: Number(row.retry_max) || 4,
    retryDelayMs: Number(row.retry_delay_ms) || 1200,
    reconnectEnabled: row.reconnect_enabled !== false,
    autoPlay: row.auto_play !== false,
    defaultQuality: row.default_quality || '360p',
    defaultLanguage: sanitizeDefaultLanguage(row.default_language),
    failoverToWebview: row.failover_to_webview !== false,
    hardwareAcceleration: row.hardware_acceleration !== false,
    softwareDecodeFallback: row.software_decode_fallback !== false,
    backgroundPlayback: row.background_playback === true,
    resumePlayback: row.resume_playback !== false,
    networkTimeoutMs: Number(row.network_timeout_ms) || 15000,
    reconnectionPolicy: ['aggressive', 'balanced', 'conservative'].includes(
      String(row.reconnection_policy || '').toLowerCase(),
    ) ? String(row.reconnection_policy).toLowerCase() : 'balanced',
    qualitiesAllowed: parseJsonArray(
      row.qualities_allowed,
      DEFAULT_PLAYER_CONFIG.qualitiesAllowed,
    ),
    languagesAllowed: parseJsonArray(
      row.languages_allowed,
      DEFAULT_PLAYER_CONFIG.languagesAllowed,
    ),
  };
}

async function getGlobalPlayerConfig() {
  try {
    const result = await query(
      `SELECT preferred_engine, buffer_min_ms, buffer_max_ms, initial_buffer_ms,
              retry_max, retry_delay_ms, reconnect_enabled, auto_play, default_quality,
              failover_to_webview, hardware_acceleration, software_decode_fallback,
              background_playback, resume_playback, network_timeout_ms,
              reconnection_policy, qualities_allowed, languages_allowed,
              default_language
         FROM player_config_global
        WHERE id = 1
        LIMIT 1`,
    );
    return mapRow(result.rows[0]);
  } catch (_) {
    return { ...DEFAULT_PLAYER_CONFIG };
  }
}

async function updateGlobalPlayerConfig(patch) {
  const current = await getGlobalPlayerConfig();
  const sanitized = sanitizePlayerConfigPatch(patch);
  const next = {
    ...current,
    ...sanitized,
    languagesAllowed: ['sw', 'en'],
    defaultLanguage: sanitizeDefaultLanguage(
      sanitized.defaultLanguage ?? current.defaultLanguage ?? DEFAULT_PLAYER_CONFIG.defaultLanguage,
    ),
  };
  if (next.bufferMaxMs < next.bufferMinMs + 500) {
    next.bufferMaxMs = Math.max(next.bufferMinMs + 500, 2000);
  }
  await query(
    `INSERT INTO player_config_global
       (id, preferred_engine, buffer_min_ms, buffer_max_ms, initial_buffer_ms,
        retry_max, retry_delay_ms, reconnect_enabled, auto_play, default_quality,
        failover_to_webview, hardware_acceleration, software_decode_fallback,
        background_playback, resume_playback, network_timeout_ms,
        reconnection_policy, qualities_allowed, languages_allowed,
        default_language, updated_at)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,NOW())
     ON CONFLICT (id) DO UPDATE SET
       preferred_engine = EXCLUDED.preferred_engine,
       buffer_min_ms = EXCLUDED.buffer_min_ms,
       buffer_max_ms = EXCLUDED.buffer_max_ms,
       initial_buffer_ms = EXCLUDED.initial_buffer_ms,
       retry_max = EXCLUDED.retry_max,
       retry_delay_ms = EXCLUDED.retry_delay_ms,
       reconnect_enabled = EXCLUDED.reconnect_enabled,
       auto_play = EXCLUDED.auto_play,
       default_quality = EXCLUDED.default_quality,
       failover_to_webview = EXCLUDED.failover_to_webview,
       hardware_acceleration = EXCLUDED.hardware_acceleration,
       software_decode_fallback = EXCLUDED.software_decode_fallback,
       background_playback = EXCLUDED.background_playback,
       resume_playback = EXCLUDED.resume_playback,
       network_timeout_ms = EXCLUDED.network_timeout_ms,
       reconnection_policy = EXCLUDED.reconnection_policy,
       qualities_allowed = EXCLUDED.qualities_allowed,
       languages_allowed = EXCLUDED.languages_allowed,
       default_language = EXCLUDED.default_language,
       updated_at = NOW()`,
    [
      next.preferredEngine,
      next.bufferMinMs,
      next.bufferMaxMs,
      next.initialBufferMs,
      next.retryMax,
      next.retryDelayMs,
      next.reconnectEnabled,
      next.autoPlay,
      next.defaultQuality,
      next.failoverToWebview,
      next.hardwareAcceleration,
      next.softwareDecodeFallback,
      next.backgroundPlayback,
      next.resumePlayback,
      next.networkTimeoutMs,
      next.reconnectionPolicy,
      JSON.stringify(next.qualitiesAllowed),
      JSON.stringify(['sw', 'en']),
      next.defaultLanguage,
    ],
  );
  return next;
}

const VALID_QUALITIES = new Set(['auto', '240p', '360p', '480p', '720p', '1080p', '2k', '4k']);
const VALID_RECONNECTION_POLICIES = new Set(['aggressive', 'balanced', 'conservative']);

function sanitizePlayerConfigPatch(patch) {
  if (!patch || typeof patch !== 'object') return {};
  const out = {};
  if (patch.preferredEngine != null) {
    out.preferredEngine = sanitizeGlobalPlaybackEngine(patch.preferredEngine);
  }
  if (patch.bufferMinMs != null) {
    const n = Number(patch.bufferMinMs);
    if (Number.isFinite(n)) out.bufferMinMs = Math.min(60_000, Math.max(500, Math.round(n)));
  }
  if (patch.bufferMaxMs != null) {
    const n = Number(patch.bufferMaxMs);
    if (Number.isFinite(n)) out.bufferMaxMs = Math.min(120_000, Math.max(2000, Math.round(n)));
  }
  if (patch.initialBufferMs != null) {
    const n = Number(patch.initialBufferMs);
    if (Number.isFinite(n)) out.initialBufferMs = Math.min(30_000, Math.max(200, Math.round(n)));
  }
  if (patch.retryMax != null) {
    const n = Number(patch.retryMax);
    if (Number.isFinite(n)) out.retryMax = Math.min(12, Math.max(1, Math.round(n)));
  }
  if (patch.retryDelayMs != null) {
    const n = Number(patch.retryDelayMs);
    if (Number.isFinite(n)) out.retryDelayMs = Math.min(15_000, Math.max(200, Math.round(n)));
  }
  if (patch.reconnectEnabled != null) out.reconnectEnabled = !!patch.reconnectEnabled;
  if (patch.autoPlay != null) out.autoPlay = !!patch.autoPlay;
  if (patch.defaultQuality != null) {
    const q = String(patch.defaultQuality).trim().toLowerCase();
    if (VALID_QUALITIES.has(q)) out.defaultQuality = q;
  }
  if (patch.defaultLanguage != null) {
    out.defaultLanguage = sanitizeDefaultLanguage(patch.defaultLanguage);
  }
  if (patch.failoverToWebview != null) out.failoverToWebview = !!patch.failoverToWebview;
  if (patch.hardwareAcceleration != null) out.hardwareAcceleration = !!patch.hardwareAcceleration;
  if (patch.softwareDecodeFallback != null) out.softwareDecodeFallback = !!patch.softwareDecodeFallback;
  if (patch.backgroundPlayback != null) out.backgroundPlayback = !!patch.backgroundPlayback;
  if (patch.resumePlayback != null) out.resumePlayback = !!patch.resumePlayback;
  if (patch.networkTimeoutMs != null) {
    const n = Number(patch.networkTimeoutMs);
    if (Number.isFinite(n)) out.networkTimeoutMs = Math.min(120_000, Math.max(3000, Math.round(n)));
  }
  if (patch.reconnectionPolicy != null) {
    const p = String(patch.reconnectionPolicy).trim().toLowerCase();
    if (VALID_RECONNECTION_POLICIES.has(p)) out.reconnectionPolicy = p;
  }
  if (patch.qualitiesAllowed != null) {
    const arr = parseJsonArray(patch.qualitiesAllowed, DEFAULT_PLAYER_CONFIG.qualitiesAllowed);
    out.qualitiesAllowed = arr.filter((q) => VALID_QUALITIES.has(q.toLowerCase()));
  }
  if (patch.languagesAllowed != null) {
    const arr = parseJsonArray(patch.languagesAllowed, DEFAULT_PLAYER_CONFIG.languagesAllowed)
      .map((l) => String(l).trim().toLowerCase())
      .filter((l) => l === 'sw' || l === 'en');
    out.languagesAllowed = arr.length ? arr : ['sw', 'en'];
  }
  return out;
}

module.exports = {
  DEFAULT_PLAYER_CONFIG,
  VALID_ENGINES,
  getGlobalPlayerConfig,
  updateGlobalPlayerConfig,
  sanitizePlayerConfigPatch,
};
