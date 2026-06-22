import '../player/flutter_playback_mode.dart';
import 'remote_config_service.dart';

/// Server-driven player engines (admin Control Center → config bundle → app).
class PlayerEngine {
  PlayerEngine._();

  static const auto = 'auto';
  static const kotlin = 'kotlin';
  static const exo = 'exo';
  static const webview = 'webview';
  static const webplayer = 'webplayer';
  static const shaka = 'shaka';
  static const flutter = 'flutter';
  static const chewie = 'chewie';
  static const nativeVideo = 'native_video';
  static const webrtc = 'webrtc';
  static const vlc = 'vlc';
  static const mx = 'mx';

  static const all = <String>{
    auto,
    kotlin,
    exo,
    webview,
    webplayer,
    shaka,
  };

  static const _deprecated = <String>{
    flutter,
    chewie,
    nativeVideo,
    webrtc,
    vlc,
    mx,
  };

  static String normalize(String? raw) {
    final e = (raw ?? auto).trim().toLowerCase();
    if (_deprecated.contains(e)) return auto;
    return all.contains(e) ? e : auto;
  }

  /// Channel override → global config fallback.
  static String resolve({
    String? channelEngine,
    String? globalEngine,
  }) {
    final channel = _optionalEngine(channelEngine);
    if (channel != null) return channel;
    return normalize(globalEngine ?? RemoteConfigService.playerConfig.preferredEngine);
  }

  static String? _optionalEngine(String? raw) {
    if (raw == null) return null;
    final e = raw.trim().toLowerCase();
    if (e.isEmpty || e == 'default' || e == 'global') return null;
    return all.contains(e) ? e : null;
  }

  static String resolveFromChannelData(Map<String, dynamic>? channelData) {
    if (channelData == null) return normalize(RemoteConfigService.playerConfig.preferredEngine);
    final effective = channelData['effectiveEngine'] ?? channelData['effective_engine'];
    final override = channelData['playbackEngine'] ??
        channelData['playback_engine'] ??
        effective;
    return resolve(
      channelEngine: override?.toString(),
      globalEngine: RemoteConfigService.playerConfig.preferredEngine,
    );
  }

  /// Maps every admin engine to an in-app player — never VLC/MX / system "Open with".
  static String resolveInAppEngine(String engine, {required bool gatewayPage}) {
    final e = normalize(engine);
    if (e == vlc || e == mx) {
      return gatewayPage ? webview : auto;
    }
    if (gatewayPage && (e == exo || e == auto || e == kotlin)) {
      return webview;
    }
    return e;
  }

  /// Kotlin [PlayerManager] / [EaMaxNativePlayerActivity].
  static bool usesNativeStack(String engine) {
    final e = normalize(engine);
    return e == auto ||
        e == kotlin ||
        e == exo ||
        e == webview ||
        e == webplayer ||
        e == shaka;
  }

  static bool usesExternalApp(String engine) {
    // All engines play in-app; kept for API compatibility.
    return false;
  }

  static bool usesFlutterStack(String engine) {
    final e = normalize(engine);
    return flutterModeFor(e) != null;
  }

  /// Maps admin engine → in-app Flutter playback backend.
  static FlutterPlaybackMode? flutterModeFor(String engine) {
    switch (normalize(engine)) {
      case flutter:
        return FlutterPlaybackMode.mediaKit;
      case shaka:
        return FlutterPlaybackMode.shaka;
      case webplayer:
        return FlutterPlaybackMode.webEmbedded;
      case chewie:
        return FlutterPlaybackMode.chewie;
      case nativeVideo:
        return FlutterPlaybackMode.nativeVideo;
      case webrtc:
        return FlutterPlaybackMode.mediaKit;
      default:
        return null;
    }
  }
}
