import { Platform } from 'react-native';
import { userAPI, notificationsAPI } from '../config/api';

// Record notification click on backend so admin panel can show clicks
function recordNotificationClick(messageOrData) {
  const data = messageOrData?.data || messageOrData;
  const id = data?.notificationId || data?.notification_id;
  if (id) {
    notificationsAPI.recordClick(String(id)).catch(() => {});
  }
}

// Notifications are delivered by FCM even when the user was offline: the backend
// sends with high priority and 28-day TTL, so when the device has internet again
// (app minimized or in background), FCM delivers and we show in the status bar.

// Request notification permissions (safe: no crash if Firebase/Notifee missing)
export const requestNotificationPermission = async () => {
  try {
    const notifee = require('@notifee/react-native').default;
    const { AndroidImportance } = require('@notifee/react-native');
    const messaging = require('@react-native-firebase/messaging').default;

    if (Platform.OS === 'android') {
      await notifee.createChannel({
        id: 'default',
        name: 'Default Channel',
        importance: AndroidImportance.HIGH,
        sound: 'default',
      });
    }

    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (enabled) {
      console.log('Notification permission granted');
      return true;
    }
    console.log('Notification permission denied');
    return false;
  } catch (error) {
    console.warn('Notification permission error:', error?.message || error);
    return false;
  }
};

// Get FCM token
export const getFCMToken = async () => {
  try {
    const messaging = require('@react-native-firebase/messaging').default;
    const token = await messaging().getToken();
    console.log('FCM Token:', token);
    return token;
  } catch (error) {
    console.error('Error getting FCM token:', error);
    return null;
  }
};

// Register FCM token with backend
export const registerFCMToken = async (externalId, fcmToken) => {
  try {
    if (!fcmToken) {
      console.warn('[FCM] No FCM token to register');
      return false;
    }
    if (!externalId) {
      console.warn('[FCM] No externalId to register token');
      return false;
    }

    await userAPI.registerFCMToken(externalId, fcmToken);
    console.log('[FCM] Token registered successfully with backend');
    return true;
  } catch (error) {
    const msg = error?.message || String(error);
    console.error('[FCM] Register token failed:', msg);
    if (msg.includes('404') || msg.includes('not found')) {
      console.warn('[FCM] User not found on backend – ensure app called register first');
    }
    return false;
  }
};

// Display local notification using Notifee
export const displayNotification = async (title, body, data = {}) => {
  try {
    const notifee = require('@notifee/react-native').default;
    const { AndroidImportance } = require('@notifee/react-native');
    if (Platform.OS === 'android') {
      await notifee.displayNotification({
        title: title || 'EaMax',
        body: body || '',
        android: {
          channelId: 'default',
          importance: AndroidImportance.HIGH,
          pressAction: { id: 'default' },
          sound: 'default',
          smallIcon: 'ic_launcher',
          showTimestamp: true,
          autoCancel: true,
          ongoing: false,
        },
        data: data || {},
      });
    } else {
      await notifee.displayNotification({
        title: title || 'EaMax',
        body: body || '',
        ios: { sound: 'default' },
        data: data || {},
      });
    }
  } catch (error) {
    console.warn('Display notification error:', error?.message || error);
  }
};

// Initialize notifications
export const initializeNotifications = async (externalId) => {
  try {
    if (!externalId) {
      console.warn('[FCM] initializeNotifications called without externalId');
      return false;
    }

    // Ensure user exists on backend so fcm-token endpoint can find them
    try {
      await userAPI.register(externalId);
    } catch (e) {
      console.warn('[FCM] Register user first failed:', e?.message || e);
    }

    const hasPermission = await requestNotificationPermission();
    if (!hasPermission) {
      console.log('[FCM] Notification permission not granted');
      return false;
    }

    const fcmToken = await getFCMToken();
    if (!fcmToken) {
      console.warn('[FCM] Could not get FCM token (check Firebase / google-services.json)');
      return false;
    }
    await registerFCMToken(externalId, fcmToken);

    // When user comes back online, FCM may refresh the token; re-register so backend has it
    const messaging = require('@react-native-firebase/messaging').default;
    messaging().onTokenRefresh(async (token) => {
      console.log('FCM token refreshed:', token);
      if (externalId) {
        await registerFCMToken(externalId, token);
      }
    });

    return true;
  } catch (error) {
    console.error('Error initializing notifications:', error);
    return false;
  }
};

// Only attach FCM/Notifee listeners once (avoid duplicate when both StreamingApp and ProfileScreen init)
let _handlersSetup = false;

// Setup notification handlers (safe: returns no-op if Firebase/Notifee unavailable)
export const setupNotificationHandlers = (onNotificationReceived) => {
  if (_handlersSetup) return () => {};
  _handlersSetup = true;
  let unsubscribeForeground = () => {};
  try {
    const messaging = require('@react-native-firebase/messaging').default;
    const notifee = require('@notifee/react-native').default;

    unsubscribeForeground = messaging().onMessage(async (remoteMessage) => {
      try {
        const { notification, data } = remoteMessage || {};
        if (notification) {
          await displayNotification(
            notification.title || 'EaMax',
            notification.body || '',
            data || {}
          );
        }
        if (onNotificationReceived) onNotificationReceived(remoteMessage);
      } catch (e) {
        console.warn('Foreground message handler error:', e?.message);
      }
    });

    messaging().getInitialNotification().then((remoteMessage) => {
      if (remoteMessage) {
        recordNotificationClick(remoteMessage);
        if (onNotificationReceived) onNotificationReceived(remoteMessage);
      }
    }).catch(() => {});

    notifee.getInitialNotification().then((initial) => {
      if (initial?.notification?.data) {
        recordNotificationClick({ data: initial.notification.data });
      }
    }).catch(() => {});

    messaging().onNotificationOpenedApp((remoteMessage) => {
      if (remoteMessage) {
        recordNotificationClick(remoteMessage);
        if (onNotificationReceived) onNotificationReceived(remoteMessage);
      }
    });

    notifee.onForegroundEvent(({ type, detail }) => {
      if (type === 1 && detail?.notification) {
        const data = detail.notification.data || {};
        recordNotificationClick({ data });
        if (onNotificationReceived) {
          onNotificationReceived({
            notification: {
              title: detail.notification.title,
              body: detail.notification.body,
            },
            data,
          });
        }
      }
    });

    notifee.onBackgroundEvent(() => {});
  } catch (error) {
    console.warn('Setup notification handlers error:', error?.message || error);
  }
  return unsubscribeForeground;
};
