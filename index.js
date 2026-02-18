/**
 * @format
 */

import { AppRegistry } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';

// Register background message handler
// This must be called outside of any React component lifecycle
// This handles notifications when the app is in the background or completely closed
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  console.log('Message handled in the background!', remoteMessage);
  
  // Import notifee dynamically to avoid issues
  const notifee = require('@notifee/react-native').default;
  const { AndroidImportance } = require('@notifee/react-native');
  
  const { notification, data } = remoteMessage;
  
  if (notification) {
    // Display notification using Notifee
    await notifee.displayNotification({
      title: notification.title || 'EaMax',
      body: notification.body || '',
      android: {
        channelId: 'default',
        importance: AndroidImportance.HIGH,
        pressAction: {
          id: 'default',
        },
        sound: 'default',
        // Ensure notification shows in status bar
        smallIcon: 'ic_notification',
        showTimestamp: true,
        autoCancel: true,
        ongoing: false,
      },
      data: data || {},
    });
  }
});

AppRegistry.registerComponent(appName, () => App);
