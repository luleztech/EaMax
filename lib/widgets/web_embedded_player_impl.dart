import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;
import 'dart:ui_web' as ui_web;

import 'package:flutter/material.dart';

import '../player/web_playback_config.dart';
import '../player/web_player_html.dart';
import '../player/web_stream_probe.dart';

/// Clean fullscreen web player — adapts to any server URL / format change.
class WebEmbeddedPlayer extends StatefulWidget {
  const WebEmbeddedPlayer({
    super.key,
    required this.config,
    this.onLoadingChanged,
    this.onError,
    this.onPlaying,
  });

  final WebPlaybackConfig config;
  final ValueChanged<bool>? onLoadingChanged;
  final ValueChanged<String>? onError;
  final VoidCallback? onPlaying;

  @override
  State<WebEmbeddedPlayer> createState() => _WebEmbeddedPlayerState();
}

class _WebEmbeddedPlayerState extends State<WebEmbeddedPlayer> {
  static int _nextViewId = 0;

  String? _viewType;
  bool _loading = true;
  bool _playingNotified = false;
  int _attemptIndex = 0;
  List<WebStreamProbeResult> _fallbackChain = const [];
  StreamSubscription<html.MessageEvent>? _messageSub;
  int _prepareGeneration = 0;

  @override
  void initState() {
    super.initState();
    _messageSub = html.window.onMessage.listen(_onIframeMessage);
    unawaited(_prepare());
  }

  @override
  void didUpdateWidget(covariant WebEmbeddedPlayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.config.url != widget.config.url ||
        oldWidget.config.drmType != widget.config.drmType ||
        oldWidget.config.licenseUrl != widget.config.licenseUrl ||
        oldWidget.config.clearKeyRaw != widget.config.clearKeyRaw ||
        oldWidget.config.token != widget.config.token ||
        !_mapEquals(oldWidget.config.headers, widget.config.headers)) {
      _attemptIndex = 0;
      unawaited(_prepare());
    }
  }

  @override
  void dispose() {
    unawaited(_messageSub?.cancel());
    super.dispose();
  }

  bool _mapEquals(Map<String, String> a, Map<String, String> b) {
    if (a.length != b.length) return false;
    for (final e in a.entries) {
      if (b[e.key] != e.value) return false;
    }
    return true;
  }

  void _onIframeMessage(html.MessageEvent event) {
    final raw = event.data;
    if (raw is! String) return;
    try {
      final data = jsonDecode(raw) as Map<String, dynamic>;
      if (data['type'] == 'eamax-player-error' && data['fatal'] == true) {
        unawaited(_tryNextFallback());
      }
    } catch (_) {}
  }

  Future<void> _tryNextFallback() async {
    if (!mounted) return;
    if (_playingNotified) return;
    if (_attemptIndex + 1 >= _fallbackChain.length) {
      widget.onError?.call('');
      return;
    }
    _attemptIndex++;
    await _mountPlayer(_fallbackChain[_attemptIndex]);
  }

  void _setLoading(bool value) {
    if (_loading == value) return;
    _loading = value;
    widget.onLoadingChanged?.call(value);
    if (mounted) setState(() {});
  }

  Future<void> _prepare() async {
    final gen = ++_prepareGeneration;
    _setLoading(true);
    _playingNotified = false;
    _viewType = null;
    _attemptIndex = 0;
    if (mounted) setState(() {});

    try {
      final primary = await WebStreamProbe.resolve(widget.config);
      if (!mounted || gen != _prepareGeneration) return;

      _fallbackChain = _buildFallbackChain(primary);
      await _mountPlayer(_fallbackChain.first);
      if (!mounted || gen != _prepareGeneration) return;

      await Future<void>.delayed(const Duration(milliseconds: 150));
      if (mounted && gen == _prepareGeneration) _setLoading(false);
    } catch (e) {
      if (mounted && gen == _prepareGeneration) {
        widget.onError?.call('');
      }
    }
  }

  List<WebStreamProbeResult> _buildFallbackChain(WebStreamProbeResult primary) {
    final chain = <WebStreamProbeResult>[primary];
    final url = primary.playbackUrl;
    final base = WebStreamProbeResult(
      kind: WebResolvedKind.adaptive,
      playbackUrl: url,
      originalUrl: primary.originalUrl,
      headers: primary.headers,
      licenseUrl: primary.licenseUrl,
      clearKeyRaw: primary.clearKeyRaw,
      authToken: primary.authToken,
      drmType: primary.drmType,
    );

    void addIfNew(WebStreamProbeResult r) {
      if (chain.any((c) => c.kind == r.kind && c.playbackUrl == r.playbackUrl)) return;
      chain.add(r);
    }

    switch (primary.kind) {
      case WebResolvedKind.hls:
      case WebResolvedKind.dash:
      case WebResolvedKind.adaptive:
      case WebResolvedKind.gatewayEmbed:
        break;
      case WebResolvedKind.progressive:
        addIfNew(base.copyWith(kind: WebResolvedKind.hls));
    }

    if (!primary.isGatewayFallback && primary.kind == WebResolvedKind.gatewayEmbed) {
      addIfNew(WebStreamProbeResult(
        kind: WebResolvedKind.hls,
        playbackUrl: primary.originalUrl,
        originalUrl: primary.originalUrl,
        headers: primary.headers,
        licenseUrl: primary.licenseUrl,
        clearKeyRaw: primary.clearKeyRaw,
        authToken: primary.authToken,
        drmType: primary.drmType,
      ));
    }

    return chain;
  }

  Future<void> _mountPlayer(WebStreamProbeResult result) async {
    final htmlContent = _htmlForResult(result);
    final viewType = 'eamax-web-player-${_nextViewId++}';
    ui_web.platformViewRegistry.registerViewFactory(viewType, (int _) {
      final iframe = html.IFrameElement()
        ..srcdoc = htmlContent
        ..style.border = 'none'
        ..style.width = '100%'
        ..style.height = '100%'
        ..style.backgroundColor = '#000'
        ..allow = 'autoplay; encrypted-media; fullscreen';
      return iframe;
    });

    if (!mounted) return;
    setState(() {
      _viewType = viewType;
      _playingNotified = false;
    });
  }

  String _htmlForResult(WebStreamProbeResult result) {
    final url = result.playbackUrl;
    final headers = result.headers;
    final drmType = result.drmType;
    final licenseUrl = result.licenseUrl;
    final clearKey = result.clearKeyRaw;
    final drm = (
      drmType: drmType,
      licenseUrl: licenseUrl,
      clearKeyRaw: clearKey,
    );

    switch (result.kind) {
      case WebResolvedKind.dash:
      case WebResolvedKind.hls:
      case WebResolvedKind.adaptive:
        return WebPlayerHtml.shaka(
          url,
          headers,
          drmType: drm.drmType,
          licenseUrl: drm.licenseUrl,
          clearKeyRaw: drm.clearKeyRaw,
        );
      case WebResolvedKind.progressive:
        return WebPlayerHtml.progressive(url);
      case WebResolvedKind.gatewayEmbed:
        return WebPlayerHtml.gatewayEmbed(url);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_viewType == null) {
      return const ColoredBox(
        color: Colors.black,
        child: Center(child: CircularProgressIndicator(color: Colors.white54)),
      );
    }

    if (!_playingNotified && !_loading) {
      _playingNotified = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        widget.onPlaying?.call();
      });
    }

    return ColoredBox(
      color: Colors.black,
      child: HtmlElementView(viewType: _viewType!),
    );
  }
}

extension on WebStreamProbeResult {
  WebStreamProbeResult copyWith({WebResolvedKind? kind}) {
    return WebStreamProbeResult(
      kind: kind ?? this.kind,
      playbackUrl: playbackUrl,
      originalUrl: originalUrl,
      headers: headers,
      licenseUrl: licenseUrl,
      clearKeyRaw: clearKeyRaw,
      authToken: authToken,
      drmType: drmType,
    );
  }
}
