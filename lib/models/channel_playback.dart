class ChannelPlaybackBundle {
  const ChannelPlaybackBundle({
    required this.channelId,
    required this.name,
    required this.streams,
    this.playbackEngine,
    this.effectiveEngine,
    this.audioLanguage,
  });

  final int channelId;
  final String name;
  final List<PlaybackStream> streams;
  /// Per-channel override from admin (null = use global).
  final String? playbackEngine;
  /// Resolved engine: channel override or global default.
  final String? effectiveEngine;
  /// Admin-set stream audio language (`auto` = player default).
  final String? audioLanguage;

  PlaybackStream? get primary =>
      streams.isNotEmpty ? streams.first : null;

  factory ChannelPlaybackBundle.fromJson(Map<String, dynamic> json) {
    final rawStreams = json['streams'];
    final streams = rawStreams is List
        ? rawStreams
            .whereType<Map>()
            .map((e) => PlaybackStream.fromJson(Map<String, dynamic>.from(e)))
            .where((s) => s.url.isNotEmpty)
            .toList()
        : <PlaybackStream>[];
    streams.sort((a, b) => a.priority.compareTo(b.priority));
    final playbackEngine = _readEngine(json['playbackEngine'] ?? json['playback_engine']);
    final effectiveEngine = _readEngine(json['effectiveEngine']) ??
        _readEngine(json['playerConfig'] is Map
            ? (json['playerConfig'] as Map)['preferredEngine']
            : null) ??
        playbackEngine;
    final audioLanguage = _readAudioLanguage(json['audioLanguage'] ?? json['audio_language']);
    return ChannelPlaybackBundle(
      channelId: int.tryParse('${json['channelId']}') ?? 0,
      name: json['name']?.toString() ?? '',
      streams: streams,
      playbackEngine: playbackEngine,
      effectiveEngine: effectiveEngine,
      audioLanguage: audioLanguage,
    );
  }

  static String? _readEngine(Object? raw) {
    if (raw == null) return null;
    final e = raw.toString().trim().toLowerCase();
    if (e.isEmpty || e == 'default' || e == 'global') return null;
    return e;
  }

  static String? _readAudioLanguage(Object? raw) {
    if (raw == null) return 'sw';
    final lang = raw.toString().trim().toLowerCase();
    if (lang.isEmpty || lang == 'auto' || lang == 'default') return 'sw';
    return lang == 'en' ? 'en' : 'sw';
  }

  /// Maps v2 stream fields to the legacy channelData shape used by playback helpers.
  Map<String, dynamic> channelDataForStream(PlaybackStream stream) {
    return {
      'streamUrl': stream.url,
      'stream_url': stream.url,
      'drmType': stream.drmType,
      'drm_type': stream.drmType,
      'licenseUrl': stream.licenseUrl,
      'license_url': stream.licenseUrl,
      'drmClearKey': stream.drmClearKey,
      'drm_clear_key': stream.drmClearKey,
      'headers': stream.headers,
      'headersJson': stream.headers,
      if (playbackEngine != null) 'playbackEngine': playbackEngine,
      if (effectiveEngine != null) 'effectiveEngine': effectiveEngine,
      if (audioLanguage != null) 'audioLanguage': audioLanguage,
      if (audioLanguage != null) 'audio_language': audioLanguage,
    };
  }
}

class PlaybackStream {
  const PlaybackStream({
    required this.priority,
    required this.url,
    required this.drmType,
    this.drmClearKey,
    this.licenseUrl,
    this.headers = const {},
  });

  final int priority;
  final String url;
  final String drmType;
  final String? drmClearKey;
  final String? licenseUrl;
  final Map<String, String> headers;

  factory PlaybackStream.fromJson(Map<String, dynamic> json) {
    final rawHeaders = json['headers'];
    final headers = <String, String>{};
    if (rawHeaders is Map) {
      rawHeaders.forEach((key, value) {
        final k = key.toString().trim();
        final v = value?.toString().trim() ?? '';
        if (k.isNotEmpty && v.isNotEmpty) headers[k] = v;
      });
    }
    return PlaybackStream(
      priority: int.tryParse('${json['priority']}') ?? 0,
      url: json['url']?.toString().trim() ?? '',
      drmType: (json['drmType'] ?? json['drm_type'] ?? 'NONE').toString().toUpperCase(),
      drmClearKey: json['drmClearKey']?.toString() ?? json['drm_clear_key']?.toString(),
      licenseUrl: json['licenseUrl']?.toString() ?? json['license_url']?.toString(),
      headers: headers,
    );
  }
}
