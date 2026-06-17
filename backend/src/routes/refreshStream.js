const { z } = require('zod');
const { query } = require('../db');
const { getChannelPlayback } = require('../services/channelPlaybackService');

const router = require('express').Router();

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
      const playback = await getChannelPlayback(body.channelId);
      if (!playback) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      const primary = playback.streams.find((s) => s.priority === 0) || playback.streams[0];
      if (!primary?.url) {
        return res.status(404).json({ error: 'No stream URL for channel' });
      }
      return res.json({
        url: primary.url,
        streamUrl: primary.url,
        licenseUrl: primary.licenseUrl || null,
        drmType: (primary.drmType || 'NONE').toUpperCase(),
        drmClearKey: primary.drmClearKey || null,
      });
    }

    const fallback = body.url ? String(body.url).trim() : '';
    return res.json({ url: fallback, streamUrl: fallback });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
