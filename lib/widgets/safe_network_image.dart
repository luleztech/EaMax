import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

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

    return CachedNetworkImage(
      imageUrl: url,
      fit: fit,
      width: width,
      height: height,
      alignment: alignment,
      memCacheWidth: memCacheWidth,
      placeholder: (_, __) => ProShimmer(child: ColoredBox(color: bg)),
      errorWidget: (_, __, ___) => ColoredBox(color: bg),
      fadeInDuration: const Duration(milliseconds: 200),
      fadeOutDuration: Duration.zero,
    );
  }
}
