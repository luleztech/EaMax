const { query } = require('../db');

const REMINDER_TITLE = 'EaMax';

/** Swahili expiry reminder — expired subscriptions only */
const REMINDER_BODY =
  'Habari mwanafamilia wa EaMax Swahili tunakutaarifu kuwa kifurushi chako kimeisha muda wake, lipia sasa upate ofa ya siku 2 bure ahsanet';

/**
 * When a specific user is targeted, explain why the main query returned no row.
 */
async function explainRemindMismatch(userId) {
  const r = await query(
    `SELECT id, blocked, premium_expires_at, fcm_token, uninstalled_at
     FROM users WHERE id = $1`,
    [userId],
  );
  if (r.rows.length === 0) {
    return 'User not found in the database.';
  }
  const u = r.rows[0];
  if (u.blocked === true) {
    return 'This account is blocked — push reminders are not sent to blocked users.';
  }
  if (u.premium_expires_at == null) {
    return 'No subscription end date (premium_expires_at) — this user is not in the “expired by date” group for push.';
  }
  const exp = new Date(u.premium_expires_at);
  if (Number.isNaN(exp.getTime())) {
    return 'Invalid subscription end date on file.';
  }
  if (exp > new Date()) {
    return `Subscription is still active (ends ${exp.toISOString()}) — not eligible for expired-subscription push.`;
  }
  const tok = String(u.fcm_token || '').trim();
  if (!tok) {
    return 'No FCM device token on file. The user must open the app on a phone so a push token can be registered.';
  }
  // Expired + token + not blocked: should have matched; keep a fallback for rare DB/driver quirks.
  return 'Could not queue push for this user — check server logs. If it persists, verify Firebase credentials and FCM setup.';
}

function fcmFailureHint(pushResult) {
  if (pushResult?._exception) {
    return `Send failed: ${pushResult._exception}`;
  }
  const responses = pushResult?.responses;
  const failedCount = Number(pushResult?.failed ?? 0);
  if (!Array.isArray(responses) || responses.length === 0) {
    if (failedCount > 0) {
      return 'FCM rejected the notification (often invalid/expired token or wrong Firebase project). Ask the user to open the app once, or verify server FIREBASE_SERVICE_ACCOUNT_KEY matches the Android app.';
    }
    return 'FCM returned no success (check Firebase project and server logs).';
  }
  const withErr = responses.find((x) => x && x.error);
  const err = withErr?.error;
  if (!err) {
    return 'FCM accepted zero messages — token may be stale.';
  }
  const code = String(err.code || '');
  const msg = String(err.message || code || '');
  if (
    code.includes('registration-token-not') ||
    code.includes('invalid-registration') ||
    msg.includes('Requested entity was not found')
  ) {
    return 'FCM token is invalid or expired. Ask the user to open the app once so a fresh token is saved.';
  }
  return msg.length > 0 && msg.length < 220 ? msg : 'FCM rejected the message — see server logs for details.';
}

/**
 * Send FCM reminders to users whose subscription has expired.
 * @param {{ userId?: number, force?: boolean }} opts
 * - force: skip 7-day throttle (manual admin sends)
 * - userId: send only to this internal user id (must still be expired + token)
 */
async function sendExpiredSubscriptionReminders(opts = {}) {
  const userId = opts.userId != null ? Number(opts.userId) : null;
  const force = !!opts.force;
  const singleTarget = userId != null && Number.isFinite(userId) && !Number.isNaN(userId);

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
  // Expiry date matches admin "Expired" tab (past premium_expires_at). Blocked users never receive push.
  // Bulk/cron: skip users marked uninstalled (reduces noise). Single-user admin bell: still try — token may be valid after reinstall.
  let sql = `
    SELECT u.id, u.fcm_token
    FROM users u
    WHERE COALESCE(u.blocked, FALSE) = FALSE
      AND u.fcm_token IS NOT NULL
      AND trim(u.fcm_token) <> ''
      AND u.premium_expires_at IS NOT NULL
      AND u.premium_expires_at <= NOW()
  `;

  if (!singleTarget) {
    sql += ` AND u.uninstalled_at IS NULL`;
  }

  if (singleTarget) {
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
    let message =
      'No users matched: need past premium_expires_at, active FCM token, and not blocked.';
    if (singleTarget) {
      message = await explainRemindMismatch(userId);
    }
    return {
      ok: true,
      sent: 0,
      targeted: 0,
      skipped: 0,
      message,
    };
  }

  const sendMultiple = firebase.sendPushNotificationToMultiple;
  const BATCH = 500;
  let sentTotal = 0;
  const remindedIds = [];
  let lastPushResult = null;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const tokens = chunk.map((r) => String(r.fcm_token || '').trim()).filter(Boolean);
    if (tokens.length === 0) continue;

    try {
      const pushResult = await sendMultiple(tokens, REMINDER_TITLE, REMINDER_BODY, {
        type: 'subscription_expired_reminder',
        category: 'habari',
      });
      lastPushResult = pushResult;
      const rawSent = pushResult?.sent ?? pushResult?.successCount;
      let okCount =
        typeof rawSent === 'number' && !Number.isNaN(rawSent)
          ? rawSent
          : Array.isArray(pushResult?.responses)
            ? pushResult.responses.filter((x) => x && x.success === true).length
            : 0;
      sentTotal += okCount;

      const responses = pushResult?.responses;
      chunk.forEach((row, idx) => {
        if (row.id == null) return;
        const r = responses?.[idx];
        let success = false;
        if (r) {
          success = r.success === true || (!!r.messageId && !r.error);
        } else if (okCount > 0) {
          success = okCount === tokens.length;
        }
        if (success) remindedIds.push(row.id);
      });
    } catch (e) {
      const msg = e?.message || String(e || '');
      console.error('[ExpiredReminder] batch failed:', msg);
      lastPushResult = {
        sent: 0,
        failed: tokens.length,
        responses: [],
        _exception: msg,
      };
    }
  }

  if (remindedIds.length > 0) {
    const uniqueIds = [...new Set(remindedIds)];
    await query(
      `UPDATE users
         SET subscription_expiry_reminder_sent_at = NOW()
       WHERE id = ANY($1::int[])`,
      [uniqueIds],
    ).catch((err) => console.error('[ExpiredReminder] stamp failed:', err.message));
  }

  const out = {
    ok: true,
    sent: sentTotal,
    targeted: rows.length,
    skipped: Math.max(0, rows.length - sentTotal),
    title: REMINDER_TITLE,
    body: REMINDER_BODY,
  };

  if (sentTotal === 0 && rows.length > 0) {
    out.message = fcmFailureHint(lastPushResult);
  } else if (sentTotal > 0 && sentTotal < rows.length) {
    out.message = `Sent ${sentTotal} of ${rows.length}; some tokens may be invalid.`;
  }

  return out;
}

module.exports = {
  sendExpiredSubscriptionReminders,
  REMINDER_TITLE,
  REMINDER_BODY,
};
