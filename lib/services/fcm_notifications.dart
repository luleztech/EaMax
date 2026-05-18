import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/api.dart';
import '../firebase_options.dart';
import 'supasoka_fcm_sync.dart';
import 'user_id.dart' as user_id;

/// Must match [AndroidManifest] `com.google.firebase.messaging.default_notification_channel_id`.
const kFcmAndroidChannelId = 'eamax_high_priority';
const kFcmAndroidChannelName = 'EaMax Arifa';
const kFcmAndroidChannelDesc = 'Arifa za channel na matukio';

const _prefsUserIdKey = 'userId';
const _prefsLegacyUserIdKey = '@eamax:userId';
const _prefsDirectTopicKey = 'eamax_direct_user_topic_v1';

StreamSubscription<String>? _tokenRefreshSub;
bool _eamaxListenersBound = false;

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

/// Background isolate — EaMax Firebase project (EaAdmin pushes).
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

  final title = message.notification?.title ?? message.data['title'] ?? 'EaMax';
  final body = message.notification?.body ??
      message.data['body'] ??
      message.data['message'] ??
      '';
  if (body.isEmpty) return;
  await showEamaxLocalNotification(
    title: title,
    body: body,
    notificationId: nid,
    messageId: message.messageId,
  );
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

String _directUserTopic(String publicId) {
  final clean = publicId.trim().replaceAll(RegExp(r'[^a-zA-Z0-9\-_.~%]'), '_');
  return 'user_$clean';
}

/// True when the OS allows showing notifications (Android 13+ POST_NOTIFICATIONS + FCM auth).
Future<bool> isEamaxNotificationPermissionGranted() async {
  if (kIsWeb) return false;
  if (defaultTargetPlatform == TargetPlatform.android) {
    await _ensureLocalNotificationsPlugin();
    final android = _local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    final enabled = await android?.areNotificationsEnabled();
    if (enabled == false) return false;
  }
  final settings = await FirebaseMessaging.instance.getNotificationSettings();
  return settings.authorizationStatus == AuthorizationStatus.authorized ||
      settings.authorizationStatus == AuthorizationStatus.provisional;
}

/// Request OS notification permission (call after user taps Allow on our modal).
Future<bool> requestEamaxNotificationPermission() async {
  if (kIsWeb) return false;
  await ensureAndroidNotificationChannel();

  if (defaultTargetPlatform == TargetPlatform.android) {
    final android = _local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    final granted = await android?.requestNotificationsPermission();
    if (granted == false) return false;
  }

  final settings = await FirebaseMessaging.instance.requestPermission(
    alert: true,
    badge: true,
    sound: true,
    provisional: false,
  );
  if (kDebugMode) {
    debugPrint('[FCM] Permission result: ${settings.authorizationStatus}');
  }
  return settings.authorizationStatus == AuthorizationStatus.authorized ||
      settings.authorizationStatus == AuthorizationStatus.provisional;
}

/// Subscribe EaMax Firebase topics + register token with EaMax backend (EaAdmin pushes).
Future<void> syncEamaxFcmDelivery(String publicId) async {
  if (kIsWeb || publicId.trim().isEmpty) return;
  final uid = publicId.trim();
  final messaging = FirebaseMessaging.instance;

  try {
    await messaging.subscribeToTopic('all_users');
  } catch (_) {}

  try {
    final topic = _directUserTopic(uid);
    final prefs = await SharedPreferences.getInstance();
    final old = prefs.getString(_prefsDirectTopicKey);
    if (old != null && old.isNotEmpty && old != topic) {
      try {
        await messaging.unsubscribeFromTopic(old);
      } catch (_) {}
    }
    await messaging.subscribeToTopic(topic);
    await prefs.setString(_prefsDirectTopicKey, topic);
  } catch (_) {}

  try {
    final tok = await messaging.getToken();
    if (tok != null && tok.isNotEmpty) {
      await userApi.registerFcmToken(uid, tok);
    }
  } catch (_) {}
}

void bindEamaxFcmTokenRefresh(String publicId) {
  if (kIsWeb || publicId.trim().isEmpty) return;
  _tokenRefreshSub?.cancel();
  _tokenRefreshSub = FirebaseMessaging.instance.onTokenRefresh.listen((tok) {
    if (tok.isEmpty) return;
    unawaited(userApi.registerFcmToken(publicId.trim(), tok));
    unawaited(ensureEamaxPushReady(publicId.trim()));
  });
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

Future<void> showEamaxLocalNotification({
  required String title,
  required String body,
  int? notificationId,
  String? messageId,
}) async {
  await ensureAndroidNotificationChannel();
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  final id = messageId != null && messageId.isNotEmpty
      ? messageId.hashCode & 0x7fffffff
      : DateTime.now().millisecondsSinceEpoch & 0x7fffffff;
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

/// EaMax Firebase foreground listener (EaAdmin + bridge pushes on eamax project).
Future<void> bindEamaxFcmForegroundListener() async {
  if (kIsWeb || _eamaxListenersBound) return;
  _eamaxListenersBound = true;

  await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(
    alert: true,
    badge: true,
    sound: true,
  );

  FirebaseMessaging.onMessage.listen((RemoteMessage message) async {
    unawaited(_trackRemoteMessage(message, openedFromTray: false));

    final n = message.notification;
    final title = n?.title ?? message.data['title'] ?? 'EaMax';
    final body = n?.body ?? message.data['body'] ?? message.data['message'] ?? '';
    if (body.isEmpty) return;
    final nid = int.tryParse(message.data['notificationId'] ?? '');
    await showEamaxLocalNotification(
      title: title,
      body: body,
      notificationId: nid,
      messageId: message.messageId,
    );
  });

  FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
    unawaited(_trackRemoteMessage(message, openedFromTray: true));
  });

  final initial = await FirebaseMessaging.instance.getInitialMessage();
  if (initial != null) {
    await _trackRemoteMessage(initial, openedFromTray: true);
  }
}

/// Register both Firebase projects after permission is granted.
Future<void> ensureEamaxPushReady(
  String publicId, {
  bool isPremium = false,
}) async {
  if (kIsWeb || publicId.trim().isEmpty) return;
  final granted = await isEamaxNotificationPermissionGranted();
  if (!granted) return;

  await bindEamaxFcmForegroundListener();
  bindEamaxFcmTokenRefresh(publicId);
  await syncEamaxFcmDelivery(publicId);
  await ensureSupasokaPushReady(publicId, isPremium: isPremium);
}

/// Channel + listeners only (no permission dialog).
Future<void> setupFcmLocalNotifications() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  await ensureAndroidNotificationChannel();
  await bindEamaxFcmForegroundListener();
}
