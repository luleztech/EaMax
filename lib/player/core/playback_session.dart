import '../../models/channel_playback.dart';
import '../../models/remote_config_bundle.dart';

/// Unified playback session — single source of truth for one channel open.
class PlaybackSession {
  const PlaybackSession({
    required this.channelId,
    required this.channelName,
    required this.primaryStream,
    required this.fallbackStreams,
    required this.channelData,
    required this.policy,
    this.playbackEngineOverride,
  });

  final int channelId;
  final String channelName;
  final PlaybackStream primaryStream;
  final List<PlaybackStream> fallbackStreams;
  final Map<String, dynamic> channelData;
  final RemotePlayerConfig policy;
  final String? playbackEngineOverride;

  String get url => primaryStream.url;

  String? get effectiveEngine =>
      playbackEngineOverride ?? policy.preferredEngine;

  factory PlaybackSession.fromBundle(ChannelPlaybackBundle bundle) {
    final primary = bundle.primary!;
    final backups = bundle.streams.length > 1
        ? bundle.streams.sublist(1)
        : <PlaybackStream>[];
    final channelData = bundle.channelDataForStream(primary);
    final policy = bundle.playerConfig ?? RemotePlayerConfig.fromJson(const {});
    return PlaybackSession(
      channelId: bundle.channelId,
      channelName: bundle.name,
      primaryStream: primary,
      fallbackStreams: backups,
      channelData: channelData,
      policy: policy,
      playbackEngineOverride: bundle.effectiveEngine,
    );
  }
}
