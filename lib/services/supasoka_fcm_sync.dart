import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../firebase_supasoka_options.dart';
import 'fcm_notifications.dart';

const _supasokaAppName = 'supasoka';
const _prefsSupasokaTopicKey = 'eamax_supasoka_direct_topic_v1';

bool _listenersBound = false;

Future<bool> ensureSupasokaFirebaseApp() async {
  if (kIsWeb || !SupasokaFirebaseOptions.isConfigured) return false;
  try {
    if (Firebase.apps.any((a) => a.name == _supasokaAppName)) return true;
    await Firebase.initializeApp(
      name: _supasokaAppName,
      options: SupasokaFirebaseOptions.android,
    );
    if (kDebugMode) {
      debugPrint('[SupasokaFCM] Secondary Firebase app initialized');
    }
    return true;
  } catch (e, st) {
    if (kDebugMode) {
      debugPrint('[SupasokaFCM] Init failed: $e\n$st');
    }
    return false;
  }
}

FirebaseMessaging? _supasokaMessaging() {
  if (!Firebase.apps.any((a) => a.name == _supasokaAppName)) return null;
  return FirebaseMessaging.instanceFor(app: Firebase.app(_supasokaAppName));
}

String _directUserTopic(String publicId) {
  final clean = publicId.trim().replaceAll(RegExp(r'[^a-zA-Z0-9\-_.~%]'), '_');
  return 'user_$clean';
}

/// Subscribe to SupaAdmin FCM topics on the Supasoka Firebase project (instant delivery).
Future<void> syncSupasokaFcmTopics(
  String publicId, {
  bool isPremium = false,
}) async {
  if (kIsWeb || publicId.trim().isEmpty) return;
  if (!await ensureSupasokaFirebaseApp()) return;

  final messaging = _supasokaMessaging();
  if (messaging == null) return;

  try {
    await messaging.subscribeToTopic('all_users');
    if (isPremium) {
      await messaging.subscribeToTopic('premium_users');
      await messaging.unsubscribeFromTopic('free_users');
    } else {
      await messaging.subscribeToTopic('free_users');
      await messaging.unsubscribeFromTopic('premium_users');
    }
    final topic = _directUserTopic(publicId);
    final prefs = await SharedPreferences.getInstance();
    final old = prefs.getString(_prefsSupasokaTopicKey);
    if (old != null && old.isNotEmpty && old != topic) {
      try {
        await messaging.unsubscribeFromTopic(old);
      } catch (_) {}
    }
    await messaging.subscribeToTopic(topic);
    await prefs.setString(_prefsSupasokaTopicKey, topic);
    if (kDebugMode) {
      debugPrint('[SupasokaFCM] Topics synced for $publicId');
    }
  } catch (e) {
    if (kDebugMode) debugPrint('[SupasokaFCM] Topic sync failed: $e');
  }
}

/// Show SupaAdmin pushes in foreground (secondary Firebase app).
Future<void> bindSupasokaFcmForegroundListener() async {
  if (kIsWeb || _listenersBound) return;
  if (!await ensureSupasokaFirebaseApp()) return;
  final messaging = _supasokaMessaging();
  if (messaging == null) return;

  _listenersBound = true;
  messaging.onMessage.listen((RemoteMessage message) async {
    final n = message.notification;
    final title = n?.title ?? message.data['title'] ?? 'EaMax';
    final body = n?.body ?? message.data['body'] ?? message.data['message'] ?? '';
    if (body.isEmpty) return;
    await showEamaxLocalNotification(
      title: title,
      body: body,
      notificationId: null,
    );
  });
}

/// Full Supasoka-side setup after notification permission is granted.
Future<void> ensureSupasokaPushReady(
  String publicId, {
  bool isPremium = false,
}) async {
  await bindSupasokaFcmForegroundListener();
  await syncSupasokaFcmTopics(publicId, isPremium: isPremium);
}
