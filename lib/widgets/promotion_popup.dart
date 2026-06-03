import 'dart:math' as math;
import 'dart:ui';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/promotion.dart';
import '../services/promotion_service.dart';

class PromotionPopupOverlay extends StatefulWidget {
  const PromotionPopupOverlay({
    super.key,
    required this.promotion,
    required this.onDismiss,
    this.onForceUpdate,
  });

  final Promotion promotion;
  final VoidCallback onDismiss;
  final VoidCallback? onForceUpdate;

  @override
  State<PromotionPopupOverlay> createState() => _PromotionPopupOverlayState();
}

class _PromotionPopupOverlayState extends State<PromotionPopupOverlay>
    with TickerProviderStateMixin {
  late final AnimationController _enterCtrl;
  late final AnimationController _floatCtrl;
  late final Animation<double> _fade;
  late final Animation<double> _scale;
  bool _closing = false;
  bool _viewReported = false;

  @override
  void initState() {
    super.initState();
    _enterCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );
    _floatCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2400),
    )..repeat(reverse: true);
    _fade = CurvedAnimation(parent: _enterCtrl, curve: Curves.easeOut);
    _scale = Tween<double>(begin: 0.8, end: 1).animate(
      CurvedAnimation(parent: _enterCtrl, curve: Curves.elasticOut),
    );
    _enterCtrl.forward();
    _reportViewOnce();
  }

  Future<void> _reportViewOnce() async {
    if (_viewReported) return;
    _viewReported = true;
    await promotionService.reportView(widget.promotion.id);
    await promotionService.markShown(widget.promotion);
  }

  @override
  void dispose() {
    _enterCtrl.dispose();
    _floatCtrl.dispose();
    super.dispose();
  }

  Future<void> _close() async {
    if (_closing) return;
    _closing = true;
    await promotionService.reportClose(widget.promotion.id);
    await _enterCtrl.reverse();
    if (mounted) widget.onDismiss();
  }

  Future<void> _onCta() async {
    await promotionService.reportClick(widget.promotion.id);
    if (widget.promotion.forceUpdate || widget.promotion.type == 'force_update') {
      widget.onForceUpdate?.call();
      return;
    }
    final url = widget.promotion.buttonUrl?.trim();
    if (url != null && url.isNotEmpty) {
      final uri = Uri.tryParse(url);
      if (uri != null && await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    }
    await _close();
  }

  List<Color> _gradient() {
    switch (widget.promotion.backgroundStyle) {
      case 'gold':
        return const [Color(0xFFB8860B), Color(0xFF78350F), Color(0xFF1C1917)];
      case 'premium_blue':
        return const [Color(0xFF2563EB), Color(0xFF1E3A8A), Color(0xFF0F172A)];
      case 'red_alert':
        return const [Color(0xFFDC2626), Color(0xFF991B1B), Color(0xFF1F2937)];
      case 'green_success':
        return const [Color(0xFF16A34A), Color(0xFF166534), Color(0xFF052E16)];
      case 'dark_glass':
      default:
        return const [Color(0xFF334155), Color(0xFF1E293B), Color(0xFF020617)];
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.promotion;
    final canClose = !p.blocksAppForUpdate;
    final maxW = math.min(MediaQuery.sizeOf(context).width - 32, 400.0);

    return Material(
      color: Colors.transparent,
      child: FadeTransition(
        opacity: _fade,
        child: Container(
          color: const Color(0xBF000000),
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
          child: AnimatedBuilder(
            animation: Listenable.merge([_scale, _floatCtrl]),
            builder: (context, child) {
              final floatY = math.sin(_floatCtrl.value * math.pi * 2) * 6;
              return Transform.translate(
                offset: Offset(0, floatY),
                child: Transform.scale(scale: _scale.value, child: child),
              );
            },
            child: ClipRRect(
              borderRadius: BorderRadius.circular(28),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
                child: Container(
                  constraints: BoxConstraints(maxWidth: maxW),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(28),
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: _gradient(),
                    ),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.55),
                        blurRadius: 48,
                        offset: const Offset(0, 24),
                      ),
                    ],
                  ),
                  child: Stack(
                    children: [
                      Padding(
                        padding: EdgeInsets.fromLTRB(24, canClose ? 48 : 28, 24, 28),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (p.isImageType) ...[
                              CachedNetworkImage(
                                imageUrl: p.imageUrl!,
                                height: 180,
                                fit: BoxFit.contain,
                                fadeInDuration: const Duration(milliseconds: 280),
                                placeholder: (_, __) => const SizedBox(
                                  height: 120,
                                  child: Center(
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  ),
                                ),
                                errorWidget: (_, __, ___) => const Icon(
                                  Icons.image_not_supported_outlined,
                                  size: 64,
                                  color: Colors.white54,
                                ),
                              ),
                              const SizedBox(height: 20),
                            ],
                            Text(
                              p.title,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.w800,
                                color: Colors.white,
                                letterSpacing: 0.3,
                              ),
                            ),
                            if (p.description.isNotEmpty) ...[
                              const SizedBox(height: 12),
                              Text(
                                p.description,
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontSize: 15,
                                  height: 1.45,
                                  color: Colors.white.withValues(alpha: 0.88),
                                ),
                              ),
                            ],
                            const SizedBox(height: 24),
                            _CtaButton(label: p.buttonText, onPressed: _onCta),
                          ],
                        ),
                      ),
                      if (canClose)
                        Positioned(
                          top: 12,
                          right: 12,
                          child: _CloseButton(onTap: _close),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CloseButton extends StatelessWidget {
  const _CloseButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.14),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: const SizedBox(
          width: 40,
          height: 40,
          child: Icon(Icons.close_rounded, color: Colors.white, size: 22),
        ),
      ),
    );
  }
}

class _CtaButton extends StatefulWidget {
  const _CtaButton({required this.label, required this.onPressed});
  final String label;
  final VoidCallback onPressed;

  @override
  State<_CtaButton> createState() => _CtaButtonState();
}

class _CtaButtonState extends State<_CtaButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) {
        setState(() => _pressed = false);
        widget.onPressed();
      },
      onTapCancel: () => setState(() => _pressed = false),
      child: AnimatedScale(
        scale: _pressed ? 0.96 : 1,
        duration: const Duration(milliseconds: 120),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            gradient: const LinearGradient(
              colors: [Color(0xFF8B5CF6), Color(0xFF6D28D9)],
            ),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF8B5CF6).withValues(alpha: 0.45),
                blurRadius: 20,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          alignment: Alignment.center,
          child: Text(
            widget.label,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              color: Colors.white,
              letterSpacing: 0.4,
            ),
          ),
        ),
      ),
    );
  }
}
