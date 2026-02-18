import { Platform } from 'react-native';
import { userAPI } from '../config/api';

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
      console.warn('No FCM token to register');
      return false;
    }

    await userAPI.registerFCMToken(externalId, fcmToken);
    console.log('FCM token registered successfully');
    return true;
  } catch (error) {
    console.error('Error registering FCM token:', error);
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
    // Request permission
    const hasPermission = await requestNotificationPermission();
    if (!hasPermission) {
      console.log('Notification permission not granted');
      return false;
    }

    // Get FCM token
    const fcmToken = await getFCMToken();
    if (fcmToken && externalId) {
      // Register token with backend
      await registerFCMToken(externalId, fcmToken);
    }

    // Listen for token refresh
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

// Setup notification handlers (safe: returns no-op if Firebase/Notifee unavailable)
export const setupNotificationHandlers = (onNotificationReceived) => {
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
      if (remoteMessage && onNotificationReceived) onNotificationReceived(remoteMessage);
    }).catch(() => {});

    messaging().onNotificationOpenedApp((remoteMessage) => {
      if (onNotificationReceived && remoteMessage) onNotificationReceived(remoteMessage);
    });

    notifee.onForegroundEvent(({ type, detail }) => {
      if (type === 1 && onNotificationReceived && detail?.notification) {
        onNotificationReceived({
          notification: {
            title: detail.notification.title,
            body: detail.notification.body,
          },
          data: detail.notification.data || {},
        });
      }
    });

    notifee.onBackgroundEvent(() => {});
  } catch (error) {
    console.warn('Setup notification handlers error:', error?.message || error);
  }
  return unsubscribeForeground;
};
