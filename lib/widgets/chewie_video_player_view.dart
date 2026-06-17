import 'dart:async';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import 'package:chewie/chewie.dart';

/// Chewie UI over [video_player] — HLS/MP4 progressive on mobile.
class ChewieVideoPlayerView extends StatefulWidget {
  const ChewieVideoPlayerView({
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
  State<ChewieVideoPlayerView> createState() => _ChewieVideoPlayerViewState();
}

class _ChewieVideoPlayerViewState extends State<ChewieVideoPlayerView> {
  VideoPlayerController? _video;
  ChewieController? _chewie;
  bool _loading = true;

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
      );
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      controller.addListener(() {
        if (controller.value.isPlaying) widget.onPlaying?.call();
      });
      final chewie = ChewieController(
        videoPlayerController: controller,
        autoPlay: true,
        looping: false,
        allowFullScreen: false,
        allowMuting: true,
        showControls: true,
        materialProgressColors: ChewieProgressColors(
          playedColor: const Color(0xFF7C3AED),
          handleColor: const Color(0xFFA78BFA),
          backgroundColor: Colors.white24,
          bufferedColor: Colors.white38,
        ),
        placeholder: const ColoredBox(color: Colors.black),
        errorBuilder: (_, message) => Center(
          child: Text(message, style: const TextStyle(color: Colors.white70)),
        ),
      );
      setState(() {
        _video = controller;
        _chewie = chewie;
        _loading = false;
      });
      await controller.play();
    } catch (e) {
      if (mounted) {
        setState(() => _loading = false);
        widget.onError?.call('$e');
      }
    }
  }

  @override
  void dispose() {
    _chewie?.dispose();
    _video?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_chewie == null || _video == null) {
      return const Center(
        child: Text('Chewie haikuweza kuanza', style: TextStyle(color: Colors.white70)),
      );
    }
    return OrientationBuilder(
      builder: (context, orientation) {
        final controller = _video!;
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
        return Chewie(controller: _chewie!);
      },
    );
  }
}
