const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const {
  sendPushNotification,
  sendPushNotificationToTopic,
  isInitialized,
} = require('../services/firebase');

const router = express.Router();

function verifyPartnerSecret(req, res, next) {
  const secret = String(process.env.SUPA_EAMAX_BRIDGE_SECRET || '').trim();
  if (!secret) {
    return res.status(503).json({ ok: false, error: 'Partner bridge not configured' });
  }
  const header = String(req.get('X-Partner-Secret') || '').trim();
  if (!header || header !== secret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  return next();
}

/**
 * Mirror SupaAdmin pushes onto EaMax FCM without writing to EaMax notifications table
 * (EaAdmin notifications stay separate).
 */
router.post('/supa-push', verifyPartnerSecret, async (req, res, next) => {
  try {
    const bodySchema = z.object({
      title: z.string().min(1, 'title is required'),
      message: z.string().min(1, 'message is required'),
      scope: z.enum(['broadcast', 'user']),
      externalId: z.string().optional(),
    });
    const data = bodySchema.parse(req.body);

    if (!isInitialized()) {
      return res.status(503).json({
        ok: false,
        error: 'Firebase not initialized. Set FIREBASE_SERVICE_ACCOUNT_KEY on Railway.',
      });
    }

    const pushData = {
      source: 'supaadmin',
      type: 'notification',
      category: 'habari',
    };

    if (data.scope === 'broadcast') {
      const result = await sendPushNotificationToTopic(
        'all_users',
        data.title,
        data.message,
        pushData,
      );
      return res.json({
        ok: true,
        scope: 'broadcast',
        topic: 'all_users',
        messageId: result.messageId,
      });
    }

    const externalId = String(data.externalId || '').trim();
    if (!externalId) {
      return res.status(400).json({ ok: false, error: 'externalId is required for user scope' });
    }

    const userResult = await query(
      `SELECT fcm_token
       FROM users
       WHERE external_id = $1
         AND blocked = FALSE
         AND uninstalled_at IS NULL
       LIMIT 1`,
      [externalId],
    );
    const token = String(userResult.rows[0]?.fcm_token || '').trim();
    if (!token) {
      return res.json({
        ok: true,
        scope: 'user',
        delivered: false,
        reason: 'no_fcm_token',
      });
    }

    const result = await sendPushNotification(token, data.title, data.message, pushData);
    return res.json({
      ok: true,
      scope: 'user',
      delivered: true,
      messageId: result.messageId,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
