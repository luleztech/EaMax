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
  const messaging = require('@react-native-firebase/messaging').default;
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    try {
      const notifee = require('@notifee/react-native').default;
      const { AndroidImportance } = require('@notifee/react-native');
      const { notification, data } = remoteMessage || {};
      if (notification) {
        await notifee.createChannel({
          id: 'default',
          name: 'Default Channel',
          importance: AndroidImportance.HIGH,
          sound: 'default',
        });
        await notifee.displayNotification({
          title: notification.title || 'EaMax',
          body: notification.body || '',
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
          data: data && typeof data === 'object' ? data : {},
        });
      }
    } catch (err) {
      console.warn('Background notification display failed:', err?.message || err);
    }
  });
} catch (err) {
  console.warn('Firebase messaging not available:', err?.message || err);
}

AppRegistry.registerComponent(appName, () => App);
