'use strict';

/**
 * Keeps playback working without anyone touching it.
 *
 *  - HOT loop (every 75s): channels users opened in the last 30 min are re-resolved before the
 *    120s resolve cache expires, so the next tap never pays a cold resolve and an upstream
 *    change (CDN headers, token host, rotated link) is detected and repaired within a minute.
 *  - SWEEP loop (every 30 min): every embed channel is checked once, low concurrency, so a
 *    dead source is noticed (and Azam repaired) even if nobody is watching it right now.
 *
 * Both loops are best-effort and never throw. Status: GET /api/playback/health.
 */

const { query } = require('../db');
const {
  healChannel,
  recentlyPlayedChannelIds,
} = require('./embedPlaybackService');

const HOT_INTERVAL_MS = 75 * 1000;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const HOT_WINDOW_MS = 30 * 60 * 1000;
const HOT_CONCURRENCY = 3;
const SWEEP_CONCURRENCY = 2;
const SWEEP_MAX_CHANNELS = 120;

let started = false;
let hotRunning = false;
let sweepRunning = false;

async function runLimited(ids, limit) {
  const queue = [...ids];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        await healChannel(id);
      } catch (err) {
        console.warn(`[watchdog] ch=${id} crashed:`, err.message || err);
      }
    }
  });
  await Promise.all(workers);
}

async function hotTick() {
  if (hotRunning) return;
  hotRunning = true;
  try {
    const ids = recentlyPlayedChannelIds(HOT_WINDOW_MS);
    if (ids.length) await runLimited(ids, HOT_CONCURRENCY);
  } finally {
    hotRunning = false;
  }
}

async function sweepTick() {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    const r = await query(
      `SELECT id FROM channels
        WHERE is_active = TRUE
          AND (stream_alias IS NOT NULL
               OR stream_url ~* '(\\.php|/embed|/gateway|/player)')
        ORDER BY id
        LIMIT $1`,
      [SWEEP_MAX_CHANNELS],
    );
    const ids = r.rows.map((row) => Number(row.id)).filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length) await runLimited(ids, SWEEP_CONCURRENCY);
  } catch (err) {
    console.warn('[watchdog] sweep failed:', err.message || err);
  } finally {
    sweepRunning = false;
  }
}

function startChannelWatchdog() {
  if (started) return;
  if (String(process.env.CHANNEL_WATCHDOG || '').toLowerCase() === 'off') {
    console.info('[watchdog] disabled via CHANNEL_WATCHDOG=off');
    return;
  }
  started = true;
  setTimeout(() => {
    sweepTick().catch(() => {});
    setInterval(() => sweepTick().catch(() => {}), SWEEP_INTERVAL_MS).unref?.();
  }, 45 * 1000).unref?.();
  setInterval(() => hotTick().catch(() => {}), HOT_INTERVAL_MS).unref?.();
  console.info('[watchdog] channel watchdog started');
}

module.exports = { startChannelWatchdog, hotTick, sweepTick };
