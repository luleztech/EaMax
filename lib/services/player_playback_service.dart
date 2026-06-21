import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../models/channel_playback.dart';
import '../player/flutter_playback_mode.dart';
import '../player/stream_url_utils.dart';
import '../screens/fullscreen_video_page.dart';
import 'native_android_player.dart';
import 'player_engine.dart';
import 'remote_config_service.dart';

/// Opens playback using admin global + per-channel player engine settings.
class PlayerPlaybackService {
  PlayerPlaybackService._();

  static String get activeEngine =>
      PlayerEngine.normalize(RemoteConfigService.playerConfig.preferredEngine);

  static Future<void> open({
    required BuildContext context,
    required String url,
    String? channelName,
    Map<String, dynamic>? channelData,
    List<PlaybackStream>? fallbackStreams,
    String? playbackEngineOverride,
    required String Function(Map<String, dynamic>?) extractClearKey,
    required String Function(Map<String, dynamic>?, String, String) normalizeDrm,
    required String Function(Map<String, dynamic>?) extractToken,
    required Map<String, String> Function(Map<String, dynamic>?) extractHeaders,
    required String Function(Map<String, dynamic>?) extractAudioLanguage,
  }) async {
    if (url.isEmpty) return;

    final gatewayPage = isGatewayUrl(url) || useWebViewForUrl(url);

    var engine = playbackEngineOverride != null && playbackEngineOverride.isNotEmpty
        ? PlayerEngine.resolve(
            channelEngine: playbackEngineOverride,
            globalEngine: activeEngine,
          )
        : PlayerEngine.resolveFromChannelData(channelData);

    engine = PlayerEngine.resolveInAppEngine(engine, gatewayPage: gatewayPage);

    final ck = extractClearKey(channelData);
    final drm = normalizeDrm(channelData, ck, url);
    final license = channelData?['licenseUrl'] ?? channelData?['license_url'];
    final token = extractToken(channelData);
    final playbackHeaders = extractHeaders(channelData);
    final audioLanguage = extractAudioLanguage(channelData);
    final merged = Map<String, String>.from(playbackHeaders);
    if (token.isNotEmpty &&
        !merged.keys.any((k) => k.toLowerCase() == 'authorization')) {
      merged['Authorization'] = 'Bearer $token';
    }

    if (NativeAndroidPlayer.supported && PlayerEngine.usesNativeStack(engine)) {
      await NativeAndroidPlayer.open(
        url: url,
        licenseUrl: license != null ? '$license' : '',
        token: token,
        drmType: drm,
        clearKeyHex: ck,
        headers: merged.isEmpty ? null : merged,
        fallbackStreams: fallbackStreams,
        playbackEngine: engine,
        audioLanguage: audioLanguage,
      );
      return;
    }

    final flutterMode = PlayerEngine.flutterModeFor(engine) ??
        (kIsWeb ? FlutterPlaybackMode.webEmbedded : FlutterPlaybackMode.mediaKit);
    final effectiveFlutterMode = gatewayPage &&
            flutterMode != FlutterPlaybackMode.webEmbedded &&
            flutterMode != FlutterPlaybackMode.shaka
        ? FlutterPlaybackMode.webEmbedded
        : flutterMode;

    if (!context.mounted) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => FullscreenVideoPage(
          videoUrl: url,
          channelName: channelName,
          httpHeaders: merged.isEmpty ? null : merged,
          drmType: drm,
          licenseUrl: license != null ? '$license' : '',
          clearKeyRaw: ck,
          playbackToken: token,
          playbackMode: effectiveFlutterMode,
          audioLanguage: audioLanguage,
        ),
      ),
    );
  }
}
