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
    // Check if Firebase credentials are provided
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    
    if (serviceAccountKey) {
      // Parse JSON from environment variable
      const serviceAccount = JSON.parse(serviceAccountKey);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      firebaseInitialized = true;
      console.log('Firebase Admin initialized successfully');
    } else {
      console.warn('FIREBASE_SERVICE_ACCOUNT_KEY not found. Push notifications will be disabled.');
    }
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
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
