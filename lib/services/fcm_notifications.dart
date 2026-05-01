import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../firebase_options.dart';

/// Must match [AndroidManifest] `com.google.firebase.messaging.default_notification_channel_id`.
const kFcmAndroidChannelId = 'eamax_high_priority';
const kFcmAndroidChannelName = 'EaMax Arifa';
const kFcmAndroidChannelDesc = 'Arifa za channel na matukio';

final FlutterLocalNotificationsPlugin _local = FlutterLocalNotificationsPlugin();

bool _channelReady = false;

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  if (kIsWeb) return;
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  await ensureAndroidNotificationChannel();
  // Background + notification payload: Android shows the system notification using
  // default_notification_channel_id (high importance in manifest).
  // Data-only: we must show a local notification.
  if (message.notification == null) {
    final title = message.data['title'] ?? 'EaMax';
    final body = message.data['body'] ?? message.data['message'] ?? '';
    if (body.isEmpty) return;
    await _showLocal(
      _notifId(message),
      title,
      body,
    );
  }
}

int _notifId(RemoteMessage message) {
  final mid = message.messageId;
  if (mid != null && mid.isNotEmpty) {
    return mid.hashCode & 0x7fffffff;
  }
  return DateTime.now().millisecondsSinceEpoch & 0x7fffffff;
}

Future<void> ensureAndroidNotificationChannel() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  if (_channelReady) return;
  const init = InitializationSettings(
    android: AndroidInitializationSettings('@mipmap/ic_launcher'),
  );
  await _local.initialize(settings: init);
  final android = _local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
  await android?.createNotificationChannel(
    const AndroidNotificationChannel(
      kFcmAndroidChannelId,
      kFcmAndroidChannelName,
      description: kFcmAndroidChannelDesc,
      importance: Importance.max,
      playSound: true,
      enableVibration: true,
      showBadge: true,
    ),
  );
  _channelReady = true;
}

Future<void> _showLocal(int id, String title, String body) async {
  await ensureAndroidNotificationChannel();
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  await _local.show(
    id: id,
    title: title,
    body: body,
    notificationDetails: const NotificationDetails(
      android: AndroidNotificationDetails(
        kFcmAndroidChannelId,
        kFcmAndroidChannelName,
        channelDescription: kFcmAndroidChannelDesc,
        importance: Importance.max,
        priority: Priority.high,
        playSound: true,
        enableVibration: true,
        icon: '@mipmap/ic_launcher',
      ),
    ),
  );
}

/// Call after [Firebase.initializeApp]. Registers channel, permission, and foreground listener.
Future<void> setupFcmLocalNotifications() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;

  await ensureAndroidNotificationChannel();

  final settings = await FirebaseMessaging.instance.requestPermission(
    alert: true,
    badge: true,
    sound: true,
    provisional: false,
  );
  if (kDebugMode) {
    debugPrint('FCM permission: ${settings.authorizationStatus}');
  }

  final androidPlugin = _local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
  await androidPlugin?.requestNotificationsPermission();

  await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(
    alert: true,
    badge: true,
    sound: true,
  );

  FirebaseMessaging.onMessage.listen((RemoteMessage message) async {
    final n = message.notification;
    if (n != null) {
      await _showLocal(
        _notifId(message),
        n.title ?? 'EaMax',
        n.body ?? '',
      );
      return;
    }
    final title = message.data['title'] ?? 'EaMax';
    final body = message.data['body'] ?? message.data['message'] ?? '';
    if (body.isEmpty) return;
    await _showLocal(_notifId(message), title, body);
  });
}
