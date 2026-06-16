const express = require('express');
const { z } = require('zod');
const { getChannelPlayback } = require('../../services/channelPlaybackService');
const { getEmergencyControls } = require('../../services/configBundleService');

const router = express.Router();

/**
 * GET /api/v2/channels/:id/playback
 * Returns primary + backup streams for failover playback.
 */
router.get('/:id/playback', async (req, res, next) => {
  try {
    const params = z.object({ id: z.string().regex(/^\d+$/) }).parse(req.params);
    const channelId = parseInt(params.id, 10);

    const emergency = await getEmergencyControls();
    if (emergency.disabledChannelIds.includes(channelId)) {
      return res.status(503).json({
        error: 'channel_disabled',
        message: 'Channel hii haipatikani kwa sasa.',
      });
    }

    const playback = await getChannelPlayback(channelId);
    if (!playback) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    if (!playback.streams.length) {
      return res.status(503).json({ error: 'no_streams', message: 'Hakuna stream inayopatikana.' });
    }

    return res.json(playback);
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid channel id' });
    }
    return next(err);
  }
});

module.exports = router;
