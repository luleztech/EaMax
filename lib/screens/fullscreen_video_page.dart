import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../player/flutter_playback_mode.dart';
import '../player/stream_url_utils.dart';
import '../player/web_playback_config.dart';
import '../player/web_player_html.dart';
import '../player/web_stream_probe.dart';
import '../widgets/chewie_video_player_view.dart';
import '../widgets/native_video_player_view.dart';
import '../widgets/web_embedded_player.dart';
import '../utils/player_orientation.dart';

/// Full-screen playback: `media_kit` for streams; WebView for PHP/HTML pages (same strategy as RN).
class FullscreenVideoPage extends StatefulWidget {
  const FullscreenVideoPage({
    super.key,
    required this.videoUrl,
    this.channelName,
    this.channelId,
    this.httpHeaders,
    this.drmType,
    this.licenseUrl,
    this.clearKeyRaw,
    this.playbackToken,
    this.playbackMode = FlutterPlaybackMode.mediaKit,
    this.audioLanguage = 'sw',
    this.defaultQuality = '360p',
  });

  final String videoUrl;
  final String? channelName;
  final int? channelId;
  /// Optional HTTP headers for manifest/segment requests (e.g. Referer, Authorization).
  final Map<String, String>? httpHeaders;
  /// Server DRM settings — used by Flutter Web player (ClearKey / Widevine).
  final String? drmType;
  final String? licenseUrl;
  final String? clearKeyRaw;
  final String? playbackToken;
  /// Admin-selected Flutter playback backend.
  final FlutterPlaybackMode playbackMode;
  /// Admin-set stream audio language (`auto` = player default).
  final String audioLanguage;
  /// Admin default quality from Control Center / per-channel override.
  final String defaultQuality;

  @override
  State<FullscreenVideoPage> createState() => _FullscreenVideoPageState();
}

class _FullscreenVideoPageState extends State<FullscreenVideoPage> with WidgetsBindingObserver {
  Player? _player;
  VideoController? _videoController;
  WebViewController? _webController;

  StreamSubscription<bool>? _playingSub;
  StreamSubscription<Tracks>? _tracksSub;

  bool _webView = false;
  bool _useWebPlayer = false;
  bool _loading = true;
  bool _isPlaying = false;
  bool _playbackConfirmed = false;
  bool _unavailableNotified = false;

  /// First multi-track manifest: apply admin default quality cap once at startup.
  bool _appliedDefaultOkoa360 = false;

  /** After landscape once this session, do not show hint again (until new page). */
  bool _hasSeenLandscapeSession = false;

  void _applyImmersive() {
    SystemChrome.setEnabledSystemUIMode(
      SystemUiMode.immersiveSticky,
      overlays: [],
    );
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _useWebPlayer = kIsWeb || widget.playbackMode == FlutterPlaybackMode.webEmbedded;
    _webView = !kIsWeb &&
        (widget.playbackMode == FlutterPlaybackMode.shaka ||
            (widget.playbackMode == FlutterPlaybackMode.mediaKit &&
                useWebViewForUrl(widget.videoUrl)));
    unawaited(PlayerOrientation.enterFullscreenPlayer());
    WakelockPlus.enable();
    _init();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final o = MediaQuery.orientationOf(context);
      if (o == Orientation.landscape && !_hasSeenLandscapeSession) {
        setState(() => _hasSeenLandscapeSession = true);
      }
    });
  }

  @override
  void didChangeMetrics() {
    super.didChangeMetrics();
    _applyImmersive();
    if (mounted) setState(() {});
  }

  Future<void> _init() async {
    if (_useWebPlayer ||
        widget.playbackMode == FlutterPlaybackMode.webEmbedded) {
      setState(() => _loading = true);
      return;
    }
    if (widget.playbackMode == FlutterPlaybackMode.chewie ||
        widget.playbackMode == FlutterPlaybackMode.nativeVideo) {
      setState(() => _loading = false);
      return;
    }
    setState(() => _loading = true);
    try {
      if (widget.playbackMode == FlutterPlaybackMode.shaka || _needsShakaWebView()) {
        _webView = true;
        await _initShakaWebView();
      } else if (useWebViewForUrl(widget.videoUrl)) {
        _webView = true;
        await _initWebView();
      } else {
        await _initMediaKitWithFallback();
      }
    } catch (e, st) {
      debugPrint('Fullscreen init failed: $e\n$st');
      await _notifyUnavailableAndExit();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool _needsShakaWebView() {
    if (kIsWeb) return false;
    final drm = (widget.drmType ?? 'NONE').toUpperCase().replaceAll(RegExp(r'[\s\-]+'), '_');
    if (drm != 'NONE') return true;
    if ((widget.clearKeyRaw ?? '').trim().isNotEmpty) return true;
    if ((widget.licenseUrl ?? '').trim().isNotEmpty) return true;
    final fmt = detectStreamFormat(widget.videoUrl);
    return fmt == StreamFormat.dash || fmt == StreamFormat.gateway;
  }

  Future<void> _initShakaWebView() async {
    _webController = WebViewController();
    try {
      _webController!.setJavaScriptMode(JavaScriptMode.unrestricted);
    } on UnimplementedError {
      if (!kIsWeb) rethrow;
    }
    try {
      _webController!.setBackgroundColor(Colors.black);
    } on UnimplementedError {}
    await _guardWebViewNavigation(_webController!);

    final config = WebPlaybackConfig(
      url: widget.videoUrl,
      headers: widget.httpHeaders ?? const {},
      drmType: widget.drmType ?? 'NONE',
      licenseUrl: widget.licenseUrl ?? '',
      clearKeyRaw: widget.clearKeyRaw ?? '',
      token: widget.playbackToken ?? '',
    );

    final resolved = await WebStreamProbe.resolve(config);
    final html = _htmlForProbeResult(resolved);
    await _webController!.loadHtmlString(html);
  }

  String _htmlForProbeResult(WebStreamProbeResult result) {
    final headers = result.headers;
    final drm = (
      drmType: result.drmType,
      licenseUrl: result.licenseUrl,
      clearKeyRaw: result.clearKeyRaw,
    );
    switch (result.kind) {
      case WebResolvedKind.dash:
      case WebResolvedKind.hls:
      case WebResolvedKind.adaptive:
        return WebPlayerHtml.shaka(
          result.playbackUrl,
          headers,
          drmType: drm.drmType,
          licenseUrl: drm.licenseUrl,
          clearKeyRaw: drm.clearKeyRaw,
        );
      case WebResolvedKind.progressive:
        return WebPlayerHtml.progressive(result.playbackUrl);
      case WebResolvedKind.gatewayEmbed:
        return WebPlayerHtml.gatewayEmbed(result.playbackUrl);
    }
  }

  Future<void> _notifyUnavailableAndExit() async {
    if (!mounted || _unavailableNotified || _playbackConfirmed || _isPlaying) return;
    _unavailableNotified = true;
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _initWebView() async {
    _webController = WebViewController();
    // `webview_flutter_web` may not implement `setJavaScriptMode` on all
    // versions/platforms. Don't crash the whole page if it's unimplemented.
    try {
      _webController!.setJavaScriptMode(JavaScriptMode.unrestricted);
    } on UnimplementedError {
      if (!kIsWeb) rethrow;
    }
    try {
      _webController!.setBackgroundColor(Colors.black);
    } on UnimplementedError {
      // Some webview_flutter_web versions don't support background color.
    }
    await _guardWebViewNavigation(_webController!);
    _webController!.loadRequest(Uri.parse(widget.videoUrl));
  }

  /// Keep stream/gateway URLs inside the app — never hand off to VLC/MX/system chooser.
  Future<void> _guardWebViewNavigation(WebViewController controller) async {
    if (kIsWeb) return;
    try {
      await controller.setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) {
            final lower = request.url.toLowerCase();
            if (lower.startsWith('intent:') ||
                lower.startsWith('market:') ||
                lower.startsWith('vlc:') ||
                lower.startsWith('mx:') ||
                lower.startsWith('file:') ||
                lower.startsWith('content:')) {
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
        ),
      );
    } catch (_) {}
  }

  Future<void> _initMediaKitWithFallback() async {
    final player = Player();
    _player = player;
    _videoController = VideoController(player);

    _isPlaying = false;
    await _playingSub?.cancel();
    _playingSub = player.stream.playing.listen((playing) {
      _isPlaying = playing;
      if (playing && mounted) {
        _playbackConfirmed = true;
      }
    });

    try {
      await player.open(
        Media(
          widget.videoUrl,
          httpHeaders: widget.httpHeaders,
        ),
      );
      if (!mounted) return;

      // Show the player surface immediately; buffering continues inside media_kit.
      setState(() => _loading = false);

      await player.play();

      await _tracksSub?.cancel();
      _tracksSub = player.stream.tracks.listen((_) {
        _maybeApplyDefaultOkoa360();
      });

      // Manifest may expose tracks slightly after play().
      unawaited(Future<void>.delayed(const Duration(milliseconds: 300), () {
        _maybeApplyDefaultOkoa360();
      }));

      final started = await _waitUntilPlaying(
        maxWait: Duration(seconds: kIsWeb ? 4 : 8),
      );
      if (!mounted) return;
      if (!started && !_playbackConfirmed) {
        if (kIsWeb) {
          await _notifyUnavailableAndExit();
          return;
        }
        try {
          await _switchToWebView();
        } catch (e, st) {
          debugPrint('WebView fallback failed: $e\n$st');
          await _notifyUnavailableAndExit();
        }
      }
    } catch (e, st) {
      debugPrint('media_kit open failed: $e\n$st');
      if (kIsWeb) {
        await _notifyUnavailableAndExit();
        return;
      }
      try {
        await _switchToWebView();
      } catch (e2, st2) {
        debugPrint('WebView fallback failed: $e2\n$st2');
        await _notifyUnavailableAndExit();
      }
    }
  }

  Future<bool> _waitUntilPlaying({required Duration maxWait}) async {
    final deadline = DateTime.now().add(maxWait);
    while (mounted && DateTime.now().isBefore(deadline)) {
      if (_isPlaying) return true;
      await Future<void>.delayed(const Duration(milliseconds: 120));
    }
    return _isPlaying;
  }

  void _maybeApplyDefaultOkoa360() {
    if (!mounted || _webView || _appliedDefaultOkoa360) return;
    final targetHeight = _qualityToHeight(widget.defaultQuality);
    if (targetHeight <= 0) {
      _appliedDefaultOkoa360 = true;
      return;
    }
    final tracks = _player?.state.tracks.video ?? [];
    if (tracks.length > 1) {
      if (mounted) {
        unawaited(_selectVideoTrackNearestMaxHeight(targetHeight));
      }
      _appliedDefaultOkoa360 = true;
    } else if (tracks.isNotEmpty) {
      _appliedDefaultOkoa360 = true;
    }
  }

  int _qualityToHeight(String quality) {
    switch (quality.toLowerCase().trim()) {
      case 'auto':
        return 0;
      case '240p':
        return 240;
      case '480p':
        return 480;
      case '720p':
        return 720;
      case '1080p':
      case '2k':
        return 1080;
      case '4k':
        return 2160;
      default:
        return 360;
    }
  }

  /// Picks the highest video track with height ≤ [maxHeight], else the lowest available.
  Future<void> _selectVideoTrackNearestMaxHeight(int maxHeight) async {
    final p = _player;
    if (p == null) return;
    try {
      final videos = p.state.tracks.video.where((t) => (t.h ?? 0) > 0).toList();
      if (videos.isEmpty) return;
      VideoTrack? bestUnder;
      var bestUnderH = -1;
      for (final t in videos) {
        final h = t.h!;
        if (h <= maxHeight && h > bestUnderH) {
          bestUnderH = h;
          bestUnder = t;
        }
      }
      final pick = bestUnder ?? videos.reduce((a, b) => ((a.h ?? 99999) <= (b.h ?? 99999) ? a : b));
      await p.setVideoTrack(pick);
    } catch (e, st) {
      debugPrint('setVideoTrack: $e\n$st');
    }
  }

  Future<void> _switchToWebView() async {
    await _tracksSub?.cancel();
    _tracksSub = null;
    await _playingSub?.cancel();
    _playingSub = null;
    // Stop/dispose the current player so the page doesn't keep resources alive.
    try {
      await _player?.dispose();
    } catch (_) {}
    _player = null;
    _videoController = null;

    _webView = true;
    setState(() {
      _webController = null;
      _loading = true;
    });

    await _initWebView();
    if (mounted) setState(() => _loading = false);
  }

  Widget _buildVideoSurface(BoxFit videoFit) {
    switch (widget.playbackMode) {
      case FlutterPlaybackMode.webEmbedded:
        return WebEmbeddedPlayer(
          config: WebPlaybackConfig(
            url: widget.videoUrl,
            headers: widget.httpHeaders ?? const {},
            drmType: widget.drmType ?? 'NONE',
            licenseUrl: widget.licenseUrl ?? '',
            clearKeyRaw: widget.clearKeyRaw ?? '',
            token: widget.playbackToken ?? '',
          ),
          onLoadingChanged: (loading) {
            if (mounted) setState(() => _loading = loading);
          },
          onError: (_) {
            if (_playbackConfirmed || _isPlaying) return;
            unawaited(_notifyUnavailableAndExit());
          },
          onPlaying: () {
            if (mounted) {
              setState(() {
                _isPlaying = true;
                _playbackConfirmed = true;
              });
            }
          },
        );
      case FlutterPlaybackMode.chewie:
        return ChewieVideoPlayerView(
          url: widget.videoUrl,
          httpHeaders: widget.httpHeaders ?? const {},
          onError: (_) => unawaited(_notifyUnavailableAndExit()),
          onPlaying: () {
            if (mounted) {
              setState(() {
                _isPlaying = true;
                _playbackConfirmed = true;
                _loading = false;
              });
            }
          },
        );
      case FlutterPlaybackMode.nativeVideo:
        return NativeVideoPlayerView(
          url: widget.videoUrl,
          httpHeaders: widget.httpHeaders ?? const {},
          onError: (_) => unawaited(_notifyUnavailableAndExit()),
          onPlaying: () {
            if (mounted) {
              setState(() {
                _isPlaying = true;
                _playbackConfirmed = true;
                _loading = false;
              });
            }
          },
        );
      case FlutterPlaybackMode.shaka:
      case FlutterPlaybackMode.mediaKit:
      case FlutterPlaybackMode.webrtc:
        if (_useWebPlayer) {
          return WebEmbeddedPlayer(
            config: WebPlaybackConfig(
              url: widget.videoUrl,
              headers: widget.httpHeaders ?? const {},
              drmType: widget.drmType ?? 'NONE',
              licenseUrl: widget.licenseUrl ?? '',
              clearKeyRaw: widget.clearKeyRaw ?? '',
              token: widget.playbackToken ?? '',
            ),
            onLoadingChanged: (loading) {
              if (mounted) setState(() => _loading = loading);
            },
            onError: (_) {
              if (_playbackConfirmed || _isPlaying) return;
              unawaited(_notifyUnavailableAndExit());
            },
            onPlaying: () {
              if (mounted) {
                setState(() {
                  _isPlaying = true;
                  _playbackConfirmed = true;
                });
              }
            },
          );
        }
        if (_webView && _webController != null) {
          return SizedBox.expand(
            child: WebViewWidget(controller: _webController!),
          );
        }
        if (_videoController != null) {
          return Video(
            controller: _videoController!,
            fit: videoFit,
            fill: Colors.black,
          );
        }
        return const SizedBox.shrink();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_tracksSub?.cancel());
    unawaited(_playingSub?.cancel());
    WakelockPlus.disable();
    unawaited(PlayerOrientation.exitFullscreenPlayer());
    _player?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return OrientationBuilder(
      builder: (context, orientation) {
        if (orientation == Orientation.landscape && !_hasSeenLandscapeSession) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted && !_hasSeenLandscapeSession) {
              setState(() => _hasSeenLandscapeSession = true);
            }
          });
        }

        final isLandscape = orientation == Orientation.landscape;
        final videoFit = isLandscape ? BoxFit.cover : BoxFit.contain;

        return Scaffold(
          backgroundColor: Colors.black,
          extendBody: true,
          extendBodyBehindAppBar: true,
          body: Stack(
            fit: StackFit.expand,
            children: [
              Positioned.fill(
                child: ColoredBox(
                  color: Colors.black,
                  child: _buildVideoSurface(videoFit),
                ),
              ),
              if (_loading)
                const Center(child: CircularProgressIndicator()),
            ],
          ),
        );
      },
    );
  }
}
