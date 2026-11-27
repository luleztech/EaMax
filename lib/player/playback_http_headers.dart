import './cdn_token_headers.dart';
import '../services/remote_config_service.dart';
import 'stream_url_utils.dart';

const _chromeMobileUa =
    'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

String _pageUserAgent() {
  final ua = RemoteConfigService.playerConfig.gatewayPolicy.pageUserAgent.trim();
  return ua.isNotEmpty ? ua : _chromeMobileUa;
}

String _appPackageHeader() {
  final pkg = RemoteConfigService.playerConfig.gatewayPolicy.appPackageHeader.trim();
  // Never advertise this app's own id — embed hosts only recognise the Washa package.
  if (pkg.isEmpty || pkg.toLowerCase().contains('eamax')) return 'com.washatv';
  return pkg;
}

/// Direct HLS/DASH/file URLs. Browser page headers (`Origin`, `Sec-Fetch-Dest: document`)
/// make these servers answer 403. Token CDNs and `.php` gateways still need those headers.
bool isDirectMediaUrl(String rawUrl) {
  final u = rawUrl.trim();
  if (u.isEmpty) return false;
  if (u.toLowerCase().contains('.php')) return false;
  if (CdnTokenHeaders.isTokenizedCdnUrl(u)) return false;
  final uri = Uri.tryParse(u);
  if (uri == null) return false;
  final scheme = uri.scheme.toLowerCase();
  if (scheme != 'http' && scheme != 'https') return false;
  // Extension, ?format= hints, `;params`, trailing `/`, upper-case / %-encoded names and
  // raw IPTV panel links all count as direct media (same rules as native classifier).
  return hasMediaSignature(u);
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
    final headers = <String, String>{
      'User-Agent': _pageUserAgent(),
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9,sw;q=0.8',
      'Connection': 'keep-alive',
    };
    // Bare-IP IPTV panels often 403 without a matching Referer.
    final host = parsed.host;
    if (RegExp(r'^\d{1,3}(?:\.\d{1,3}){3}$').hasMatch(host)) {
      final origin = '${parsed.scheme}://${parsed.authority}';
      headers['Referer'] = '$origin/';
      headers['Origin'] = origin;
    }
    return headers;
  }

  final cdnOrigin = '${parsed.scheme}://${parsed.authority}';
  final tokenHeaders = CdnTokenHeaders.refererOriginForUrl(u);
  final referer = tokenHeaders?['referer'] ?? '$cdnOrigin/';
  final origin = tokenHeaders?['origin'] ?? cdnOrigin;

  final headers = <String, String>{
    'Referer': referer,
    'Origin': origin,
    'User-Agent': _pageUserAgent(),
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
  // Admin-managed package marker (Control Center → gateway policy).
  final lower = u.toLowerCase();
  if (lower.contains('.php') ||
      lower.contains('.html') ||
      lower.contains('.htm') ||
      lower.contains('/embed/') ||
      lower.contains('/gateway/') ||
      lower.contains('/player/') ||
      lower.contains('/play/')) {
    headers['X-Requested-With'] = _appPackageHeader();
  }
  return headers;
}

/// Merges API-provided headers over URL-derived defaults (playback API wins).
Map<String, String> mergePlaybackHeaders(
  String streamUrl, [
  Map<String, dynamic>? fromApi,
]) {
  final merged = Map<String, String>.from(playbackHttpHeaders(streamUrl));
  // API header names win and replace defaults case-insensitively (no `referer` + `Referer`).
  void put(String k, String v) {
    merged.removeWhere((existing, _) => existing.toLowerCase() == k.toLowerCase());
    merged[k] = v;
  }

  if (fromApi != null) {
    fromApi.forEach((key, value) {
      final k = key.toString().trim();
      final v = value?.toString().trim() ?? '';
      if (k.isNotEmpty && v.isNotEmpty) put(k, v);
    });
  }
  final direct = isDirectMediaUrl(streamUrl);
  final xrw = merged.keys.where((k) => k.toLowerCase() == 'x-requested-with').toList();
  if (direct) {
    // CDNs 403 the package marker on plain media requests.
    for (final k in xrw) {
      merged.remove(k);
    }
  } else if (xrw.any((k) => merged[k]!.toLowerCase().contains('eamax'))) {
    put('X-Requested-With', _appPackageHeader());
  }
  if (direct) {
    merged.removeWhere((key, _) => _browserOnlyHeader(key));
    final host = Uri.tryParse(streamUrl.trim())?.host.toLowerCase() ?? '';
    final isBareIp = RegExp(r'^\d{1,3}(?:\.\d{1,3}){3}$').hasMatch(host);
    // Keep Referer/Origin for bare-IP IPTV (they 403 without it).
    if (host.isNotEmpty && !isBareIp) {
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
