#!/usr/bin/env node

/**
 * Background FCM service to process scheduled notifications.
 */

const { query } = require('./src/db');
const { isInitialized } = require('./src/services/firebase');
const { scheduleNotificationBroadcast } = require('./src/services/notificationBroadcast');

async function processScheduledNotifications() {
  try {
    if (!isInitialized()) {
      console.log('[FCM Service] Firebase not initialized, skipping scheduled notifications');
      return;
    }

    const result = await query(
      `SELECT id, title, message, category
       FROM notifications
       WHERE type = 'scheduled'
         AND scheduled_for <= NOW()
         AND sent_at IS NULL
       ORDER BY scheduled_for ASC
       LIMIT 10`,
    );

    if (result.rows.length === 0) {
      return;
    }

    console.log(`[FCM Service] Processing ${result.rows.length} scheduled notifications`);

    for (const notification of result.rows) {
      try {
        await query(
          `UPDATE notifications
              SET sent_at = NOW(),
                  push_status = 'sending',
                  sent_count = 0,
                  delivered_count = 0,
                  clicks = 0
            WHERE id = $1`,
          [notification.id],
        );

        scheduleNotificationBroadcast(
          notification.id,
          notification.title,
          notification.message,
          {
            notificationId: String(notification.id),
            category: notification.category,
            type: 'notification',
          },
        );

        console.log(`[FCM Service] Queued scheduled notification ${notification.id}`);
      } catch (err) {
        console.error(`[FCM Service] Error processing notification ${notification.id}:`, err.message);
      }
    }
  } catch (error) {
    console.error('[FCM Service] Error processing scheduled notifications:', error.message);
  }
}

async function runService() {
  console.log('[FCM Service] Starting background notification service...');
  setInterval(processScheduledNotifications, 60000);
  await processScheduledNotifications();
}

if (require.main === module) {
  runService().catch((error) => {
    console.error('[FCM Service] Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { processScheduledNotifications };
