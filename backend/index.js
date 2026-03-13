#!/usr/bin/env node

/**
 * Background FCM service to ensure notifications are delivered even when users are offline
 * This service runs independently from the main API server
 */

const admin = require('firebase-admin');
const { query } = require('./src/db');
const { sendPushNotificationToMultiple, isInitialized } = require('./src/services/firebase');

// Check for scheduled notifications and send them
async function processScheduledNotifications() {
  try {
    if (!isInitialized()) {
      console.log('[FCM Service] Firebase not initialized, skipping scheduled notifications');
      return;
    }

    // Get scheduled notifications that are due to be sent
    const result = await query(
      `SELECT id, title, message, category
       FROM notifications
       WHERE type = 'scheduled'
       AND scheduled_for <= NOW()
       AND sent_at IS NULL
       ORDER BY scheduled_for ASC
       LIMIT 10`
    );

    if (result.rows.length === 0) {
      return;
    }

    console.log(`[FCM Service] Processing ${result.rows.length} scheduled notifications`);

    for (const notification of result.rows) {
      try {
        // Get all active users with FCM tokens
        const tokensResult = await query(
          `SELECT u.id as user_id, u.fcm_token 
           FROM users u
           WHERE u.fcm_token IS NOT NULL 
           AND u.blocked = FALSE 
           AND TRIM(u.fcm_token) != ''
           AND u.uninstalled_at IS NULL`
        );

        const userTokenMap = new Map();
        (tokensResult.rows || []).forEach((row) => {
          const token = row?.fcm_token;
          if (token && String(token).trim() !== '') {
            userTokenMap.set(row.user_id, token);
          }
        });

        const fcmTokens = [...new Set(userTokenMap.values())];

        if (fcmTokens.length > 0) {
          const pushResult = await sendPushNotificationToMultiple(
            fcmTokens,
            notification.title,
            notification.message,
            {
              notificationId: String(notification.id),
              category: notification.category,
              type: 'notification',
            }
          );

          const invalidTokens = [];
          if (pushResult?.responses) {
            pushResult.responses.forEach((resp, idx) => {
              if (!resp.success && resp.error && fcmTokens[idx]) {
                const errCode = String(resp.error.code || resp.error.message || '').toLowerCase();
                const isInvalid =
                  errCode.includes('registration-token-not-registered') ||
                  errCode.includes('invalid-registration-token') ||
                  errCode.includes('invalid-argument') ||
                  errCode.includes('unregistered') ||
                  errCode.includes('invalid_argument');
                if (isInvalid) invalidTokens.push(fcmTokens[idx]);
              }
            });
          }
          for (const token of invalidTokens) {
            await query(`UPDATE users SET fcm_token = NULL WHERE fcm_token = $1`, [token]).catch(() => {});
          }
          if (invalidTokens.length > 0) {
            console.log(`[FCM Service] Cleared ${invalidTokens.length} invalid token(s)`);
          }

          const successCount = pushResult?.sent ?? 0;
          const deliveryRecords = [];
          for (const [userId, token] of userTokenMap.entries()) {
            if (!invalidTokens.includes(token)) {
              deliveryRecords.push([notification.id, userId, token]);
            }
          }

          if (deliveryRecords.length > 0) {
            const deliveryValues = deliveryRecords
              .map((_, idx) => {
                const base = idx * 3;
                return `($${base + 1}, $${base + 2}, $${base + 3})`;
              })
              .join(',');
            const deliveryParams = deliveryRecords.flat();
            await query(
              `INSERT INTO notification_deliveries (notification_id, user_id, fcm_token)
               VALUES ${deliveryValues}
               ON CONFLICT (notification_id, user_id) DO NOTHING`,
              deliveryParams
            ).catch(() => {});

            await query(
              `UPDATE notifications SET sent_count = $1, sent_at = NOW() WHERE id = $2`,
              [successCount, notification.id]
            ).catch(() => {});
          } else {
            await query(
              `UPDATE notifications SET sent_count = 0, sent_at = NOW() WHERE id = $1`,
              [notification.id]
            ).catch(() => {});
          }

          console.log(`[FCM Service] Sent notification ${notification.id}: ${successCount} delivered, ${invalidTokens.length} invalid tokens cleared`);
        }

        // Mark as sent
        await query(
          `UPDATE notifications SET sent_at = NOW() WHERE id = $1`,
          [notification.id]
        );
      } catch (err) {
        console.error(`[FCM Service] Error processing notification ${notification.id}:`, err.message);
      }
    }
  } catch (error) {
    console.error('[FCM Service] Error processing scheduled notifications:', error.message);
  }
}

// Run the service
async function runService() {
  console.log('[FCM Service] Starting background notification service...');
  
  // Process scheduled notifications every minute
  setInterval(processScheduledNotifications, 60000);
  
  // Run immediately on start
  await processScheduledNotifications();
}

// Only run if this file is executed directly
if (require.main === module) {
  runService().catch((error) => {
    console.error('[FCM Service] Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { processScheduledNotifications };
