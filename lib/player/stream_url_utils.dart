/// Stream URL classification aligned with native [StreamUrlClassifier] / RN VideoPlayer.
enum StreamFormat { dash, hls, progressive, gateway, unknown }

bool isGatewayUrl(String url) {
  final u = url.toLowerCase();
  if (RegExp(r'\.(php|asp|aspx|cgi|jsp)(\?|$|#)', caseSensitive: false).hasMatch(url)) {
    return true;
  }
  return u.contains('/embed/') ||
      u.contains('/gateway/') ||
      u.contains('/player/') ||
      u.contains('/play/');
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
  if (RegExp(r'\.m3u8(\?|#|$)|\.m3u(\?|#|$)').hasMatch(u) ||
      u.contains('hls') ||
      u.contains('/relay/m3u8')) {
    return StreamFormat.hls;
  }
  if (RegExp(r'\.(mp4|m4v|webm|mkv|mov|ts)(\?|#|$)').hasMatch(u)) {
    return StreamFormat.progressive;
  }
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
  final l = url.toLowerCase();
  if (l.contains('.php') || l.contains('.html') || l.contains('.htm')) return true;
  if (l.contains('/embed/') || l.contains('/gateway/')) return true;
  if (l.contains('/player/') || l.contains('/play/')) return true;
  return false;
}
