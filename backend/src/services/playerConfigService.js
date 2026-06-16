const { query } = require('../db');

const DEFAULT_PLAYER_CONFIG = {
  preferredEngine: 'auto',
  bufferMinMs: 1500,
  bufferMaxMs: 30000,
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
    preferredEngine: row.preferred_engine || 'auto',
    bufferMinMs: Number(row.buffer_min_ms) || 1500,
    bufferMaxMs: Number(row.buffer_max_ms) || 30000,
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
  const next = { ...current, ...patch };
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

module.exports = {
  DEFAULT_PLAYER_CONFIG,
  getGlobalPlayerConfig,
  updateGlobalPlayerConfig,
};
