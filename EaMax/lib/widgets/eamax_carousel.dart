import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../models/carousel_slide.dart';
import '../theme/app_theme.dart';

/// Home hero carousel — layout matches RN `ImageCarousel` (320px height, rounded, dots, arrows).
class EamaxCarousel extends StatefulWidget {
  const EamaxCarousel({
    super.key,
    required this.items,
    required this.onPlaySlide,
  });

  final List<CarouselSlide> items;
  final Future<void> Function(CarouselSlide slide) onPlaySlide;

  @override
  State<EamaxCarousel> createState() => _EamaxCarouselState();
}

class _EamaxCarouselState extends State<EamaxCarousel> {
  late final PageController _pageController;
  int _index = 0;
  Timer? _timer;

  static const double _height = 320;
  static const _autoMs = 5000;

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
    _startTimer();
  }

  void _startTimer() {
    _timer?.cancel();
    if (widget.items.length <= 1) return;
    _timer = Timer.periodic(const Duration(milliseconds: _autoMs), (_) {
      if (!mounted || !_pageController.hasClients) return;
      final next = (_index + 1) % widget.items.length;
      _pageController.animateToPage(
        next,
        duration: const Duration(milliseconds: 680),
        curve: Curves.easeInOutCubic,
      );
    });
  }

  @override
  void didUpdateWidget(covariant EamaxCarousel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.items.length != widget.items.length) {
      _startTimer();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width - 32;
    if (widget.items.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(left: 16, right: 16, bottom: 8),
      child: Column(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: SizedBox(
              width: w,
              height: _height,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  PageView.builder(
                    controller: _pageController,
                    itemCount: widget.items.length,
                    onPageChanged: (i) => setState(() => _index = i),
                    itemBuilder: (context, i) {
                      final item = widget.items[i];
                      return GestureDetector(
                        onTap: () {
                          widget.onPlaySlide(item);
                        },
                        child: _SlideContent(item: item),
                      );
                    },
                  ),
                  if (widget.items.length > 1) ...[
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: _NavArrow(
                          icon: Icons.chevron_left,
                          onTap: () {
                            final next = (_index - 1 + widget.items.length) % widget.items.length;
                            _pageController.animateToPage(
                              next,
                              duration: const Duration(milliseconds: 680),
                              curve: Curves.easeInOutCubic,
                            );
                            _startTimer();
                          },
                        ),
                      ),
                    ),
                    Align(
                      alignment: Alignment.centerRight,
                      child: Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: _NavArrow(
                          icon: Icons.chevron_right,
                          onTap: () {
                            final next = (_index + 1) % widget.items.length;
                            _pageController.animateToPage(
                              next,
                              duration: const Duration(milliseconds: 680),
                              curve: Curves.easeInOutCubic,
                            );
                            _startTimer();
                          },
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (widget.items.length > 1)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(widget.items.length, (i) {
                  final active = i == _index;
                  return GestureDetector(
                    onTap: () {
                      _pageController.animateToPage(
                        i,
                        duration: const Duration(milliseconds: 680),
                        curve: Curves.easeInOutCubic,
                      );
                      _startTimer();
                    },
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      width: active ? 22 : 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: active ? const Color(0xFF22C55E) : const Color(0x47FFFFFF),
                        borderRadius: BorderRadius.circular(3.5),
                      ),
                    ),
                  );
                }),
              ),
            ),
        ],
      ),
    );
  }
}

class _NavArrow extends StatelessWidget {
  const _NavArrow({required this.icon, required this.onTap});
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0x61000000),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(4),
          child: Icon(icon, color: const Color(0xD9FFFFFF), size: 20),
        ),
      ),
    );
  }
}

class _SlideContent extends StatelessWidget {
  const _SlideContent({required this.item});
  final CarouselSlide item;

  Widget _fallback() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF0C0F1A), Color(0xFF111827), Color(0xFF000000)],
        ),
      ),
      child: const Center(
        child: Icon(Icons.image_not_supported_outlined, color: Color(0x66FFFFFF), size: 44),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        if (item.imageUrl != null && item.imageUrl!.isNotEmpty)
          CachedNetworkImage(
            imageUrl: item.imageUrl!,
            fit: BoxFit.cover,
            placeholder: (_, __) => _fallback(),
            errorWidget: (_, __, ___) => _fallback(),
          )
        else
          _fallback(),
        Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Colors.black.withValues(alpha: 0.08),
                Colors.black.withValues(alpha: 0.18),
                Colors.black.withValues(alpha: 0.72),
              ],
            ),
          ),
        ),
        if (item.badge != null && item.badge!.isNotEmpty)
          Positioned(
            top: 14,
            left: 14,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: AppColors.liveRed,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 7,
                    height: 7,
                    decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                  ),
                  const SizedBox(width: 5),
                  Text(
                    item.badge!,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.4,
                    ),
                  ),
                ],
              ),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.end,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (item.title != null && item.title!.isNotEmpty)
                Text(
                  item.title!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                    letterSpacing: 0.3,
                    shadows: [Shadow(blurRadius: 6, color: Colors.black87, offset: Offset(0, 2))],
                  ),
                ),
              if (item.subtitle != null && item.subtitle!.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  item.subtitle!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    color: Colors.white.withValues(alpha: 0.82),
                    shadows: const [Shadow(blurRadius: 4, color: Colors.black54, offset: Offset(0, 1))],
                  ),
                ),
              ],
              if (item.info.isNotEmpty) ...[
                const SizedBox(height: 10),
                Wrap(
                  spacing: 10,
                  runSpacing: 4,
                  children: item.info
                      .map(
                        (inf) => Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.schedule, size: 13, color: AppColors.gold),
                            const SizedBox(width: 4),
                            Text(
                              inf.text,
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.gold,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      )
                      .toList(),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
