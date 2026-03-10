import { Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp } from '@react-native-firebase/app';
import {
  getMessaging,
  hasPermission,
  requestPermission,
  getToken,
  onMessage,
  getInitialNotification,
  onNotificationOpenedApp,
  onTokenRefresh,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';
import { userAPI, notificationsAPI } from '../config/api';

const NOTIFICATION_PERMISSION_ASKED_KEY = 'notificationPermissionAsked';

function getMessagingInstance() {
  return getMessaging(getApp());
}

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

// Check if we've already asked the user for notification permission
export const hasAskedNotificationPermission = async () => {
  try {
    const value = await AsyncStorage.getItem(NOTIFICATION_PERMISSION_ASKED_KEY);
    return value === 'true';
  } catch {
    return false;
  }
};

// Mark that we have asked the user (so we never show the prompt again)
export const markNotificationPermissionAsked = async () => {
  try {
    await AsyncStorage.setItem(NOTIFICATION_PERMISSION_ASKED_KEY, 'true');
  } catch {}
};

// Check actual OS-level notification permission status.
// Returns true if notifications are currently granted/authorized.
// Returns false if denied, not determined, or Firebase unavailable.
export const isNotificationPermissionGranted = async () => {
  try {
    // On Android 13+ check the real OS permission via PermissionsAndroid
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      const status = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      return status === true;
    }

    // On iOS (and Android < 13 where permission is auto-granted), use Firebase modular API
    const messaging = getMessagingInstance();
    const authStatus = await hasPermission(messaging);
    return (
      authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
};

// Request notification permissions — handles Android 13+ POST_NOTIFICATIONS
// and iOS authorization in one call. Safe: no crash if Firebase/Notifee missing.
export const requestNotificationPermission = async () => {
  try {
    const notifee = require('@notifee/react-native').default;
    const { AndroidImportance } = require('@notifee/react-native');
    const messaging = getMessagingInstance();

    if (Platform.OS === 'android') {
      // Step 1: Create the notification channel (required for Android 8+)
      await notifee.createChannel({
        id: 'default',
        name: 'Default Channel',
        importance: AndroidImportance.HIGH,
        sound: 'default',
      });

      // Step 2: On Android 13+ (API 33+), request POST_NOTIFICATIONS via
      // PermissionsAndroid — this triggers the real OS permission dialog.
      if (Platform.Version >= 33) {
        const status = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          {
            title: 'Ruhusu Arifa',
            message: 'Ruhusu EaMax ikutumie arifa za mechi, channels mpya na ofa maalum.',
            buttonPositive: 'Ruhusu',
            buttonNegative: 'Kataa',
          },
        );
        const granted = status === PermissionsAndroid.RESULTS.GRANTED;
        console.log('[FCM] Android POST_NOTIFICATIONS:', status);
        if (!granted) return false;
      }

      // Step 3: Also request via Notifee (handles its own internal state)
      await notifee.requestPermission();
    }

    // Step 4: Request via Firebase Messaging (needed on iOS + syncs Android state)
    const authStatus = await requestPermission(messaging);
    const enabled =
      authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL;

    console.log('[FCM] Permission status:', authStatus, '| enabled:', enabled);
    return enabled;
  } catch (error) {
    console.warn('[FCM] requestNotificationPermission error:', error?.message || error);
    return false;
  }
};

// Get FCM token
export const getFCMToken = async () => {
  try {
    const messaging = getMessagingInstance();
    const token = await getToken(messaging);
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

// Confirm notification delivery to backend
const confirmNotificationDelivery = async (notificationId, externalId) => {
  try {
    if (!notificationId || !externalId) return;
    await notificationsAPI.confirmDelivery(String(notificationId), externalId);
    console.log(`[FCM] Confirmed delivery of notification ${notificationId}`);
  } catch (error) {
    console.warn('[FCM] Failed to confirm delivery:', error?.message || error);
  }
};

// Display local notification using Notifee
export const displayNotification = async (title, body, data = {}, externalId = null) => {
  try {
    const notifee = require('@notifee/react-native').default;
    const { AndroidImportance } = require('@notifee/react-native');
    
    // Confirm delivery to backend for tracking
    const notificationId = data?.notificationId || data?.notification_id;
    if (notificationId && externalId) {
      confirmNotificationDelivery(notificationId, externalId);
    }
    
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
    const messaging = getMessagingInstance();
    onTokenRefresh(messaging, async (token) => {
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
let _cachedExternalId = null;

// Setup notification handlers (safe: returns no-op if Firebase/Notifee unavailable)
export const setupNotificationHandlers = (onNotificationReceived, externalId = null) => {
  if (externalId) _cachedExternalId = externalId;
  
  if (_handlersSetup) return () => {};
  _handlersSetup = true;
  let unsubscribeForeground = () => {};
  try {
    const messaging = getMessagingInstance();
    const notifee = require('@notifee/react-native').default;

    // Foreground message handler - displays notification and confirms delivery
    unsubscribeForeground = onMessage(messaging, async (remoteMessage) => {
      try {
        const { notification, data } = remoteMessage || {};
        if (notification) {
          await displayNotification(
            notification.title || 'EaMax',
            notification.body || '',
            data || {},
            _cachedExternalId
          );
        }
        if (onNotificationReceived) onNotificationReceived(remoteMessage);
      } catch (e) {
        console.warn('Foreground message handler error:', e?.message);
      }
    });

    // App opened from killed state via notification
    getInitialNotification(messaging).then((remoteMessage) => {
      if (remoteMessage) {
        recordNotificationClick(remoteMessage);
        // Confirm delivery when app opened from notification
        const notificationId = remoteMessage?.data?.notificationId || remoteMessage?.data?.notification_id;
        if (notificationId && _cachedExternalId) {
          confirmNotificationDelivery(notificationId, _cachedExternalId);
        }
        if (onNotificationReceived) onNotificationReceived(remoteMessage);
      }
    }).catch(() => {});

    // Notifee initial notification
    notifee.getInitialNotification().then((initial) => {
      if (initial?.notification?.data) {
        recordNotificationClick({ data: initial.notification.data });
        const notificationId = initial.notification.data?.notificationId || initial.notification.data?.notification_id;
        if (notificationId && _cachedExternalId) {
          confirmNotificationDelivery(notificationId, _cachedExternalId);
        }
      }
    }).catch(() => {});

    // App opened from background via notification
    onNotificationOpenedApp(messaging, (remoteMessage) => {
      if (remoteMessage) {
        recordNotificationClick(remoteMessage);
        const notificationId = remoteMessage?.data?.notificationId || remoteMessage?.data?.notification_id;
        if (notificationId && _cachedExternalId) {
          confirmNotificationDelivery(notificationId, _cachedExternalId);
        }
        if (onNotificationReceived) onNotificationReceived(remoteMessage);
      }
    });

    // Notifee foreground event (user taps notification)
    notifee.onForegroundEvent(({ type, detail }) => {
      if (type === 1 && detail?.notification) {
        const data = detail.notification.data || {};
        recordNotificationClick({ data });
        const notificationId = data?.notificationId || data?.notification_id;
        if (notificationId && _cachedExternalId) {
          confirmNotificationDelivery(notificationId, _cachedExternalId);
        }
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

    // Background event handler - confirms delivery even when app is in background
    notifee.onBackgroundEvent(async ({ type, detail }) => {
      if (detail?.notification?.data) {
        const notificationId = detail.notification.data?.notificationId || detail.notification.data?.notification_id;
        if (notificationId && _cachedExternalId) {
          confirmNotificationDelivery(notificationId, _cachedExternalId);
        }
      }
    });
  } catch (error) {
    console.warn('Setup notification handlers error:', error?.message || error);
  }
  return unsubscribeForeground;
};
