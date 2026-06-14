/// Server-backed playback settings for Flutter Web (mirrors native [StreamSession]).
class WebPlaybackConfig {
  const WebPlaybackConfig({
    required this.url,
    this.headers = const {},
    this.drmType = 'NONE',
    this.licenseUrl = '',
    this.clearKeyRaw = '',
    this.token = '',
  });

  final String url;
  final Map<String, String> headers;
  final String drmType;
  final String licenseUrl;
  final String clearKeyRaw;
  final String token;

  String get normalizedDrmType {
    var d = drmType.trim().toUpperCase().replaceAll(RegExp(r'[\s\-]+'), '_');
    if (d == 'CLEAR_KEY') d = 'CLEARKEY';
    if (d.isNotEmpty && d != 'NONE') return d;
    if (clearKeyRaw.isNotEmpty) return 'CLEARKEY';
    return 'NONE';
  }

  bool get isClearKey => normalizedDrmType == 'CLEARKEY';
  bool get isWidevine => normalizedDrmType.startsWith('WIDEVINE');
  bool get isPlayReady => normalizedDrmType == 'PLAYREADY';

  WebPlaybackConfig copyWith({
    String? url,
    Map<String, String>? headers,
    String? drmType,
    String? licenseUrl,
    String? clearKeyRaw,
    String? token,
  }) {
    return WebPlaybackConfig(
      url: url ?? this.url,
      headers: headers ?? this.headers,
      drmType: drmType ?? this.drmType,
      licenseUrl: licenseUrl ?? this.licenseUrl,
      clearKeyRaw: clearKeyRaw ?? this.clearKeyRaw,
      token: token ?? this.token,
    );
  }
}
