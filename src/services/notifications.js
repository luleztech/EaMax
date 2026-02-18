import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { Platform } from 'react-native';
import { userAPI } from '../config/api';

// Request notification permissions
export const requestNotificationPermission = async () => {
  try {
    if (Platform.OS === 'android') {
      // Create a default channel for Android
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
    } else {
      console.log('Notification permission denied');
      return false;
    }
  } catch (error) {
    console.error('Error requesting notification permission:', error);
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
    if (Platform.OS === 'android') {
      await notifee.displayNotification({
        title,
        body,
        android: {
          channelId: 'default',
          importance: AndroidImportance.HIGH,
          pressAction: {
            id: 'default',
          },
          sound: 'default',
          // Ensure notification shows in status bar
          smallIcon: 'ic_notification', // Use default system icon
          showTimestamp: true,
          autoCancel: true,
          ongoing: false,
        },
        data,
      });
    } else {
      // iOS
      await notifee.displayNotification({
        title,
        body,
        ios: {
          sound: 'default',
        },
        data,
      });
    }
  } catch (error) {
    console.error('Error displaying notification:', error);
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

// Setup notification handlers
export const setupNotificationHandlers = (onNotificationReceived) => {
  // Handle foreground notifications
  const unsubscribeForeground = messaging().onMessage(async (remoteMessage) => {
    console.log('Foreground notification received:', remoteMessage);
    
    const { notification, data } = remoteMessage;
    
    if (notification) {
      // Display notification using Notifee
      await displayNotification(
        notification.title || 'EaMax',
        notification.body || '',
        data || {}
      );
    }

    // Call callback if provided
    if (onNotificationReceived) {
      onNotificationReceived(remoteMessage);
    }
  });

  // Note: Background message handler is registered in index.js
  // This is required for React Native Firebase to work when app is in background/quit state

  // Handle notification opened from quit state
  messaging()
    .getInitialNotification()
    .then((remoteMessage) => {
      if (remoteMessage) {
        console.log('Notification opened app from quit state:', remoteMessage);
        if (onNotificationReceived) {
          onNotificationReceived(remoteMessage);
        }
      }
    });

  // Handle notification opened from background state
  messaging().onNotificationOpenedApp((remoteMessage) => {
    console.log('Notification opened app from background:', remoteMessage);
    if (onNotificationReceived) {
      onNotificationReceived(remoteMessage);
    }
  });

  // Handle notification press (when app is in foreground)
  notifee.onForegroundEvent(async ({ type, detail }) => {
    if (type === 1) { // Press action
      console.log('Notification pressed:', detail.notification);
      if (onNotificationReceived && detail.notification) {
        onNotificationReceived({
          notification: {
            title: detail.notification.title,
            body: detail.notification.body,
          },
          data: detail.notification.data || {},
        });
      }
    }
  });

  // Handle notification press (when app is in background/quit)
  notifee.onBackgroundEvent(async ({ type, detail }) => {
    if (type === 1) { // Press action
      console.log('Background notification pressed:', detail.notification);
    }
  });

  return unsubscribeForeground;
};
