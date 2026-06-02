const { query } = require('../db');
const {
  isInitialized,
  sendReliablePushNotificationToTopic,
  sendReliablePushNotificationToMultiple,
} = require('./firebase');

const FCM_BATCH_SIZE = 500;
/** Run several FCM batches at once (faster than serial + sleep). */
const PARALLEL_BATCHES = 4;

const inFlightJobs = new Set();

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

async function countUsersWithFcmToken() {
  const result = await query(
    `SELECT COUNT(*)::int AS count
       FROM users
      WHERE blocked = FALSE
        AND uninstalled_at IS NULL
        AND fcm_token IS NOT NULL
        AND TRIM(fcm_token) <> ''`,
  );
  return Number(result.rows?.[0]?.count || 0);
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
  const unique = [...new Set(tokens)];
  if (unique.length === 0) return;
  await query(
    `UPDATE users SET fcm_token = NULL WHERE fcm_token = ANY($1::text[])`,
    [unique],
  ).catch(() => {
    for (const token of unique) {
      query(`UPDATE users SET fcm_token = NULL WHERE fcm_token = $1`, [token]).catch(() => {});
    }
  });
}

/**
 * Send FCM in parallel batches. Topic runs in parallel when enabled.
 */
async function broadcastNotificationToAllUsers(title, body, data = {}, options = {}) {
  if (!isInitialized()) {
    throw new Error('Firebase Admin not initialized');
  }

  const useTopic = options.useTopic !== false;
  const useTokenMulticast = options.useTokenMulticast !== false;

  const topicPromise = useTopic
    ? sendReliablePushNotificationToTopic('all_users', title, body, data)
        .then(() => true)
        .catch((err) => {
          console.error('[FCM] Topic all_users failed:', err.message || err);
          return false;
        })
    : Promise.resolve(false);

  let tokensAttempted = 0;
  let tokensSent = 0;
  let tokensFailed = 0;
  const invalidTokens = [];

  if (useTokenMulticast) {
    const userTokenMap = await fetchActiveUserTokens();
    const tokens = [...new Set(userTokenMap.values())];
    tokensAttempted = tokens.length;

    const batches = [];
    for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
      batches.push(tokens.slice(i, i + FCM_BATCH_SIZE));
    }

    for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
      const chunk = batches.slice(i, i + PARALLEL_BATCHES);
      const results = await Promise.all(
        chunk.map((batch) =>
          sendReliablePushNotificationToMultiple(batch, title, body, data),
        ),
      );
      for (let j = 0; j < results.length; j += 1) {
        const pushResult = results[j];
        const batch = chunk[j];
        tokensSent += Number(pushResult?.sent || 0);
        tokensFailed += Number(pushResult?.failed || 0);
        invalidTokens.push(...collectInvalidTokens(pushResult?.responses, batch));
      }
    }

    if (invalidTokens.length > 0) {
      await clearInvalidFcmTokens(invalidTokens);
    }
  }

  const topicSent = await topicPromise;

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
    usersWithToken: tokensAttempted,
    invalidTokensCleared: invalidTokens.length,
  };
}

async function runNotificationBroadcastJob(notificationId, title, body, data) {
  const id = Number(notificationId);
  if (!Number.isFinite(id)) return;

  await query(
    `UPDATE notifications
        SET push_status = 'sending', push_error = NULL
      WHERE id = $1`,
    [id],
  ).catch(() => {});

  try {
    const usersWithToken = await countUsersWithFcmToken();
    // Large audiences: topic only (instant). Small: tokens for precise FCM counts.
    const useTokenMulticast = usersWithToken < 800;

    const broadcast = await broadcastNotificationToAllUsers(title, body, data, {
      useTopic: true,
      useTokenMulticast,
    });

    const sentCount = useTokenMulticast
      ? broadcast.tokensSent
      : usersWithToken;

    await query(
      `UPDATE notifications
          SET sent_count = $1,
              push_status = 'completed',
              push_error = NULL
        WHERE id = $2`,
      [sentCount, id],
    );

    console.log(
      `[FCM] Notification ${id} done: sent_count=${sentCount} topic=${broadcast.topicSent} tokens=${broadcast.tokensSent}/${broadcast.tokensAttempted}`,
    );
  } catch (err) {
    const msg = String(err?.message || err);
    console.error(`[FCM] Notification ${id} broadcast failed:`, msg);
    await query(
      `UPDATE notifications
          SET push_status = 'failed',
              push_error = $1
        WHERE id = $2`,
      [msg.slice(0, 500), id],
    ).catch(() => {});
  }
}

/** Queue broadcast so admin API returns immediately. */
function scheduleNotificationBroadcast(notificationId, title, body, data) {
  const id = Number(notificationId);
  if (!Number.isFinite(id) || inFlightJobs.has(id)) return;
  inFlightJobs.add(id);

  setImmediate(() => {
    runNotificationBroadcastJob(id, title, body, data)
      .catch((err) => {
        console.error('[FCM] Background job error:', err?.message || err);
      })
      .finally(() => {
        inFlightJobs.delete(id);
      });
  });
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
  scheduleNotificationBroadcast,
  runNotificationBroadcastJob,
  fetchActiveUserTokens,
  countUsersWithFcmToken,
  syncNotificationStats,
  clearInvalidFcmTokens,
  collectInvalidTokens,
};
