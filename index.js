/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Background message handler (must be outside React lifecycle).
// FCM delivers here when the device receives the message — including after the user
// was offline: messages are queued by FCM and delivered as soon as the device has
// internet again, even if the app is minimized or in the background.
try {
  const { getApp } = require('@react-native-firebase/app');
  const { getMessaging, setBackgroundMessageHandler } = require('@react-native-firebase/messaging');
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const { API_BASE_URL } = require('./src/config/api');

  const messaging = getMessaging(getApp());
  setBackgroundMessageHandler(messaging, async (remoteMessage) => {
    try {
      const notifee = require('@notifee/react-native').default;
      const { AndroidImportance } = require('@notifee/react-native');
      const { notification, data } = remoteMessage || {};
      const title =
        notification?.title || (data && data.title) || 'EaMax';
      const body =
        notification?.body ||
        (data && (data.body || data.message)) ||
        '';
      if (title || body) {
        await notifee.createChannel({
          id: 'eamax_high_priority',
          name: 'EaMax Arifa',
          importance: AndroidImportance.HIGH,
          sound: 'default',
        });
        await notifee.displayNotification({
          title,
          body,
          android: {
            channelId: 'eamax_high_priority',
            importance: AndroidImportance.HIGH,
            pressAction: { id: 'default' },
            sound: 'default',
            smallIcon: 'ic_launcher',
            showTimestamp: true,
            autoCancel: true,
            ongoing: false,
          },
          data: data && typeof data === 'object' ? data : {},
        });
      }
      // Confirm delivery to backend even when app was in background (so admin stats are accurate)
      const notificationId = (data && (data.notificationId || data.notification_id)) || null;
      if (notificationId) {
        try {
          const userId = await AsyncStorage.getItem('userId');
          if (userId && API_BASE_URL) {
            await fetch(`${API_BASE_URL}/api/notifications/${notificationId}/delivered`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ externalId: userId }),
            });
          }
        } catch (_) {}
      }
    } catch (err) {
      console.warn('Background notification display failed:', err?.message || err);
    }
  });
} catch (err) {
  console.warn('Firebase messaging not available:', err?.message || err);
}

AppRegistry.registerComponent(appName, () => App);
