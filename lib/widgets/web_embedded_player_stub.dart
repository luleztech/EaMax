import 'package:flutter/material.dart';

import '../player/web_playback_config.dart';

/// Stub — real implementation is on Flutter Web only.
class WebEmbeddedPlayer extends StatefulWidget {
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
  State<WebEmbeddedPlayer> createState() => _WebEmbeddedPlayerStubState();
}

class _WebEmbeddedPlayerStubState extends State<WebEmbeddedPlayer> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      widget.onLoadingChanged?.call(false);
      widget.onError?.call('');
    });
  }

  @override
  Widget build(BuildContext context) {
    return const ColoredBox(
      color: Colors.black,
      child: Center(
        child: CircularProgressIndicator(color: Colors.white54),
      ),
    );
  }
}
