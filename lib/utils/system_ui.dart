import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// App-wide status bar: hidden by default. Swiping down from the top reveals it
/// (black background, light icons) and it hides again after [_revealDuration].
class AppSystemUi {
  AppSystemUi._();

  static const overlayStyle = SystemUiOverlayStyle(
    statusBarColor: Colors.black,
    statusBarIconBrightness: Brightness.light,
    statusBarBrightness: Brightness.dark,
  );

  static const _revealDuration = Duration(seconds: 3);
  static Timer? _rehide;
  static bool _fullscreen = false;

  static Future<void> init() async {
    if (kIsWeb) return;
    SystemChrome.setSystemUIOverlayStyle(overlayStyle);
    await SystemChrome.setSystemUIChangeCallback(_onOverlaysChanged);
    await hideStatusBar();
  }

  static Future<void> hideStatusBar() async {
    if (kIsWeb) return;
    await SystemChrome.setEnabledSystemUIMode(
      SystemUiMode.manual,
      overlays: const [SystemUiOverlay.bottom],
    );
  }

  /// The full-screen player owns system UI while active (immersive, both bars hidden).
  static void setFullscreen(bool value) {
    _fullscreen = value;
    if (value) _rehide?.cancel();
  }

  static Future<void> _onOverlaysChanged(bool visible) async {
    _rehide?.cancel();
    if (!visible || _fullscreen) return;
    _rehide = Timer(_revealDuration, () {
      if (!_fullscreen) unawaited(hideStatusBar());
    });
  }
}

/// Paints the status-bar area black; Android 15+ ignores `statusBarColor` under edge-to-edge.
class StatusBarBackdrop extends StatelessWidget {
  const StatusBarBackdrop({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.viewPaddingOf(context).top;
    return Stack(
      fit: StackFit.expand,
      alignment: Alignment.topLeft,
      textDirection: TextDirection.ltr,
      children: [
        child,
        if (top > 0)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: top,
            child: const IgnorePointer(child: ColoredBox(color: Colors.black)),
          ),
      ],
    );
  }
}
