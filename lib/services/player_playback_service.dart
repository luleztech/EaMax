import 'package:flutter/material.dart';

import '../models/channel_playback.dart';
import '../models/remote_config_bundle.dart';
import '../player/core/playback_orchestrator.dart';
import 'player_engine.dart';
import 'remote_config_service.dart';

/// Opens playback using admin global + per-channel player engine settings.
/// Delegates to [PlaybackOrchestrator] — the unified playback entry point.
class PlayerPlaybackService {
  PlayerPlaybackService._();

  static final PlaybackOrchestrator _orchestrator = PlaybackOrchestrator.instance;

  static String get activeEngine =>
      PlayerEngine.normalize(RemoteConfigService.playerConfig.preferredEngine);

  static Future<void> open({
    required BuildContext context,
    required String url,
    String? channelName,
    int? channelId,
    Map<String, dynamic>? channelData,
    List<PlaybackStream>? fallbackStreams,
    String? playbackEngineOverride,
    RemotePlayerConfig? policyOverride,
    required String Function(Map<String, dynamic>?) extractClearKey,
    required String Function(Map<String, dynamic>?, String, String) normalizeDrm,
    required String Function(Map<String, dynamic>?) extractToken,
    required Map<String, String> Function(Map<String, dynamic>?) extractHeaders,
    required String Function(Map<String, dynamic>?) extractAudioLanguage,
  }) async {
    await _orchestrator.open(
      context: context,
      url: url,
      channelName: channelName,
      channelId: channelId,
      channelData: channelData,
      fallbackStreams: fallbackStreams,
      playbackEngineOverride: playbackEngineOverride,
      policyOverride: policyOverride,
      extractClearKey: extractClearKey,
      normalizeDrm: normalizeDrm,
      extractToken: extractToken,
      extractHeaders: extractHeaders,
      extractAudioLanguage: extractAudioLanguage,
    );
  }
}
