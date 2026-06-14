const express = require('express');
const { z } = require('zod');
const { query } = require('../db');

const router = express.Router();

/**
 * Refresh playback URL/token for expiring streams (RN StreamEngine retry path).
 * POST /api/refreshStream  { channelId?, url?, token? }
 */
router.post('/', async (req, res, next) => {
  try {
    const bodySchema = z.object({
      channelId: z.coerce.number().int().positive().optional(),
      url: z.string().optional(),
      token: z.string().optional(),
    });
    const body = bodySchema.parse(req.body || {});

    if (body.channelId) {
      const result = await query(
        `SELECT
           COALESCE(c.stream_url, t.stream_url) AS stream_url,
           c.license_url,
           c.drm_type,
           c.drm_clear_key
         FROM channels c
         LEFT JOIN stream_aliases a ON a.alias = c.stream_alias AND a.is_active = TRUE
         LEFT JOIN channels t ON t.id = a.channel_id AND t.is_active = TRUE
         WHERE c.id = $1 AND c.is_active = TRUE
         LIMIT 1`,
        [body.channelId],
      );
      if (!result.rows.length) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      const row = result.rows[0];
      const streamUrl = row.stream_url ? String(row.stream_url).trim() : '';
      return res.json({
        url: streamUrl,
        streamUrl,
        licenseUrl: row.license_url || null,
        drmType: (row.drm_type || 'NONE').toUpperCase(),
        drmClearKey: row.drm_clear_key || null,
      });
    }

    const fallback = body.url ? String(body.url).trim() : '';
    return res.json({ url: fallback, streamUrl: fallback });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
