import 'package:firebase_core/firebase_core.dart';

/// Supasoka Firebase project (`supasokatv-d238c`) — SupaAdmin FCM topics.
/// EaMax app `com.eamax` registered in same project as Supasoka viewer.
class SupasokaFirebaseOptions {
  static const String projectId = 'supasokatv-d238c';
  static const String messagingSenderId = '88812273490';
  static const String storageBucket = 'supasokatv-d238c.firebasestorage.app';
  static const String apiKey = 'AIzaSyA2TKmWfzwCBTVOkfjl8t3DTjobEnaHIFw';

  /// From Firebase → supasokatv-d238c → Android app `com.eamax`.
  static const String androidAppId = String.fromEnvironment(
    'SUPASOKA_EAMAX_APP_ID',
    defaultValue: '1:88812273490:android:b73045c5800cb02a43048b',
  );

  static bool get isConfigured =>
      androidAppId.trim().isNotEmpty && androidAppId.contains(':android:');

  static FirebaseOptions get android => FirebaseOptions(
        apiKey: apiKey,
        appId: androidAppId,
        messagingSenderId: messagingSenderId,
        projectId: projectId,
        storageBucket: storageBucket,
      );
}
