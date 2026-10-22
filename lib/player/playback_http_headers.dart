import './cdn_token_headers.dart';

const _chromeMobileUa =
    'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

/// Direct HLS/DASH/file URLs. Browser page headers (`Origin`, `Sec-Fetch-Dest: document`)
/// make these servers answer 403. Token CDNs and `.php` gateways still need those headers.
bool isDirectMediaUrl(String rawUrl) {
  final u = rawUrl.trim();
  if (u.isEmpty) return false;
  if (u.toLowerCase().contains('.php')) return false;
  if (CdnTokenHeaders.isTokenizedCdnUrl(u)) return false;
  final uri = Uri.tryParse(u);
  if (uri == null) return false;
  final path = uri.path.toLowerCase();
  return path.endsWith('.m3u8') ||
      path.endsWith('.m3u') ||
      path.endsWith('.mpd') ||
      path.endsWith('.mp4') ||
      path.endsWith('.m4v') ||
      path.endsWith('.ts') ||
      path.endsWith('.mkv') ||
      path.endsWith('.webm');
}

/// CDNs / `.php` gateways often reject players without browser-like headers.
/// Tokenized Azam/Nagra URLs (`tok_<jwt>`) require Referer/Origin from the JWT `url` field.
/// Direct media (HTTP and HTTPS `.m3u8` / `.mpd` / files) uses player headers only.
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

  if (isDirectMediaUrl(u)) {
    return const {
      'User-Agent': _chromeMobileUa,
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9,sw;q=0.8',
      'Connection': 'keep-alive',
    };
  }

  final cdnOrigin = '${parsed.scheme}://${parsed.authority}';
  final tokenHeaders = CdnTokenHeaders.refererOriginForUrl(u);
  final referer = tokenHeaders?['referer'] ?? '$cdnOrigin/';
  final origin = tokenHeaders?['origin'] ?? cdnOrigin;

  final headers = <String, String>{
    'Referer': referer,
    'Origin': origin,
    'User-Agent': _chromeMobileUa,
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
  if (isDirectMediaUrl(streamUrl)) {
    merged.removeWhere((key, _) => _browserOnlyHeader(key));
    final host = Uri.tryParse(streamUrl.trim())?.host.toLowerCase() ?? '';
    if (host.isNotEmpty) {
      final origin = merged['Origin'] ?? merged['origin'];
      final referer = merged['Referer'] ?? merged['referer'];
      if (origin != null && origin.toLowerCase().contains(host)) {
        merged.remove('Origin');
        merged.remove('origin');
      }
      if (referer != null && referer.toLowerCase().contains(host)) {
        merged.remove('Referer');
        merged.remove('referer');
      }
    }
    merged['Accept'] = '*/*';
  }
  return merged;
}

bool _browserOnlyHeader(String key) {
  switch (key.toLowerCase()) {
    case 'sec-fetch-dest':
    case 'sec-fetch-mode':
    case 'sec-fetch-site':
    case 'sec-fetch-user':
    case 'upgrade-insecure-requests':
    case 'sec-ch-ua':
    case 'sec-ch-ua-mobile':
    case 'sec-ch-ua-platform':
      return true;
    default:
      return false;
  }
}
