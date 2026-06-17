import 'dart:async';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

/// Lightweight native [video_player] — MP4/HLS where platform supports it.
class NativeVideoPlayerView extends StatefulWidget {
  const NativeVideoPlayerView({
    super.key,
    required this.url,
    this.httpHeaders = const {},
    this.onError,
    this.onPlaying,
  });

  final String url;
  final Map<String, String> httpHeaders;
  final ValueChanged<String>? onError;
  final VoidCallback? onPlaying;

  @override
  State<NativeVideoPlayerView> createState() => _NativeVideoPlayerViewState();
}

class _NativeVideoPlayerViewState extends State<NativeVideoPlayerView> {
  VideoPlayerController? _controller;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_init());
  }

  Future<void> _init() async {
    try {
      final controller = VideoPlayerController.networkUrl(
        Uri.parse(widget.url),
        httpHeaders: widget.httpHeaders,
        videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true),
      );
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      controller.addListener(() {
        if (controller.value.isPlaying) widget.onPlaying?.call();
      });
      setState(() {
        _controller = controller;
        _loading = false;
      });
      await controller.setLooping(false);
      await controller.play();
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = '$e';
        });
        widget.onError?.call('$e');
      }
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null || _controller == null) {
      return Center(
        child: Text(
          _error ?? 'Native player failed',
          style: const TextStyle(color: Colors.white70),
          textAlign: TextAlign.center,
        ),
      );
    }
    return OrientationBuilder(
      builder: (context, orientation) {
        final controller = _controller!;
        if (orientation == Orientation.landscape) {
          final size = controller.value.size;
          final w = size.width > 0 ? size.width : 16.0;
          final h = size.height > 0 ? size.height : 9.0;
          return SizedBox.expand(
            child: FittedBox(
              fit: BoxFit.cover,
              clipBehavior: Clip.hardEdge,
              child: SizedBox(
                width: w,
                height: h,
                child: VideoPlayer(controller),
              ),
            ),
          );
        }
        return Center(
          child: AspectRatio(
            aspectRatio: controller.value.aspectRatio > 0
                ? controller.value.aspectRatio
                : 16 / 9,
            child: VideoPlayer(controller),
          ),
        );
      },
    );
  }
}
