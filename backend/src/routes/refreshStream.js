const { z } = require('zod');
const { getChannelPlayback } = require('../services/channelPlaybackService');
const {
  isEmbedPlaybackUrl,
  isPublicHttpUrl,
  presentPlaybackForPlayer,
  publicBaseUrl,
  resolveEmbedPlayback,
} = require('../services/embedPlaybackService');

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
      const playback = await presentPlaybackForPlayer(
        await getChannelPlayback(body.channelId),
        publicBaseUrl(req),
      );
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
        headers: primary.headers || {},
      });
    }

    const fallback = body.url ? String(body.url).trim() : '';
    if (fallback && isEmbedPlaybackUrl(fallback) && isPublicHttpUrl(fallback)) {
      const resolved = await resolveEmbedPlayback(fallback);
      if (resolved?.streamUrl) {
        return res.json({
          url: resolved.streamUrl,
          streamUrl: resolved.streamUrl,
          licenseUrl: resolved.licenseUrl || null,
          drmType: resolved.drmType || 'NONE',
          drmClearKey: resolved.clearKeyRaw || null,
          headers: {
            Referer: resolved.referer,
            Origin: resolved.origin,
            ...(resolved.authorization
              ? { Authorization: `Bearer ${resolved.authorization.replace(/^bearer\s+/i, '')}` }
              : {}),
          },
        });
      }
    }
    return res.json({ url: fallback, streamUrl: fallback });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
