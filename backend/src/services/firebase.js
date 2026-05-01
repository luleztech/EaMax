const admin = require('firebase-admin');

// Initialize Firebase Admin
// For production, use service account key from environment variable
// For now, we'll use a placeholder that can be configured via env vars
let firebaseInitialized = false;

const initializeFirebase = () => {
  if (firebaseInitialized) {
    return;
  }

  try {
    let serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKey || String(serviceAccountKey).trim() === '') {
      console.warn('FIREBASE_SERVICE_ACCOUNT_KEY not set. Push notifications will be disabled.');
      return;
    }
    // Allow pasting pretty-printed JSON (strip real newlines; keep \n inside private_key string)
    serviceAccountKey = String(serviceAccountKey).replace(/\r\n/g, '').replace(/\n/g, '').trim();
    const serviceAccount = JSON.parse(serviceAccountKey);
    if (!serviceAccount || typeof serviceAccount !== 'object') {
      console.warn('FIREBASE_SERVICE_ACCOUNT_KEY invalid JSON. Push notifications will be disabled.');
      return;
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseInitialized = true;
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error.message || error);
  }
};

// FCM keeps messages when device is offline and delivers when back online.
// TTL: 28 days (max) so user gets the notification as soon as they have internet.
// No collapseKey so every notification is delivered (not replaced by a newer one).
const FCM_TTL_MS = 28 * 24 * 60 * 60 * 1000; // 28 days in milliseconds
const FCM_ANDROID_CHANNEL_ID = 'eamax_high_priority';

// Ensure all data payload values are strings (FCM requirement)
const stringifyData = (data) => {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    out[k] = v == null ? '' : String(v);
  }
  return out;
};

// Send push notification to a single FCM token
const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  if (!firebaseInitialized) {
    throw new Error('Firebase Admin not initialized');
  }

  try {
    const message = {
      notification: {
        title,
        body,
      },
      data: stringifyData({
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK', // For React Native compatibility
      }),
      token: fcmToken,
      android: {
        priority: 'high',
        ttl: FCM_TTL_MS,
        notification: {
          channelId: FCM_ANDROID_CHANNEL_ID,
          sound: 'default',
          priority: 'high',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'content-available': 1,
          },
        },
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
      },
    };

    const response = await admin.messaging().send(message);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('Error sending push notification:', error);
    throw error;
  }
};

// Send push notification to multiple FCM tokens.
// Offline: FCM stores each message (no collapseKey); when user has internet again,
// all pending messages are delivered (app can be minimized or in background).
const sendPushNotificationToMultiple = async (fcmTokens, title, body, data = {}) => {
  if (!firebaseInitialized) {
    throw new Error('Firebase Admin not initialized');
  }

  if (!fcmTokens || fcmTokens.length === 0) {
    return { success: true, sent: 0, failed: 0 };
  }

  try {
    const message = {
      notification: {
        title,
        body,
      },
      data: stringifyData({
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      }),
      android: {
        priority: 'high',
        ttl: FCM_TTL_MS,
        notification: {
          channelId: FCM_ANDROID_CHANNEL_ID,
          sound: 'default',
          priority: 'high',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'content-available': 1,
          },
        },
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast({
      ...message,
      tokens: fcmTokens,
    });

    return {
      success: true,
      sent: response.successCount,
      failed: response.failureCount,
      responses: response.responses,
    };
  } catch (error) {
    console.error('Error sending multicast push notification:', error);
    throw error;
  }
};

// Send one notification to all devices subscribed to a topic (e.g. all_users)
const sendPushNotificationToTopic = async (topic, title, body, data = {}) => {
  if (!firebaseInitialized) {
    throw new Error('Firebase Admin not initialized');
  }
  if (!topic || String(topic).trim() === '') {
    throw new Error('Topic is required');
  }

  const message = {
    topic: String(topic).trim(),
    notification: {
      title,
      body,
    },
    data: stringifyData({
      ...data,
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    }),
    android: {
      priority: 'high',
      ttl: FCM_TTL_MS,
      notification: {
        channelId: FCM_ANDROID_CHANNEL_ID,
        sound: 'default',
        priority: 'high',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
          'content-available': 1,
        },
      },
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert',
      },
    },
  };

  const messageId = await admin.messaging().send(message);
  return { success: true, messageId };
};

// Initialize on module load
initializeFirebase();

module.exports = {
  initializeFirebase,
  sendPushNotification,
  sendPushNotificationToMultiple,
  sendPushNotificationToTopic,
  isInitialized: () => firebaseInitialized,
};
