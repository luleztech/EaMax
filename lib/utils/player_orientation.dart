import 'package:flutter/services.dart';

/// Centralized orientation + immersive mode for home vs full-screen playback.
class PlayerOrientation {
  PlayerOrientation._();

  static const _allOrientations = [
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ];

  /// Home shell stays portrait; requires MainActivity `fullSensor` in the manifest.
  static Future<void> lockHomePortrait() async {
    await SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
    ]);
  }

  /// Full-screen player: allow rotation + hide system bars.
  static Future<void> enterFullscreenPlayer() async {
    await SystemChrome.setEnabledSystemUIMode(
      SystemUiMode.immersiveSticky,
      overlays: [],
    );
    await SystemChrome.setPreferredOrientations(_allOrientations);
  }

  static Future<void> exitFullscreenPlayer() async {
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    await lockHomePortrait();
  }
}
