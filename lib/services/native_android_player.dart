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
    String? playbackEngine,
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
      if (playbackEngine != null && playbackEngine.isNotEmpty)
        'playbackEngine': playbackEngine,
    });
  }

  /// Launch VLC or MX Player with stream URL (admin engine: vlc / mx).
  static Future<bool> openExternal({
    required String engine,
    required String url,
    String licenseUrl = '',
    String token = '',
    String drmType = 'NONE',
    String clearKeyHex = '',
    Map<String, String>? headers,
  }) async {
    if (!supported) return false;
    try {
      final result = await _channel.invokeMethod<bool>('openExternal', <String, dynamic>{
        'engine': engine,
        'url': url,
        'licenseUrl': licenseUrl,
        'token': token,
        'drmType': drmType,
        'clearKeyHex': clearKeyHex,
        'headersJson': headers == null || headers.isEmpty ? '' : jsonEncode(headers),
      });
      return result == true;
    } catch (e) {
      debugPrint('[NativeAndroidPlayer] openExternal failed: $e');
      return false;
    }
  }

  /// Push server-driven player settings to Kotlin [RemotePlayerConfigHolder].
  static Future<void> syncPlayerConfig({
    required String preferredEngine,
    required int bufferMinMs,
    required int bufferMaxMs,
    required int retryMax,
    required int retryDelayMs,
    required bool reconnectEnabled,
    required bool autoPlay,
    required String defaultQuality,
    required bool failoverToWebview,
  }) async {
    if (!supported) return;
    await _channel.invokeMethod<void>('updatePlayerConfig', <String, dynamic>{
      'preferredEngine': preferredEngine,
      'bufferMinMs': bufferMinMs,
      'bufferMaxMs': bufferMaxMs,
      'retryMax': retryMax,
      'retryDelayMs': retryDelayMs,
      'reconnectEnabled': reconnectEnabled,
      'autoPlay': autoPlay,
      'defaultQuality': defaultQuality,
      'failoverToWebview': failoverToWebview,
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
