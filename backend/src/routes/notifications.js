const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { syncNotificationStats } = require('../services/notificationBroadcast');

const router = express.Router();

// Public: list notifications for admin recent list (scheduled pinned first, then sent)
// Scheduled: sent_at IS NULL, scheduled_for set — shown first (pinned). Sent: sent_at set — then by sent_at DESC.
// ?limit=20 returns up to 20 total (scheduled + sent); default 20
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const result = await query(
      `SELECT id, title, message, category, type, sent_at, scheduled_for,
              COALESCE(clicks, 0) AS clicks,
              COALESCE(sent_count, 0) AS sent_count,
              COALESCE(delivered_count, 0) AS delivered_count
         FROM notifications
        WHERE sent_at IS NOT NULL OR scheduled_for IS NOT NULL
        ORDER BY (CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END) ASC,
                 (CASE WHEN sent_at IS NULL THEN scheduled_for END) ASC NULLS LAST,
                 (CASE WHEN sent_at IS NOT NULL THEN sent_at END) DESC NULLS LAST
        LIMIT $1`,
      [limit],
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// Public: track click on a notification
router.post('/:id/click', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      id: z.string().regex(/^\d+$/),
    });
    const bodySchema = z.object({
      userId: z.number().int().positive().optional(),
      externalId: z.string().optional(),
      fcmToken: z.string().optional(),
    });
    const { id } = paramsSchema.parse(req.params);
    const body = bodySchema.parse(req.body || {});
    const notificationId = Number(id);

    let userId = body.userId;
    if (!userId && body.externalId) {
      const userResult = await query(
        `SELECT id FROM users WHERE external_id = $1 LIMIT 1`,
        [body.externalId],
      );
      if (userResult.rows.length > 0) {
        userId = userResult.rows[0].id;
      }
    }

    if (!userId) {
      return res.status(400).json({
        error: 'externalId or userId required for click tracking',
      });
    }

    await query(
      `INSERT INTO notification_clicks (notification_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (notification_id, user_id) DO NOTHING`,
      [notificationId, userId],
    ).catch(() => {});

    await syncNotificationStats(notificationId);

    const updated = await query(
      `SELECT id, clicks FROM notifications WHERE id = $1`,
      [notificationId],
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    return res.json(updated.rows[0]);
  } catch (err) {
    return next(err);
  }
});

// Public: confirm notification delivery (called by app when notification is received on device)
router.post('/:id/delivered', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      id: z.string().regex(/^\d+$/),
    });
    const bodySchema = z.object({
      userId: z.number().int().positive().optional(),
      externalId: z.string().optional(),
      fcmToken: z.string().optional(),
    });

    const { id } = paramsSchema.parse(req.params);
    const body = bodySchema.parse(req.body);

    const notificationId = Number(id);
    let userId = body.userId;
    const fcmTokenBody = body.fcmToken && String(body.fcmToken).trim() !== '' ? String(body.fcmToken).trim() : null;

    if (!userId && body.externalId) {
      const userResult = await query(
        `SELECT id FROM users WHERE external_id = $1`,
        [body.externalId],
      );
      if (userResult.rows.length > 0) {
        userId = userResult.rows[0].id;
      }
    }

    if (!userId) {
      return res.status(400).json({
        error: 'externalId or userId required for delivery tracking',
      });
    }

    await query(
      `INSERT INTO notification_deliveries (notification_id, user_id, fcm_token, delivered_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (notification_id, user_id)
       DO UPDATE SET
         delivered_at = COALESCE(notification_deliveries.delivered_at, now()),
         fcm_token = COALESCE(EXCLUDED.fcm_token, notification_deliveries.fcm_token)`,
      [notificationId, userId, fcmTokenBody],
    ).catch(async () => {
      await query(
        `UPDATE notification_deliveries
            SET delivered_at = now()
          WHERE notification_id = $1 AND user_id = $2 AND delivered_at IS NULL`,
        [notificationId, userId],
      ).catch(() => {});
    });

    await syncNotificationStats(notificationId);

    const updated = await query(
      `SELECT id, delivered_count FROM notifications WHERE id = $1`,
      [notificationId],
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    return res.json(updated.rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
