import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../config/api.dart';
import '../../models/channel_playback.dart';
import '../../models/remote_config_bundle.dart';
import '../../services/native_android_player.dart';
import '../../services/player_engine.dart';
import '../../services/remote_config_service.dart';
import '../analytics/playback_analytics.dart';
import 'playback_session.dart';
import '../../screens/fullscreen_video_page.dart';
import '../../player/flutter_playback_mode.dart';
import '../../player/stream_url_utils.dart';

typedef ClearKeyExtractor = String Function(Map<String, dynamic>?);
typedef DrmNormalizer = String Function(Map<String, dynamic>?, String, String);
typedef TokenExtractor = String Function(Map<String, dynamic>?);
typedef HeadersExtractor = Map<String, String> Function(Map<String, dynamic>?);
typedef AudioLanguageExtractor = String Function(Map<String, dynamic>?);

/// Central playback engine — routes to native Kotlin or Flutter fallback
/// using fully admin-driven policy from the server.
class PlaybackOrchestrator {
  PlaybackOrchestrator._();

  static final PlaybackOrchestrator instance = PlaybackOrchestrator._();

  RemotePlayerConfig get _globalPolicy => RemoteConfigService.playerConfig;

  /// Resolves v2 playback bundle; returns null when channel unavailable.
  Future<PlaybackSession?> resolveSession(int channelId) async {
    try {
      final bundle = await channelsApi.getChannelPlayback(channelId);
      if (bundle.streams.isEmpty) return null;
      return PlaybackSession.fromBundle(bundle);
    } catch (_) {
      return null;
    }
  }

  /// Opens playback for a resolved session.
  Future<void> openSession({
    required BuildContext context,
    required PlaybackSession session,
    required ClearKeyExtractor extractClearKey,
    required DrmNormalizer normalizeDrm,
    required TokenExtractor extractToken,
    required HeadersExtractor extractHeaders,
    required AudioLanguageExtractor extractAudioLanguage,
  }) async {
    final url = session.url;
    if (url.isEmpty) return;

    unawaited(PlaybackAnalytics.trackChannelOpen(
      channelId: session.channelId,
      channelName: session.channelName,
      engine: session.effectiveEngine ?? _globalPolicy.preferredEngine,
    ));

    final policy = session.policy;
    unawaited(_syncNativePolicy(policy));

    final channelData = session.channelData;
    final gatewayPage = isGatewayUrl(url) || useWebViewForUrl(url);

    var engine = session.effectiveEngine != null && session.effectiveEngine!.isNotEmpty
        ? PlayerEngine.resolve(
            channelEngine: session.effectiveEngine,
            globalEngine: _globalPolicy.preferredEngine,
          )
        : PlayerEngine.resolveFromChannelData(channelData);

    engine = PlayerEngine.resolveInAppEngine(engine, gatewayPage: gatewayPage);

    final ck = extractClearKey(channelData);
    final drm = normalizeDrm(channelData, ck, url);
    final license = channelData['licenseUrl'] ?? channelData['license_url'];
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
        channelId: session.channelId,
        channelName: session.channelName,
        licenseUrl: license != null ? '$license' : '',
        token: token,
        drmType: drm,
        clearKeyHex: ck,
        headers: merged.isEmpty ? null : merged,
        fallbackStreams: session.fallbackStreams.isEmpty
            ? null
            : session.fallbackStreams,
        playbackEngine: engine,
        audioLanguage: audioLanguage,
        playerPolicy: policy,
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
          channelName: session.channelName,
          channelId: session.channelId,
          httpHeaders: merged.isEmpty ? null : merged,
          drmType: drm,
          licenseUrl: license != null ? '$license' : '',
          clearKeyRaw: ck,
          playbackToken: token,
          playbackMode: effectiveFlutterMode,
          audioLanguage: audioLanguage,
          defaultQuality: policy.defaultQuality,
        ),
      ),
    );
  }

  /// Legacy-compatible open from raw URL + channel data.
  Future<void> open({
    required BuildContext context,
    required String url,
    String? channelName,
    int? channelId,
    Map<String, dynamic>? channelData,
    List<PlaybackStream>? fallbackStreams,
    String? playbackEngineOverride,
    RemotePlayerConfig? policyOverride,
    required ClearKeyExtractor extractClearKey,
    required DrmNormalizer normalizeDrm,
    required TokenExtractor extractToken,
    required HeadersExtractor extractHeaders,
    required AudioLanguageExtractor extractAudioLanguage,
  }) async {
    if (url.isEmpty) return;

    final policy = policyOverride ?? _globalPolicy;
    unawaited(_syncNativePolicy(policy));

    if (channelId != null) {
      unawaited(PlaybackAnalytics.trackChannelOpen(
        channelId: channelId,
        channelName: channelName ?? '',
        engine: playbackEngineOverride ?? policy.preferredEngine,
      ));
    }

    final primary = PlaybackStream(
      priority: 0,
      url: url,
      drmType: (channelData?['drmType'] ?? channelData?['drm_type'] ?? 'NONE')
          .toString()
          .toUpperCase(),
      drmClearKey: channelData?['drmClearKey']?.toString() ??
          channelData?['drm_clear_key']?.toString(),
      licenseUrl: channelData?['licenseUrl']?.toString() ??
          channelData?['license_url']?.toString(),
      headers: extractHeaders(channelData),
    );

    final session = PlaybackSession(
      channelId: channelId ?? 0,
      channelName: channelName ?? '',
      primaryStream: primary,
      fallbackStreams: fallbackStreams ?? const [],
      channelData: channelData ?? const {},
      policy: policy,
      playbackEngineOverride: playbackEngineOverride,
    );

    if (!context.mounted) return;
    await openSession(
      context: context,
      session: session,
      extractClearKey: extractClearKey,
      normalizeDrm: normalizeDrm,
      extractToken: extractToken,
      extractHeaders: extractHeaders,
      extractAudioLanguage: extractAudioLanguage,
    );
  }

  Future<void> _syncNativePolicy(RemotePlayerConfig policy) async {
    if (!NativeAndroidPlayer.supported) return;
    try {
      await NativeAndroidPlayer.syncPlayerConfig(
        preferredEngine: policy.preferredEngine,
        bufferMinMs: policy.bufferMinMs,
        bufferMaxMs: policy.bufferMaxMs,
        initialBufferMs: policy.initialBufferMs,
        retryMax: policy.retryMax,
        retryDelayMs: policy.retryDelayMs,
        reconnectEnabled: policy.reconnectEnabled,
        autoPlay: policy.autoPlay,
        defaultQuality: policy.defaultQuality,
        failoverToWebview: policy.failoverToWebview,
        hardwareAcceleration: policy.hardwareAcceleration,
        softwareDecodeFallback: policy.softwareDecodeFallback,
        backgroundPlayback: policy.backgroundPlayback,
        resumePlayback: policy.resumePlayback,
        networkTimeoutMs: policy.networkTimeoutMs,
        reconnectionPolicy: policy.reconnectionPolicy,
      );
    } catch (e) {
      debugPrint('[PlaybackOrchestrator] native policy sync: $e');
    }
  }
}
