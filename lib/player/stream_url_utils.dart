/// Stream URL classification aligned with native [StreamUrlClassifier] / RN VideoPlayer.
enum StreamFormat { dash, hls, progressive, gateway, unknown }

// Path-extension match tolerant of `;params`, a trailing `/` and upper-case names.
// Mirrors Kotlin StreamUrlClassifier.pathExtension / strongFormat.
const _hlsExt = {'m3u8', 'm3u', 'm3u8x'};
const _dashExt = {'mpd'};
const _progressiveExt = {
  'mp4', 'm4v', 'm4s', 'm4a', 'mov', 'webm', 'mkv', 'ts', 'm2ts', 'mts', '3gp', 'flv', 'avi',
  'mp3', 'aac', 'ogg', 'oga', 'ogv', 'opus', 'flac', 'wav',
};

String _pathExtension(String url) {
  var path = url.trim().split('#').first.split('?').first;
  try {
    path = Uri.decodeFull(path);
  } catch (_) {}
  path = path.split(';').first.toLowerCase();
  while (path.endsWith('/')) {
    path = path.substring(0, path.length - 1);
  }
  final afterScheme = path.contains('://') ? path.split('://').skip(1).join('://') : path;
  final slash = afterScheme.indexOf('/');
  if (slash < 0) return '';
  final name = afterScheme.substring(slash + 1).split('/').last;
  final dot = name.lastIndexOf('.');
  if (dot < 0 || dot == name.length - 1) return '';
  return name.substring(dot + 1);
}

String _query(String url) {
  final noFrag = url.trim().split('#').first;
  final i = noFrag.indexOf('?');
  return i < 0 ? '' : noFrag.substring(i + 1);
}

bool _hasObviousM3u8(String url) =>
    _hlsExt.contains(_pathExtension(url)) ||
    RegExp(r'(^|[?&])(format|type|output|ext|fmt|container|mode)=(m3u8?|hls|applehls)(\b|&|$)',
            caseSensitive: false)
        .hasMatch(_query(url));

bool _hasObviousMpd(String url) =>
    _dashExt.contains(_pathExtension(url)) ||
    RegExp(r'(^|[?&])(format|type|output|ext|fmt|container|mode)=(mpd|dash)(\b|&|$)',
            caseSensitive: false)
        .hasMatch(_query(url));

bool _hasObviousProgressive(String url) =>
    _progressiveExt.contains(_pathExtension(url)) ||
    RegExp(r'(^|[?&])(format|type|output|ext|fmt|container)=(mp4|ts|mkv|webm|mpegts)(\b|&|$)',
            caseSensitive: false)
        .hasMatch(_query(url));

bool isLikelyIptvLiveUrl(String url) {
  if (url.isEmpty) return false;
  if (_hasObviousM3u8(url) || _hasObviousMpd(url) || _hasObviousProgressive(url)) {
    return false;
  }
  final base = url.split('#').first.toLowerCase();
  if (RegExp(r'^https?://[^/]+:\d{2,5}/(live|stream|play|hls|iptv|channel|ch)/').hasMatch(base)) {
    return true;
  }
  if (RegExp(r'^https?://[^/]+:\d{2,5}/[^/]+/[^/]+/[^/?#]+$').hasMatch(base)) return true;
  if (RegExp(r'^https?://[^/]+/(live|stream|play|hls|iptv|channel|ch)/[^/?#]+').hasMatch(base)) {
    return true;
  }
  return false;
}

bool isGatewayUrl(String url) {
  if (_hasObviousM3u8(url) || _hasObviousMpd(url) || _hasObviousProgressive(url)) {
    return false;
  }
  // mpilali manifest.php serves DASH — not a gateway page.
  if (RegExp(r'/manifest\.php(\?|#|$)', caseSensitive: false).hasMatch(url)) {
    return false;
  }
  final u = url.toLowerCase();
  if (RegExp(r'\.(php|asp|aspx|cgi|jsp|html?)(\?|$|#)', caseSensitive: false).hasMatch(url)) {
    return true;
  }
  return u.contains('/embed/') ||
      u.contains('/gateway/') ||
      (u.contains('/stream/') && !_hasObviousM3u8(url) && !_hasObviousMpd(url)) ||
      (u.contains('/play/') && !_hasObviousM3u8(url) && !_hasObviousMpd(url)) ||
      u.contains('/player/');
}

StreamFormat detectStreamFormat(String url) {
  if (url.isEmpty) return StreamFormat.unknown;
  final u = url.toLowerCase();
  if (RegExp(r'\.mpd(\?|#|$)').hasMatch(u) ||
      RegExp(r'/manifest\.php(\?|#|$)').hasMatch(u) ||
      u.contains('dash') ||
      u.contains('/manifest') ||
      u.contains('/relay/stream') ||
      u.contains('/api/relay/')) {
    return StreamFormat.dash;
  }
  if (_hasObviousM3u8(url) || u.contains('hls') || u.contains('/relay/m3u8')) {
    return StreamFormat.hls;
  }
  if (_hasObviousProgressive(url)) {
    return StreamFormat.progressive;
  }
  if (isLikelyIptvLiveUrl(url)) return StreamFormat.hls;
  if (isGatewayUrl(url)) return StreamFormat.gateway;
  if (u.startsWith('http')) {
    if (RegExp(r'^https?://[^/]+:\d{2,5}/(live|stream|play|hls|iptv|channel|ch)/').hasMatch(u)) {
      return StreamFormat.hls;
    }
    if (RegExp(r'^https?://[^/]+:\d{2,5}/[^/]+/[^/]+/[^/?#]+$').hasMatch(u.split('#').first)) {
      return StreamFormat.hls;
    }
  }
  return StreamFormat.unknown;
}

bool useWebViewForUrl(String url) {
  if (_hasObviousM3u8(url) || _hasObviousMpd(url) || _hasObviousProgressive(url)) {
    return false;
  }
  if (isLikelyIptvLiveUrl(url)) return false;
  final l = url.toLowerCase();
  if (l.contains('.php') || l.contains('.html') || l.contains('.htm')) return true;
  if (l.contains('/embed/') || l.contains('/gateway/')) return true;
  if (l.contains('/player/') || l.contains('/play/')) return true;
  return false;
}
