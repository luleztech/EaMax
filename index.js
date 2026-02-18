/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Register background message handler (must be outside React lifecycle)
// Handles notifications when app is in background or closed
try {
  const messaging = require('@react-native-firebase/messaging').default;
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    try {
      const notifee = require('@notifee/react-native').default;
      const { AndroidImportance } = require('@notifee/react-native');
      const { notification, data } = remoteMessage || {};
      if (notification) {
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
          data: data || {},
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
