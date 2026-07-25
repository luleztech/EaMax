import 'dart:async';
import 'dart:math' as math;
import 'dart:ui';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/api.dart';
import '../config/payment_helpers.dart';
import '../models/api_exceptions.dart';
import '../models/promotion.dart';
import '../utils/api_error_message.dart';
import '../services/promotion_service.dart';
import '../services/user_id.dart';

class PromotionPopupOverlay extends StatefulWidget {
  const PromotionPopupOverlay({
    super.key,
    required this.promotion,
    required this.onDismiss,
    this.onPaymentSuccess,
  });

  final Promotion promotion;
  final VoidCallback onDismiss;
  /// Called only after payment is confirmed and premium is unlocked.
  final PremiumUnlockCallback? onPaymentSuccess;

  @override
  State<PromotionPopupOverlay> createState() => _PromotionPopupOverlayState();
}

class _PromotionPopupOverlayState extends State<PromotionPopupOverlay>
    with TickerProviderStateMixin {
  late final AnimationController _enterCtrl;
  late final Animation<double> _fade;
  late final Animation<double> _scale;
  bool _closing = false;
  bool _viewReported = false;
  Timer? _countdownTimer;
  Duration? _remaining;
  bool _offerExpired = false;
  bool _submittingOffer = false;

  static const _tzPrefixes = [
    '061', '062', '063', '065', '067', '068', '069',
    '071', '074', '075', '076', '077', '078', '079',
  ];

  @override
  void initState() {
    super.initState();
    _enterCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 280),
    );
    _fade = CurvedAnimation(parent: _enterCtrl, curve: Curves.easeOut);
    _scale = Tween<double>(begin: 0.88, end: 1).animate(
      CurvedAnimation(parent: _enterCtrl, curve: Curves.easeOutCubic),
    );
    _enterCtrl.forward();
    _reportViewOnce();
    _startCountdownIfNeeded();
  }

  void _startCountdownIfNeeded() {
    if (!widget.promotion.isOfa) return;
    final ends = widget.promotion.offerEndsAt;
    if (ends == null) {
      unawaited(_startLocalCountdown());
      return;
    }
    void tick() {
      final left = ends.difference(DateTime.now());
      if (!mounted) return;
      setState(() {
        _remaining = left.isNegative ? Duration.zero : left;
        _offerExpired = left.isNegative;
      });
    }
    tick();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) => tick());
  }

  Future<void> _startLocalCountdown() async {
    final localEnds = await promotionService.localOfaEndsAt(widget.promotion);
    final mins = widget.promotion.offerCountdownMinutes ?? 0;
    final ends = localEnds ??
        (mins > 0 ? DateTime.now().add(Duration(minutes: mins)) : null);
    if (ends == null) return;
    void tick() {
      final left = ends.difference(DateTime.now());
      if (!mounted) return;
      setState(() {
        _remaining = left.isNegative ? Duration.zero : left;
        _offerExpired = left.isNegative;
      });
    }
    tick();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) => tick());
  }

  Future<void> _reportViewOnce() async {
    if (_viewReported) return;
    _viewReported = true;
    await promotionService.reportView(widget.promotion.id);
    await promotionService.markShown(widget.promotion);
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _enterCtrl.dispose();
    super.dispose();
  }

  Future<void> _close() async {
    if (_closing || _submittingOffer) return;
    _closing = true;
    await promotionService.reportClose(widget.promotion.id);
    await _enterCtrl.reverse();
    if (mounted) widget.onDismiss();
  }

  Future<void> _onLinkTap() async {
    await promotionService.reportClick(widget.promotion.id);
    final url = widget.promotion.buttonUrl?.trim();
    if (url != null && url.isNotEmpty) {
      final uri = Uri.tryParse(url);
      if (uri != null && await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    }
    await _close();
  }

  String _normalizePhone(String raw) {
    var s = raw.replaceAll(RegExp(r'\s+'), '');
    if (s.startsWith('+255')) {
      s = '0${s.substring(4)}';
    } else if (s.startsWith('255') && s.length >= 12) {
      s = '0${s.substring(3)}';
    }
    if (RegExp(r'^[1-9]\d{8}$').hasMatch(s)) {
      s = '0$s';
    }
    return s;
  }

  bool _phoneValid(String raw) {
    final clean = _normalizePhone(raw);
    if (!RegExp(r'^0\d{8,9}$').hasMatch(clean)) return false;
    return _tzPrefixes.any((p) => clean.startsWith(p));
  }

  Future<void> _pokeaOfa() async {
    final p = widget.promotion;
    if (_offerExpired || p.offerAmountTsh == null) return;

    final phoneCtrl = TextEditingController();
    final formKey = GlobalKey<FormState>();

    final confirmed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: const Color(0xFF111827),
          title: const Text(
            'Nambari ya simu',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800),
          ),
          content: Form(
            key: formKey,
            child: TextFormField(
              controller: phoneCtrl,
              keyboardType: TextInputType.phone,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                hintText: '0712345678',
                hintStyle: TextStyle(color: Colors.white38),
                enabledBorder: UnderlineInputBorder(
                  borderSide: BorderSide(color: Colors.white24),
                ),
              ),
              validator: (v) {
                if (!_phoneValid(v ?? '')) {
                  return 'Andika nambari sahihi (M-Pesa, Halopesa, n.k.)';
                }
                return null;
              },
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Ghairi'),
            ),
            FilledButton(
              onPressed: () {
                if (formKey.currentState?.validate() != true) return;
                Navigator.pop(ctx, true);
              },
              child: const Text('Tuma ombi'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted) return;

    await promotionService.reportClick(p.id);

    final uid = await getStoredUserId();
    if (uid == null || uid.isEmpty) {
      _showSnack('Fungua wasifu kwanza, kisha jaribu tena.');
      return;
    }

    setState(() => _submittingOffer = true);
    try {
      final result = await paymentsApi.startOfferPayment(
        externalId: uid,
        promotionId: p.id,
        amount: p.offerAmountTsh!,
        phone: _normalizePhone(phoneCtrl.text),
        email: '$uid@eamax.app',
        name: uid,
      );
      final orderId = (result['orderId']?.toString() ?? '').trim();
      if (orderId.isNotEmpty) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('pendingPaymentOrderId', orderId);
      }
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: const Color(0xFF111827),
          title: const Text(
            'Ombi limetumwa',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800),
          ),
          content: Text(
            'Angalia simu yako na uingize PIN ya malipo ya Tsh.${_formatAmount(p.offerAmountTsh!)}. '
            'Channel zote zitafunguliwa moja kwa moja baada ya malipo.',
            style: const TextStyle(color: Colors.white70, height: 1.4),
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Sawa'),
            ),
          ],
        ),
      );
      // Do NOT unlock here — pendingPaymentOrderId watcher / status poll unlocks after PIN.
      await _close();
    } on ApiRateLimitedException catch (e) {
      _showSnack(userFacingApiError(e));
    } catch (e) {
      _showSnack(userFacingApiError(e));
    } finally {
      if (mounted) setState(() => _submittingOffer = false);
    }
  }

  void _showSnack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating),
    );
  }

  String _formatAmount(int n) =>
      n.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (m) => '${m[1]},');

  String _countdownSw() {
    final r = _remaining;
    if (r == null) return '';
    if (r.inSeconds <= 0) return 'Ofa imekwisha';
    if (r.inMinutes < 60) {
      final m = r.inMinutes;
      final s = r.inSeconds % 60;
      return m > 0 ? 'Zimebaki dakika $m ofa iishe' : 'Zimebaki sekunde $s ofa iishe';
    }
    if (r.inHours < 24) {
      return 'Zimebaki masaa ${r.inHours} ofa iishe';
    }
    return 'Zimebaki siku ${r.inDays} ofa iishe';
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
      default:
        return const [Color(0xFF334155), Color(0xFF1E293B), Color(0xFF020617)];
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.promotion;
    final screen = MediaQuery.sizeOf(context);
    final imagePromo = p.hasImage && p.isPicha;
    final maxW = imagePromo
        ? screen.width - 24
        : math.min(screen.width - 32, 400.0);
    final maxImageH = screen.height * 0.78;

    return Material(
      type: MaterialType.transparency,
      child: FadeTransition(
        opacity: _fade,
        child: GestureDetector(
          onTap: _close,
          behavior: HitTestBehavior.opaque,
          child: Container(
            color: const Color(0xBF000000),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 32),
            child: GestureDetector(
              onTap: () {},
              child: ScaleTransition(
                scale: _scale,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(24),
                  child: BackdropFilter(
                    filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
                    child: Container(
                      constraints: BoxConstraints(maxWidth: maxW),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(24),
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: _gradient(),
                        ),
                        border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.5),
                            blurRadius: 32,
                            offset: const Offset(0, 16),
                          ),
                        ],
                      ),
                      child: Stack(
                        clipBehavior: Clip.none,
                        children: [
                          SingleChildScrollView(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                if (p.hasImage) ...[
                                  _PromotionFullImage(
                                    url: p.imageUrl!,
                                    maxWidth: maxW,
                                    maxHeight: maxImageH,
                                  ),
                                  if (!imagePromo) const SizedBox(height: 16),
                                ],
                                Padding(
                                  padding: EdgeInsets.fromLTRB(
                                    22,
                                    p.hasImage ? 16 : 44,
                                    22,
                                    22,
                                  ),
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                Text(
                                  p.title,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.w800,
                                    color: Colors.white,
                                  ),
                                ),
                                if (p.description.isNotEmpty) ...[
                                  const SizedBox(height: 10),
                                  Text(
                                    p.description,
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      fontSize: 14,
                                      height: 1.45,
                                      color: Colors.white.withValues(alpha: 0.9),
                                    ),
                                  ),
                                ],
                                if (p.isOfa) ...[
                                  const SizedBox(height: 14),
                                  if (_countdownSw().isNotEmpty)
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 14,
                                        vertical: 8,
                                      ),
                                      decoration: BoxDecoration(
                                        color: Colors.black.withValues(alpha: 0.25),
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: Text(
                                        _countdownSw(),
                                        textAlign: TextAlign.center,
                                        style: const TextStyle(
                                          color: Color(0xFFFBBF24),
                                          fontWeight: FontWeight.w700,
                                          fontSize: 14,
                                        ),
                                      ),
                                    ),
                                  if (p.offerAmountTsh != null) ...[
                                    const SizedBox(height: 12),
                                    Text(
                                      'Fungua channel zote kwa Tsh.${_formatAmount(p.offerAmountTsh!)} kwa ${p.periodLabelSw}',
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 15,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ],
                                  const SizedBox(height: 18),
                                  Row(
                                    children: [
                                      Expanded(
                                        child: OutlinedButton(
                                          onPressed: _offerExpired || _submittingOffer
                                              ? null
                                              : _close,
                                          style: OutlinedButton.styleFrom(
                                            foregroundColor: Colors.white70,
                                            side: const BorderSide(color: Colors.white38),
                                            padding: const EdgeInsets.symmetric(vertical: 14),
                                          ),
                                          child: const Text('Kataa'),
                                        ),
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        flex: 2,
                                        child: FilledButton(
                                          onPressed: _offerExpired || _submittingOffer
                                              ? null
                                              : _pokeaOfa,
                                          style: FilledButton.styleFrom(
                                            backgroundColor: const Color(0xFF16A34A),
                                            padding: const EdgeInsets.symmetric(vertical: 14),
                                          ),
                                          child: _submittingOffer
                                              ? const SizedBox(
                                                  width: 22,
                                                  height: 22,
                                                  child: CircularProgressIndicator(
                                                    strokeWidth: 2,
                                                    color: Colors.white,
                                                  ),
                                                )
                                              : const Text(
                                                  'Pokea Ofa',
                                                  style: TextStyle(fontWeight: FontWeight.w800),
                                                ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ] else ...[
                                  if (p.showLinkButton) ...[
                                    const SizedBox(height: 20),
                                    SizedBox(
                                      width: double.infinity,
                                      child: FilledButton(
                                        onPressed: _onLinkTap,
                                        style: FilledButton.styleFrom(
                                          backgroundColor: const Color(0xFF7C3AED),
                                          padding: const EdgeInsets.symmetric(vertical: 14),
                                        ),
                                        child: Text(
                                          p.buttonText.isNotEmpty ? p.buttonText : 'Fungua',
                                          style: const TextStyle(fontWeight: FontWeight.w800),
                                        ),
                                      ),
                                    ),
                                  ],
                                ],
                              ],
                            ),
                          ),
                              ],
                            ),
                          ),
                          Positioned(
                            top: 8,
                            right: 8,
                            child: _RedCloseButton(
                              onTap: _close,
                              enabled: !_submittingOffer,
                            ),
                          ),
                        ],
                      ),
                    ),
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

/// Shows the full image at natural aspect ratio (no crop), up to [maxWidth] × [maxHeight].
class _PromotionFullImage extends StatelessWidget {
  const _PromotionFullImage({
    required this.url,
    required this.maxWidth,
    required this.maxHeight,
  });

  final String url;
  final double maxWidth;
  final double maxHeight;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: BoxConstraints(
        maxWidth: maxWidth,
        maxHeight: maxHeight,
      ),
      child: CachedNetworkImage(
        imageUrl: url,
        width: maxWidth,
        fit: BoxFit.contain,
        fadeInDuration: const Duration(milliseconds: 280),
        placeholder: (_, _) => SizedBox(
          width: maxWidth,
          height: math.min(maxHeight * 0.35, 160),
          child: const Center(
            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white70),
          ),
        ),
        errorWidget: (_, _, _) => SizedBox(
          width: maxWidth,
          height: 120,
          child: const Icon(
            Icons.broken_image_outlined,
            size: 48,
            color: Colors.white54,
          ),
        ),
      ),
    );
  }
}

class _RedCloseButton extends StatelessWidget {
  const _RedCloseButton({required this.onTap, required this.enabled});

  final VoidCallback onTap;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFDC2626),
      elevation: 4,
      shadowColor: Colors.black45,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: enabled ? onTap : null,
        child: const SizedBox(
          width: 36,
          height: 36,
          child: Icon(Icons.close_rounded, color: Colors.white, size: 22),
        ),
      ),
    );
  }
}
