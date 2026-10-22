import 'dart:async';
import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/api.dart';
import '../config/payment_helpers.dart';
import '../models/remote_config_bundle.dart';
import '../services/payment_pending_session.dart';
import '../services/remote_config_service.dart';
import '../services/user_id.dart';
import '../utils/payment_voices.dart';
import '../utils/tz_payment_config.dart';

/// Premium unlock as a centered 4-step card carousel with voice guides.
class PremiumLockModal extends StatefulWidget {
  const PremiumLockModal({
    super.key,
    this.onPaymentSuccess,
  });

  final PremiumUnlockCallback? onPaymentSuccess;

  static Future<void> show(
    BuildContext context, {
    PremiumUnlockCallback? onPaymentSuccess,
  }) {
    // Warm + start step-0 voice before the dialog paints.
    unawaited(PaymentVoices.prepare().then((_) => PaymentVoices.playStep(0)));
    return showGeneralDialog(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'premium-carousel',
      barrierColor: Colors.transparent,
      transitionDuration: const Duration(milliseconds: 220),
      pageBuilder: (_, _, _) => PremiumLockModal(onPaymentSuccess: onPaymentSuccess),
      transitionBuilder: (_, anim, _, child) {
        final curved = CurvedAnimation(parent: anim, curve: Curves.easeOutCubic);
        return AnimatedBuilder(
          animation: curved,
          builder: (context, _) {
            final t = curved.value;
            return Stack(
              fit: StackFit.expand,
              children: [
                // Frosted blur backdrop
                Opacity(
                  opacity: t,
                  child: BackdropFilter(
                    filter: ImageFilter.blur(sigmaX: 16 * t, sigmaY: 16 * t),
                    child: Container(
                      color: Color.lerp(
                        Colors.transparent,
                        const Color(0xCC0A0E16),
                        t,
                      ),
                    ),
                  ),
                ),
                FadeTransition(
                  opacity: curved,
                  child: ScaleTransition(
                    scale: Tween(begin: 0.97, end: 1.0).animate(curved),
                    child: child,
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  @override
  State<PremiumLockModal> createState() => _PremiumLockModalState();
}

class _PremiumLockModalState extends State<PremiumLockModal> with TickerProviderStateMixin {
  static const _prefsPhoneKey = 'eamax_pay_phone_v1';

  final _phoneCtrl = TextEditingController();
  final _phoneFocus = FocusNode();

  AnimationController? _pulse;
  AnimationController? _wave;
  AnimationController? _waitSpin;
  AnimationController? _successPop;

  int _page = 0;
  bool _speaking = false;
  bool _paymentSuccess = false;
  bool _paymentBusy = false;
  bool _resending = false;
  bool _promptOnPhone = false;
  bool _canResend = false;
  Timer? _resendRevealTimer;
  String? _formError;
  String? _selectedSlug;
  String _waitingHint = 'Tafadhali subiri kidogo…';
  String? _pendingPlanLabel;
  List<RemoteSubscriptionPlan> _plans = defaultSubscriptionPlans();

  Color get _green => const Color(0xFF19B26B);
  Color get _greenDark => const Color(0xFF0F8A52);
  Color get _navy => const Color(0xFF0F2748);
  Color get _navyMid => const Color(0xFF1A3A5C);
  Color get _section => const Color(0xFFF0F5FA);
  Color get _textPrimary => const Color(0xFF0F2748);
  Color get _textSecondary => const Color(0xFF5A6F86);
  Color get _textHint => const Color(0xFF8FA3B8);

  void _ensureAnims() {
    _pulse ??= AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat(reverse: true);
    _wave ??= AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat();
    _waitSpin ??= AnimationController(vsync: this, duration: const Duration(milliseconds: 1800))..repeat();
    _successPop ??= AnimationController(vsync: this, duration: const Duration(milliseconds: 780));
  }

  @override
  void initState() {
    super.initState();
    _ensureAnims();
    _phoneCtrl.clear();
    PaymentVoices.bindUiHooks(
      onStart: () {
        if (mounted) setState(() => _speaking = true);
      },
      onDone: () {
        if (mounted) setState(() => _speaking = false);
      },
    );
    // Voice already kicked off in [show]; reflect speaking UI immediately.
    _speaking = true;
    unawaited(_bootstrapForm());
  }

  Future<void> _bootstrapForm() async {
    final plans = RemoteConfigService.paymentPlans;
    if (!mounted) return;
    if (plans.isNotEmpty) {
      final popular = plans.where((p) => p.isPopular);
      setState(() {
        _plans = plans;
        _selectedSlug = popular.isNotEmpty ? popular.first.slug : plans.first.slug;
      });
    } else if (_plans.isNotEmpty) {
      _selectedSlug = _plans.first.slug;
    }

    try {
      final prefs = await SharedPreferences.getInstance();
      final phone = prefs.getString(_prefsPhoneKey)?.trim() ?? '';
      if (!mounted) return;
      if (phone.isNotEmpty) {
        _phoneCtrl.text = phone;
      }
    } catch (_) {
      // keep empty so placeholder stays visible
    }
  }

  Future<void> _speak(int step) async {
    if (_paymentSuccess) {
      await PaymentVoices.playAsset(
        PaymentVoices.successAsset,
        onStart: () {
          if (mounted) setState(() => _speaking = true);
        },
        onDone: () {
          if (mounted) setState(() => _speaking = false);
        },
      );
      return;
    }
    await PaymentVoices.playStep(
      step.clamp(0, 3),
      onStart: () {
        if (mounted) setState(() => _speaking = true);
      },
      onDone: () {
        if (mounted) setState(() => _speaking = false);
      },
    );
  }

  void _armResendWait() {
    _resendRevealTimer?.cancel();
    _canResend = false;
    _resendRevealTimer = Timer(const Duration(seconds: 10), () {
      if (!mounted || _paymentSuccess) return;
      setState(() {
        _canResend = true;
        if (_promptOnPhone) {
          _waitingHint = 'Bado hakuna PIN. Gusa Tuma tena.';
        }
      });
    });
  }

  void _showResendNow() {
    _resendRevealTimer?.cancel();
    _canResend = true;
  }

  /// M-Pesa refuses another prompt while one is still open. Hold the button
  /// so extra taps do not pile up as failed requests.
  void _holdResend() {
    _resendRevealTimer?.cancel();
    _canResend = false;
    _resendRevealTimer = Timer(const Duration(seconds: 30), () {
      if (!mounted || _paymentSuccess) return;
      setState(() {
        _canResend = true;
        _waitingHint = 'Sasa unaweza kutuma tena.';
      });
    });
  }

  /// This SIM already has a USSD window. A crowded gateway is not this case.
  bool _phoneUssdBusy(Object error) {
    final raw = error.toString().toLowerCase();
    return raw.contains('ussd nyingine') || raw.contains('funga dirisha la ussd');
  }

  Future<void> _stopAudio() async {
    await PaymentVoices.stop();
    if (mounted) setState(() => _speaking = false);
  }

  void _schedulePaymentSuccess() {
    _paymentSuccess = false;
    _paymentBusy = true;
    _successPop?.reset();
    _waitSpin
      ?..reset()
      ..repeat();
    unawaited(_runPaymentFlow());
  }

  Future<void> _runPaymentFlow() async {
    // Re-resolve plans in case remote config arrived late.
    if (_plans.isEmpty) {
      final remote = RemoteConfigService.paymentPlans;
      if (remote.isNotEmpty) {
        _plans = remote;
        _selectedSlug ??= remote.where((p) => p.isPopular).isNotEmpty
            ? remote.firstWhere((p) => p.isPopular).slug
            : remote.first.slug;
      }
    }

    if (_plans.isEmpty || _selectedSlug == null) {
      if (!mounted) return;
      setState(() {
        _paymentBusy = false;
        _waitingHint = 'Hakuna kifurushi kinachopatikana. Jaribu tena baadaye.';
      });
      return;
    }

    final phoneRaw = _phoneCtrl.text.trim();
    final phone = TzPaymentConfig.normalizeTzLocalPhone(phoneRaw);
    if (phone == null) {
      if (!mounted) return;
      setState(() {
        _paymentBusy = false;
        _waitingHint = 'Namba ya simu si sahihi. Rudi nyuma uhakikishe.';
      });
      return;
    }

    final pkg = _plans.firstWhere((p) => p.slug == _selectedSlug, orElse: () => _plans.first);
    final name = 'EaMax $phone';

    if (mounted) {
      setState(() {
        _pendingPlanLabel = pkg.displayName;
        _waitingHint = 'Tunatuma ombi… ${TzPaymentConfig.paymentPromptFor(phone)}';
      });
    }

    try {
      final canonicalUid =
          (await getOrCreateUserId())?.trim() ?? (await ensureLocalUserId());
      if (canonicalUid.isEmpty) {
        if (!mounted) return;
        setState(() {
          _paymentBusy = false;
          _waitingHint = 'Hatukuweza kutambua akaunti yako. Jaribu tena.';
        });
        return;
      }
      unawaited(registerUserInDatabase(id: canonicalUid, maxRetries: 1));
      final resetFuture = PaymentPendingSession.resetForNewCheckout();
      final resultFuture = _startPrompt(
        externalId: canonicalUid,
        bundle: pkg.slug,
        amount: pkg.priceTzs,
        phone: phone,
        email: '$canonicalUid@eamax.app',
        name: name,
      );
      await resetFuture;
      if (!mounted) return;
      final result = await resultFuture;

      final orderId = (result['orderId']?.toString() ?? '').trim();
      final dispatching = result['dispatching'] == true;
      final pushSent = dispatching || result['ussdSent'] != false;
      debugPrint(
        '[Payment] create_order order=${orderId.isEmpty ? 'none' : orderId} ussdSent=${result['ussdSent']} reused=${result['reusedPending']}',
      );
      if (!mounted || _page != 3) return;

      if (orderId.isEmpty) {
        _waitSpin?.stop();
        _showResendNow();
        setState(() {
          _paymentBusy = false;
          _promptOnPhone = false;
          _canResend = true;
          _waitingHint = 'Ombi halijatumwa kwenye simu. Gusa Tuma tena.';
        });
        return;
      }

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('pendingPaymentOrderId', orderId);
      await prefs.setString(_prefsPhoneKey, phone);
      await PaymentPendingSession.save(
        orderId: orderId,
        phone: phone,
        bundle: pkg.slug,
        amount: pkg.priceTzs,
      );

      if (!mounted) return;
      _showResendNow();
      setState(() {
        _paymentBusy = false;
        _promptOnPhone = pushSent;
        _canResend = true;
        _pendingPlanLabel = pkg.displayName;
        _waitingHint = dispatching
            ? 'Tunatuma ombi. Subiri PIN kwenye simu.'
            : (pushSent
                ? 'Imetumwa ombi. Subiri.'
                : 'Ombi halijatumwa kwenye simu. Gusa Tuma tena.');
      });

      const maxAttempts = 90;
      for (var i = 0; i < maxAttempts; i++) {
        if (i > 0) {
          final delay = i < 25 ? const Duration(milliseconds: 800) : const Duration(seconds: 2);
          await Future.delayed(delay);
        }
        if (!mounted || _page != 3 || _paymentSuccess) return;

        try {
          final response = await PaymentPendingSession.checkBestPaymentStatus();
          final sessionAge = await PaymentPendingSession.sessionAge();
          if (shouldDeferPaymentTerminal(
            sessionAge: sessionAge,
            pollCount: i + 1,
            response: response,
          )) {
            if (mounted && _promptOnPhone && _canResend) {
              setState(() {
                _waitingHint = 'Bado hakuna PIN. Gusa Tuma tena.';
              });
            }
            continue;
          }
          if (shouldKeepPaymentUnlockPolling(response) && !isPaymentSuccessResponse(response)) {
            if (mounted && _promptOnPhone && _canResend) {
              setState(() {
                _waitingHint = 'Bado hakuna PIN. Gusa Tuma tena.';
              });
            }
            continue;
          }
          if (isPaymentSuccessResponse(response)) {
            final userPayload = userPayloadFromPaymentResponse(response);
            var unlocked = false;
            try {
              unlocked = await widget.onPaymentSuccess?.call(userPayload: userPayload) ?? false;
            } catch (e) {
              debugPrint('[PremiumLockModal] onPaymentSuccess failed: $e');
            }
            if (!unlocked) {
              if (mounted) {
                setState(() {
                  _waitingHint = PaymentStatusCopy.applying;
                });
              }
              continue;
            }
            await PaymentPendingSession.clear();
            await _markPaymentSuccess();
            return;
          }
          final status = paymentStatusFromResponse(response);
          if (isPaymentCancelledStatus(status)) {
            if (mounted && _promptOnPhone) {
              setState(() => _waitingHint = PaymentStatusCopy.requestSent);
            }
            continue;
          }
          if (isPaymentTerminalFailure(status) || response['terminal'] == true) {
            if (!mounted) return;
            _waitSpin?.stop();
            setState(() {
              _paymentBusy = false;
              _waitingHint = paymentStatusUserMessage(response);
            });
            return;
          }
        } catch (_) {
          if (mounted) {
            setState(() => _waitingHint = 'Seva inaendelea kuchakata malipo…');
          }
          continue;
        }

        if (!mounted || !_promptOnPhone || !_canResend) continue;
        setState(() {
          _waitingHint = 'Bado hakuna PIN. Gusa Tuma tena.';
        });
      }

      if (!mounted) return;
      _waitSpin?.stop();
      setState(() {
        _paymentBusy = false;
        _waitingHint = _promptOnPhone
            ? 'Muda wa kusubiri malipo umeisha. Hakikisha umethibitisha PIN kwenye simu, kisha jaribu tena.'
            : 'PIN haijatumwa kwenye simu. Gusa Tuma ombi tena.';
      });
    } catch (e) {
      if (!mounted) return;
      _waitSpin?.stop();
      debugPrint('[Payment] start failed: $e');
      final blocked = _phoneUssdBusy(e);
      if (blocked) {
        _holdResend();
      } else {
        _showResendNow();
      }
      setState(() {
        _paymentBusy = false;
        _promptOnPhone = false;
        _canResend = !blocked;
        _waitingHint = blocked
            ? 'Funga dirisha la USSD kwenye simu, kisha tuma tena.'
            : 'Ombi halijatumwa kwenye simu. Gusa Tuma tena.';
      });
    }
  }

  Future<void> _markPaymentSuccess() async {
    if (!mounted || _page != 3) return;
    _waitSpin?.stop();
    setState(() {
      _paymentSuccess = true;
      _paymentBusy = false;
      _waitingHint = 'Chaneli zote zimefunguliwa. Karibu ufurahie Premium.';
    });
    await _successPop?.forward(from: 0);
    if (mounted) {
      await PaymentVoices.playAsset(
        PaymentVoices.successAsset,
        onStart: () {
          if (mounted) setState(() => _speaking = true);
        },
        onDone: () {
          if (mounted) setState(() => _speaking = false);
        },
      );
    }
  }

  Future<void> _goTo(int page, {bool speak = true}) async {
    if (page < 0 || page > 3 || page == _page) return;
    FocusManager.instance.primaryFocus?.unfocus();

    if (page != 3) {
      _paymentSuccess = false;
      _paymentBusy = false;
    }

    setState(() {
      _page = page;
      _formError = null;
      if (page == 3) {
        _waitingHint = 'Tunatuma ombi la malipo… Angalia simu yako.';
        if (_plans.isNotEmpty) {
          final pkg = _plans.firstWhere(
            (p) => p.slug == _selectedSlug,
            orElse: () => _plans.first,
          );
          _pendingPlanLabel = pkg.displayName;
        }
      }
    });

    // Speak without awaiting stop — multi-player swap is instant.
    if (speak && mounted && !_paymentSuccess) {
      unawaited(_speak(page));
    }

    if (page == 3) {
      _schedulePaymentSuccess();
    }
  }

  Future<void> _back() async {
    if (_page <= 0 || _page >= 3) return;
    await _goTo(_page - 1);
  }

  Future<void> _close() async {
    unawaited(PaymentVoices.stop());
    FocusManager.instance.primaryFocus?.unfocus();
    if (mounted) Navigator.of(context).pop();
  }

  bool _validatePhone() {
    final phone = _phoneCtrl.text.trim();
    if (phone.isEmpty) {
      setState(() => _formError = 'Tafadhali weka nambari ya simu');
      return false;
    }
    if (!phone.startsWith('0')) {
      setState(() => _formError = 'Namba ya simu ianze na 0 (mfano 07…)');
      return false;
    }
    if (!TzPaymentConfig.isValidTzLocalPhone(phone)) {
      setState(() => _formError = 'Namba ya simu si sahihi. Tumia 07… au 06…');
      return false;
    }
    FocusManager.instance.primaryFocus?.unfocus();
    return true;
  }

  Future<void> _next() async {
    if (_paymentSuccess) {
      await _close();
      return;
    }
    if (_page == 1 && !_validatePhone()) return;
    if (_page == 2 && (_selectedSlug == null || _plans.isEmpty)) return;
    if (_page >= 3) return;
    await _goTo(_page + 1);
  }

  @override
  void dispose() {
    _resendRevealTimer?.cancel();
    _phoneFocus.dispose();
    _pulse?.dispose();
    _wave?.dispose();
    _waitSpin?.dispose();
    _successPop?.dispose();
    _phoneCtrl.dispose();
    PaymentVoices.clearUiHooks();
    PaymentVoices.stop();
    super.dispose();
  }

  double _cardHeightForPage(Size size, {required bool keyboardOpen}) {
    final pad = MediaQuery.paddingOf(context);
    final chrome = pad.top + pad.bottom + (keyboardOpen ? 100.0 : 78.0);
    final available = (size.height - chrome).clamp(240.0, size.height);

    switch (_page) {
      case 0: // intro — compact
        return (available * 0.42).clamp(260.0, 360.0);
      case 1: // phone — snug to the screen, never taller than the space above the keyboard
        final screenH = size.height;
        final snug = screenH < 680 ? 390.0 : screenH < 820 ? 440.0 : 480.0;
        return math.min(keyboardOpen ? available : snug, available);
      case 2: // pricing — tall so all plans are visible
        final planExtra = (_plans.length * 78.0).clamp(160.0, 360.0);
        final target = 220.0 + planExtra; // hero + list + CTA
        return target.clamp(available * 0.62, available * 0.90);
      default: // PIN step — hug the summary so it fits without a blank gap
        final snug = size.height < 640 ? available : 468.0;
        return math.min(snug, available);
    }
  }

  @override
  Widget build(BuildContext context) {
    _ensureAnims();
    final size = MediaQuery.sizeOf(context);
    final kb = MediaQuery.viewInsetsOf(context).bottom;
    final keyboardOpen = kb > 40;
    final canGoBack = _page > 0 && _page < 3 && !_paymentSuccess;
    final cardH = _cardHeightForPage(size, keyboardOpen: keyboardOpen);

    return Material(
      color: Colors.transparent,
      child: Stack(
        children: [
          // Tap outside to dismiss (blur already drawn in transitionBuilder).
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () {
                if (keyboardOpen) {
                  FocusManager.instance.primaryFocus?.unfocus();
                } else {
                  _close();
                }
              },
              child: const ColoredBox(color: Colors.transparent),
            ),
          ),
          AnimatedPadding(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOutCubic,
            padding: EdgeInsets.only(bottom: kb),
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                child: Column(
                  children: [
                    Row(
                      children: [
                        if (canGoBack)
                          IconButton(
                            onPressed: _back,
                            tooltip: 'Rudi nyuma',
                            icon: Container(
                              padding: const EdgeInsets.all(6),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.18),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.arrow_back_rounded, color: Colors.white, size: 18),
                            ),
                          )
                        else
                          const SizedBox(width: 48),
                        Expanded(child: Center(child: _dots())),
                        IconButton(
                          onPressed: _close,
                          icon: Container(
                            padding: const EdgeInsets.all(6),
                            decoration: const BoxDecoration(
                              color: Color(0xFFE53935),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.close_rounded, color: Colors.white, size: 18),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Expanded(
                      child: Center(
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 280),
                          curve: Curves.easeOutCubic,
                          height: cardH,
                          width: (size.width - 32).clamp(280.0, 420.0),
                          child: AnimatedSwitcher(
                            duration: const Duration(milliseconds: 280),
                            switchInCurve: Curves.easeOutCubic,
                            switchOutCurve: Curves.easeInCubic,
                            transitionBuilder: (child, anim) => FadeTransition(
                              opacity: anim,
                              child: SlideTransition(
                                position: Tween(begin: const Offset(0.04, 0), end: Offset.zero).animate(anim),
                                child: child,
                              ),
                            ),
                            child: KeyedSubtree(
                              key: ValueKey('pay-step-$_page'),
                              child: _CarouselCard(child: _cardBody(_page)),
                            ),
                          ),
                        ),
                      ),
                    ),
                    if (!keyboardOpen) ...[
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          if (canGoBack)
                            TextButton(
                              onPressed: _back,
                              child: Text(
                                'Rudi',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.9),
                                  fontWeight: FontWeight.w700,
                                  fontSize: 14,
                                ),
                              ),
                            )
                          else
                            const SizedBox(width: 56),
                          Expanded(
                            child: Text(
                              _pageLabel,
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.85),
                                fontWeight: FontWeight.w600,
                                fontSize: 13,
                              ),
                            ),
                          ),
                          _NextFab(
                            onTap: _next,
                            isLast: _page >= 3,
                            success: _paymentSuccess,
                            green: _green,
                            greenDark: _greenDark,
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  TzMobileNetwork get _detectedNetwork =>
      TzPaymentConfig.detectNetworkLive(_phoneCtrl.text);

  String get _pageLabel {
    if (_paymentSuccess) return 'Imefanikiwa';
    final net = _detectedNetwork;
    final netName = net == TzMobileNetwork.unknown
        ? ''
        : ' · ${TzPaymentConfig.networkLabel(net)}';
    switch (_page) {
      case 0:
        return 'Hatua 1 / 4 · Maelezo';
      case 1:
        return 'Hatua 2 / 4 · Simu$netName';
      case 2:
        return 'Hatua 3 / 4 · Kifurushi$netName';
      default:
        return 'Hatua 4 / 4 · PIN$netName';
    }
  }

  Widget _stepTrack() {
    const steps = ['Maelezo', 'Simu', 'Kifurushi', 'PIN'];
    return Row(
      children: List.generate(steps.length, (i) {
        final done = i < _page || _paymentSuccess;
        final on = i == _page && !_paymentSuccess;
        final color = on || done ? _green : const Color(0xFFD6E8F6);
        return Expanded(
          child: Padding(
            padding: EdgeInsets.only(right: i == steps.length - 1 ? 0 : 6),
            child: Column(
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  height: 4,
                  decoration: BoxDecoration(
                    color: color,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
                const SizedBox(height: 5),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    '${i + 1}  ${steps[i]}',
                    maxLines: 1,
                    softWrap: false,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: on ? FontWeight.w800 : FontWeight.w600,
                      color: on ? _greenDark : _textHint,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      }),
    );
  }

  Widget _networkChip() {
    final net = _detectedNetwork;
    if (net == TzMobileNetwork.unknown) {
      final started = TzPaymentConfig.liveDigits(_phoneCtrl.text).isNotEmpty;
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: _section,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          started
              ? 'Bado hatujatambua mtandao. Endelea kuandika nambari.'
              : 'M-Pesa, Airtel Money, Mixx by Yas, au HaloPesa.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 12, color: _textSecondary, fontWeight: FontWeight.w600),
        ),
      );
    }
    final color = switch (net) {
      TzMobileNetwork.mpesa => const Color(0xFFE60000),
      TzMobileNetwork.airtel => const Color(0xFFED1C24),
      TzMobileNetwork.tigo => const Color(0xFF0033A0),
      TzMobileNetwork.halotel => const Color(0xFF00843D),
      TzMobileNetwork.unknown => _textHint,
    };
    final name = TzPaymentConfig.networkFullName(net);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Row(
        children: [
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: color),
                ),
                Text(
                  'PIN itaenda kwenye ${TzPaymentConfig.networkLabel(net)}.',
                  style: TextStyle(fontSize: 11.5, color: _textSecondary, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _dots() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(4, (i) {
        final on = i == _page;
        return AnimatedContainer(
          duration: const Duration(milliseconds: 280),
          margin: const EdgeInsets.symmetric(horizontal: 3),
          width: on ? 22 : 8,
          height: 8,
          decoration: BoxDecoration(
            color: on ? _green : Colors.white.withValues(alpha: 0.35),
            borderRadius: BorderRadius.circular(8),
          ),
        );
      }),
    );
  }

  Widget _cardBody(int index) {
    switch (index) {
      case 0:
        return _detailsCard();
      case 1:
        return _phoneCard();
      case 2:
        return _pricesCard();
      default:
        return _waitingCard();
    }
  }

  Widget _detailsCard() {
    return _CardScaffold(
      hero: _HeroPanel(icon: Icons.lock_open_rounded, pulse: _pulse!, navyMid: _navyMid, navy: _navy),
      navyMid: _navyMid,
      navy: _navy,
      child: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              child: Column(
                children: [
                  Text(
                    'Namna ya kufungua chaneli zote au kufanya malipo',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: _textPrimary, height: 1.3),
                  ),
                  const SizedBox(height: 14),
                  _audioStrip(),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          _PrimaryButton(
            label: 'NIELEZE',
            icon: Icons.play_arrow_rounded,
            green: _green,
            greenDark: _greenDark,
            onTap: () => _goTo(1),
          ),
        ],
      ),
    );
  }

  Widget _phoneCard() {
    return _CardScaffold(
      hero: _HeroPanel(icon: Icons.phone_rounded, pulse: _pulse!, compact: true, navyMid: _navyMid, navy: _navy),
      heroHeight: 78,
      navyMid: _navyMid,
      navy: _navy,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final short = constraints.maxHeight < 360;
          final gap = short ? 6.0 : 10.0;
          return FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.topCenter,
            child: SizedBox(
              width: constraints.maxWidth,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Weka nambari ya simu',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: short ? 15 : 17,
                      fontWeight: FontWeight.w800,
                      color: _textPrimary,
                    ),
                  ),
                  SizedBox(height: gap),
                  _stepTrack(),
                  SizedBox(height: gap),
                  _audioStrip(),
                  SizedBox(height: gap + 2),
                  _phoneField(),
                  SizedBox(height: gap),
                  _networkChip(),
                  if (_formError != null) ...[
                    const SizedBox(height: 6),
                    Text(
                      _formError!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 12, color: Colors.redAccent, fontWeight: FontWeight.w600),
                    ),
                  ],
                  SizedBox(height: gap + 4),
                  _PrimaryButton(
                    label: 'Endelea',
                    icon: Icons.arrow_forward_rounded,
                    green: _green,
                    greenDark: _greenDark,
                    onTap: () {
                      if (!_validatePhone()) return;
                      _goTo(2);
                    },
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _pricesCard() {
    return _CardScaffold(
      heroHeight: _detectedNetwork == TzMobileNetwork.unknown ? 96 : 118,
      navyMid: _navyMid,
      navy: _navy,
      hero: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Chagua Kifurushi', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Colors.white)),
            if (_detectedNetwork != TzMobileNetwork.unknown) ...[
              const SizedBox(height: 4),
              Text(
                '${TzPaymentConfig.networkFullName(_detectedNetwork)} · ${TzPaymentConfig.liveDigits(_phoneCtrl.text)}',
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Colors.white),
              ),
            ],
            const SizedBox(height: 8),
            _audioStrip(lite: true),
          ],
        ),
      ),
      child: Column(
        children: [
          Expanded(
            child: _plans.isEmpty
                ? Center(
                    child: Text(
                      'Hakuna bei zinazopatikana sasa',
                      style: TextStyle(fontSize: 13, color: _textHint, fontWeight: FontWeight.w600),
                    ),
                  )
                : ListView.separated(
                    padding: EdgeInsets.zero,
                    itemCount: _plans.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final pk = _plans[i];
                      final on = pk.slug == _selectedSlug;
                      return GestureDetector(
                        onTap: () => setState(() => _selectedSlug = pk.slug),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 180),
                          padding: const EdgeInsets.all(11),
                          decoration: BoxDecoration(
                            color: on ? _green.withValues(alpha: 0.08) : _section,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: on ? _green : Colors.transparent, width: 2),
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 20,
                                height: 20,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: on ? _green : Colors.transparent,
                                  border: Border.all(color: on ? _green : const Color(0xFFC9DEF0), width: 2),
                                ),
                                child: on ? const Icon(Icons.check, color: Colors.white, size: 12) : null,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Flexible(
                                          child: Text(
                                            pk.displayName,
                                            style: TextStyle(fontSize: 13.5, color: _textPrimary, fontWeight: FontWeight.w800),
                                          ),
                                        ),
                                        if (pk.isPopular) ...[
                                          const SizedBox(width: 6),
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                            decoration: BoxDecoration(
                                              color: _green,
                                              borderRadius: BorderRadius.circular(6),
                                            ),
                                            child: const Text(
                                              'MAARUFU',
                                              style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w800),
                                            ),
                                          ),
                                        ],
                                      ],
                                    ),
                                    Text(
                                      pk.displayPriceLine,
                                      style: TextStyle(fontSize: 10.5, color: _textHint),
                                    ),
                                  ],
                                ),
                              ),
                              Text(
                                'TSh ${pk.formattedPrice}',
                                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: _textPrimary),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
          const SizedBox(height: 8),
          if (_formError != null) ...[
            Text(
              _formError!,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12, color: Colors.redAccent, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
          ],
          _PrimaryButton(
            label: _paymentBusy ? 'Inatuma…' : 'Lipia sasa',
            icon: Icons.payments_rounded,
            green: _green,
            greenDark: _greenDark,
            onTap: () async {
              if (_paymentBusy) return;
              if (!_validatePhone()) {
                // Phone invalid — send user back to fix it.
                await _goTo(1);
                return;
              }
              if (_selectedSlug == null || _plans.isEmpty) {
                setState(() => _formError = 'Chagua kifurushi kwanza');
                return;
              }
              setState(() {
                _formError = null;
                _waitingHint = TzPaymentConfig.paymentPromptFor(_phoneCtrl.text);
              });
              await _goTo(3);
            },
          ),
        ],
      ),
    );
  }

  Widget _phoneField() {
    return TextField(
      controller: _phoneCtrl,
      focusNode: _phoneFocus,
      keyboardType: TextInputType.phone,
      textInputAction: TextInputAction.done,
      maxLength: 10,
      onSubmitted: (_) {
        FocusManager.instance.primaryFocus?.unfocus();
      },
      scrollPadding: const EdgeInsets.only(bottom: 120),
      style: TextStyle(fontSize: 18, color: _textPrimary, fontWeight: FontWeight.w700, letterSpacing: 1.2),
      cursorColor: _navy,
      onChanged: (raw) {
        setState(() => _formError = null);
        final digits = raw.replaceAll(RegExp(r'\D'), '');
        var next = digits;
        if (next.isEmpty) {
          if (_phoneCtrl.text.isNotEmpty) {
            _phoneCtrl.clear();
          }
          return;
        }
        if (!next.startsWith('0')) {
          next = '0$next';
        }
        if (next.length > 10) next = next.substring(0, 10);
        if (next != _phoneCtrl.text) {
          _phoneCtrl.value = TextEditingValue(
            text: next,
            selection: TextSelection.collapsed(offset: next.length),
          );
        }
      },
      decoration: InputDecoration(
        counterText: '',
        labelText: 'Nambari ya simu',
        hintText: '0XXXXXXXXXXX',
        labelStyle: TextStyle(fontSize: 12.5, color: _textHint),
        hintStyle: TextStyle(fontSize: 14, color: _textHint.withValues(alpha: 0.7)),
        prefixIcon: Icon(Icons.phone_rounded, color: _navyMid, size: 20),
        filled: true,
        fillColor: Colors.white,
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: Color(0xFFD6E8F6), width: 1.4),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: _green, width: 1.8),
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: Color(0xFFD6E8F6)),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
        isDense: true,
      ),
    );
  }

  Future<Map<String, dynamic>> _startPrompt({
    required String externalId,
    required String bundle,
    required int amount,
    required String phone,
    required String email,
    required String name,
  }) {
    return paymentsApi.startPayment(
      externalId: externalId,
      bundle: bundle,
      amount: amount,
      phone: phone,
      email: email,
      name: name,
    );
  }

  Future<void> _resendPrompt() async {
    if (_paymentSuccess || _resending || !_canResend) return;
    _resending = true;
    final phone = TzPaymentConfig.normalizeTzLocalPhone(_phoneCtrl.text.trim());
    RemoteSubscriptionPlan? plan;
    for (final item in _plans) {
      if (item.slug == _selectedSlug) {
        plan = item;
        break;
      }
    }
    plan ??= _plans.isEmpty ? null : _plans.first;
    if (phone == null || plan == null) {
      _resending = false;
      setState(() {
        _promptOnPhone = false;
        _waitingHint = 'Namba ya simu si sahihi. Rudi nyuma uhakikishe.';
      });
      return;
    }
    setState(() {
      _resending = true;
      _waitingHint = 'Tunatuma ombi la PIN kwenye $phone…';
    });
    try {
      final result = await PaymentPendingSession.resendStk(
        userRequested: true,
        phone: phone,
        bundle: plan.slug,
        amount: plan.priceTzs,
      );
      if (!mounted) return;
      debugPrint(
        '[Payment] resend order=${result.orderId ?? 'none'} sent=${result.sent} ussd=${result.ussdSent} reused=${result.reusedPending}',
      );
      if (result.sent && !result.reusedPending) {
        final prefs = await SharedPreferences.getInstance();
        if (result.orderId != null && result.orderId!.isNotEmpty) {
          await prefs.setString('pendingPaymentOrderId', result.orderId!);
        }
        _showResendNow();
        setState(() {
          _promptOnPhone = true;
          _canResend = true;
          _waitingHint = 'Imetumwa ombi. Subiri.';
        });
      } else if (result.dispatching || (result.reusedPending && result.ussdSent != false)) {
        _showResendNow();
        setState(() {
          _promptOnPhone = true;
          _canResend = true;
          _waitingHint = result.dispatching
              ? 'Tunatuma ombi. Subiri PIN kwenye simu.'
              : 'Imetumwa ombi. Subiri.';
        });
      } else if (result.ussdSent == false) {
        _showResendNow();
        setState(() {
          _promptOnPhone = false;
          _canResend = true;
          _waitingHint = 'Ombi halijatumwa kwenye simu. Gusa Tuma tena.';
        });
      } else if (result.skippedTooSoon) {
        setState(() {
          _waitingHint = 'Subiri sekunde chache, kisha gusa Tuma ombi tena.';
        });
      } else if (result.capped) {
        setState(() {
          _waitingHint = 'Umefika kikomo. Funga USSD kwenye simu, subiri dakika moja, kisha jaribu tena.';
        });
      } else {
        setState(() {
          _promptOnPhone = false;
          _waitingHint = 'Hatukuweza kutuma ombi tena. Jaribu tena.';
        });
      }
    } catch (e) {
      if (!mounted) return;
      final alreadyOnPhone = _phoneUssdBusy(e);
      if (alreadyOnPhone) {
        debugPrint('[Payment] phone already has a USSD window');
        _holdResend();
        setState(() {
          _promptOnPhone = false;
          _canResend = false;
          _waitingHint = 'Funga dirisha la USSD kwenye simu, kisha tuma tena.';
        });
      } else {
        debugPrint('[Payment] resend failed: $e');
        setState(() {
          _promptOnPhone = false;
          _waitingHint = mapPaymentStartError(e);
        });
      }
    } finally {
      if (mounted) setState(() => _resending = false);
    }
  }

  Widget _pinSummaryRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 88,
            child: Text(
              label,
              style: TextStyle(fontSize: 12.5, color: _textHint, fontWeight: FontWeight.w700),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(fontSize: 13.5, color: _textPrimary, fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }

  Widget _waitingCard() {
    final phone = TzPaymentConfig.normalizeTzLocalPhone(_phoneCtrl.text) ??
        TzPaymentConfig.liveDigits(_phoneCtrl.text);
    final net = _detectedNetwork;
    final netName = net == TzMobileNetwork.unknown
        ? 'Mobile Money'
        : TzPaymentConfig.networkFullName(net);
    final plan = _plans.cast<RemoteSubscriptionPlan?>().firstWhere(
          (p) => p?.slug == _selectedSlug,
          orElse: () => _plans.isEmpty ? null : _plans.first,
        );
    final bundleName = _pendingPlanLabel ?? plan?.displayName ?? 'Kifurushi';
    final price = plan == null ? '' : ' · Tsh ${plan.formattedPrice}';

    return _CardScaffold(
      navyMid: _navyMid,
      navy: _navy,
      heroHeight: 92,
      bodyPadding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
      hero: _paymentSuccess
          ? _SuccessTick(controller: _successPop!, green: _green, greenDark: _greenDark)
          : _HeroPanel(
              icon: Icons.hourglass_top_rounded,
              pulse: _waitSpin!,
              spinning: true,
              compact: true,
              navyMid: _navyMid,
              navy: _navy,
            ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          return FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.topCenter,
            child: SizedBox(
              width: constraints.maxWidth,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _stepTrack(),
                  const SizedBox(height: 8),
                  Text(
                    _paymentSuccess
                        ? 'Hongera sasa channeli zote zimefunguliwa'
                        : 'Ingiza PIN',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: _textPrimary),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _paymentSuccess
                        ? 'Malipo yamehakikiwa. Unaweza kufungua na kutazama channel zote sasa.'
                        : (_promptOnPhone
                            ? 'Imetumwa ombi. Subiri PIN kwenye simu.'
                            : 'Ombi halijatumwa kwenye simu hii.'),
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: _textSecondary, height: 1.3),
                  ),
                  if (!_paymentSuccess) ...[
                    const SizedBox(height: 8),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      decoration: BoxDecoration(
                        color: _section,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Column(
                        children: [
                          _pinSummaryRow('Nambari', phone.isEmpty ? '—' : phone),
                          _pinSummaryRow('Kifurushi', '$bundleName$price'),
                          _pinSummaryRow('Mtandao', netName),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _waitingHint,
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 12.5, color: _textSecondary, height: 1.3),
                    ),
                  ],
                  const SizedBox(height: 10),
                  if (_paymentSuccess)
                    _PrimaryButton(
                      label: 'Endelea Kutazama',
                      icon: Icons.play_arrow_rounded,
                      green: _green,
                      greenDark: _greenDark,
                      onTap: _close,
                    )
                  else ...[
                    _PrimaryButton(
                      label: _resending
                          ? 'Inatuma…'
                          : (_canResend ? 'Tuma tena' : 'Subiri…'),
                      icon: Icons.refresh_rounded,
                      green: _green,
                      greenDark: _greenDark,
                      onTap: _resendPrompt,
                    ),
                    const SizedBox(height: 6),
                    GestureDetector(
                      onTap: _close,
                      child: Text('Funga', style: TextStyle(fontSize: 14, color: _navyMid, fontWeight: FontWeight.w800)),
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _audioStrip({bool lite = false}) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.symmetric(horizontal: 12, vertical: lite ? 8 : 10),
      decoration: BoxDecoration(
        color: lite ? Colors.white.withValues(alpha: 0.16) : _section,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Icon(
            _speaking ? Icons.volume_up_rounded : Icons.volume_off_rounded,
            color: lite ? Colors.white : _green,
            size: 18,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _speaking
                ? AnimatedBuilder(
                    animation: _wave!,
                    builder: (_, _) => Row(
                      children: List.generate(5, (i) {
                        final phase = (_wave!.value + i * 0.14) % 1.0;
                        final h = 4.0 + (10.0 * (0.35 + 0.65 * (1 - (phase - 0.5).abs() * 2).clamp(0.0, 1.0)));
                        return Container(
                          width: 3,
                          height: h,
                          margin: const EdgeInsets.only(right: 3),
                          decoration: BoxDecoration(
                            color: lite ? Colors.white : _green,
                            borderRadius: BorderRadius.circular(2),
                          ),
                        );
                      }),
                    ),
                  )
                : Text(
                    'Gusa kusikiliza tena',
                    style: TextStyle(fontSize: 11.5, color: lite ? Colors.white70 : _textHint),
                  ),
          ),
          GestureDetector(
            onTap: () {
              if (_speaking) {
                _stopAudio();
              } else {
                _speak(_page);
              }
            },
            child: Icon(
              _speaking ? Icons.stop_rounded : Icons.replay_rounded,
              color: lite ? Colors.white : _navyMid,
              size: 18,
            ),
          ),
        ],
      ),
    );
  }

}

class _CarouselCard extends StatelessWidget {
  const _CarouselCard({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SizedBox.expand(
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(28),
          border: Border.all(color: const Color(0xFF0F2748).withValues(alpha: 0.14), width: 1.4),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFF0F2748).withValues(alpha: 0.32),
              blurRadius: 36,
              offset: const Offset(0, 18),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(28),
          child: Material(color: Colors.white, elevation: 0, child: child),
        ),
      ),
    );
  }
}

class _CardScaffold extends StatelessWidget {
  const _CardScaffold({
    required this.hero,
    required this.child,
    required this.navyMid,
    required this.navy,
    this.heroHeight = 120,
    this.bodyPadding = const EdgeInsets.fromLTRB(18, 16, 18, 16),
  });

  final Widget hero;
  final Widget child;
  final double heroHeight;
  final EdgeInsets bodyPadding;
  final Color navyMid;
  final Color navy;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SizedBox(
          height: heroHeight,
          width: double.infinity,
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [navyMid, navy],
              ),
            ),
            child: hero,
          ),
        ),
        Expanded(
          child: ColoredBox(
            color: Colors.white,
            child: Padding(
              padding: bodyPadding,
              child: child,
            ),
          ),
        ),
      ],
    );
  }
}

class _HeroPanel extends StatelessWidget {
  const _HeroPanel({
    required this.icon,
    required this.pulse,
    required this.navyMid,
    required this.navy,
    this.compact = false,
    this.spinning = false,
  });

  final IconData icon;
  final AnimationController pulse;
  final bool compact;
  final bool spinning;
  final Color navyMid;
  final Color navy;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: AnimatedBuilder(
        animation: pulse,
        builder: (_, _) {
          final t = spinning ? pulse.value * 2 * math.pi : 0.0;
          final scale = spinning ? 1.0 : (0.94 + pulse.value * 0.06);
          return Transform.rotate(
            angle: t,
            child: Transform.scale(
              scale: scale,
              child: Container(
                width: compact ? 64 : 78,
                height: compact ? 64 : 78,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white.withValues(alpha: 0.16),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.28), width: 2),
                ),
                child: Icon(icon, color: Colors.white, size: compact ? 30 : 34),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  const _PrimaryButton({
    required this.label,
    required this.icon,
    required this.onTap,
    required this.green,
    required this.greenDark,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final Color green;
  final Color greenDark;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 50,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: [green, greenDark]),
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(color: green.withValues(alpha: 0.35), blurRadius: 16, offset: const Offset(0, 8)),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: onTap,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, color: Colors.white, size: 22),
                const SizedBox(width: 8),
                Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 15)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NextFab extends StatelessWidget {
  const _NextFab({
    required this.onTap,
    required this.isLast,
    required this.green,
    required this.greenDark,
    this.success = false,
  });

  final VoidCallback onTap;
  final bool isLast;
  final bool success;
  final Color green;
  final Color greenDark;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 280),
        width: 58,
        height: 58,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(colors: [green, greenDark]),
          boxShadow: [
            BoxShadow(color: green.withValues(alpha: 0.4), blurRadius: 18, offset: const Offset(0, 8)),
          ],
        ),
        child: Icon(
          success ? Icons.check_rounded : (isLast ? Icons.hourglass_top_rounded : Icons.chevron_right_rounded),
          color: Colors.white,
          size: 30,
        ),
      ),
    );
  }
}

class _SuccessTick extends StatelessWidget {
  const _SuccessTick({
    required this.controller,
    required this.green,
    required this.greenDark,
  });

  final AnimationController controller;
  final Color green;
  final Color greenDark;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: AnimatedBuilder(
        animation: controller,
        builder: (_, _) {
          final t = Curves.easeOutBack.transform(controller.value.clamp(0.0, 1.0));
          return Transform.scale(
            scale: 0.4 + (0.6 * t),
            child: Opacity(
              opacity: t.clamp(0.0, 1.0),
              child: Container(
                width: 88,
                height: 88,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(colors: [green, greenDark]),
                  boxShadow: [
                    BoxShadow(color: green.withValues(alpha: 0.45), blurRadius: 24, spreadRadius: 2),
                  ],
                ),
                child: const Icon(Icons.check_rounded, color: Colors.white, size: 48),
              ),
            ),
          );
        },
      ),
    );
  }
}
