const { query } = require('../db');

const VALID_EVENT_TYPES = new Set([
  'channel_open',
  'watch_duration',
  'player_crash',
  'buffer_event',
  'stream_failure',
  'quality_switch',
  'language_change',
  'failover_step',
  'auto_heal',
  'device_info',
]);

function sanitizeEventType(raw) {
  const t = String(raw || '').trim().toLowerCase();
  return VALID_EVENT_TYPES.has(t) ? t : 'device_info';
}

async function ingestEvents(events, userExternalId = null) {
  if (!Array.isArray(events) || events.length === 0) return { accepted: 0 };
  const capped = events.slice(0, 50);
  let accepted = 0;

  for (const ev of capped) {
    if (!ev || typeof ev !== 'object') continue;
    const eventType = sanitizeEventType(ev.eventType || ev.event_type);
    const channelId = ev.channelId != null ? parseInt(ev.channelId, 10) : null;
    const payload = ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
    const deviceInfo = ev.deviceInfo && typeof ev.deviceInfo === 'object'
      ? ev.deviceInfo
      : (ev.device_info && typeof ev.device_info === 'object' ? ev.device_info : {});

    try {
      await query(
        `INSERT INTO player_analytics_events
           (user_external_id, channel_id, event_type, payload_json, device_info)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [
          userExternalId || ev.userExternalId || ev.user_external_id || null,
          Number.isFinite(channelId) && channelId > 0 ? channelId : null,
          eventType,
          JSON.stringify(payload),
          JSON.stringify(deviceInfo),
        ],
      );
      accepted += 1;
    } catch (_) {
      // Non-fatal — table may not exist on older deployments until migration runs.
    }
  }

  return { accepted };
}

async function getPlaybackAnalyticsSummary({ days = 7 } = {}) {
  const windowDays = Math.min(90, Math.max(1, Number(days) || 7));
  try {
    const result = await query(
      `SELECT
         COUNT(*) FILTER (WHERE event_type = 'channel_open')::int AS channel_opens,
         COUNT(*) FILTER (WHERE event_type = 'stream_failure')::int AS stream_failures,
         COUNT(*) FILTER (WHERE event_type = 'player_crash')::int AS player_crashes,
         COUNT(*) FILTER (WHERE event_type = 'buffer_event')::int AS buffer_events,
         COUNT(*) FILTER (WHERE event_type = 'quality_switch')::int AS quality_switches,
         COUNT(*) FILTER (WHERE event_type = 'failover_step')::int AS failover_steps,
         COUNT(*) FILTER (WHERE event_type = 'auto_heal')::int AS auto_heals,
         COALESCE(SUM(
           CASE WHEN event_type = 'watch_duration'
             THEN COALESCE((payload_json->>'seconds')::numeric, 0)
             ELSE 0 END
         ), 0)::bigint AS total_watch_seconds
       FROM player_analytics_events
      WHERE created_at > NOW() - ($1 || ' days')::interval`,
      [String(windowDays)],
    );
    const row = result.rows[0] || {};
    return {
      windowDays,
      channelOpens: Number(row.channel_opens) || 0,
      streamFailures: Number(row.stream_failures) || 0,
      playerCrashes: Number(row.player_crashes) || 0,
      bufferEvents: Number(row.buffer_events) || 0,
      qualitySwitches: Number(row.quality_switches) || 0,
      failoverSteps: Number(row.failover_steps) || 0,
      autoHeals: Number(row.auto_heals) || 0,
      totalWatchSeconds: Number(row.total_watch_seconds) || 0,
    };
  } catch (_) {
    return {
      windowDays,
      channelOpens: 0,
      streamFailures: 0,
      playerCrashes: 0,
      bufferEvents: 0,
      qualitySwitches: 0,
      failoverSteps: 0,
      autoHeals: 0,
      totalWatchSeconds: 0,
    };
  }
}

async function getTopFailureChannels({ days = 7, limit = 10 } = {}) {
  const windowDays = Math.min(90, Math.max(1, Number(days) || 7));
  const lim = Math.min(50, Math.max(1, Number(limit) || 10));
  try {
    const result = await query(
      `SELECT e.channel_id, c.name AS channel_name,
              COUNT(*)::int AS failure_count
         FROM player_analytics_events e
         LEFT JOIN channels c ON c.id = e.channel_id
        WHERE e.event_type IN ('stream_failure', 'player_crash')
          AND e.created_at > NOW() - ($1 || ' days')::interval
          AND e.channel_id IS NOT NULL
        GROUP BY e.channel_id, c.name
        ORDER BY failure_count DESC
        LIMIT $2`,
      [String(windowDays), lim],
    );
    return result.rows.map((r) => ({
      channelId: r.channel_id,
      channelName: r.channel_name || `Channel ${r.channel_id}`,
      failureCount: Number(r.failure_count) || 0,
    }));
  } catch (_) {
    return [];
  }
}

module.exports = {
  ingestEvents,
  getPlaybackAnalyticsSummary,
  getTopFailureChannels,
  VALID_EVENT_TYPES,
};
