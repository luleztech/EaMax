const { query } = require('../db');
const { VALID_ENGINES, sanitizeGlobalPlaybackEngine } = require('../constants/playerEngines');

const DEFAULT_PLAYER_CONFIG = {
  preferredEngine: 'auto',
  bufferMinMs: 800,
  bufferMaxMs: 12000,
  retryMax: 4,
  retryDelayMs: 1200,
  reconnectEnabled: true,
  autoPlay: true,
  defaultQuality: '360p',
  failoverToWebview: true,
};

function mapRow(row) {
  if (!row) return { ...DEFAULT_PLAYER_CONFIG };
  return {
    preferredEngine: sanitizeGlobalPlaybackEngine(row.preferred_engine),
    bufferMinMs: Number(row.buffer_min_ms) || 800,
    bufferMaxMs: Number(row.buffer_max_ms) || 12000,
    retryMax: Number(row.retry_max) || 4,
    retryDelayMs: Number(row.retry_delay_ms) || 1200,
    reconnectEnabled: row.reconnect_enabled !== false,
    autoPlay: row.auto_play !== false,
    defaultQuality: row.default_quality || '360p',
    failoverToWebview: row.failover_to_webview !== false,
  };
}

async function getGlobalPlayerConfig() {
  try {
    const result = await query(
      `SELECT preferred_engine, buffer_min_ms, buffer_max_ms, retry_max, retry_delay_ms,
              reconnect_enabled, auto_play, default_quality, failover_to_webview
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
  const next = { ...current, ...sanitized };
  if (next.bufferMaxMs < next.bufferMinMs + 500) {
    next.bufferMaxMs = Math.max(next.bufferMinMs + 500, 2000);
  }
  await query(
    `INSERT INTO player_config_global
       (id, preferred_engine, buffer_min_ms, buffer_max_ms, retry_max, retry_delay_ms,
        reconnect_enabled, auto_play, default_quality, failover_to_webview, updated_at)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (id) DO UPDATE SET
       preferred_engine = EXCLUDED.preferred_engine,
       buffer_min_ms = EXCLUDED.buffer_min_ms,
       buffer_max_ms = EXCLUDED.buffer_max_ms,
       retry_max = EXCLUDED.retry_max,
       retry_delay_ms = EXCLUDED.retry_delay_ms,
       reconnect_enabled = EXCLUDED.reconnect_enabled,
       auto_play = EXCLUDED.auto_play,
       default_quality = EXCLUDED.default_quality,
       failover_to_webview = EXCLUDED.failover_to_webview,
       updated_at = NOW()`,
    [
      next.preferredEngine,
      next.bufferMinMs,
      next.bufferMaxMs,
      next.retryMax,
      next.retryDelayMs,
      next.reconnectEnabled,
      next.autoPlay,
      next.defaultQuality,
      next.failoverToWebview,
    ],
  );
  return next;
}

const VALID_QUALITIES = new Set(['auto', '240p', '360p', '480p', '720p', '1080p']);

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
  if (patch.failoverToWebview != null) out.failoverToWebview = !!patch.failoverToWebview;
  return out;
}

module.exports = {
  DEFAULT_PLAYER_CONFIG,
  VALID_ENGINES,
  getGlobalPlayerConfig,
  updateGlobalPlayerConfig,
  sanitizePlayerConfigPatch,
};
