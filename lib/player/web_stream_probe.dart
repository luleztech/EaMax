import 'package:http/http.dart' as http;

import 'gateway_stream_extractor.dart';
import 'manifest_url_extractor.dart';
import 'stream_url_utils.dart';
import 'web_playback_config.dart';

/// How the web player should play a URL (aligned with Android [StreamProbe]).
enum WebResolvedKind { hls, dash, progressive, adaptive, gatewayEmbed }

class WebStreamProbeResult {
  const WebStreamProbeResult({
    required this.kind,
    required this.playbackUrl,
    required this.originalUrl,
    this.headers = const {},
    this.licenseUrl = '',
    this.clearKeyRaw = '',
    this.authToken = '',
    this.drmType = 'NONE',
  });

  final WebResolvedKind kind;
  final String playbackUrl;
  final String originalUrl;
  final Map<String, String> headers;
  final String licenseUrl;
  final String clearKeyRaw;
  final String authToken;
  final String drmType;

  bool get isGatewayFallback => kind == WebResolvedKind.gatewayEmbed;
}

/// Resolves any server URL to the best web playback strategy.
class WebStreamProbe {
  static const _browserUa =
      'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36';
  static const _rangeBytes = 2047;
  static const _maxReadBytes = 4096;

  static Future<WebStreamProbeResult> resolve(WebPlaybackConfig config) async {
    final original = config.url.trim();
    if (original.isEmpty) {
      throw ArgumentError('Empty stream URL');
    }

    final headers = _buildRequestHeaders(config);

    // Fast paths first — manifest URLs must not be treated as gateways (/stream/ in path).
    if (RegExp(r'\.m3u8?(\?|#|$)', caseSensitive: false).hasMatch(original) ||
        RegExp(r'[?&](format|type)=m3u8?(\b|&|$)', caseSensitive: false).hasMatch(original)) {
      return _direct(original, config, WebResolvedKind.hls, headers);
    }
    if (RegExp(r'\.mpd(\?|#|$)', caseSensitive: false).hasMatch(original)) {
      return _direct(original, config, WebResolvedKind.dash, headers);
    }
    if (RegExp(r'\.(mp4|m4v|webm|mkv|mov)(\?|#|$)', caseSensitive: false).hasMatch(original)) {
      return _direct(original, config, WebResolvedKind.progressive, headers);
    }
    if (isLikelyIptvLiveUrl(original)) {
      return _direct(original, config, WebResolvedKind.hls, headers);
    }

    // PHP / HTML gateways — decrypt embedded stream when possible.
    if (isGatewayUrl(original) || useWebViewForUrl(original)) {
      return _resolveGateway(original, config, headers);
    }

    final lower = original.toLowerCase();
    final isIptvPort = RegExp(
      r'^https?://[^/]+:\d{2,5}/(live|stream|play|hls|iptv|channel|ch)/',
    ).hasMatch(lower);
    final isXtream = RegExp(
      r'^https?://[^/]+:\d{2,5}/[^/]+/[^/]+/[^/?#]+$',
    ).hasMatch(original.split('#').first);
    if (isIptvPort || isXtream) {
      return _direct(original, config, WebResolvedKind.hls, headers);
    }

    // Ambiguous — probe HTTP body / content-type.
    try {
      return await _probeHttp(original, config, headers);
    } catch (_) {
      if (isGatewayUrl(original)) {
        return _gatewayFallback(original, config, headers);
      }
      return _direct(original, config, WebResolvedKind.adaptive, headers);
    }
  }

  static WebStreamProbeResult _direct(
    String url,
    WebPlaybackConfig config,
    WebResolvedKind kind,
    Map<String, String> headers,
  ) {
    return WebStreamProbeResult(
      kind: kind,
      playbackUrl: url,
      originalUrl: url,
      headers: headers,
      licenseUrl: config.licenseUrl,
      clearKeyRaw: config.clearKeyRaw,
      authToken: config.token,
      drmType: config.normalizedDrmType,
    );
  }

  static Future<WebStreamProbeResult> _resolveGateway(
    String url,
    WebPlaybackConfig config,
    Map<String, String> headers,
  ) async {
    try {
      final html = await _fetchBody(url, headers, gatewayStyle: true);
      final extracted = GatewayStreamExtractor.extract(html) ??
          GatewayStreamExtractor.extractDrmFromHtml(html);
      if (extracted != null && extracted.streamUrl.startsWith('http')) {
        final merged = Map<String, String>.from(headers);
        if (extracted.authToken.isNotEmpty &&
            !merged.keys.any((k) => k.toLowerCase() == 'authorization')) {
          merged['Authorization'] = 'Bearer ${extracted.authToken}';
        }
        final license = extracted.licenseUrl.isNotEmpty
            ? extracted.licenseUrl
            : config.licenseUrl;
        final clearKey = extracted.clearKeyRaw.isNotEmpty
            ? extracted.clearKeyRaw
            : config.clearKeyRaw;
        var drm = config.normalizedDrmType;
        if (drm == 'NONE') {
          if (license.isNotEmpty) {
            drm = license.toLowerCase().contains('playready') ? 'PLAYREADY' : 'WIDEVINE';
          } else if (clearKey.isNotEmpty) {
            drm = 'CLEARKEY';
          }
        }
        final kind = extracted.isHls ? WebResolvedKind.hls : WebResolvedKind.dash;
        return WebStreamProbeResult(
          kind: kind,
          playbackUrl: extracted.streamUrl,
          originalUrl: url,
          headers: merged,
          licenseUrl: license,
          clearKeyRaw: clearKey,
          authToken: extracted.authToken,
          drmType: drm,
        );
      }

      final manifest = ManifestUrlExtractor.extract(html, url);
      if (manifest != null) {
        return WebStreamProbeResult(
          kind: manifest.isHls ? WebResolvedKind.hls : WebResolvedKind.dash,
          playbackUrl: manifest.url,
          originalUrl: url,
          headers: headers,
          licenseUrl: config.licenseUrl,
          clearKeyRaw: config.clearKeyRaw,
          authToken: config.token,
          drmType: config.normalizedDrmType,
        );
      }
    } catch (_) {}

    return _gatewayFallback(url, config, headers);
  }

  static WebStreamProbeResult _gatewayFallback(
    String url,
    WebPlaybackConfig config,
    Map<String, String> headers,
  ) {
    return WebStreamProbeResult(
      kind: WebResolvedKind.gatewayEmbed,
      playbackUrl: url,
      originalUrl: url,
      headers: headers,
      licenseUrl: config.licenseUrl,
      clearKeyRaw: config.clearKeyRaw,
      authToken: config.token,
      drmType: config.normalizedDrmType,
    );
  }

  static Future<WebStreamProbeResult> _probeHttp(
    String url,
    WebPlaybackConfig config,
    Map<String, String> headers,
  ) async {
    final gatewayStyle = isGatewayUrl(url);
    final accept = gatewayStyle
        ? 'text/html,application/xhtml+xml,application/xml;q=0.9,application/dash+xml,application/vnd.apple.mpegurl;q=0.8,*/*;q=0.7'
        : 'application/dash+xml,application/vnd.apple.mpegurl,application/x-mpegURL,application/xml,text/xml,*/*;q=0.8';

    final reqHeaders = Map<String, String>.from(headers)..putIfAbsent('Accept', () => accept);

    http.Response response;
    try {
      response = await http
          .get(Uri.parse(url), headers: {...reqHeaders, 'Range': 'bytes=0-$_rangeBytes'})
          .timeout(const Duration(seconds: 10));
      if (response.statusCode == 404 || response.statusCode == 403 || response.statusCode == 416) {
        response = await http
            .get(Uri.parse(url), headers: reqHeaders)
            .timeout(const Duration(seconds: 10));
      }
    } catch (_) {
      return _direct(url, config, WebResolvedKind.adaptive, headers);
    }

    final status = response.statusCode;
    final body = response.body.length > _maxReadBytes
        ? response.body.substring(0, _maxReadBytes)
        : response.body;
    final ct = response.headers['content-type']?.split(';').first.trim().toLowerCase() ?? '';
    final finalUrl = response.request?.url.toString() ?? url;
    final ok = status >= 200 && status < 300 || status == 206;

    if (!ok) {
      if (_looksLikeHtml(body)) {
        final manifest = ManifestUrlExtractor.extract(body, finalUrl);
        if (manifest != null) {
          return WebStreamProbeResult(
            kind: manifest.isHls ? WebResolvedKind.hls : WebResolvedKind.dash,
            playbackUrl: manifest.url,
            originalUrl: url,
            headers: headers,
            licenseUrl: config.licenseUrl,
            clearKeyRaw: config.clearKeyRaw,
            authToken: config.token,
            drmType: config.normalizedDrmType,
          );
        }
      }
      if (isGatewayUrl(url)) return _gatewayFallback(url, config, headers);
      return _direct(url, config, WebResolvedKind.adaptive, headers);
    }

    final trimmed = body.trim();
    if (trimmed.startsWith('#EXTM3U')) {
      return _direct(finalUrl, config, WebResolvedKind.hls, headers);
    }
    if (_looksLikeDashMpd(trimmed)) {
      return _direct(finalUrl, config, WebResolvedKind.dash, headers);
    }

    if (_looksLikeHtml(trimmed) || _looksLikeLogin(trimmed)) {
      final manifest = ManifestUrlExtractor.extract(body, finalUrl);
      if (manifest != null) {
        return WebStreamProbeResult(
          kind: manifest.isHls ? WebResolvedKind.hls : WebResolvedKind.dash,
          playbackUrl: manifest.url,
          originalUrl: url,
          headers: headers,
          licenseUrl: config.licenseUrl,
          clearKeyRaw: config.clearKeyRaw,
          authToken: config.token,
          drmType: config.normalizedDrmType,
        );
      }
      if (isGatewayUrl(url)) return _gatewayFallback(url, config, headers);
      return _direct(finalUrl, config, WebResolvedKind.adaptive, headers);
    }

    if (ct.startsWith('video/') || ct == 'application/octet-stream') {
      return _direct(finalUrl, config, WebResolvedKind.progressive, headers);
    }
    if (ct.contains('mpegurl') || ct.contains('m3u8')) {
      return _direct(finalUrl, config, WebResolvedKind.hls, headers);
    }
    if (ct.contains('dash') && ct.contains('xml')) {
      return _direct(finalUrl, config, WebResolvedKind.dash, headers);
    }

    if (isGatewayUrl(url)) return _gatewayFallback(url, config, headers);
    return _direct(finalUrl, config, WebResolvedKind.adaptive, headers);
  }

  static Future<String> _fetchBody(
    String url,
    Map<String, String> headers, {
    required bool gatewayStyle,
  }) async {
    final h = Map<String, String>.from(headers);
    h.putIfAbsent('Accept', () => 'text/html,application/xhtml+xml,*/*;q=0.8');
    h.putIfAbsent('User-Agent', () => _browserUa);
    final res = await http.get(Uri.parse(url), headers: h).timeout(const Duration(seconds: 12));
    if (res.statusCode < 200 || res.statusCode >= 400) {
      throw StateError('HTTP ${res.statusCode}');
    }
    return res.body;
  }

  static Map<String, String> _buildRequestHeaders(WebPlaybackConfig config) {
    final h = Map<String, String>.from(config.headers);
    if (config.token.isNotEmpty && !h.keys.any((k) => k.toLowerCase() == 'authorization')) {
      h['Authorization'] = 'Bearer ${config.token}';
    }
    h.putIfAbsent('User-Agent', () => _browserUa);
    if (!h.keys.any((k) => k.toLowerCase() == 'referer')) {
      try {
        final u = Uri.parse(config.url.trim());
        if (u.scheme.isNotEmpty && u.host.isNotEmpty) {
          final port = (u.port <= 0 || u.port == 80 || u.port == 443) ? '' : ':${u.port}';
          h['Referer'] = '${u.scheme}://${u.host}$port/';
          h.putIfAbsent('Origin', () => '${u.scheme}://${u.host}$port');
        }
      } catch (_) {}
    }
    return h;
  }

  static bool _looksLikeHtml(String s) {
    final t = (s.length > 12288 ? s.substring(0, 12288) : s).trim().toLowerCase();
    if (t.startsWith('#extm3u')) return false;
    return t.startsWith('<!doctype') ||
        t.contains('<html') ||
        t.contains('<head') ||
        (t.startsWith('<') && (t.contains('<script') || t.contains('<iframe') || t.contains('<body')));
  }

  static bool _looksLikeLogin(String s) {
    final t = (s.length > 24576 ? s.substring(0, 24576) : s).toLowerCase();
    return t.contains('type="password"') ||
        t.contains("type='password'") ||
        t.contains('unauthorized') ||
        t.contains('access denied') ||
        t.contains('forbidden') ||
        RegExp(r'(^|[^a-z])login([^a-z]|$)').hasMatch(t);
  }

  static bool _looksLikeDashMpd(String s) {
    final t = s.trim();
    final tl = t.toLowerCase();
    if (t.startsWith('#EXTM3U')) return false;
    if (_looksLikeHtml(t)) return false;
    if (t.startsWith('<?xml')) return tl.contains('<mpd') || tl.contains('mpeg:dash:schema:mpd');
    final idx = tl.indexOf('<mpd');
    return idx >= 0 && idx <= 4096;
  }
}
