import 'dart:convert';

/// Decrypted stream payload from PHP / HTML gateway pages (encryptedMpd pattern).
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

/// Port of [PhpWebViewSupport.gatewayStreamExtractScript] for Flutter Web fetch path.
class GatewayStreamExtractor {
  static GatewayExtracted? extract(String html) {
    if (!html.contains('encryptedMpd')) return null;

    if (html.trim().toLowerCase() == 'blocked' ||
        (html.length < 200 && html.toLowerCase().contains('blocked'))) {
      return null;
    }

    String pick(String name) {
      final re = RegExp(
        '$name\\s*=\\s*["\\\']([^"\\\']+)["\\\']',
        caseSensitive: false,
      );
      return re.firstMatch(html)?.group(1)?.trim() ?? '';
    }

    String xorDecrypt(String enc, String key) {
      try {
        final raw = base64.decode(enc);
        final out = List<int>.generate(raw.length, (i) {
          return raw[i] ^ key.codeUnitAt(i % key.length);
        });
        return utf8.decode(out, allowMalformed: true);
      } catch (_) {
        return '';
      }
    }

    final keyPart = pick('keyPart');
    final encMpd = pick('encryptedMpd');
    if (keyPart.isEmpty || encMpd.isEmpty) return null;

    final streamUrl = xorDecrypt(encMpd, keyPart);
    if (streamUrl.isEmpty || !streamUrl.startsWith('http')) return null;

    final licenseUrl = pick('encryptedLicense').isNotEmpty
        ? xorDecrypt(pick('encryptedLicense'), keyPart)
        : '';
    final authToken = pick('encryptedToken').isNotEmpty
        ? xorDecrypt(pick('encryptedToken'), keyPart)
        : '';
    final clearKeyRaw = pick('encryptedClearKey').isNotEmpty
        ? xorDecrypt(pick('encryptedClearKey'), keyPart)
        : '';

    return GatewayExtracted(
      streamUrl: streamUrl,
      isHls: streamUrl.toLowerCase().contains('.m3u8'),
      licenseUrl: licenseUrl,
      authToken: authToken,
      clearKeyRaw: clearKeyRaw,
    );
  }
}
