import 'dart:convert';

/// Decrypted stream payload from PHP / HTML gateway pages (mirrors Kotlin [PhpGatewayExtractor]).
class GatewayExtracted {
  const GatewayExtracted({
    required this.streamUrl,
    this.isHls = false,
    this.licenseUrl = '',
    this.authToken = '',
    this.clearKeyRaw = '',
  });

  final String streamUrl;
  final bool isHls;
  final String licenseUrl;
  final String authToken;
  final String clearKeyRaw;
}

/// Port of Android [PhpGatewayExtractor] for Flutter Web / mobile WebView fetch path.
class GatewayStreamExtractor {
  static const _streamFields = [
    'encryptedMpd',
    'encryptedStream',
    'encryptedUrl',
    'encryptedHls',
    'encryptedDash',
    'encryptedManifest',
  ];
  static const _licenseFields = [
    'encryptedLicense',
    'encryptedLicence',
    'encryptedDrm',
    'encryptedWidevine',
    'encryptedLicenseUrl',
  ];
  static const _tokenFields = [
    'encryptedToken',
    'encryptedAuth',
    'encryptedAuthToken',
  ];
  static const _keyFields = ['keyPart', 'key', 'xorKey', 'decryptKey'];
  static const _clearKeyFields = [
    'encryptedClearKey',
    'encryptedClearKeys',
    'encryptedKeys',
  ];

  static GatewayExtracted? extract(String html) {
    if (html.isEmpty) return null;
    final blocked = html.trim().toLowerCase() == 'blocked' ||
        (html.length < 200 && html.toLowerCase().contains('blocked'));
    if (blocked) return null;

    final fields = _parseFields(html, requireStream: true);
    if (fields != null) return _toExtracted(fields);

    final inline = _extractInlineDrm(html);
    if (inline != null && inline.streamUrl.isNotEmpty) return inline;

    return null;
  }

  /// License / token when stream URL is already known (network intercept path).
  static GatewayExtracted? extractDrmFromHtml(String html, {String fallbackStreamUrl = ''}) {
    final fields = _parseFields(html, requireStream: false);
    if (fields != null &&
        (fields.licenseUrl.isNotEmpty ||
            fields.authToken.isNotEmpty ||
            fields.clearKeyRaw.isNotEmpty)) {
      final stream = fields.streamUrl.isNotEmpty ? fields.streamUrl : fallbackStreamUrl;
      if (stream.isEmpty) return null;
      return GatewayExtracted(
        streamUrl: stream,
        isHls: stream.toLowerCase().contains('.m3u8'),
        licenseUrl: fields.licenseUrl,
        authToken: fields.authToken,
        clearKeyRaw: fields.clearKeyRaw,
      );
    }
    return _extractInlineDrm(html, fallbackStreamUrl: fallbackStreamUrl);
  }

  static GatewayExtracted? extractFromHtml(String html, String fallbackStreamUrl) {
    return extract(html) ??
        extractDrmFromHtml(html, fallbackStreamUrl: fallbackStreamUrl);
  }

  static GatewayExtracted _toExtracted(_ParsedFields fields) {
    return GatewayExtracted(
      streamUrl: fields.streamUrl,
      isHls: fields.streamUrl.toLowerCase().contains('.m3u8'),
      licenseUrl: fields.licenseUrl,
      authToken: fields.authToken,
      clearKeyRaw: fields.clearKeyRaw,
    );
  }

  static _ParsedFields? _parseFields(String html, {required bool requireStream}) {
    final keyPart = _pickQuoted(html, _keyFields);
    if (keyPart == null || keyPart.isEmpty) return null;

    String streamUrl = '';
    for (final name in _streamFields) {
      final enc = _pickQuoted(html, [name]);
      if (enc != null && enc.isNotEmpty) {
        streamUrl = _xorDecrypt(enc, keyPart);
        if (streamUrl.isNotEmpty) break;
      }
    }

    if (requireStream && (streamUrl.isEmpty || !streamUrl.toLowerCase().startsWith('http'))) {
      return null;
    }

    var licenseUrl = '';
    for (final name in _licenseFields) {
      final enc = _pickQuoted(html, [name]);
      if (enc != null && enc.isNotEmpty) {
        licenseUrl = _xorDecrypt(enc, keyPart);
        if (licenseUrl.isNotEmpty) break;
      }
    }

    var authToken = '';
    for (final name in _tokenFields) {
      final enc = _pickQuoted(html, [name]);
      if (enc != null && enc.isNotEmpty) {
        authToken = _xorDecrypt(enc, keyPart);
        if (authToken.isNotEmpty) break;
      }
    }

    var clearKeyRaw = '';
    for (final name in _clearKeyFields) {
      final enc = _pickQuoted(html, [name]);
      if (enc != null && enc.isNotEmpty) {
        clearKeyRaw = _xorDecrypt(enc, keyPart);
        if (clearKeyRaw.isNotEmpty) break;
      }
    }

    return _ParsedFields(
      streamUrl: streamUrl,
      licenseUrl: licenseUrl,
      authToken: authToken,
      clearKeyRaw: clearKeyRaw,
    );
  }

  static GatewayExtracted? _extractInlineDrm(String html, {String fallbackStreamUrl = ''}) {
    final licenseUrl = _extractInlineLicenseUrl(html);
    var authToken = '';
    for (final name in _tokenFields) {
      final v = _pickQuoted(html, [name]);
      if (v != null && v.isNotEmpty && !v.contains('=')) {
        authToken = v;
        break;
      }
    }
    if (licenseUrl.isEmpty && authToken.isEmpty) return null;
    final stream = fallbackStreamUrl;
    if (stream.isEmpty && licenseUrl.isEmpty) return null;
    return GatewayExtracted(
      streamUrl: stream,
      isHls: stream.toLowerCase().contains('.m3u8'),
      licenseUrl: licenseUrl,
      authToken: authToken,
    );
  }

  static String _extractInlineLicenseUrl(String html) {
    final patterns = [
      RegExp(r'''['"]com\.widevine\.alpha['"]\s*:\s*['"](https?://[^'"]+)['"]''', caseSensitive: false),
      RegExp(r'''['"]com\.widevine['"]\s*:\s*['"](https?://[^'"]+)['"]''', caseSensitive: false),
      RegExp(r'''licenseUrl\s*:\s*['"](https?://[^'"]+)['"]''', caseSensitive: false),
      RegExp(r'''Lic_?url\s*=\s*['"](https?://[^'"]+)['"]''', caseSensitive: false),
      RegExp(
        r'''(https?://[^\s"'<>]*(?:license|widevine|RightsManager|AcquireLicense|/wv/|/drm/)[^\s"'<>]*)''',
        caseSensitive: false,
      ),
    ];
    for (final re in patterns) {
      final url = re.firstMatch(html)?.group(1)?.trim() ?? '';
      if (url.toLowerCase().startsWith('http') &&
          !url.toLowerCase().contains('.js') &&
          !url.toLowerCase().contains('.css')) {
        return url;
      }
    }
    return '';
  }

  static String? _pickQuoted(String html, List<String> names) {
    for (final name in names) {
      final escaped = RegExp.escape(name);
      final patterns = [
        RegExp('$escaped[\\s=:]+"([^"]+)"', caseSensitive: false),
        RegExp("$escaped[\\s=:]+'([^']+)'", caseSensitive: false),
        RegExp('["\']$escaped["\']\\s*:\\s*"([^"]+)"', caseSensitive: false),
        RegExp('["\']$escaped["\']\\s*:\\s*\'([^\']+)\'', caseSensitive: false),
        RegExp('$escaped\\s*=\\s*`([^`]+)`', caseSensitive: false),
      ];
      for (final re in patterns) {
        final v = re.firstMatch(html)?.group(1)?.trim();
        if (v != null && v.isNotEmpty) return v;
      }
    }
    return null;
  }

  static String _xorDecrypt(String enc, String key) {
    if (enc.isEmpty || key.isEmpty) return '';
    try {
      final raw = base64.decode(enc);
      final out = List<int>.generate(raw.length, (i) => raw[i] ^ key.codeUnitAt(i % key.length));
      return utf8.decode(out, allowMalformed: true).trim();
    } catch (_) {
      return '';
    }
  }
}

class _ParsedFields {
  const _ParsedFields({
    this.streamUrl = '',
    this.licenseUrl = '',
    this.authToken = '',
    this.clearKeyRaw = '',
  });

  final String streamUrl;
  final String licenseUrl;
  final String authToken;
  final String clearKeyRaw;
}
