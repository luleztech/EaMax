import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../utils/media_url.dart';
import 'pro_shimmer.dart';

class SafeNetworkImage extends StatelessWidget {
  const SafeNetworkImage({
    super.key,
    required this.imageUrl,
    this.fit = BoxFit.cover,
    this.placeholderColor,
    this.width,
    this.height,
    this.alignment = Alignment.center,
    this.memCacheWidth,
  });

  final String imageUrl;
  final BoxFit? fit;
  final Color? placeholderColor;
  final double? width;
  final double? height;
  final Alignment alignment;
  final int? memCacheWidth;

  static String sanitize(String raw) {
    final u = raw.trim().replaceAll(RegExp(r'[\r\n\t]'), '');
    if (u.isEmpty || u == 'null') return '';
    return u;
  }

  Widget _placeholder(Color bg) {
    if (width != null || height != null) {
      return ProShimmer(child: ColoredBox(color: bg, child: SizedBox(width: width, height: height)));
    }
    return ProShimmer(child: SizedBox.expand(child: ColoredBox(color: bg)));
  }

  Widget _error(Color bg) {
    if (width != null || height != null) {
      return ColoredBox(color: bg, child: SizedBox(width: width, height: height));
    }
    return SizedBox.expand(child: ColoredBox(color: bg));
  }

  @override
  Widget build(BuildContext context) {
    final url = sanitize(imageUrl);
    final bg = placeholderColor ?? const Color(0xFF18181b);

    if (url.isEmpty) {
      if (width != null || height != null) {
        return ColoredBox(color: bg, child: SizedBox(width: width, height: height));
      }
      return SizedBox.expand(child: ColoredBox(color: bg));
    }

    // Animated GIF: avoid mem-cache resize / fade — keeps animation smooth in carousels.
    if (isLikelyAnimatedGifUrl(url)) {
      return Image(
        image: CachedNetworkImageProvider(url),
        fit: fit,
        width: width,
        height: height,
        alignment: alignment,
        gaplessPlayback: true,
        filterQuality: FilterQuality.medium,
        loadingBuilder: (context, child, progress) {
          if (progress == null) return child;
          return _placeholder(bg);
        },
        errorBuilder: (_, __, ___) => _error(bg),
      );
    }

    return CachedNetworkImage(
      imageUrl: url,
      fit: fit,
      width: width,
      height: height,
      alignment: alignment,
      memCacheWidth: memCacheWidth,
      placeholder: (_, __) => _placeholder(bg),
      errorWidget: (_, __, ___) => _error(bg),
      fadeInDuration: const Duration(milliseconds: 200),
      fadeOutDuration: Duration.zero,
    );
  }
}
