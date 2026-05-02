import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

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
  }) async {
    if (!supported) return;
    await _channel.invokeMethod<void>('open', <String, dynamic>{
      'url': url,
      'licenseUrl': licenseUrl,
      'token': token,
      'drmType': drmType,
      'clearKeyHex': clearKeyHex,
      // Kotlin merges these — supports alternate backend keys without exposing errors to users.
      'drmClearKey': clearKeyHex,
      'drm_clear_key': clearKeyHex,
      'headersJson': headers == null || headers.isEmpty ? '' : jsonEncode(headers),
    });
  }
}
