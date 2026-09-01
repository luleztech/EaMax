import './cdn_token_headers.dart';

/// CDNs / `.php` gateways often reject players without browser-like headers.
/// Tokenized Azam/Nagra URLs (`tok_<jwt>`) require Referer/Origin from the JWT `url` field.
Map<String, String> playbackHttpHeaders(String rawUrl) {
  final u = rawUrl.trim();
  if (u.isEmpty) return const {};
  Uri parsed;
  try {
    parsed = Uri.parse(u);
  } catch (_) {
    return const {};
  }
  if (!parsed.hasScheme || !parsed.hasAuthority) return const {};

  final cdnOrigin = '${parsed.scheme}://${parsed.authority}';
  final tokenHeaders = CdnTokenHeaders.refererOriginForUrl(u);
  final referer = tokenHeaders?['referer'] ?? '$cdnOrigin/';
  final origin = tokenHeaders?['origin'] ?? cdnOrigin;

  final headers = <String, String>{
    'Referer': referer,
    'Origin': origin,
    'User-Agent':
        'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Connection': 'keep-alive',
    'Accept-Language': 'en-US,en;q=0.9,sw;q=0.8',
    'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,application/dash+xml,application/vnd.apple.mpegurl;q=0.8,*/*;q=0.7',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
  // Hostinger PHP gateways reject requests without the app package header.
  if (u.toLowerCase().contains('.php')) {
    headers['X-Requested-With'] = 'com.eamax';
  }
  return headers;
}

/// Merges API-provided headers over URL-derived defaults (playback API wins).
Map<String, String> mergePlaybackHeaders(
  String streamUrl, [
  Map<String, dynamic>? fromApi,
]) {
  final merged = Map<String, String>.from(playbackHttpHeaders(streamUrl));
  if (fromApi != null) {
    fromApi.forEach((key, value) {
      final k = key.toString().trim();
      final v = value?.toString().trim() ?? '';
      if (k.isNotEmpty && v.isNotEmpty) merged[k] = v;
    });
  }
  return merged;
}
