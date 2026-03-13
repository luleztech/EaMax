const express = require('express');
const { z } = require('zod');
const { query } = require('../db');

const router = express.Router();

// Public: list active channels, optionally filter by category
router.get('/', async (req, res, next) => {
  try {
    const schema = z.object({
      category: z.enum(['football', 'movies', 'habari', 'tamthilia', 'wanyama', 'katuni', 'sayansi']).optional(),
    });
    const parsed = schema.safeParse(req.query);

    let sql = 'SELECT * FROM channels WHERE is_active = TRUE';
    const params = [];

    if (parsed.success && parsed.data.category) {
      sql += ' AND category = $1';
      params.push(parsed.data.category);
    }

    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);
    const rows = (result.rows || []).map((row) => {
      const pts = row.points_required != null ? Number(row.points_required) : 0;
      const drmType = (row.drm_type || 'NONE').toUpperCase();
      const isClearKey = drmType === 'CLEARKEY';
      const unlockToFree = !!(row.unlock_to_free === true || row.unlockToFree === true);
      const out = {
        ...row,
        points_required: pts,
        pointsRequired: Number.isNaN(pts) ? 0 : pts,
        drm_type: drmType,
        drmType,
        unlock_to_free: unlockToFree,
        unlockToFree,
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
      'SELECT id, name, category, stream_url, thumbnail_url, thumbnail_emoji, color, points_required, drm_protected, COALESCE(drm_type, \'NONE\') AS drm_type, drm_clear_key, COALESCE(unlock_to_free, false) AS unlock_to_free FROM channels WHERE id = $1 AND is_active = TRUE',
      [id]
    );
    if (!result.rows || result.rows.length === 0) return res.status(404).json({ error: 'Channel not found' });
    const row = result.rows[0];
    const pts = row.points_required != null ? Number(row.points_required) : 0;
    const drmType = (row.drm_type || 'NONE').toUpperCase();
    const isClearKey = drmType === 'CLEARKEY';
    const clearKey = isClearKey && row.drm_clear_key ? String(row.drm_clear_key).trim() : null;
    const unlockToFree = !!(row.unlock_to_free === true);
    return res.json({
      id: row.id,
      name: row.name,
      category: row.category,
      stream_url: row.stream_url,
      streamUrl: row.stream_url,
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
  const result = await query(
    'SELECT COALESCE(drm_type, \'NONE\') AS drm_type, drm_clear_key FROM channels WHERE id = $1 AND is_active = TRUE',
    [id]
  );
  if (!result.rows || result.rows.length === 0) return { status: 404 };
  const row = result.rows[0];
  const drmType = (row.drm_type || 'NONE').toUpperCase();
  if (drmType !== 'CLEARKEY' || !row.drm_clear_key) return { status: 400 };

  const raw = String(row.drm_clear_key).trim();

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

