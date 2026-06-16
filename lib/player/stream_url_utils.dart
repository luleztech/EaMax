/// Stream URL classification aligned with native [StreamUrlClassifier] / RN VideoPlayer.
enum StreamFormat { dash, hls, progressive, gateway, unknown }

bool _hasObviousM3u8(String url) =>
    RegExp(r'\.m3u8?(\?|#|$)', caseSensitive: false).hasMatch(url) ||
    RegExp(r'[?&](format|type)=m3u8?(\b|&|$)', caseSensitive: false).hasMatch(url);

bool _hasObviousMpd(String url) =>
    RegExp(r'\.mpd(\?|#|$)', caseSensitive: false).hasMatch(url);

bool _hasObviousProgressive(String url) =>
    RegExp(r'\.(mp4|m4v|webm|mkv|mov|ts)(\?|#|$)', caseSensitive: false).hasMatch(url);

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
