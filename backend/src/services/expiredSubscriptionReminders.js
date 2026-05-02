const { query } = require('../db');

const REMINDER_TITLE = 'EaMax';

/** Swahili expiry reminder — expired subscriptions only */
const REMINDER_BODY =
  'Habari mwanafamilia wa EaMax Swahili tunakutaarifu kuwa kifurushi chako kimeisha muda wake, lipia sasa upate ofa ya siku 2 bure ahsanet';

/**
 * Send FCM reminders to users whose subscription has expired.
 * @param {{ userId?: number, force?: boolean }} opts
 * - force: skip 7-day throttle (manual admin sends)
 * - userId: send only to this internal user id (must still be expired + token)
 */
async function sendExpiredSubscriptionReminders(opts = {}) {
  const userId = opts.userId != null ? Number(opts.userId) : null;
  const force = !!opts.force;

  const firebase = require('./firebase');
  if (typeof firebase.isInitialized !== 'function' || !firebase.isInitialized()) {
    return {
      ok: false,
      message:
        'Firebase Admin is not initialized on the server. Set FIREBASE_SERVICE_ACCOUNT_KEY (JSON) in Railway so FCM can deliver.',
      sent: 0,
      targeted: 0,
      skipped: 0,
    };
  }

  const params = [];
  // Expiry date is source of truth (matches admin "Expired" list). Do not require is_premium=TRUE —
  // some rows may have sub ended while flags differ; blocked users never receive push.
  let sql = `
    SELECT u.id, u.fcm_token
    FROM users u
    WHERE u.blocked = FALSE
      AND u.uninstalled_at IS NULL
      AND u.fcm_token IS NOT NULL
      AND trim(u.fcm_token) <> ''
      AND u.premium_expires_at IS NOT NULL
      AND u.premium_expires_at <= NOW()
  `;

  if (userId != null && !Number.isNaN(userId)) {
    params.push(userId);
    sql += ` AND u.id = $${params.length}`;
  }

  if (!force) {
    sql += `
      AND (
        u.subscription_expiry_reminder_sent_at IS NULL
        OR u.subscription_expiry_reminder_sent_at < NOW() - INTERVAL '7 days'
      )
    `;
  }

  const result = await query(sql, params.length ? params : undefined);
  const rows = result.rows || [];

  if (rows.length === 0) {
    return {
      ok: true,
      sent: 0,
      targeted: 0,
      skipped: 0,
      message:
        userId != null
          ? 'No push: user not matched (must have ended subscription date in the past, FCM token, not blocked).'
          : 'No users matched: need past premium_expires_at, active FCM token, and not blocked.',
    };
  }

  const sendMultiple = firebase.sendPushNotificationToMultiple;
  const BATCH = 500;
  let sentTotal = 0;
  const remindedIds = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const tokens = chunk.map((r) => String(r.fcm_token || '').trim()).filter(Boolean);
    if (tokens.length === 0) continue;

    try {
      const pushResult = await sendMultiple(tokens, REMINDER_TITLE, REMINDER_BODY, {
        type: 'subscription_expired_reminder',
        category: 'habari',
      });
      const okCount = pushResult?.sent ?? 0;
      sentTotal += okCount;
      if (okCount > 0) {
        chunk.forEach((row) => {
          if (row.id != null) remindedIds.push(row.id);
        });
      }
    } catch (e) {
      console.error('[ExpiredReminder] batch failed:', e.message || e);
    }
  }

  if (remindedIds.length > 0) {
    await query(
      `UPDATE users
         SET subscription_expiry_reminder_sent_at = NOW()
       WHERE id = ANY($1::int[])`,
      [remindedIds],
    ).catch((err) => console.error('[ExpiredReminder] stamp failed:', err.message));
  }

  return {
    ok: true,
    sent: sentTotal,
    targeted: rows.length,
    skipped: rows.length - remindedIds.length,
    title: REMINDER_TITLE,
    body: REMINDER_BODY,
  };
}

module.exports = {
  sendExpiredSubscriptionReminders,
  REMINDER_TITLE,
  REMINDER_BODY,
};
