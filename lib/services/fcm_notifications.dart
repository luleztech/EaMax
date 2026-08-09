import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/api.dart';
import '../config/payment_helpers.dart';
import '../firebase_options.dart';
import 'eamax_notification_queue.dart';
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

/// Set from [StreamingApp] — refreshes premium when payment/admin push arrives.
PremiumUnlockCallback? onPremiumUnlockRequested;

bool _isPremiumUnlockPushType(String? type) {
  final t = type?.trim().toLowerCase() ?? '';
  return t == 'payment_success' || t == 'admin_access_granted';
}

void _maybeRequestPremiumUnlock(RemoteMessage message) {
  final type = message.data['type']?.toString();
  if (!_isPremiumUnlockPushType(type)) return;

  Map<String, dynamic>? payload;
  final isPrem = message.data['isPremium'] ?? message.data['is_premium'];
  final expires = (message.data['premiumExpiresAt'] ?? message.data['subscriptionEndDate'])
      ?.toString()
      .trim();
  final externalId = (message.data['externalId'] ?? message.data['external_id'])?.toString().trim();
  // payment_success / admin_access_granted always means unlock — never wait for a flag.
  final active = isPrem == null || isPrem.isEmpty
      ? true
      : (isPrem == 'true' || isPrem == '1');
  payload = <String, dynamic>{
    'isPremium': active,
    'is_premium': active,
    'premiumGranted': true,
    if (expires != null && expires.isNotEmpty) 'premiumExpiresAt': expires,
    if (expires != null && expires.isNotEmpty) 'subscriptionEndDate': expires,
    if (externalId != null && externalId.isNotEmpty) 'externalId': externalId,
    if (externalId != null && externalId.isNotEmpty) 'external_id': externalId,
  };

  unawaited(onPremiumUnlockRequested?.call(userPayload: payload));
}

void _maybeHandleScheduleLive(RemoteMessage message, {bool open = false}) {
  final type = message.data['type']?.toString();
  if (type != 'schedule_live') return;
  final scheduleId = message.data['scheduleId']?.toString() ?? '';
  final channelId = message.data['channelId']?.toString() ?? '';
  final payload = 'schedule:$scheduleId:$channelId';
  if (open) {
    _dispatchSchedulePayload(payload);
  }
}

final FlutterLocalNotificationsPlugin _local = FlutterLocalNotificationsPlugin();

void _logFcm(String message) {
  if (kDebugMode) {
    debugPrint('[EaMaxFCM] $message');
  }
}

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
  } catch (e, st) {
    _logFcm('Failed to report remote message event nid=$nid uid=$uid opened=$openedFromTray: $e\n$st');
  }
}

Future<void> _reportQueuedDelivered(QueuedEamaxNotification item) async {
  final nid = item.notificationId;
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
    _logFcm('Reported delivery nid=$nid uid=$uid');
  } catch (e, st) {
    _logFcm('Failed to report delivery nid=$nid: $e\n$st');
  }
}

Future<void> _cancelTrayNotification() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  try {
    await _local.cancel(id: kEamaxTrayNotificationId, tag: 'eamax_broadcast');
  } catch (_) {}
}

Future<void> _enqueueRemoteTrayNotification({
  required String title,
  required String body,
  int? notificationId,
  String? messageId,
  RemoteMessage? message,
  String? payload,
}) async {
  if (body.isEmpty) return;
  if (message?.notification != null) {
    _logFcm('Skip local tray — OS notification payload nid=$notificationId');
    if (notificationId != null) {
      unawaited(_reportQueuedDelivered(QueuedEamaxNotification(
        title: title,
        body: body,
        notificationId: notificationId,
        messageId: messageId,
      )));
    }
    return;
  }

  await enqueueEamaxNotification(
    QueuedEamaxNotification(
      title: title,
      body: body,
      notificationId: notificationId,
      messageId: messageId,
    ),
    show: (item) => showEamaxLocalNotification(
      title: item.title,
      body: item.body,
      notificationId: item.notificationId,
      messageId: item.messageId,
      androidId: kEamaxTrayNotificationId,
      payload: payload,
    ),
    reportDelivered: _reportQueuedDelivered,
    cancelTray: _cancelTrayNotification,
  );
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
      _logFcm('Background handler token fetched for nid=$nid');
    } catch (e, st) {
      _logFcm('Background handler failed to fetch token: $e\n$st');
    }
    try {
      await notificationsApi.reportDelivered(nid, uid, fcmToken: tok);
      _logFcm('Background handler reported delivery nid=$nid uid=$uid');
    } catch (e, st) {
      _logFcm('Background handler failed to report delivered nid=$nid uid=$uid: $e\n$st');
    }
  }

  await ensureAndroidNotificationChannel();

  final title = message.notification?.title ?? message.data['title'] ?? 'EaMax';
  final body = message.notification?.body ??
      message.data['body'] ??
      message.data['message'] ??
      '';
  if (body.isEmpty) return;
  if (message.notification != null) {
    _logFcm('Background handler: OS notification payload nid=$nid');
    return;
  }
  await showEamaxLocalNotification(
    title: title,
    body: body,
    notificationId: nid,
    messageId: message.messageId,
    androidId: kEamaxTrayNotificationId,
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
  _logFcm('Local notification tapped payload=$payload');

  if (payload != null && payload.startsWith('schedule:')) {
    _dispatchSchedulePayload(payload);
    return;
  }

  final nid = int.tryParse(payload ?? '');
  if (nid == null) return;
  Future<void> run() async {
    final uid = await user_id.getStoredUserId();
    if (uid == null || uid.isEmpty) {
      _logFcm('Local notification tapped but no stored user id found');
      return;
    }
    String? tok;
    try {
      tok = await FirebaseMessaging.instance.getToken();
      _logFcm('Local notification tapped token fetched');
    } catch (e, st) {
      _logFcm('Local notification tapped token fetch failed: $e\n$st');
    }
    try {
      await notificationsApi.reportDelivered(nid, uid, fcmToken: tok);
      await notificationsApi.reportClick(nid, uid);
      _logFcm('Local notification tapped reported delivered/click nid=$nid uid=$uid');
    } catch (e, st) {
      _logFcm('Local notification tapped failed report nid=$nid uid=$uid: $e\n$st');
    }
  }

  unawaited(run());
}

void Function(String payload)? _onSchedulePayload;

/// Wired from [ratiba_reminders.dart] so we avoid circular imports in the tap path.
void setScheduleNotificationPayloadHandler(void Function(String payload)? handler) {
  _onSchedulePayload = handler;
}

void _dispatchSchedulePayload(String payload) {
  _onSchedulePayload?.call(payload);
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
  _logFcm('Notification permission result: ${settings.authorizationStatus}');
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
    _logFcm('Subscribed to all_users topic');
  } catch (e, st) {
    _logFcm('Failed to subscribe to all_users: $e\n$st');
  }

  try {
    final topic = _directUserTopic(uid);
    final prefs = await SharedPreferences.getInstance();
    final old = prefs.getString(_prefsDirectTopicKey);
    if (old != null && old.isNotEmpty && old != topic) {
      try {
        await messaging.unsubscribeFromTopic(old);
        _logFcm('Unsubscribed from legacy topic $old');
      } catch (e, st) {
        _logFcm('Failed to unsubscribe from legacy topic $old: $e\n$st');
      }
    }
    await messaging.subscribeToTopic(topic);
    _logFcm('Subscribed to direct user topic $topic');
    await prefs.setString(_prefsDirectTopicKey, topic);
  } catch (e, st) {
    _logFcm('Failed to sync direct user topic: $e\n$st');
  }

  try {
    final tok = await messaging.getToken();
    if (tok != null && tok.isNotEmpty) {
      await userApi.registerFcmToken(uid, tok);
      _logFcm('Registered FCM token for uid=$uid');
    }
  } catch (e, st) {
    _logFcm('Failed to register FCM token for uid=$uid: $e\n$st');
  }
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
  int? androidId,
  String? payload,
}) async {
  await ensureAndroidNotificationChannel();
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  final id = androidId ??
      (messageId != null && messageId.isNotEmpty
          ? messageId.hashCode & 0x7fffffff
          : DateTime.now().millisecondsSinceEpoch & 0x7fffffff);
  await _local.show(
    id: id,
    title: title,
    body: body,
    payload: payload ?? (notificationId != null ? '$notificationId' : null),
    notificationDetails: NotificationDetails(
      android: AndroidNotificationDetails(
        kFcmAndroidChannelId,
        kFcmAndroidChannelName,
        channelDescription: kFcmAndroidChannelDesc,
        importance: Importance.max,
        priority: Priority.high,
        playSound: true,
        enableVibration: true,
        icon: '@mipmap/ic_launcher',
        tag: androidId != null ? 'eamax_broadcast' : null,
      ),
    ),
  );
}

Future<void> scheduleLocalNotificationAt({
  required int id,
  required String title,
  required String body,
  required dynamic when,
  String? payload,
}) async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  await _ensureLocalNotificationsPlugin();
  await ensureAndroidNotificationChannel();
  await _local.zonedSchedule(
    id: id,
    title: title,
    body: body,
    scheduledDate: when,
    payload: payload,
    androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
    notificationDetails: NotificationDetails(
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

Future<void> cancelScheduledLocalNotification(int id) async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  await _ensureLocalNotificationsPlugin();
  await _local.cancel(id: id);
}

/// EaMax Firebase foreground listener (EaAdmin + bridge pushes on eamax project).
Future<void> bindEamaxFcmForegroundListener() async {
  if (kIsWeb || _eamaxListenersBound) return;
  _eamaxListenersBound = true;

  await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(
    alert: false,
    badge: true,
    sound: false,
  );

  FirebaseMessaging.onMessage.listen((RemoteMessage message) async {
    _logFcm('Foreground message received id=${message.messageId} data=${message.data}');
    _maybeRequestPremiumUnlock(message);
    _maybeHandleScheduleLive(message);

    final n = message.notification;
    final title = n?.title ?? message.data['title'] ?? 'EaMax';
    final body = n?.body ?? message.data['body'] ?? message.data['message'] ?? '';
    if (body.isEmpty) return;
    final nid = int.tryParse(message.data['notificationId'] ?? '');
    final scheduleId = message.data['scheduleId']?.toString();
    final channelId = message.data['channelId']?.toString() ?? '';
    final payload = (message.data['type']?.toString() == 'schedule_live' && scheduleId != null)
        ? 'schedule:$scheduleId:$channelId'
        : null;
    await _enqueueRemoteTrayNotification(
      title: title,
      body: body,
      notificationId: nid,
      messageId: message.messageId,
      message: message,
      payload: payload,
    );
  });

  FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
    _logFcm('Foreground message opened from tray id=${message.messageId} data=${message.data}');
    unawaited(_trackRemoteMessage(message, openedFromTray: true));
    _maybeRequestPremiumUnlock(message);
    _maybeHandleScheduleLive(message, open: true);
  });

  final initial = await FirebaseMessaging.instance.getInitialMessage();
  if (initial != null) {
    await _trackRemoteMessage(initial, openedFromTray: true);
    _maybeRequestPremiumUnlock(initial);
    _maybeHandleScheduleLive(initial, open: true);
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
  // Supasoka Firebase topics (SupaAdmin direct); bridge covers foreground on EaMax FCM.
  await ensureSupasokaPushReady(publicId, isPremium: isPremium);
}

/// Channel + listeners only (no permission dialog).
Future<void> setupFcmLocalNotifications() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  await ensureAndroidNotificationChannel();
  await bindEamaxFcmForegroundListener();
}
