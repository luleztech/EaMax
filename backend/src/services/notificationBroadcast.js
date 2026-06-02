const { query } = require('../db');
const {
  isInitialized,
  sendReliablePushNotificationToTopic,
  sendReliablePushNotificationToMultiple,
} = require('./firebase');

const FCM_BATCH_SIZE = 500;
const BATCH_DELAY_MS = 120;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Active installs with a stored FCM token (one row per user). */
async function fetchActiveUserTokens() {
  const result = await query(
    `SELECT u.id AS user_id, TRIM(u.fcm_token) AS fcm_token
       FROM users u
      WHERE u.blocked = FALSE
        AND u.uninstalled_at IS NULL
        AND u.fcm_token IS NOT NULL
        AND TRIM(u.fcm_token) <> ''`,
  );
  const userTokenMap = new Map();
  for (const row of result.rows || []) {
    const token = row?.fcm_token;
    if (token) userTokenMap.set(row.user_id, token);
  }
  return userTokenMap;
}

function collectInvalidTokens(responses, tokens) {
  const invalid = [];
  if (!responses || !tokens) return invalid;
  responses.forEach((resp, idx) => {
    if (resp?.success || !tokens[idx]) return;
    const errCode = String(resp.error?.code || resp.error?.message || '').toLowerCase();
    const isInvalid =
      errCode.includes('registration-token-not-registered') ||
      errCode.includes('invalid-registration-token') ||
      errCode.includes('invalid-argument') ||
      errCode.includes('unregistered') ||
      errCode.includes('invalid_argument');
    if (isInvalid) invalid.push(tokens[idx]);
  });
  return invalid;
}

async function clearInvalidFcmTokens(tokens) {
  for (const token of tokens) {
    await query(`UPDATE users SET fcm_token = NULL WHERE fcm_token = $1`, [token]).catch(() => {});
  }
}

/**
 * Broadcast to every user with a registered token (batched FCM) plus topic all_users
 * for installs subscribed without a token row. Returns real FCM acceptance counts.
 */
async function broadcastNotificationToAllUsers(title, body, data = {}) {
  if (!isInitialized()) {
    throw new Error('Firebase Admin not initialized');
  }

  const userTokenMap = await fetchActiveUserTokens();
  const tokens = [...new Set(userTokenMap.values())];

  let tokensAttempted = tokens.length;
  let tokensSent = 0;
  let tokensFailed = 0;
  const invalidTokens = [];

  for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
    const batch = tokens.slice(i, i + FCM_BATCH_SIZE);
    const pushResult = await sendReliablePushNotificationToMultiple(
      batch,
      title,
      body,
      data,
    );
    tokensSent += Number(pushResult?.sent || 0);
    tokensFailed += Number(pushResult?.failed || 0);
    invalidTokens.push(...collectInvalidTokens(pushResult?.responses, batch));
    if (i + FCM_BATCH_SIZE < tokens.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  if (invalidTokens.length > 0) {
    await clearInvalidFcmTokens([...new Set(invalidTokens)]);
  }

  let topicSent = false;
  // Topic reaches installs without a token row; skip when we already target tokens (avoids duplicate alerts).
  if (tokens.length === 0) {
    try {
      await sendReliablePushNotificationToTopic('all_users', title, body, data);
      topicSent = true;
    } catch (err) {
      console.error('[FCM] Topic all_users broadcast failed:', err.message || err);
    }
  }

  const audienceResult = await query(
    `SELECT COUNT(*)::int AS count
       FROM users
      WHERE blocked = FALSE
        AND uninstalled_at IS NULL`,
  ).catch(() => ({ rows: [{ count: 0 }] }));
  const registeredUsers = Number(audienceResult.rows?.[0]?.count || 0);

  return {
    tokensAttempted,
    tokensSent,
    tokensFailed,
    topicSent,
    registeredUsers,
    usersWithToken: tokens.length,
    invalidTokensCleared: invalidTokens.length,
  };
}

/** Keep notifications.delivered_count and clicks in sync with detail tables. */
async function syncNotificationStats(notificationId) {
  await query(
    `UPDATE notifications n
        SET delivered_count = (
              SELECT COUNT(*)::int
                FROM notification_deliveries nd
               WHERE nd.notification_id = n.id
                 AND nd.delivered_at IS NOT NULL
            ),
            clicks = (
              SELECT COUNT(*)::int
                FROM notification_clicks nc
               WHERE nc.notification_id = n.id
            )
      WHERE n.id = $1`,
    [notificationId],
  );
}

module.exports = {
  broadcastNotificationToAllUsers,
  fetchActiveUserTokens,
  syncNotificationStats,
  clearInvalidFcmTokens,
  collectInvalidTokens,
};
