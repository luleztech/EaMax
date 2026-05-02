import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/api.dart';
import '../firebase_options.dart';
import 'user_id.dart' as user_id;

/// Must match [AndroidManifest] `com.google.firebase.messaging.default_notification_channel_id`.
const kFcmAndroidChannelId = 'eamax_high_priority';
const kFcmAndroidChannelName = 'EaMax Arifa';
const kFcmAndroidChannelDesc = 'Arifa za channel na matukio';

const _prefsUserIdKey = 'userId';
const _prefsLegacyUserIdKey = '@eamax:userId';

final FlutterLocalNotificationsPlugin _local = FlutterLocalNotificationsPlugin();

bool _channelReady = false;
bool _pluginInitialized = false;

Future<String?> _readExternalIdFromPrefsOnly() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    for (final key in [_prefsUserIdKey, _prefsLegacyUserIdKey]) {
      final v = prefs.getString(key)?.trim();
      if (v != null && v.isNotEmpty) return v;
    }
  } catch (_) {}
  return null;
}

Future<void> _trackRemoteMessage(RemoteMessage message, {required bool openedFromTray}) async {
  final raw = message.data['notificationId'];
  final nid = int.tryParse(raw ?? '');
  if (nid == null) return;

  String? uid;
  try {
    uid = await user_id.getStoredUserId();
  } catch (_) {
    uid = await _readExternalIdFromPrefsOnly();
  }
  if (uid == null || uid.isEmpty) return;

  String? tok;
  try {
    tok = await FirebaseMessaging.instance.getToken();
  } catch (_) {}

  try {
    await notificationsApi.reportDelivered(nid, uid, fcmToken: tok);
    if (openedFromTray) {
      await notificationsApi.reportClick(nid, uid);
    }
  } catch (_) {}
}

/// Background isolate — avoid MethodChannel / full identity chain.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  if (kIsWeb) return;
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  final nid = int.tryParse(message.data['notificationId'] ?? '');
  final uid = await _readExternalIdFromPrefsOnly();
  if (nid != null && uid != null && uid.isNotEmpty) {
    String? tok;
    try {
      tok = await FirebaseMessaging.instance.getToken();
    } catch (_) {}
    try {
      await notificationsApi.reportDelivered(nid, uid, fcmToken: tok);
    } catch (_) {}
  }

  await ensureAndroidNotificationChannel();

  if (message.notification == null) {
    final title = message.data['title'] ?? 'EaMax';
    final body = message.data['body'] ?? message.data['message'] ?? '';
    if (body.isEmpty) return;
    await _showLocal(
      _notifId(message),
      title,
      body,
      notificationId: nid,
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

Future<void> _ensureLocalNotificationsPlugin() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  if (_pluginInitialized) return;
  await _local.initialize(
    settings: const InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    ),
    onDidReceiveNotificationResponse: _onLocalNotificationTapped,
  );
  _pluginInitialized = true;
}

void _onLocalNotificationTapped(NotificationResponse response) {
  final payload = response.payload;
  final nid = int.tryParse(payload ?? '');
  if (nid == null) return;
  Future<void> run() async {
    final uid = await user_id.getStoredUserId();
    if (uid == null || uid.isEmpty) return;
    String? tok;
    try {
      tok = await FirebaseMessaging.instance.getToken();
    } catch (_) {}
    try {
      await notificationsApi.reportDelivered(nid, uid, fcmToken: tok);
      await notificationsApi.reportClick(nid, uid);
    } catch (_) {}
  }

  unawaited(run());
}

Future<void> ensureAndroidNotificationChannel() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  if (_channelReady) return;
  await _ensureLocalNotificationsPlugin();
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
  int? notificationId,
}) async {
  await ensureAndroidNotificationChannel();
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  await _local.show(
    id: id,
    title: title,
    body: body,
    payload: notificationId != null ? '$notificationId' : null,
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

/// Call after [Firebase.initializeApp]. Registers channel, permission, foreground listener, and opens.
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
    unawaited(_trackRemoteMessage(message, openedFromTray: false));

    final n = message.notification;
    if (n != null) {
      final nid = int.tryParse(message.data['notificationId'] ?? '');
      await _showLocal(
        _notifId(message),
        n.title ?? 'EaMax',
        n.body ?? '',
        notificationId: nid,
      );
      return;
    }
    final title = message.data['title'] ?? 'EaMax';
    final body = message.data['body'] ?? message.data['message'] ?? '';
    if (body.isEmpty) return;
    final nid = int.tryParse(message.data['notificationId'] ?? '');
    await _showLocal(_notifId(message), title, body, notificationId: nid);
  });

  FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
    unawaited(_trackRemoteMessage(message, openedFromTray: true));
  });

  final initial = await FirebaseMessaging.instance.getInitialMessage();
  if (initial != null) {
    await _trackRemoteMessage(initial, openedFromTray: true);
  }
}
