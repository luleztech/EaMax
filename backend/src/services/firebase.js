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

/** Android replaces the previous EaMax tray alert (one visible at a time on device). */
const FCM_ANDROID_COLLAPSE_KEY = 'eamax_broadcast_v1';

/** Must match Flutter `kFcmAndroidChannelId` / AndroidManifest `default_notification_channel_id`. */
const FCM_ANDROID_CHANNEL_ID =
  process.env.FCM_ANDROID_CHANNEL_ID || 'eamax_high_priority';

// Ensure all data payload values are strings (FCM requirement)
const stringifyData = (data) => {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    out[k] = v == null ? '' : String(v);
  }
  return out;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableFirebaseError = (error) => {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === 'messaging/server-unavailable' ||
    code === 'messaging/internal-error' ||
    code === 'messaging/quota-exceeded' ||
    code === 'messaging/too-many-requests' ||
    code === 'messaging/unknown' ||
    message.includes('429') ||
    message.includes('too many requests') ||
    message.includes('quota exceeded') ||
    message.includes('server unavailable') ||
    message.includes('internal error')
  );
};

const retryFirebaseSend = async (fn, attempts = 3, baseDelay = 300) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isRetryableFirebaseError(error)) {
        throw error;
      }
      await sleep(baseDelay * Math.pow(2, attempt));
    }
  }
  throw lastError;
};

/**
 * Data-only FCM (no top-level `notification` key) so Android delivers to
 * firebaseMessagingBackgroundHandler — apps show a local notification and can
 * POST /api/notifications/:id/delivered for accurate delivery counts.
 */
const buildDataOnlyPayload = (title, body, data = {}) =>
  stringifyData({
    title,
    body,
    ...data,
    click_action: 'FLUTTER_NOTIFICATION_CLICK',
  });

// Send push notification to a single FCM token
const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  if (!firebaseInitialized) {
    throw new Error('Firebase Admin not initialized');
  }

  try {
    const message = {
      data: buildDataOnlyPayload(title, body, data),
      token: fcmToken,
      android: {
        priority: 'high',
        ttl: FCM_TTL_MS,
        collapseKey: FCM_ANDROID_COLLAPSE_KEY,
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
        },
      },
    };

    const response = await retryFirebaseSend(async () => admin.messaging().send(message));
    return { success: true, messageId: response };
  } catch (error) {
    console.error('Error sending push notification:', error);
    throw error;
  }
};

const buildReliableAndroidConfig = () => ({
  priority: 'high',
  ttl: FCM_TTL_MS,
  collapseKey: FCM_ANDROID_COLLAPSE_KEY,
  notification: {
    channelId: FCM_ANDROID_CHANNEL_ID,
    sound: 'default',
    priority: 'high',
    defaultSound: true,
    visibility: 'public',
    tag: FCM_ANDROID_COLLAPSE_KEY,
  },
});

const buildReliableApnsConfig = () => ({
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
});

const buildReliableMulticastBase = (title, body, data = {}) => ({
  notification: { title, body },
  data: stringifyData({
    title,
    body,
    ...data,
    click_action: 'FLUTTER_NOTIFICATION_CLICK',
  }),
  android: buildReliableAndroidConfig(),
  apns: buildReliableApnsConfig(),
});

// Send push notification to multiple FCM tokens (notification + data for OS display).
const sendPushNotificationToMultiple = async (fcmTokens, title, body, data = {}) => {
  return sendReliablePushNotificationToMultiple(fcmTokens, title, body, data);
};

const sendReliablePushNotificationToMultiple = async (fcmTokens, title, body, data = {}) => {
  if (!firebaseInitialized) {
    throw new Error('Firebase Admin not initialized');
  }

  if (!fcmTokens || fcmTokens.length === 0) {
    return { success: true, sent: 0, failed: 0, responses: [] };
  }

  try {
    const baseMessage = buildReliableMulticastBase(title, body, data);
    const tokens = fcmTokens.map((t) => String(t || '').trim()).filter(Boolean);
    const messages = tokens.map((token) => ({
      ...baseMessage,
      token,
    }));

    const response = await retryFirebaseSend(async () => admin.messaging().sendEach(messages));

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

/**
 * Notification + data (best for Android when app is killed / idle).
 * Used for SupaAdmin → EaMax bridge so the OS shows alerts immediately.
 */
const sendReliablePushNotificationToTopic = async (topic, title, body, data = {}) => {
  if (!firebaseInitialized) {
    throw new Error('Firebase Admin not initialized');
  }
  if (!topic || String(topic).trim() === '') {
    throw new Error('Topic is required');
  }

  const message = {
    topic: String(topic).trim(),
    notification: { title, body },
    data: stringifyData({
      title,
      body,
      ...data,
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    }),
    android: buildReliableAndroidConfig(),
    apns: buildReliableApnsConfig(),
  };

  const messageId = await retryFirebaseSend(async () => admin.messaging().send(message));
  return { success: true, messageId };
};

/** Reliable single-token push (notification + data). */
const sendReliablePushNotification = async (fcmToken, title, body, data = {}) => {
  if (!firebaseInitialized) {
    throw new Error('Firebase Admin not initialized');
  }
  const token = String(fcmToken || '').trim();
  if (!token) {
    throw new Error('FCM token is required');
  }

  const message = {
    token,
    notification: { title, body },
    data: stringifyData({
      title,
      body,
      ...data,
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    }),
    android: buildReliableAndroidConfig(),
    apns: buildReliableApnsConfig(),
  };

  const messageId = await admin.messaging().send(message);
  return { success: true, messageId };
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
    data: buildDataOnlyPayload(title, body, data),
    android: {
      priority: 'high',
      ttl: FCM_TTL_MS,
      collapseKey: FCM_ANDROID_COLLAPSE_KEY,
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
      },
    },
  };

  const messageId = await retryFirebaseSend(async () => admin.messaging().send(message));
  return { success: true, messageId };
};

// Initialize on module load
initializeFirebase();

module.exports = {
  initializeFirebase,
  sendPushNotification,
  sendPushNotificationToMultiple,
  sendReliablePushNotificationToMultiple,
  sendPushNotificationToTopic,
  sendReliablePushNotification,
  sendReliablePushNotificationToTopic,
  isInitialized: () => firebaseInitialized,
};
