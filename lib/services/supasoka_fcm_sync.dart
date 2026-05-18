import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging_platform_interface/firebase_messaging_platform_interface.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../firebase_supasoka_options.dart';

const _supasokaAppName = 'supasoka';
const _prefsSupasokaTopicKey = 'eamax_supasoka_direct_topic_v1';

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

FirebaseMessagingPlatform? _supasokaMessagingPlatform() {
  if (!Firebase.apps.any((a) => a.name == _supasokaAppName)) return null;
  return FirebaseMessagingPlatform.instanceFor(
    app: Firebase.app(_supasokaAppName),
    pluginConstants: {},
  );
}

String _directUserTopic(String publicId) {
  final clean = publicId.trim().replaceAll(RegExp(r'[^a-zA-Z0-9\-_.~%]'), '_');
  return 'user_$clean';
}

/// Subscribe to SupaAdmin FCM topics on the Supasoka Firebase project.
Future<void> syncSupasokaFcmTopics(
  String publicId, {
  bool isPremium = false,
}) async {
  if (kIsWeb || publicId.trim().isEmpty) return;
  if (!await ensureSupasokaFirebaseApp()) return;

  final messaging = _supasokaMessagingPlatform();
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

/// Supasoka FCM setup (topics only). Foreground tray alerts for SupaAdmin also
/// arrive via the EaMax HTTP bridge on the default Firebase app.
Future<void> ensureSupasokaPushReady(
  String publicId, {
  bool isPremium = false,
}) async {
  await syncSupasokaFcmTopics(publicId, isPremium: isPremium);
}
