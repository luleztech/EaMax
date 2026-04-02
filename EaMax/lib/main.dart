import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:media_kit/media_kit.dart';

import 'app/streaming_app.dart';
import 'firebase_options.dart';
import 'services/fcm_notifications.dart';
import 'register_webview_for_web_stub.dart'
    if (dart.library.html) 'register_webview_for_web.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  registerWebViewPlatformForWeb();
  try {
    MediaKit.ensureInitialized();
  } catch (e, st) {
    // Web may lack media_kit web libs; Android/desktop should not fail here.
    if (kIsWeb) {
      debugPrint('MediaKit.ensureInitialized failed on web (playback may be limited): $e\n$st');
    } else {
      rethrow;
    }
  }
  if (kIsWeb) {
    // No Web app in Firebase yet; FCM / AdMob are mobile-only for this project.
  } else {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    await MobileAds.instance.initialize();
  }
  runApp(const EamaxApp());
}

class EamaxApp extends StatelessWidget {
  const EamaxApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EaMax',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      builder: (context, child) {
        // Ensure no platform/browser default underline leaks via inherited text styles.
        return DefaultTextStyle.merge(
          style: const TextStyle(decoration: TextDecoration.none),
          child: child ?? const SizedBox.shrink(),
        );
      },
      home: const AnnotatedRegion(
        value: SystemUiOverlayStyle(
          statusBarBrightness: Brightness.dark,
          statusBarIconBrightness: Brightness.light,
          statusBarColor: Color(0xFF030712),
        ),
        child: StreamingApp(),
      ),
    );
  }
}
