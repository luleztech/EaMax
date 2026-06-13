/// Extracts DASH / HLS URLs buried in HTML gateway pages.
class ManifestExtracted {
  const ManifestExtracted({required this.url, required this.isHls});

  final String url;
  final bool isHls;
}

class ManifestUrlExtractor {
  static const _htmlExtractMax = 524288;

  static ManifestExtracted? extract(String html, String baseUrl) {
    if (html.isEmpty || baseUrl.isEmpty) return null;
    final slice = html.length > _htmlExtractMax ? html.substring(0, _htmlExtractMax) : html;
    final found = <String>{};

    for (final m in RegExp(
      r'''["'`](https?://[^"'`\s<>]+)["'`]''',
      caseSensitive: false,
    ).allMatches(slice)) {
      _pushUrl(m.group(1)!, baseUrl, found);
    }
    for (final m in RegExp(
      r'''https?://[^\s"'<>()]+?\.(m3u8|mpd)(?:[?#][^\s"'<>()]*)?''',
      caseSensitive: false,
    ).allMatches(slice)) {
      _pushUrl(m.group(0)!, baseUrl, found);
    }
    for (final m in RegExp(
      r'''(?:src|href|file|url|source|streamUrl|playlistUrl|manifestUrl|hlsUrl|dashUrl)\s*[:=]\s*["']([^"']+)["']''',
      caseSensitive: false,
    ).allMatches(slice)) {
      _pushUrl(m.group(1)!, baseUrl, found);
    }
    for (final m in RegExp(
      r'''["'](\/?[\w\-./%]+\.(?:m3u8|mpd)(?:\?[^"'<>\s]*)?)["']''',
      caseSensitive: false,
    ).allMatches(slice)) {
      _pushUrl(m.group(1)!, baseUrl, found);
    }

    for (final u in found) {
      if (RegExp(r'\.m3u8(\?|$|#)', caseSensitive: false).hasMatch(u)) {
        return ManifestExtracted(url: u, isHls: true);
      }
    }
    for (final u in found) {
      if (RegExp(r'\.mpd(\?|$|#)', caseSensitive: false).hasMatch(u)) {
        return ManifestExtracted(url: u, isHls: false);
      }
    }
    return null;
  }

  static void _pushUrl(String raw, String baseUrl, Set<String> out) {
    var s = raw.trim();
    if (s.startsWith("'") || s.startsWith('`') || s.startsWith('"')) {
      s = s.substring(1);
    }
    if (s.endsWith("'") || s.endsWith('"')) {
      s = s.substring(0, s.length - 1);
    }
    if (s.isEmpty || s.startsWith('data:') || s.startsWith('javascript:')) return;
    s = s.replaceAll(r'\u0026', '&').replaceAll('&amp;', '&').replaceAll(r'\/', '/');
    try {
      final abs = s.startsWith('//')
          ? 'https:$s'
          : s.toLowerCase().startsWith('http')
              ? s
              : Uri.parse(baseUrl).resolve(s).toString();
      out.add(abs);
    } catch (_) {}
  }
}
