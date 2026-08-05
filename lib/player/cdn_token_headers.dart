import 'dart:convert';

/// Azam / Nagra CDN URLs embed a signed `tok_<jwt>` segment. The JWT payload
/// includes a `url` field that must be sent as [Referer] and [Origin].
class CdnTokenHeaders {
  CdnTokenHeaders._();

  static final _tokPattern = RegExp(r'/tok_([^.]+)\.([^.]+)\.([^/]+)/');

  /// Returns `{referer, origin}` when [rawUrl] contains a parsable CDN token.
  static Map<String, String>? refererOriginForUrl(String rawUrl) {
    final match = _tokPattern.firstMatch(rawUrl.trim());
    if (match == null) return null;
    final payloadSegment = match.group(2);
    if (payloadSegment == null || payloadSegment.isEmpty) return null;
    try {
      final bytes = base64Url.decode(base64Url.normalize(payloadSegment));
      final decoded = jsonDecode(utf8.decode(bytes));
      if (decoded is! Map) return null;
      final allowed = (decoded['url'] ?? decoded['referer'] ?? decoded['origin'])
          ?.toString()
          .trim();
      if (allowed == null || allowed.isEmpty) return null;
      final uri = Uri.tryParse(allowed);
      if (uri == null || !uri.hasScheme || uri.host.isEmpty) return null;
      final port = (uri.hasPort && uri.port != 80 && uri.port != 443)
          ? ':${uri.port}'
          : '';
      final origin = '${uri.scheme}://${uri.host}$port';
      final referer = origin.endsWith('/') ? origin : '$origin/';
      return {'referer': referer, 'origin': origin};
    } catch (_) {
      return null;
    }
  }

  static bool isTokenizedCdnUrl(String? rawUrl) {
    if (rawUrl == null || rawUrl.trim().isEmpty) return false;
    return _tokPattern.hasMatch(rawUrl.trim());
  }
}
