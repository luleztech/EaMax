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
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK', // For React Native compatibility
      },
      token: fcmToken,
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          sound: 'default',
          priority: 'high',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
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

// Send push notification to multiple FCM tokens
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
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          sound: 'default',
          priority: 'high',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
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

// Initialize on module load
initializeFirebase();

module.exports = {
  initializeFirebase,
  sendPushNotification,
  sendPushNotificationToMultiple,
  isInitialized: () => firebaseInitialized,
};
