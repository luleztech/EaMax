import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/carousel_slide.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import 'safe_network_image.dart';

/// Supasoka-style hero carousel: 360px, in-card dots, LIVE badge overlay.
/// Supports static images (JPG/PNG/WebP) and animated GIFs from admin URLs.
class EamaxCarousel extends StatefulWidget {
  const EamaxCarousel({super.key, required this.items});

  final List<CarouselSlide> items;

  @override
  State<EamaxCarousel> createState() => _EamaxCarouselState();
}

class _EamaxCarouselState extends State<EamaxCarousel> {
  late final PageController _pageController;
  int _index = 0;
  Timer? _timer;

  static const double _height = 360;

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
    _timer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!mounted || widget.items.length <= 1) return;
      final next = (_index + 1) % widget.items.length;
      setState(() => _index = next);
      _pageController.animateToPage(next, duration: const Duration(milliseconds: 450), curve: Curves.easeOutCubic);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    if (widget.items.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      child: Container(
        width: double.infinity,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: t.border.withValues(alpha: 0.6)),
          boxShadow: [
            BoxShadow(
              color: t.accent.withValues(alpha: 0.14),
              blurRadius: 24,
              spreadRadius: -6,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(20),
          child: SizedBox(
            height: _height,
            child: Stack(
              fit: StackFit.expand,
              children: [
                PageView.builder(
                  controller: _pageController,
                  itemCount: widget.items.length,
                  onPageChanged: (i) => setState(() => _index = i),
                  itemBuilder: (context, i) => _CarouselSlideWidget(
                    key: ValueKey(widget.items[i].id ?? widget.items[i].imageUrl ?? i),
                    item: widget.items[i],
                    colors: t,
                  ),
                ),
                Positioned(
                  left: 18,
                  right: 18,
                  bottom: 14,
                  child: Row(
                    children: List.generate(widget.items.length, (i) {
                      final active = i == _index;
                      return GestureDetector(
                        onTap: () {
                          setState(() => _index = i);
                          _pageController.animateToPage(
                            i,
                            duration: const Duration(milliseconds: 300),
                            curve: Curves.easeOutCubic,
                          );
                        },
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 300),
                          margin: const EdgeInsets.only(right: 6),
                          height: 3,
                          width: active ? 32 : 14,
                          decoration: BoxDecoration(
                            color: active ? t.accent : const Color(0xFF52525b),
                            borderRadius: BorderRadius.circular(99),
                          ),
                        ),
                      );
                    }),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CarouselSlideWidget extends StatefulWidget {
  const _CarouselSlideWidget({super.key, required this.item, required this.colors});
  final CarouselSlide item;
  final AppThemeColors colors;

  @override
  State<_CarouselSlideWidget> createState() => _CarouselSlideWidgetState();
}

class _CarouselSlideWidgetState extends State<_CarouselSlideWidget> with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final item = widget.item;
    final colors = widget.colors;
    final badge = (item.badge != null && item.badge!.trim().isNotEmpty) ? item.badge!.trim() : 'LIVE';
    final title = item.title?.trim() ?? '';

    return Stack(
      fit: StackFit.expand,
      children: [
        RepaintBoundary(
          child: item.imageUrl != null && item.imageUrl!.isNotEmpty
              ? SafeNetworkImage(imageUrl: item.imageUrl!, fit: BoxFit.cover, placeholderColor: colors.card)
              : DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: item.gradient.length >= 2 ? item.gradient : [colors.card, colors.bg2],
                    ),
                  ),
                ),
        ),
        // Vignette — keeps text readable on bright GIFs / photos.
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              stops: [0.0, 0.35, 0.72, 1.0],
              colors: [
                Color(0x14000000),
                Color(0x00000000),
                Color(0x66000000),
                Color(0xC0000000),
              ],
            ),
          ),
        ),
        Positioned(
          left: 20,
          right: 24,
          bottom: 36,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: colors.red, borderRadius: BorderRadius.circular(4)),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(width: 4, height: 4, decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle)),
                    const SizedBox(width: 6),
                    Text(
                      badge.toUpperCase(),
                      style: orbitron(8, weight: FontWeight.w900).copyWith(color: Colors.white, letterSpacing: 1.5),
                    ),
                  ],
                ),
              ),
              if (title.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  title.toUpperCase(),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: inter(18, weight: FontWeight.w900).copyWith(
                    color: Colors.white,
                    height: 1.15,
                    fontStyle: FontStyle.italic,
                    letterSpacing: -0.5,
                    shadows: const [Shadow(color: Colors.black54, blurRadius: 12, offset: Offset(0, 2))],
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
