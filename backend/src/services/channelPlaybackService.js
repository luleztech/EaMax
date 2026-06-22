const { query } = require('../db');
const { sanitizeChannelAudioLanguage } = require('../constants/streamLanguages');
const { resolvePlaybackPolicy } = require('./playbackPolicyService');

async function resolveStreamUrl(row) {
  if (row.stream_url && String(row.stream_url).trim()) {
    return String(row.stream_url).trim();
  }
  if (row.stream_alias) {
    const alias = await query(
      `SELECT COALESCE(c.stream_url, t.stream_url) AS url
         FROM stream_aliases a
         LEFT JOIN channels c ON c.id = a.channel_id
         LEFT JOIN channels t ON t.stream_alias = a.alias
        WHERE a.alias = $1 AND a.is_active = TRUE
        LIMIT 1`,
      [row.stream_alias],
    );
    const url = alias.rows[0]?.url;
    if (url) return String(url).trim();
  }
  return '';
}

function mapStreamRow(row, resolvedUrl) {
  const drmType = (row.drm_type || 'NONE').toUpperCase();
  const isClearKey = drmType === 'CLEARKEY';
  let headers = {};
  try {
    headers = typeof row.headers_json === 'object' && row.headers_json
      ? row.headers_json
      : JSON.parse(row.headers_json || '{}');
  } catch (_) {
    headers = {};
  }
  return {
    priority: Number(row.priority) || 0,
    url: resolvedUrl,
    streamAlias: row.stream_alias || null,
    drmType,
    drmClearKey: isClearKey && row.drm_clear_key ? String(row.drm_clear_key).trim() : null,
    licenseUrl: row.license_url || null,
    headers,
    isActive: row.is_active !== false,
  };
}

async function getChannelPlayback(channelId) {
  const channelResult = await query(
    `SELECT c.id, c.name, c.category, c.is_active,
            COALESCE(c.stream_url, t.stream_url) AS legacy_url,
            c.stream_alias, c.drm_type, c.drm_clear_key, c.license_url,
            c.thumbnail_url, c.points_required, c.unlock_to_free,
            c.playback_engine, c.audio_language,
            c.preferred_quality, c.stream_type,
            c.buffer_min_ms_override, c.buffer_max_ms_override,
            c.retry_max_override, c.retry_delay_ms_override,
            c.region_rules_json
       FROM channels c
       LEFT JOIN stream_aliases a ON a.alias = c.stream_alias AND a.is_active = TRUE
       LEFT JOIN channels t ON t.id = a.channel_id AND t.is_active = TRUE
      WHERE c.id = $1 AND c.is_active = TRUE
      LIMIT 1`,
    [channelId],
  );
  if (!channelResult.rows.length) return null;
  const channel = channelResult.rows[0];

  let streamRows = [];
  try {
    const streamsResult = await query(
      `SELECT priority, stream_url, stream_alias, drm_type, drm_clear_key,
              license_url, headers_json, is_active
         FROM channel_streams
        WHERE channel_id = $1 AND is_active = TRUE
        ORDER BY priority ASC`,
      [channelId],
    );
    streamRows = streamsResult.rows;
  } catch (_) {
    streamRows = [];
  }

  const streams = [];
  if (streamRows.length) {
    for (const row of streamRows) {
      const url = await resolveStreamUrl(row);
      if (url) streams.push(mapStreamRow(row, url));
    }
  }

  if (streams.length === 0 && channel.legacy_url) {
    const legacyDrmType = (channel.drm_type || 'NONE').toUpperCase();
    streams.push({
      priority: 0,
      url: String(channel.legacy_url).trim(),
      streamAlias: channel.stream_alias || null,
      drmType: legacyDrmType,
      drmClearKey: legacyDrmType === 'CLEARKEY' && channel.drm_clear_key
        ? String(channel.drm_clear_key).trim()
        : null,
      licenseUrl: channel.license_url || null,
      headers: {},
      isActive: true,
    });
  }

  const policy = await resolvePlaybackPolicy(channel);

  return {
    channelId: channel.id,
    name: channel.name,
    category: channel.category,
    streams,
    playbackEngine: policy.playbackEngine,
    effectiveEngine: policy.effectiveEngine,
    audioLanguage: policy.audioLanguage,
    audio_language: policy.audioLanguage,
    streamType: policy.streamType,
    playerConfig: policy,
    playbackPolicy: policy,
  };
}

async function upsertChannelStream(channelId, priority, data) {
  await query(
    `INSERT INTO channel_streams
       (channel_id, priority, stream_url, stream_alias, drm_type, drm_clear_key,
        license_url, headers_json, is_active, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,NOW())
     ON CONFLICT (channel_id, priority) DO UPDATE SET
       stream_url = EXCLUDED.stream_url,
       stream_alias = EXCLUDED.stream_alias,
       drm_type = EXCLUDED.drm_type,
       drm_clear_key = EXCLUDED.drm_clear_key,
       license_url = EXCLUDED.license_url,
       headers_json = EXCLUDED.headers_json,
       is_active = EXCLUDED.is_active,
       updated_at = NOW()`,
    [
      channelId,
      priority,
      data.streamUrl || null,
      data.streamAlias || null,
      data.drmType || 'NONE',
      data.drmClearKey || null,
      data.licenseUrl || null,
      JSON.stringify(data.headers || {}),
      data.isActive !== false,
    ],
  );
}

async function syncPrimaryChannelStreamFromChannel(channelRow) {
  if (!channelRow?.id) return;
  const streamUrl = channelRow.stream_url ? String(channelRow.stream_url).trim() : '';
  const streamAlias = channelRow.stream_alias ? String(channelRow.stream_alias).trim() : '';
  if (!streamUrl && !streamAlias) return;
  const drmType = (channelRow.drm_type || 'NONE').toUpperCase();
  await upsertChannelStream(channelRow.id, 0, {
    streamUrl: streamUrl || null,
    streamAlias: streamAlias || null,
    drmType,
    drmClearKey: drmType === 'CLEARKEY' && channelRow.drm_clear_key
      ? String(channelRow.drm_clear_key).trim()
      : null,
    licenseUrl: channelRow.license_url ? String(channelRow.license_url).trim() : null,
    isActive: channelRow.is_active !== false,
  });
}

module.exports = {
  getChannelPlayback,
  upsertChannelStream,
  syncPrimaryChannelStreamFromChannel,
};
