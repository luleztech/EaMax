import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Android gateway web player — CORS-aware native WebView embedded in Flutter UI.
class GatewayWebPlayerView extends StatefulWidget {
  const GatewayWebPlayerView({
    super.key,
    required this.url,
    required this.headers,
    required this.onPlaybackError,
  });

  final String url;
  final Map<String, String> headers;
  final VoidCallback onPlaybackError;

  @override
  State<GatewayWebPlayerView> createState() => _GatewayWebPlayerViewState();
}

class _GatewayWebPlayerViewState extends State<GatewayWebPlayerView> {
  static const _viewType = 'com.eamax/gateway_web_player';
  static const _channel = MethodChannel('com.eamax/gateway_web_player');

  int? _viewId;

  @override
  void initState() {
    super.initState();
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      _channel.setMethodCallHandler(_onNativeCall);
    }
  }

  Future<void> _onNativeCall(MethodCall call) async {
    if (call.method != 'onError') return;
    final args = call.arguments;
    if (args is! Map) return;
    final errViewId = args['viewId'];
    if (_viewId != null && errViewId != _viewId) return;
    widget.onPlaybackError();
  }

  @override
  void dispose() {
    _channel.setMethodCallHandler(null);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) {
      return const SizedBox.shrink();
    }

    return AndroidView(
      viewType: _viewType,
      layoutDirection: TextDirection.ltr,
      gestureRecognizers: const <Factory<OneSequenceGestureRecognizer>>{},
      creationParams: <String, dynamic>{
        'url': widget.url,
        'headersJson': widget.headers.isEmpty ? '' : jsonEncode(widget.headers),
      },
      creationParamsCodec: const StandardMessageCodec(),
      onPlatformViewCreated: (id) => _viewId = id,
    );
  }
}
