import 'package:flutter/material.dart';

import '../player/web_playback_config.dart';

/// Stub — real implementation is on Flutter Web only.
class WebEmbeddedPlayer extends StatelessWidget {
  const WebEmbeddedPlayer({
    super.key,
    required this.config,
    this.onLoadingChanged,
    this.onError,
    this.onPlaying,
  });

  final WebPlaybackConfig config;
  final ValueChanged<bool>? onLoadingChanged;
  final ValueChanged<String>? onError;
  final VoidCallback? onPlaying;

  @override
  Widget build(BuildContext context) {
    return const ColoredBox(
      color: Colors.black,
      child: Center(
        child: Text(
          'Web player unavailable on this platform',
          style: TextStyle(color: Colors.white54),
        ),
      ),
    );
  }
}
