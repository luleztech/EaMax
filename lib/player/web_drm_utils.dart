import 'dart:convert';

/// ClearKey helpers for Shaka Player on web (base64url, no padding).
class WebDrmUtils {
  static Map<String, String>? parseClearKeys(String? raw) {
    if (raw == null || raw.trim().isEmpty) return null;
    final str = raw.trim();
    String kid;
    String key;
    if (str.contains(':')) {
      final p = str.split(':').map((s) => s.trim()).toList();
      kid = p[0];
      key = p.length > 1 ? p[1] : p[0];
    } else if (str.contains(',')) {
      final p = str.split(',').map((s) => s.trim()).toList();
      kid = p[0];
      key = p.length > 1 ? p[1] : p[0];
    } else if (str.startsWith('{')) {
      try {
        final o = jsonDecode(str) as Map<String, dynamic>;
        final keys = o['keys'];
        if (keys is List && keys.isNotEmpty) {
          final item = keys.first;
          if (item is Map) {
            kid = '${item['kid'] ?? ''}'.trim();
            key = '${item['k'] ?? item['key'] ?? ''}'.trim();
            if (kid.isNotEmpty && key.isNotEmpty) {
              return {_normalizePart(kid): _normalizePart(key)};
            }
          }
        }
      } catch (_) {}
      return null;
    } else {
      kid = str;
      key = str;
    }
    if (kid.isEmpty || key.isEmpty) return null;
    return {_normalizePart(kid): _normalizePart(key)};
  }

  static String _normalizePart(String part) {
    final raw = part.trim();
    final hex = raw.replaceAll(RegExp(r'[^0-9a-fA-F]'), '');
    if (hex.isNotEmpty && hex == raw && hex.length % 2 == 0) {
      return _hexToBase64Url(hex);
    }
    return raw
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll(RegExp(r'=+$'), '');
  }

  static String _hexToBase64Url(String hex) {
    final bytes = <int>[];
    for (var i = 0; i < hex.length; i += 2) {
      bytes.add(int.parse(hex.substring(i, i + 2), radix: 16));
    }
    return base64Url.encode(bytes).replaceAll('=', '');
  }
}
