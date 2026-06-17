const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { isPremiumActive } = require('../services/premiumStatus');
const {
  syncUserPremiumFlagsByExternalId,
  buildUserSummaryResponse,
} = require('../services/userEntitlements');

const router = express.Router();

// Ensure externalId-based user exists or create new
router.post('/register', async (req, res, next) => {
  try {
    const bodySchema = z.object({
      externalId: z.string().min(1),
    });
    const { externalId } = bodySchema.parse(req.body);

    const existing = await query(
      'SELECT * FROM users WHERE external_id = $1',
      [externalId],
    );

    if (existing.rows.length > 0) {
      return res.json(existing.rows[0]);
    }

    const inserted = await query(
      `INSERT INTO users (external_id)
       VALUES ($1)
       ON CONFLICT (external_id) DO UPDATE SET external_id = EXCLUDED.external_id
       RETURNING *`,
      [externalId],
    );

    return res.status(201).json(inserted.rows[0]);
  } catch (err) {
    return next(err);
  }
});

/**
 * Find existing user by FCM device token (after app update / storage loss) so we do not
 * assign a new external_id when this device is already known in the database.
 */
router.post('/resolve-by-fcm', async (req, res, next) => {
  try {
    const bodySchema = z.object({
      fcmToken: z.string().min(1),
    });
    const { fcmToken } = bodySchema.parse(req.body);
    const token = fcmToken.trim();
    const result = await query(
      `SELECT external_id FROM users
       WHERE fcm_token = $1 AND blocked = FALSE
       ORDER BY fcm_token_updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [token],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No matching user' });
    }
    return res.json({ externalId: result.rows[0].external_id });
  } catch (err) {
    return next(err);
  }
});

// Get user summary by externalId (returns camelCase for app; isPremium reflects current status including expiry)
router.get('/:externalId', async (req, res, next) => {
  try {
    const { externalId } = req.params;
    const result = await query(
      'SELECT * FROM users WHERE external_id = $1',
      [externalId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const row = result.rows[0];
    const synced = await syncUserPremiumFlagsByExternalId(externalId);
    if (synced) {
      row.is_premium = synced.is_premium;
    }

    return res.json(buildUserSummaryResponse(row));
  } catch (err) {
    return next(err);
  }
});

// Record ad watched and increment points
router.post('/:externalId/ads/watched', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      externalId: z.string().min(1),
    });
    const bodySchema = z.object({
      points: z.number().int().positive().default(20),
    });

    const { externalId } = paramsSchema.parse(req.params);
    const { points } = bodySchema.parse(req.body);

    const userResult = await query(
      'SELECT id, blocked FROM users WHERE external_id = $1',
      [externalId],
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (userResult.rows[0].blocked === true) {
      return res.status(403).json({
        error: 'Account suspended',
        code: 'BLOCKED',
      });
    }
    const userId = userResult.rows[0].id;

    await query(
      `INSERT INTO ad_events (user_id, points_earned)
       VALUES ($1, $2)`,
      [userId, points],
    );

    const updated = await query(
      `UPDATE users
         SET points = points + $1
       WHERE id = $2
       RETURNING *`,
      [points, userId],
    );

    return res.json({
      user: updated.rows[0],
      pointsAdded: points,
    });
  } catch (err) {
    return next(err);
  }
});

// Record channel watch (for "Most Watched" analytics in admin)
router.post('/:externalId/channels/:channelId/watch', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      externalId: z.string().min(1),
      channelId: z.string().min(1),
    });
    const { externalId, channelId } = paramsSchema.parse(req.params);

    const channelIdNum = parseInt(channelId, 10);
    if (Number.isNaN(channelIdNum)) {
      return res.status(400).json({ error: 'Invalid channel id' });
    }

    const userResult = await query(
      'SELECT id FROM users WHERE external_id = $1',
      [externalId],
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = userResult.rows[0].id;

    const channelResult = await query(
      'SELECT id FROM channels WHERE id = $1 AND is_active = TRUE',
      [channelIdNum],
    );
    if (channelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    await query(
      `INSERT INTO channel_watch_events (user_id, channel_id)
       VALUES ($1, $2)`,
      [userId, channelIdNum],
    );

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// Spend points to watch a channel (per view – no persistent unlock; each watch requires points again)
router.post('/:externalId/channels/:channelId/unlock', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      externalId: z.string().min(1),
      channelId: z.string().min(1),
    });
    const { externalId, channelId } = paramsSchema.parse(req.params);

    const channelIdNum = parseInt(channelId, 10);
    if (Number.isNaN(channelIdNum)) {
      return res.status(400).json({ error: 'Invalid channel id' });
    }

    const userResult = await query(
      'SELECT id, points, blocked, is_premium, premium_expires_at FROM users WHERE external_id = $1',
      [externalId],
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (userResult.rows[0].blocked === true) {
      return res.status(403).json({
        error: 'Account suspended',
        code: 'BLOCKED',
      });
    }
    const userId = userResult.rows[0].id;
    const userPoints = userResult.rows[0].points;
    const isPremium = isPremiumActive(userResult.rows[0]);

    const settingsResult = await query(
      "SELECT value FROM app_settings WHERE key = 'channels_premium_only' LIMIT 1",
    );
    const channelsPremiumOnly = settingsResult.rows.length > 0 &&
      (settingsResult.rows[0].value === 'true' || settingsResult.rows[0].value === '1');

    if (channelsPremiumOnly && !isPremium) {
      return res.status(403).json({
        error: 'Channels are premium only',
        code: 'PREMIUM_ONLY',
      });
    }

    const channelResult = await query(
      'SELECT id, points_required FROM channels WHERE id = $1 AND is_active = TRUE',
      [channelIdNum],
    );
    if (channelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    const pointsRequired = channelResult.rows[0].points_required || 0;

    if (pointsRequired > 0 && userPoints < pointsRequired) {
      return res.status(400).json({
        error: 'Insufficient points',
        pointsRequired,
        userPoints,
      });
    }

    if (pointsRequired > 0) {
      await query(
        `UPDATE users SET points = points - $1 WHERE id = $2`,
        [pointsRequired, userId],
      );
    }

    return res.json({
      success: true,
      pointsSpent: pointsRequired,
    });
  } catch (err) {
    return next(err);
  }
});

// Register or update FCM token for push notifications
router.post('/:externalId/fcm-token', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      externalId: z.string().min(1),
    });
    const bodySchema = z.object({
      fcmToken: z.string().min(1),
    });

    const { externalId } = paramsSchema.parse(req.params);
    const { fcmToken } = bodySchema.parse(req.body);

    const userResult = await query(
      'SELECT id FROM users WHERE external_id = $1',
      [externalId],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    await query(
      `UPDATE users 
       SET fcm_token = $1, fcm_token_updated_at = now() 
       WHERE id = $2`,
      [fcmToken, userId],
    );

    return res.json({ message: 'FCM token registered successfully' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

