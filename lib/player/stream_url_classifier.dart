/// URL classification aligned with `/player/StreamUrlClassifier.kt` (EaMax gateway pages).
class StreamUrlClassifier {
  StreamUrlClassifier._();

  /// `.php` gateways — include `.php/` paths (many panels use `/play.php/channel`).
  static bool isPhpLikeUrl(String? url) {
    if (url == null || url.trim().isEmpty) return false;
    final u = url.toLowerCase();
    return RegExp(r'\.php(\$|[/?#])', caseSensitive: false).hasMatch(u);
  }

  /// PHP, ASP, /player/, /embed/ gateways — need in-app web player, not direct Exo.
  static bool isLikelyGatewayUrl(String? url) {
    if (url == null || url.trim().isEmpty) return false;
    final u = url.toLowerCase();
    return RegExp(r'\.(php|asp|aspx|cgi|jsp)(\?|#|\$|/)', caseSensitive: false).hasMatch(u) ||
        u.contains('/embed/') ||
        u.contains('/gateway/') ||
        u.contains('/stream/') ||
        u.contains('/play/') ||
        u.contains('/player/');
  }

  static bool needsWebPlayer(String url) {
    final u = url.trim();
    if (u.isEmpty) return false;
    final hasDirect = hasObviousM3u8(u) || hasObviousMpd(u) || hasObviousTs(u);
    return (isPhpLikeUrl(u) || isLikelyGatewayUrl(u)) && !hasDirect;
  }

  /// HLS — match `.m3u8` anywhere (path, redirect targets, signed URLs).
  static bool hasObviousM3u8(String url) {
    final u = url.toLowerCase();
    return u.contains('.m3u8');
  }

  /// DASH — match `.mpd` anywhere (manifest URLs, Widevine/ClearKey hosts).
  static bool hasObviousMpd(String url) {
    final u = url.toLowerCase();
    return u.contains('.mpd');
  }

  /// Direct-ish progressive / obvious stream hints when extension is nonstandard.
  static bool hasObviousTs(String url) {
    final u = url.toLowerCase();
    return u.contains('.ts?') || u.endsWith('.ts') || u.contains('.mp4?') || u.endsWith('.mp4');
  }
}

/// Same UA as [playbackHttpHeaders] / native ExoPlayer (real Chrome mobile — avoids bot checks).
const String kBrowserPlaybackUserAgent =
    'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
