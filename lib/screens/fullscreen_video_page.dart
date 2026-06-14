import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../player/stream_url_utils.dart';
import '../player/web_playback_config.dart';
import '../player/web_player_html.dart';
import '../player/web_stream_probe.dart';
import '../services/player_rotate_hint_prefs.dart';
import '../widgets/channel_unavailable_modal.dart';
import '../widgets/web_embedded_player.dart';

/// Full-screen playback: `media_kit` for streams; WebView for PHP/HTML pages (same strategy as RN).
class FullscreenVideoPage extends StatefulWidget {
  const FullscreenVideoPage({
    super.key,
    required this.videoUrl,
    this.channelName,
    this.httpHeaders,
    this.drmType,
    this.licenseUrl,
    this.clearKeyRaw,
    this.playbackToken,
  });

  final String videoUrl;
  final String? channelName;
  /// Optional HTTP headers for manifest/segment requests (e.g. Referer, Authorization).
  final Map<String, String>? httpHeaders;
  /// Server DRM settings — used by Flutter Web player (ClearKey / Widevine).
  final String? drmType;
  final String? licenseUrl;
  final String? clearKeyRaw;
  final String? playbackToken;

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

  /// First multi-track manifest: default to ~360p (“Okoa bando”) unless user changed quality.
  bool _appliedDefaultOkoa360 = false;
  bool _userChoseOkoaQuality = false;

  bool _neverShowRotateHint = false;
  bool _prefsLoaded = false;
  /** [Baadae] — until next channel / new page. */
  bool _sessionDismissedRotateHint = false;
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
    _useWebPlayer = kIsWeb;
    _webView = !kIsWeb && useWebViewForUrl(widget.videoUrl);
    _applyImmersive();
    // All orientations so rotation to landscape is responsive (matches native fullSensor behavior).
    SystemChrome.setPreferredOrientations(DeviceOrientation.values);
    WakelockPlus.enable();
    _loadRotateHintPref();
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
  }

  Future<void> _loadRotateHintPref() async {
    final v = await PlayerRotateHintPrefs.getNeverShow();
    if (mounted) {
      setState(() {
        _neverShowRotateHint = v;
        _prefsLoaded = true;
      });
    }
  }

  Future<void> _init() async {
    if (_useWebPlayer) {
      setState(() => _loading = true);
      return;
    }
    setState(() => _loading = true);
    try {
      if (_needsShakaWebView()) {
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
    if (!mounted) return;
    await showChannelUnavailableModal(context);
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
    _webController!.loadRequest(Uri.parse(widget.videoUrl));
  }

  Future<void> _initMediaKitWithFallback() async {
    final player = Player();
    _player = player;
    _videoController = VideoController(player);

    _isPlaying = false;
    await _playingSub?.cancel();
    _playingSub = player.stream.playing.listen((playing) {
      _isPlaying = playing;
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
      _tracksSub = player.stream.tracks.listen((_) => _maybeApplyDefaultOkoa360());

      // Manifest may expose tracks slightly after play().
      unawaited(Future<void>.delayed(const Duration(milliseconds: 300), _maybeApplyDefaultOkoa360));

      final started = await _waitUntilPlaying(
        maxWait: Duration(seconds: kIsWeb ? 3 : 5),
      );
      if (!mounted) return;
      if (!started) {
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
    if (!mounted || _webView || _userChoseOkoaQuality || _appliedDefaultOkoa360) return;
    final p = _player;
    if (p == null) return;
    try {
      final videos = p.state.tracks.video.where((t) => (t.h ?? 0) > 0).toList();
      if (videos.isEmpty) return;
      if (videos.length >= 2) {
        unawaited(_selectVideoTrackNearestMaxHeight(360));
      }
      _appliedDefaultOkoa360 = true;
    } catch (e, st) {
      debugPrint('Okoa default track: $e\n$st');
      _appliedDefaultOkoa360 = true;
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

  Future<void> _applyOkoaChoice({required bool auto, int? maxHeight}) async {
    final p = _player;
    if (p == null) return;
    setState(() => _userChoseOkoaQuality = true);
    try {
      if (auto || maxHeight == null) {
        await p.setVideoTrack(VideoTrack.auto());
      } else {
        await _selectVideoTrackNearestMaxHeight(maxHeight);
      }
    } catch (e, st) {
      debugPrint('Okoa choice: $e\n$st');
    }
  }

  Future<void> _showOkoaQualitySheet() async {
    final choice = await showModalBottomSheet<int?>(
      context: context,
      backgroundColor: const Color(0xE6202020),
      builder: (ctx) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text(
                  'OKOA BANDO — ubora wa video',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16),
                ),
              ),
              ListTile(
                title: const Text('Auto (adapt)', style: TextStyle(color: Colors.white)),
                onTap: () => Navigator.pop(ctx, -1),
              ),
              ListTile(
                title: const Text('1080p', style: TextStyle(color: Colors.white)),
                onTap: () => Navigator.pop(ctx, 1080),
              ),
              ListTile(
                title: const Text('720p', style: TextStyle(color: Colors.white)),
                onTap: () => Navigator.pop(ctx, 720),
              ),
              ListTile(
                title: const Text('480p', style: TextStyle(color: Colors.white)),
                onTap: () => Navigator.pop(ctx, 480),
              ),
              ListTile(
                title: const Text('360p (chaguo-msingi)', style: TextStyle(color: Colors.white)),
                onTap: () => Navigator.pop(ctx, 360),
              ),
              ListTile(
                title: const Text('240p', style: TextStyle(color: Colors.white)),
                onTap: () => Navigator.pop(ctx, 240),
              ),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
    if (!mounted || choice == null) return;
    if (choice == -1) {
      await _applyOkoaChoice(auto: true, maxHeight: null);
    } else {
      await _applyOkoaChoice(auto: false, maxHeight: choice);
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

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_tracksSub?.cancel());
    unawaited(_playingSub?.cancel());
    WakelockPlus.disable();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    SystemChrome.setPreferredOrientations(const [DeviceOrientation.portraitUp]);
    _player?.dispose();
    super.dispose();
  }

  bool _shouldShowRotateHint(Orientation orientation) {
    if (!_prefsLoaded) return false;
    if (_neverShowRotateHint) return false;
    if (_sessionDismissedRotateHint) return false;
    if (_hasSeenLandscapeSession) return false;
    if (orientation != Orientation.portrait) return false;
    if (_loading) return false;
    if (_useWebPlayer) return true;
    if (_webView) return _webController != null;
    return _videoController != null;
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
        // Landscape: full-bleed like native TV; portrait: letterbox so rotation feels seamless.
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
                  child: _useWebPlayer
                      ? WebEmbeddedPlayer(
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
                          onError: (_) => unawaited(_notifyUnavailableAndExit()),
                          onPlaying: () {
                            if (mounted) setState(() => _isPlaying = true);
                          },
                        )
                      : _webView && _webController != null
                          ? WebViewWidget(controller: _webController!)
                          : _videoController != null
                              ? Video(
                                  controller: _videoController!,
                                  fit: videoFit,
                                  fill: Colors.black,
                                )
                              : const SizedBox.shrink(),
                ),
              ),
              if (_loading)
                const Center(child: CircularProgressIndicator()),
              if (_shouldShowRotateHint(orientation))
                _RotateHintOverlay(
                  onLater: () {
                    setState(() => _sessionDismissedRotateHint = true);
                  },
                  onNeverAgain: () async {
                    await PlayerRotateHintPrefs.setNeverShow(true);
                    if (mounted) {
                      setState(() {
                        _neverShowRotateHint = true;
                        _sessionDismissedRotateHint = true;
                      });
                    }
                  },
                ),
              SafeArea(
                child: Align(
                  alignment: Alignment.topLeft,
                  child: IconButton(
                    icon: const Icon(Icons.close, color: Colors.white, size: 28),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ),
              ),
              if (!_webView && !_useWebPlayer && _player != null)
                SafeArea(
                  child: Align(
                    alignment: Alignment.topRight,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 4, right: 6),
                      child: Material(
                        color: Colors.black.withValues(alpha: 0.55),
                        borderRadius: BorderRadius.circular(20),
                        child: InkWell(
                          onTap: _showOkoaQualitySheet,
                          borderRadius: BorderRadius.circular(20),
                          child: const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            child: Text(
                              'OKOA BANDO',
                              style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w700,
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              if (widget.channelName != null)
                SafeArea(
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 8, left: 52, right: 130),
                      child: Text(
                        widget.channelName!,
                        textAlign: TextAlign.center,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _RotateHintOverlay extends StatelessWidget {
  const _RotateHintOverlay({
    required this.onLater,
    required this.onNeverAgain,
  });

  final VoidCallback onLater;
  final VoidCallback onNeverAgain;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.black.withValues(alpha: 0.78),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const _RotatePhoneIcon(),
              const SizedBox(height: 20),
              const Text(
                'Geuza simu yako kuona kwa ukubwa kamili',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 24),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 12,
                runSpacing: 10,
                children: [
                  TextButton(
                    style: TextButton.styleFrom(
                      backgroundColor: Colors.white.withValues(alpha: 0.18),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                    ),
                    onPressed: onLater,
                    child: const Text('Baadae'),
                  ),
                  TextButton(
                    style: TextButton.styleFrom(
                      backgroundColor: const Color(0x992196F3),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                    ),
                    onPressed: onNeverAgain,
                    child: const Text('Usioneshe tena'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RotatePhoneIcon extends StatefulWidget {
  const _RotatePhoneIcon();

  @override
  State<_RotatePhoneIcon> createState() => _RotatePhoneIconState();
}

class _RotatePhoneIconState extends State<_RotatePhoneIcon>
    with SingleTickerProviderStateMixin {
  late AnimationController _c;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, child) {
        final angle = (_c.value * 2 - 1) * 0.28;
        return Transform.rotate(
          angle: angle,
          child: child,
        );
      },
      child: const Icon(
        Icons.smartphone_rounded,
        size: 88,
        color: Colors.white,
      ),
    );
  }
}
