const express = require('express');
const { z } = require('zod');
const { ingestEvents } = require('../../services/playbackAnalyticsService');

const router = express.Router();

/**
 * POST /api/v2/analytics/playback
 * Batch ingest playback analytics from mobile clients.
 */
router.post('/playback', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const schema = z.object({
      userExternalId: z.string().optional(),
      events: z.array(z.object({
        eventType: z.string(),
        channelId: z.union([z.number(), z.string()]).optional(),
        payload: z.record(z.unknown()).optional(),
        deviceInfo: z.record(z.unknown()).optional(),
      })).min(1).max(50),
    });
    const data = schema.parse(body);
    const userId = data.userExternalId
      || req.headers['x-user-id']?.toString()
      || null;
    const result = await ingestEvents(data.events, userId);
    return res.json(result);
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    return next(err);
  }
});

module.exports = router;
