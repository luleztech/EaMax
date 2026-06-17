import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:media_kit/media_kit.dart';
import 'package:provider/provider.dart';

import 'app/streaming_app.dart';
import 'config/app_version.dart';
import 'firebase_options.dart';
import 'services/fcm_notifications.dart';
import 'register_webview_for_web_stub.dart'
    if (dart.library.html) 'register_webview_for_web.dart';
import 'theme/app_theme.dart';
import 'utils/player_orientation.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (!kIsWeb) {
    await PlayerOrientation.lockHomePortrait();
  }
  await initAppVersion();
  registerWebViewPlatformForWeb();
  try {
    MediaKit.ensureInitialized();
  } catch (e, st) {
    if (kIsWeb) {
      debugPrint('MediaKit.ensureInitialized failed on web: $e\n$st');
    } else {
      rethrow;
    }
  }
  if (!kIsWeb) {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    await MobileAds.instance.initialize();
  }
  final themeController = await ThemeController.load();
  runApp(EamaxApp(themeController: themeController));
}

class EamaxApp extends StatelessWidget {
  const EamaxApp({super.key, required this.themeController});

  final ThemeController themeController;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: themeController),
        ChangeNotifierProvider(create: (_) => AppNav()),
      ],
      child: Consumer<ThemeController>(
        builder: (context, tc, _) {
          return MaterialApp(
            title: 'EaMax',
            debugShowCheckedModeBanner: false,
            theme: buildAppTheme(tc.colors),
            builder: (context, child) {
              return DefaultTextStyle.merge(
                style: const TextStyle(decoration: TextDecoration.none),
                child: child ?? const SizedBox.shrink(),
              );
            },
            home: const AnnotatedRegion<SystemUiOverlayStyle>(
              value: SystemUiOverlayStyle(
                statusBarBrightness: Brightness.dark,
                statusBarIconBrightness: Brightness.light,
                statusBarColor: Colors.transparent,
              ),
              child: StreamingApp(),
            ),
          );
        },
      ),
    );
  }
}
