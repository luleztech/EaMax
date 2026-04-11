import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../services/player_rotate_hint_prefs.dart';

bool _useWebViewForUrl(String url) {
  final l = url.toLowerCase();
  return l.contains('.php') || l.contains('.html') || l.contains('.htm');
}

/// Full-screen playback: `media_kit` for streams; WebView for PHP/HTML pages (same strategy as RN).
class FullscreenVideoPage extends StatefulWidget {
  const FullscreenVideoPage({
    super.key,
    required this.videoUrl,
    this.channelName,
  });

  final String videoUrl;
  final String? channelName;

  @override
  State<FullscreenVideoPage> createState() => _FullscreenVideoPageState();
}

class _FullscreenVideoPageState extends State<FullscreenVideoPage> with WidgetsBindingObserver {
  Player? _player;
  VideoController? _videoController;
  WebViewController? _webController;

  bool _webView = false;
  bool _loading = true;
  String? _error;
  bool _isPlaying = false;

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
    _webView = _useWebViewForUrl(widget.videoUrl);
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
    setState(() => _loading = true);
    try {
      if (_webView) {
        await _initWebView();
      } else {
        await _initMediaKitWithFallback();
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
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
    _player = Player();
    _videoController = VideoController(_player!);

    _isPlaying = false;
    final sub = _player!.stream.playing.listen((playing) {
      _isPlaying = playing;
    });

    try {
      // Prefer awaiting so we can fail fast and switch to WebView.
      await _player!.open(Media(widget.videoUrl));

      // If nothing starts shortly after opening, fallback to WebView.
      // (On web, media_kit can silently fail depending on the stream/DRM.)
      await Future<void>.delayed(const Duration(seconds: 8));
      if (!mounted) return;
      if (!_isPlaying) {
        await _switchToWebView();
      }
    } catch (e) {
      // If media_kit can't even open the stream, immediately fall back.
      debugPrint('media_kit open failed, falling back to WebView: $e');
      await _switchToWebView();
    } finally {
      await sub.cancel();
    }
  }

  Future<void> _switchToWebView() async {
    // Stop/dispose the current player so the page doesn't keep resources alive.
    try {
      await _player?.dispose();
    } catch (_) {}
    _player = null;
    _videoController = null;

    _webView = true;
    setState(() {
      _error = null;
      _webController = null;
      _loading = true;
    });

    await _initWebView();
    if (mounted) setState(() => _loading = false);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
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
    if (_loading || _error != null) return false;
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
        // Landscape: fill the display like native zoom; portrait: full frame with letterboxing if needed.
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
                  child: _webView && _webController != null
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
              if (_error != null)
                Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      'Kuna tatizo la kucheza video.\n${_error!}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white70),
                    ),
                  ),
                ),
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
              if (widget.channelName != null)
                SafeArea(
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 8, left: 48, right: 48),
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
