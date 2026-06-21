const express = require('express');
const { z } = require('zod');
const { query } = require('../db');

/* global Buffer */

const router = express.Router();

// Public: list active channels, optionally filter by category
router.get('/', async (req, res, next) => {
  try {
    const schema = z.object({
      category: z.enum(['football', 'movies', 'habari', 'tamthilia', 'wanyama', 'katuni', 'sayansi']).optional(),
    });
    const parsed = schema.safeParse(req.query);

    let sql = `
      SELECT
        c.*,
        COALESCE(c.stream_url, t.stream_url) AS resolved_stream_url
      FROM channels c
      LEFT JOIN stream_aliases a ON a.alias = c.stream_alias AND a.is_active = TRUE
      LEFT JOIN channels t ON t.id = a.channel_id AND t.is_active = TRUE
      WHERE c.is_active = TRUE
    `;
    const params = [];

    if (parsed.success && parsed.data.category) {
      sql += ' AND c.category = $1';
      params.push(parsed.data.category);
    }

    sql += ' ORDER BY COALESCE(c.sort_order, c.id) ASC, c.id ASC';

    const result = await query(sql, params);
    const rows = (result.rows || []).map((row) => {
      const pts = row.points_required != null ? Number(row.points_required) : 0;
      const drmType = (row.drm_type || 'NONE').toUpperCase();
      const isClearKey = drmType === 'CLEARKEY';
      const unlockToFree = !!(row.unlock_to_free === true || row.unlockToFree === true);
      const playbackEngine = row.playback_engine || null;
      const audioLanguage = row.audio_language || 'auto';
      const out = {
        ...row,
        stream_url: row.resolved_stream_url ?? row.stream_url,
        streamUrl: row.resolved_stream_url ?? row.stream_url,
        stream_alias: row.stream_alias ?? null,
        streamAlias: row.stream_alias ?? null,
        license_url: row.license_url ?? null,
        licenseUrl: row.license_url ?? null,
        points_required: pts,
        pointsRequired: Number.isNaN(pts) ? 0 : pts,
        drm_type: drmType,
        drmType,
        unlock_to_free: unlockToFree,
        unlockToFree,
        playback_engine: playbackEngine,
        playbackEngine,
        audio_language: audioLanguage,
        audioLanguage,
      };
      if (!isClearKey) {
        out.drm_clear_key = null;
        out.drmClearKey = null;
      } else if (row.drm_clear_key != null) {
        out.drmClearKey = String(row.drm_clear_key).trim();
      }
      return out;
    });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// Public: get single channel by id (stream URL from admin) – for fast play on click
router.get('/:id', async (req, res, next) => {
  try {
    const schema = z.object({ id: z.string().regex(/^\d+$/) });
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid channel id' });
    const id = parsed.data.id;
    const result = await query(
      `SELECT
         c.id, c.name, c.category,
         COALESCE(c.stream_url, t.stream_url) AS stream_url,
         c.stream_alias,
         c.thumbnail_url, c.thumbnail_emoji, c.color, c.points_required, c.drm_protected,
         COALESCE(c.drm_type, 'NONE') AS drm_type,
         c.drm_clear_key,
         c.license_url,
         c.playback_engine,
         COALESCE(c.audio_language, 'auto') AS audio_language,
         COALESCE(c.unlock_to_free, false) AS unlock_to_free
       FROM channels c
       LEFT JOIN stream_aliases a ON a.alias = c.stream_alias AND a.is_active = TRUE
       LEFT JOIN channels t ON t.id = a.channel_id AND t.is_active = TRUE
       WHERE c.id = $1 AND c.is_active = TRUE`,
      [id]
    );
    if (!result.rows || result.rows.length === 0) return res.status(404).json({ error: 'Channel not found' });
    const row = result.rows[0];
    const pts = row.points_required != null ? Number(row.points_required) : 0;
    const drmType = (row.drm_type || 'NONE').toUpperCase();
    const isClearKey = drmType === 'CLEARKEY';
    const clearKey = isClearKey && row.drm_clear_key ? String(row.drm_clear_key).trim() : null;
    const unlockToFree = !!(row.unlock_to_free === true);
    const audioLanguage = row.audio_language || 'auto';
    return res.json({
      id: row.id,
      name: row.name,
      category: row.category,
      stream_url: row.stream_url,
      streamUrl: row.stream_url,
      stream_alias: row.stream_alias ?? null,
      streamAlias: row.stream_alias ?? null,
      thumbnail_url: row.thumbnail_url,
      thumbnail_emoji: row.thumbnail_emoji,
      color: row.color,
      points_required: pts,
      pointsRequired: pts,
      drm_protected: !!row.drm_protected,
      drmProtected: !!row.drm_protected,
      drm_type: drmType,
      drmType,
      drm_clear_key: clearKey,
      drmClearKey: clearKey,
      license_url: row.license_url ?? null,
      licenseUrl: row.license_url ?? null,
      playback_engine: row.playback_engine || null,
      playbackEngine: row.playback_engine || null,
      audio_language: audioLanguage,
      audioLanguage,
      unlock_to_free: unlockToFree,
      unlockToFree,
    });
  } catch (err) {
    return next(err);
  }
});

// Helper to convert Hex string to Base64Url (required by ExoPlayer ClearKey)
function hexToBase64Url(hexString) {
  try {
    const buffer = Buffer.from(hexString, 'hex');
    return buffer.toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  } catch (e) {
    return hexString; // fallback
  }
}

// Helper: build ClearKey license JSON from channel row (only for drm_type = CLEARKEY)
async function getDrmLicenseResponse(id) {
  let drmType = 'NONE';
  let drmClearKey = null;
  try {
    const streamResult = await query(
      `SELECT COALESCE(drm_type, 'NONE') AS drm_type, drm_clear_key
         FROM channel_streams
        WHERE channel_id = $1 AND priority = 0 AND is_active = TRUE
        LIMIT 1`,
      [id],
    );
    if (streamResult.rows?.length) {
      const row = streamResult.rows[0];
      const streamDrmType = (row.drm_type || 'NONE').toUpperCase();
      if (streamDrmType !== 'NONE' || row.drm_clear_key) {
        drmType = streamDrmType;
        drmClearKey = row.drm_clear_key;
      }
    }
  } catch (_) {
    // channel_streams table may not exist on older deployments
  }
  if (drmType === 'NONE' && !drmClearKey) {
    const result = await query(
      'SELECT COALESCE(drm_type, \'NONE\') AS drm_type, drm_clear_key FROM channels WHERE id = $1 AND is_active = TRUE',
      [id],
    );
    if (!result.rows || result.rows.length === 0) return { status: 404 };
    drmType = (result.rows[0].drm_type || 'NONE').toUpperCase();
    drmClearKey = result.rows[0].drm_clear_key;
  }
  if (drmType !== 'CLEARKEY' || !drmClearKey) return { status: 400 };

  const raw = String(drmClearKey).trim();

  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const jwkResponse = JSON.parse(raw);
      return { status: 200, body: jwkResponse };
    } catch (_) {}
  }

  let kidHex = '';
  let keyHex = '';
  if (raw.includes(':')) {
    [kidHex, keyHex] = raw.split(':').map((s) => s.trim());
  } else if (raw.includes(',')) {
    [kidHex, keyHex] = raw.split(',').map((s) => s.trim());
  } else {
    kidHex = raw;
    keyHex = raw;
  }

  const isHex = (str) => /^[0-9a-fA-F]+$/.test(str) && str.length % 2 === 0;
  const kidB64Url = isHex(kidHex) ? hexToBase64Url(kidHex) : kidHex;
  const kB64Url = isHex(keyHex) ? hexToBase64Url(keyHex) : keyHex;

  const keys = [{ kty: 'oct', kid: kidB64Url, k: kB64Url }];
  return { status: 200, body: { keys, type: 'temporary' } };
}

// Public: ClearKey license – GET or POST (ExoPlayer may use either). Return EME JWK from stored drm_clear_key.
router.get('/:id/drm-license', async (req, res, next) => {
  try {
    const schema = z.object({ id: z.string().regex(/^\d+$/) });
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid channel id' });
    const out = await getDrmLicenseResponse(parsed.data.id);
    if (out.status !== 200) return res.status(out.status).json(out.status === 404 ? { error: 'Channel not found' } : { error: 'DRM not configured for this channel' });
    return res.set('Content-Type', 'application/json').json(out.body);
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/drm-license', async (req, res, next) => {
  try {
    const schema = z.object({ id: z.string().regex(/^\d+$/) });
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid channel id' });
    const out = await getDrmLicenseResponse(parsed.data.id);
    if (out.status !== 200) return res.status(out.status).json(out.status === 404 ? { error: 'Channel not found' } : { error: 'DRM not configured for this channel' });
    return res.set('Content-Type', 'application/json').json(out.body);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

