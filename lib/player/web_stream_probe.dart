import 'dart:convert';

import 'package:http/http.dart' as http;

import '../services/remote_config_service.dart';
import 'gateway_stream_extractor.dart';
import 'manifest_url_extractor.dart';
import 'stream_url_classifier.dart';
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
  static const _browserUa = kBrowserPlaybackUserAgent;
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
    // SokaMax: embed.php?app=&key= → player.php?api=1 before HTML scrape.
    final api = await _resolveEmbedApi(url, headers);
    if (api != null) return api;

    try {
      final html = await _fetchBody(url, headers, gatewayStyle: true);
      final fromHtml = await _resolveEmbedApi(url, headers, html: html);
      if (fromHtml != null) return fromHtml;

      final extracted = GatewayStreamExtractor.extract(html) ??
          GatewayStreamExtractor.extractDrmFromHtml(html);
      if (extracted != null && extracted.streamUrl.startsWith('http')) {
        final merged = Map<String, String>.from(headers);
        // authXmlToken → admin-configured license auth header.
        if (extracted.authToken.isNotEmpty) {
          final authHeader = RemoteConfigService
              .playerConfig.gatewayPolicy.licenseAuthHeader
              .trim();
          merged[authHeader.isNotEmpty ? authHeader : 'nv-authorizations'] =
              extracted.authToken;
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

      if (GatewayStreamExtractor.looksLikeHardBotChallenge(html)) {
        return _gatewayFallback(url, config, headers);
      }
    } catch (_) {}

    return _gatewayFallback(url, config, headers);
  }

  /// Same as Washa [GatewayEmbedResolver]: warm embed page, then
  /// `player.php?api=1` → mpdPath + licenseUrl + authXmlToken.
  /// Details (package header, UAs, markers) come from admin gateway policy.
  static Future<WebStreamProbeResult?> _resolveEmbedApi(
    String playerUrl,
    Map<String, String> headers, {
    String? html,
  }) async {
    final policy = RemoteConfigService.playerConfig.gatewayPolicy;
    if (!policy.resolveEmbedApi) return null;

    final uri = Uri.tryParse(playerUrl);
    if (uri == null || uri.host.isEmpty) return null;
    final origin = '${uri.scheme}://${uri.host}${uri.hasPort ? ':${uri.port}' : ''}';
    final pkg = policy.appPackageHeader.trim().isNotEmpty
        ? policy.appPackageHeader.trim()
        : 'com.washatv';
    final pageUa = policy.pageUserAgent.trim().isNotEmpty
        ? policy.pageUserAgent.trim()
        : _browserUa;
    final mediaUa = policy.mediaUserAgent.trim().isNotEmpty
        ? policy.mediaUserAgent.trim()
        : 'ExoPlayer';
    final licenseAuth = policy.licenseAuthHeader.trim().isNotEmpty
        ? policy.licenseAuthHeader.trim()
        : 'nv-authorizations';
    final blocked = policy.blockedPageMarker.trim().isNotEmpty
        ? policy.blockedPageMarker.trim()
        : 'App Haijatambuliwa';

    var pageHtml = html;
    if (pageHtml == null || pageHtml.isEmpty) {
      if (policy.warmCookies) {
        try {
          final warmHeaders = Map<String, String>.from(headers)
            ..['User-Agent'] = pageUa
            ..['X-Requested-With'] = pkg
            ..['Accept'] =
                'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            ..['Referer'] = '$origin/';
          final warm = await http
              .get(uri, headers: warmHeaders)
              .timeout(const Duration(seconds: 15));
          pageHtml = warm.body;
          if (pageHtml.contains(blocked)) return null;
        } catch (_) {
          pageHtml = '';
        }
      } else {
        pageHtml = '';
      }
    } else if (pageHtml.contains(blocked)) {
      return null;
    }

    final apiUrl = _findEmbedApiUrl(playerUrl, pageHtml ?? '');
    if (apiUrl == null || apiUrl.isEmpty) return null;

    final hdrs = <String, String>{
      'User-Agent': pageUa,
      'Accept': 'application/json',
      'X-Requested-With': pkg,
      'Referer': '$origin/',
      if (headers['Origin'] != null) 'Origin': headers['Origin']!,
    };

    try {
      final response = await http
          .get(Uri.parse(apiUrl), headers: hdrs)
          .timeout(const Duration(seconds: 15));
      if (response.statusCode != 200) return null;
      final body = response.body.trim();
      if (!body.startsWith('{')) return null;
      final data = jsonDecode(body);
      if (data is! Map) return null;
      final success = data['success'];
      final hasMpd = '${data['mpdPath'] ?? ''}'.trim().isNotEmpty;
      if (success == false && !hasMpd) return null;
      final streamUrl = '${data['mpdPath'] ?? data['streamUrl'] ?? data['url'] ?? ''}'.trim();
      if (!streamUrl.toLowerCase().startsWith('http')) return null;
      final licenseUrl = '${data['licenseUrl'] ?? ''}'.trim();
      final authXmlToken =
          '${data['authXmlToken'] ?? data['authToken'] ?? ''}'.trim();
      final drmRaw = '${data['drmType'] ?? ''}'.toLowerCase();
      final drm = drmRaw.contains('clearkey')
          ? 'CLEARKEY'
          : (drmRaw.contains('widevine') || licenseUrl.isNotEmpty)
              ? 'WIDEVINE'
              : 'NONE';
      final playHeaders = <String, String>{
        'User-Agent': mediaUa,
        'Referer': '$origin/',
        'Origin': origin,
        if (authXmlToken.isNotEmpty) licenseAuth: authXmlToken,
      };
      final isHls = streamUrl.toLowerCase().contains('.m3u8');
      return WebStreamProbeResult(
        kind: isHls ? WebResolvedKind.hls : WebResolvedKind.dash,
        playbackUrl: streamUrl,
        originalUrl: playerUrl,
        headers: playHeaders,
        licenseUrl: licenseUrl,
        authToken: authXmlToken,
        drmType: drm == 'WIDEVINE' && licenseUrl.isEmpty ? 'NONE' : drm,
      );
    } catch (_) {
      return null;
    }
  }

  static String? _findEmbedApiUrl(String gatewayUrl, String html) {
    final inline = RegExp(
      r'''API_URL\s*=\s*["']([^"']+)["']''',
      caseSensitive: false,
    ).firstMatch(html)?.group(1)?.trim();
    if (inline != null && inline.isNotEmpty) {
      return _absolutize(gatewayUrl, inline.replaceAll(r'\u0026', '&').replaceAll(r'\/', '/'));
    }

    final uri = Uri.tryParse(gatewayUrl);
    if (uri == null) return null;
    final path = uri.path.toLowerCase();
    if (path.contains('embed.php') || path.contains('player.php')) {
      final app = uri.queryParameters['app']?.trim() ?? '';
      final key = uri.queryParameters['key']?.trim() ?? '';
      if (app.isNotEmpty && key.isNotEmpty) {
        final playerPath = uri.path.replaceAll(RegExp(r'embed\.php', caseSensitive: false), 'player.php');
        return uri.replace(
          path: playerPath,
          queryParameters: {
            'app': app,
            'key': key,
            'api': '1',
            't': '${DateTime.now().millisecondsSinceEpoch}',
          },
        ).toString();
      }
    }

    final href = RegExp(
      r'''(?:href|src)=["']([^"']*player\.php\?[^"']+)["']''',
      caseSensitive: false,
    ).firstMatch(html)?.group(1)?.trim();
    if (href != null && href.isNotEmpty) {
      final abs = _absolutize(gatewayUrl, href);
      if (abs.contains('api=')) return abs;
      final parsed = Uri.parse(abs);
      return parsed.replace(queryParameters: {
        ...parsed.queryParameters,
        'api': '1',
        't': '${DateTime.now().millisecondsSinceEpoch}',
      }).toString();
    }

    // Fallback: scrape app/key from HTML when URL has no query.
    final app = _pickHtmlParam(html, 'app');
    final key = _pickHtmlParam(html, 'key');
    if (app.isNotEmpty && key.isNotEmpty && uri.host.isNotEmpty) {
      final origin = '${uri.scheme}://${uri.host}${uri.hasPort ? ':${uri.port}' : ''}';
      return '$origin/player.php?app=${Uri.encodeQueryComponent(app)}&key=${Uri.encodeQueryComponent(key)}&api=1';
    }
    return null;
  }

  static String _absolutize(String baseUrl, String maybeRelative) {
    final t = maybeRelative.trim();
    if (t.startsWith('http://') || t.startsWith('https://')) return t;
    final base = Uri.parse(baseUrl);
    if (t.startsWith('/')) return '${base.scheme}://${base.authority}$t';
    final parent = base.path.substring(0, base.path.lastIndexOf('/') + 1);
    return '${base.scheme}://${base.authority}$parent$t';
  }

  static String _pickHtmlParam(String html, String name) {
    final patterns = name == 'app'
        ? [
            RegExp(r"[?&]app=([^&'\s<>]+)", caseSensitive: false),
            RegExp(r'''['"]app['"]\s*:\s*['"]?([^'",\s}]+)['"]?''', caseSensitive: false),
          ]
        : [
            RegExp(r"[?&]key=([^&'\s<>]+)", caseSensitive: false),
            RegExp(r'''['"]key['"]\s*:\s*['"]([^'"]+)['"]''', caseSensitive: false),
          ];
    for (final re in patterns) {
      final v = re.firstMatch(html)?.group(1)?.trim() ?? '';
      if (v.isNotEmpty) return v;
    }
    return '';
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
