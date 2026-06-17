const { query } = require('../db');
const {
  isInitialized,
  sendPushNotificationToTopic,
} = require('./firebase');

const inFlightJobs = new Set();
const broadcastQueue = [];
let drainingQueue = false;

/** Gap between back-to-back admin broadcasts so devices show alerts one-by-one. */
const BROADCAST_GAP_MS = 6000;

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
 * One FCM path per broadcast: data-only topic `all_users`.
 * Avoids duplicate alerts from topic + per-token multicast on the same device.
 */
async function broadcastNotificationToAllUsers(title, body, data = {}) {
  if (!isInitialized()) {
    throw new Error('Firebase Admin not initialized');
  }

  let topicSent = false;
  try {
    await sendPushNotificationToTopic('all_users', title, body, data);
    topicSent = true;
  } catch (err) {
    console.error('[FCM] Topic all_users failed:', err.message || err);
    throw err;
  }

  const usersWithToken = await countUsersWithFcmToken();
  const audienceResult = await query(
    `SELECT COUNT(*)::int AS count
       FROM users
      WHERE blocked = FALSE
        AND uninstalled_at IS NULL`,
  ).catch(() => ({ rows: [{ count: 0 }] }));
  const registeredUsers = Number(audienceResult.rows?.[0]?.count || 0);

  return {
    tokensAttempted: usersWithToken,
    tokensSent: topicSent ? usersWithToken : 0,
    tokensFailed: topicSent ? 0 : usersWithToken,
    topicSent,
    registeredUsers,
    usersWithToken,
    invalidTokensCleared: 0,
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
    const broadcast = await broadcastNotificationToAllUsers(title, body, data);
    const sentCount = broadcast.topicSent ? usersWithToken : 0;

    await query(
      `UPDATE notifications
          SET sent_count = $1,
              push_status = 'completed',
              push_error = NULL
        WHERE id = $2`,
      [sentCount, id],
    );

    console.log(
      `[FCM] Notification ${id} done: sent_count=${sentCount} topic=${broadcast.topicSent} audience=${usersWithToken}`,
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

async function drainBroadcastQueue() {
  if (drainingQueue) return;
  drainingQueue = true;
  try {
    while (broadcastQueue.length > 0) {
      const job = broadcastQueue.shift();
      const id = Number(job.notificationId);
      if (!Number.isFinite(id) || inFlightJobs.has(id)) continue;

      inFlightJobs.add(id);
      try {
        await runNotificationBroadcastJob(id, job.title, job.body, job.data);
      } finally {
        inFlightJobs.delete(id);
      }

      if (broadcastQueue.length > 0) {
        await sleep(BROADCAST_GAP_MS);
      }
    }
  } finally {
    drainingQueue = false;
    if (broadcastQueue.length > 0) {
      setImmediate(() => drainBroadcastQueue());
    }
  }
}

/** Queue broadcast so admin API returns immediately; sends one alert at a time. */
function scheduleNotificationBroadcast(notificationId, title, body, data) {
  const id = Number(notificationId);
  if (!Number.isFinite(id)) return;

  const alreadyQueued = broadcastQueue.some((j) => Number(j.notificationId) === id);
  if (alreadyQueued || inFlightJobs.has(id)) return;

  broadcastQueue.push({ notificationId: id, title, body, data });
  setImmediate(() => drainBroadcastQueue());
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
