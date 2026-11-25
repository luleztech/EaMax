const { query } = require('../db');
const { VALID_ENGINES, sanitizeGlobalPlaybackEngine } = require('../constants/playerEngines');
const { sanitizeDefaultLanguage } = require('../constants/streamLanguages');

const DEFAULT_GATEWAY_POLICY = {
  /** Sent as X-Requested-With so embed hosts recognize the official app. */
  appPackageHeader: 'com.washatv',
  /** Browser UA used when warming embed.php / gateway HTML. */
  pageUserAgent:
    'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  /** UA on the resolved media request (MPD/HLS) — Washa/SokaMax use ExoPlayer. */
  mediaUserAgent: 'ExoPlayer',
  /** Warm embed page + cookies before calling player.php?api=1. */
  warmCookies: true,
  /** Resolve embed.php?app=&key= via player.php JSON on device (same as Washa). */
  resolveEmbedApi: true,
  /** Nagra / Widevine license auth header name. */
  licenseAuthHeader: 'nv-authorizations',
  /** HTML marker when the host rejects unauthorized apps. */
  blockedPageMarker: 'App Haijatambuliwa',
};

const DEFAULT_PLAYER_CONFIG = {
  preferredEngine: 'auto',
  // Deeper buffers so mobile data / flaky Wi‑Fi don't play↔pause (existing apps).
  bufferMinMs: 18_000,
  bufferMaxMs: 55_000,
  initialBufferMs: 3000,
  retryMax: 6,
  retryDelayMs: 1500,
  reconnectEnabled: true,
  autoPlay: true,
  defaultQuality: '480p',
  defaultLanguage: 'sw',
  failoverToWebview: true,
  hardwareAcceleration: true,
  softwareDecodeFallback: true,
  backgroundPlayback: false,
  resumePlayback: true,
  networkTimeoutMs: 20000,
  reconnectionPolicy: 'balanced',
  qualitiesAllowed: ['auto', '240p', '360p', '480p', '720p', '1080p'],
  languagesAllowed: ['sw', 'en'],
  gatewayPolicy: { ...DEFAULT_GATEWAY_POLICY },
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

function parseJsonObject(raw, fallback) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_) { /* ignore */ }
  }
  return fallback;
}

function sanitizeGatewayPolicy(raw) {
  const src = parseJsonObject(raw, {});
  const out = { ...DEFAULT_GATEWAY_POLICY };
  if (src.appPackageHeader != null) {
    const v = String(src.appPackageHeader).trim();
    // Never allow the real EaMax package — embed hosts reject com.eamax.
    if (
      /^[a-zA-Z][a-zA-Z0-9._]*$/.test(v)
      && v.length <= 128
      && !/^com\.eamax(\.|$)/i.test(v)
    ) {
      out.appPackageHeader = v;
    }
  }
  // Embed URLs must always advertise Washa's package to the gateway.
  if (!out.appPackageHeader || /^com\.eamax(\.|$)/i.test(out.appPackageHeader)) {
    out.appPackageHeader = 'com.washatv';
  }
  if (src.pageUserAgent != null) {
    const v = String(src.pageUserAgent).trim();
    if (v.length >= 10 && v.length <= 512) out.pageUserAgent = v;
  }
  if (src.mediaUserAgent != null) {
    const v = String(src.mediaUserAgent).trim();
    if (v.length >= 1 && v.length <= 256) out.mediaUserAgent = v;
  }
  if (src.warmCookies != null) out.warmCookies = !!src.warmCookies;
  if (src.resolveEmbedApi != null) out.resolveEmbedApi = !!src.resolveEmbedApi;
  if (src.licenseAuthHeader != null) {
    const v = String(src.licenseAuthHeader).trim();
    if (/^[A-Za-z][A-Za-z0-9\-]*$/.test(v) && v.length <= 64) out.licenseAuthHeader = v;
  }
  if (src.blockedPageMarker != null) {
    const v = String(src.blockedPageMarker).trim();
    if (v.length >= 3 && v.length <= 200) out.blockedPageMarker = v;
  }
  return out;
}

function mapRow(row) {
  if (!row) return { ...DEFAULT_PLAYER_CONFIG, gatewayPolicy: { ...DEFAULT_GATEWAY_POLICY } };
  // Floor soft values so old DB rows still protect mobile-data / weak Wi‑Fi clients.
  const bufferMinMs = Math.max(Number(row.buffer_min_ms) || 18_000, 15_000);
  const bufferMaxMs = Math.max(Number(row.buffer_max_ms) || 55_000, bufferMinMs + 10_000);
  const initialBufferMs = Math.max(Number(row.initial_buffer_ms) || 3_000, 2_500);
  return {
    preferredEngine: sanitizeGlobalPlaybackEngine(row.preferred_engine),
    bufferMinMs,
    bufferMaxMs,
    initialBufferMs,
    retryMax: Math.max(Number(row.retry_max) || 6, 4),
    retryDelayMs: Math.max(Number(row.retry_delay_ms) || 1500, 1000),
    reconnectEnabled: row.reconnect_enabled !== false,
    autoPlay: row.auto_play !== false,
    defaultQuality: row.default_quality || '480p',
    defaultLanguage: sanitizeDefaultLanguage(row.default_language),
    failoverToWebview: row.failover_to_webview !== false,
    hardwareAcceleration: row.hardware_acceleration !== false,
    softwareDecodeFallback: row.software_decode_fallback !== false,
    backgroundPlayback: row.background_playback === true,
    resumePlayback: row.resume_playback !== false,
    networkTimeoutMs: Math.max(Number(row.network_timeout_ms) || 20_000, 15_000),
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
    gatewayPolicy: sanitizeGatewayPolicy(row.gateway_policy_json),
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
              default_language, gateway_policy_json
         FROM player_config_global
        WHERE id = 1
        LIMIT 1`,
    );
    return mapRow(result.rows[0]);
  } catch (_) {
    return { ...DEFAULT_PLAYER_CONFIG, gatewayPolicy: { ...DEFAULT_GATEWAY_POLICY } };
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
    gatewayPolicy: sanitized.gatewayPolicy
      ? sanitizeGatewayPolicy(sanitized.gatewayPolicy)
      : sanitizeGatewayPolicy(current.gatewayPolicy),
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
        default_language, gateway_policy_json, updated_at)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20::jsonb,NOW())
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
       gateway_policy_json = EXCLUDED.gateway_policy_json,
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
      JSON.stringify(next.gatewayPolicy),
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
  if (patch.gatewayPolicy != null) {
    out.gatewayPolicy = sanitizeGatewayPolicy(patch.gatewayPolicy);
  }
  return out;
}

module.exports = {
  DEFAULT_PLAYER_CONFIG,
  DEFAULT_GATEWAY_POLICY,
  VALID_ENGINES,
  getGlobalPlayerConfig,
  updateGlobalPlayerConfig,
  sanitizePlayerConfigPatch,
  sanitizeGatewayPolicy,
};
