import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../models/channel_playback.dart';

/// Opens the Kotlin [PlayerManager] stack on Android (see `android/.../com/eamax/player/`).
class NativeAndroidPlayer {
  NativeAndroidPlayer._();

  static const _channel = MethodChannel('com.eamax/native_player');

  static bool get supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  static Future<void> open({
    required String url,
    String licenseUrl = '',
    String token = '',
    String drmType = 'NONE',
    String clearKeyHex = '',
    Map<String, String>? headers,
    List<PlaybackStream>? fallbackStreams,
  }) async {
    if (!supported) return;

    final fallbackJson = _encodeFallbackStreams(fallbackStreams);

    await _channel.invokeMethod<void>('open', <String, dynamic>{
      'url': url,
      'licenseUrl': licenseUrl,
      'token': token,
      'drmType': drmType,
      'clearKeyHex': clearKeyHex,
      'drmClearKey': clearKeyHex,
      'drm_clear_key': clearKeyHex,
      'headersJson': headers == null || headers.isEmpty ? '' : jsonEncode(headers),
      if (fallbackJson.isNotEmpty) 'fallbackStreamsJson': fallbackJson,
    });
  }

  static String _encodeFallbackStreams(List<PlaybackStream>? streams) {
    if (streams == null || streams.isEmpty) return '';
    final payload = streams
        .where((s) => s.url.isNotEmpty)
        .map((s) => {
              'url': s.url,
              'licenseUrl': s.licenseUrl ?? '',
              'drmType': s.drmType,
              'clearKeyHex': s.drmClearKey ?? '',
              'drmClearKey': s.drmClearKey ?? '',
              'headers': s.headers,
            })
        .toList();
    if (payload.isEmpty) return '';
    return jsonEncode(payload);
  }
}
