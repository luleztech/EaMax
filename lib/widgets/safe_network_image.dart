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
    this.memCacheHeight,
    this.errorWidget,
    this.placeholder,
    this.httpHeaders = _browserImageHeaders,
  });

  /// Browser-like headers help CDNs that throttle empty/`Dart` user-agents.
  static const Map<String, String> _browserImageHeaders = {
    'User-Agent':
        'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };

  final String imageUrl;
  final BoxFit? fit;
  final Color? placeholderColor;
  final double? width;
  final double? height;
  final Alignment alignment;
  final int? memCacheWidth;
  final int? memCacheHeight;
  final Widget Function(BuildContext, String, Object)? errorWidget;
  final Widget Function(BuildContext, String)? placeholder;
  final Map<String, String>? httpHeaders;

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
      if (errorWidget != null) return errorWidget!(context, url, StateError('empty'));
      if (width != null || height != null) {
        return ColoredBox(color: bg, child: SizedBox(width: width, height: height));
      }
      return SizedBox.expand(child: ColoredBox(color: bg));
    }

    final dpr = MediaQuery.devicePixelRatioOf(context);
    final resolvedMemW = memCacheWidth ??
        (width != null ? (width! * dpr).round().clamp(64, 1080).toInt() : null);
    final resolvedMemH = memCacheHeight ??
        (height != null ? (height! * dpr).round().clamp(64, 1080).toInt() : null);
    // Downscale huge posters (multi‑MB CDN uploads) before disk/decode.
    final diskW = resolvedMemW == null ? null : (resolvedMemW * 2).clamp(128, 1280).toInt();
    final diskH = resolvedMemH == null ? null : (resolvedMemH * 2).clamp(128, 1280).toInt();

    // Animated GIF: avoid mem-cache resize / fade — keeps animation smooth in carousels.
    if (isLikelyAnimatedGifUrl(url)) {
      return Image(
        image: CachedNetworkImageProvider(url, headers: httpHeaders),
        fit: fit,
        width: width,
        height: height,
        alignment: alignment,
        gaplessPlayback: true,
        filterQuality: FilterQuality.medium,
        loadingBuilder: (context, child, progress) {
          if (progress == null) return child;
          return placeholder?.call(context, url) ?? _placeholder(bg);
        },
        errorBuilder: (context, error, _) =>
            errorWidget?.call(context, url, error) ?? _error(bg),
      );
    }

    return CachedNetworkImage(
      imageUrl: url,
      fit: fit,
      width: width,
      height: height,
      alignment: alignment,
      memCacheWidth: resolvedMemW,
      memCacheHeight: resolvedMemH,
      maxWidthDiskCache: diskW,
      maxHeightDiskCache: diskH,
      httpHeaders: httpHeaders,
      placeholder: (context, u) => placeholder?.call(context, u) ?? _placeholder(bg),
      errorWidget: (context, u, err) => errorWidget?.call(context, u, err) ?? _error(bg),
      fadeInDuration: const Duration(milliseconds: 200),
      fadeOutDuration: Duration.zero,
    );
  }
}
