import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../models/channel_playback.dart';
import '../models/remote_config_bundle.dart';

/// Opens the Kotlin [PlayerManager] stack on Android (see `android/.../com/eamax/player/`).
class NativeAndroidPlayer {
  NativeAndroidPlayer._();

  static const _channel = MethodChannel('com.eamax/native_player');

  static bool get supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  static Future<void> open({
    required String url,
    int? channelId,
    String? channelName,
    String licenseUrl = '',
    String token = '',
    String drmType = 'NONE',
    String clearKeyHex = '',
    Map<String, String>? headers,
    List<PlaybackStream>? fallbackStreams,
    String? playbackEngine,
    String? audioLanguage,
    RemotePlayerConfig? playerPolicy,
  }) async {
    if (!supported) return;

    final fallbackJson = _encodeFallbackStreams(fallbackStreams);

    await _channel.invokeMethod<void>('open', <String, dynamic>{
      'url': url,
      'channelId': ?channelId,
      'channelName': ?channelName,
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
      'audioLanguage': (audioLanguage == null || audioLanguage.isEmpty) ? 'sw' : audioLanguage,
      if (playerPolicy != null) 'playerPolicyJson': jsonEncode(_policyToMap(playerPolicy)),
    });
  }

  /// Push server-driven player settings to Kotlin [RemotePlayerConfigHolder].
  static Future<void> syncPlayerConfig({
    required String preferredEngine,
    required int bufferMinMs,
    required int bufferMaxMs,
    required int initialBufferMs,
    required int retryMax,
    required int retryDelayMs,
    required bool reconnectEnabled,
    required bool autoPlay,
    required String defaultQuality,
    required bool failoverToWebview,
    required bool hardwareAcceleration,
    required bool softwareDecodeFallback,
    required bool backgroundPlayback,
    required bool resumePlayback,
    required int networkTimeoutMs,
    required String reconnectionPolicy,
  }) async {
    if (!supported) return;
    await _channel.invokeMethod<void>('updatePlayerConfig', <String, dynamic>{
      'preferredEngine': preferredEngine,
      'bufferMinMs': bufferMinMs,
      'bufferMaxMs': bufferMaxMs,
      'initialBufferMs': initialBufferMs,
      'retryMax': retryMax,
      'retryDelayMs': retryDelayMs,
      'reconnectEnabled': reconnectEnabled,
      'autoPlay': autoPlay,
      'defaultQuality': defaultQuality,
      'failoverToWebview': failoverToWebview,
      'hardwareAcceleration': hardwareAcceleration,
      'softwareDecodeFallback': softwareDecodeFallback,
      'backgroundPlayback': backgroundPlayback,
      'resumePlayback': resumePlayback,
      'networkTimeoutMs': networkTimeoutMs,
      'reconnectionPolicy': reconnectionPolicy,
    });
  }

  static Map<String, dynamic> _policyToMap(RemotePlayerConfig policy) => {
    'preferredEngine': policy.preferredEngine,
    'bufferMinMs': policy.bufferMinMs,
    'bufferMaxMs': policy.bufferMaxMs,
    'initialBufferMs': policy.initialBufferMs,
    'retryMax': policy.retryMax,
    'retryDelayMs': policy.retryDelayMs,
    'reconnectEnabled': policy.reconnectEnabled,
    'autoPlay': policy.autoPlay,
    'defaultQuality': policy.defaultQuality,
    'failoverToWebview': policy.failoverToWebview,
    'hardwareAcceleration': policy.hardwareAcceleration,
    'softwareDecodeFallback': policy.softwareDecodeFallback,
    'backgroundPlayback': policy.backgroundPlayback,
    'resumePlayback': policy.resumePlayback,
    'networkTimeoutMs': policy.networkTimeoutMs,
    'reconnectionPolicy': policy.reconnectionPolicy,
  };

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
