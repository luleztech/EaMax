import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../config/api.dart';
import '../firebase_options.dart';
import 'user_id.dart';

/// Must match [AndroidManifest] `com.google.firebase.messaging.default_notification_channel_id`.
const kFcmAndroidChannelId = 'eamax_high_priority';
const kFcmAndroidChannelName = 'EaMax Arifa';
const kFcmAndroidChannelDesc = 'Arifa za channel na matukio';

final FlutterLocalNotificationsPlugin _local = FlutterLocalNotificationsPlugin();

bool _channelReady = false;

String? _notificationIdFromMessage(RemoteMessage message) {
  final data = message.data;
  final id = data['notificationId'] ?? data['notification_id'];
  final v = id?.toString().trim();
  if (v == null || v.isEmpty) return null;
  return v;
}

Future<void> _confirmDeliveredFromMessage(RemoteMessage message) async {
  final notificationId = _notificationIdFromMessage(message);
  if (notificationId == null) return;
  try {
    final externalId = await getOrCreateUserId();
    if (externalId == null || externalId.isEmpty) return;
    await notificationsApi.confirmDelivery(notificationId, externalId);
  } catch (_) {}
}

Future<void> _recordClickFromMessage(RemoteMessage message) async {
  final notificationId = _notificationIdFromMessage(message);
  if (notificationId == null) return;
  try {
    final externalId = await getOrCreateUserId();
    if (externalId == null || externalId.isEmpty) return;
    await notificationsApi.recordClick(notificationId, externalId);
  } catch (_) {}
}

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  if (kIsWeb) return;
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  await ensureAndroidNotificationChannel();
  await _confirmDeliveredFromMessage(message);
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
  await _local.initialize(
    settings: init,
    onDidReceiveNotificationResponse: (details) async {
      final payload = details.payload;
      if (payload == null || payload.isEmpty) return;
      final notificationId = payload.trim();
      if (notificationId.isEmpty) return;
      try {
        final externalId = await getOrCreateUserId();
        if (externalId == null || externalId.isEmpty) return;
        await notificationsApi.recordClick(notificationId, externalId);
      } catch (_) {}
    },
  );
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

Future<void> _showLocal(
  int id,
  String title,
  String body, {
  String? notificationId,
}) async {
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
    payload: notificationId,
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

  // Ensure every active install receives topic broadcasts from backend.
  try {
    await FirebaseMessaging.instance.subscribeToTopic('all_users');
  } catch (_) {}

  await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(
    alert: true,
    badge: true,
    sound: true,
  );

  FirebaseMessaging.onMessage.listen((RemoteMessage message) async {
    await _confirmDeliveredFromMessage(message);
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
    await _showLocal(
      _notifId(message),
      title,
      body,
      notificationId: _notificationIdFromMessage(message),
    );
  });

  FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) async {
    await _confirmDeliveredFromMessage(message);
    await _recordClickFromMessage(message);
  });

  final initial = await FirebaseMessaging.instance.getInitialMessage();
  if (initial != null) {
    await _confirmDeliveredFromMessage(initial);
    await _recordClickFromMessage(initial);
  }
}
