import 'dart:async';

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'safe_network_image.dart';

/// Full-bleed 400px hero: images cross-fade (with a gentle zoom-out) every 4.5s.
class TplHeroCarousel extends StatefulWidget {
  const TplHeroCarousel({super.key, required this.images, this.height = 480});

  final List<String> images;
  final double height;

  @override
  State<TplHeroCarousel> createState() => _TplHeroCarouselState();
}

class _TplHeroCarouselState extends State<TplHeroCarousel> {
  int _index = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _restartTimer();
  }

  @override
  void didUpdateWidget(covariant TplHeroCarousel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_index >= widget.images.length) _index = 0;
  }

  void _restartTimer() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(milliseconds: 4500), (_) {
      if (!mounted || widget.images.length <= 1) return;
      setState(() => _index = (_index + 1) % widget.images.length);
    });
  }

  void _go(int i) {
    final n = widget.images.length;
    if (n == 0) return;
    setState(() => _index = (i % n + n) % n);
    _restartTimer();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final images = widget.images;
    return SizedBox(
      height: widget.height,
      width: double.infinity,
      child: GestureDetector(
        onHorizontalDragEnd: (d) {
          final v = d.primaryVelocity ?? 0;
          if (v.abs() < 200) return;
          _go(v < 0 ? _index + 1 : _index - 1);
        },
        child: Stack(
          fit: StackFit.expand,
          children: [
            const ColoredBox(color: Tpl.slate900),
            for (var i = 0; i < images.length; i++)
              AnimatedOpacity(
                key: ValueKey(images[i]),
                opacity: i == _index ? 1 : 0,
                duration: const Duration(milliseconds: 1000),
                curve: Curves.easeInOut,
                child: AnimatedScale(
                  scale: i == _index ? 1 : 1.05,
                  duration: const Duration(milliseconds: 1000),
                  curve: Curves.easeInOut,
                  child: SafeNetworkImage(imageUrl: images[i], fit: BoxFit.cover, placeholderColor: Tpl.slate900),
                ),
              ),
            const Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              height: 112,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.bottomCenter,
                    end: Alignment.topCenter,
                    colors: [Tpl.slate950, Color(0x00020617)],
                  ),
                ),
              ),
            ),
            if (images.length > 1)
              Positioned(
                left: 0,
                right: 0,
                bottom: 24,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    for (var i = 0; i < images.length; i++)
                      GestureDetector(
                        onTap: () => _go(i),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 150),
                          margin: const EdgeInsets.symmetric(horizontal: 4),
                          height: 6,
                          width: i == _index ? 28 : 8,
                          decoration: BoxDecoration(
                            color: i == _index ? Tpl.lime400 : Colors.white.withValues(alpha: 0.5),
                            borderRadius: BorderRadius.circular(999),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
