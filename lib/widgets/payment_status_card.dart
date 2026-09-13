import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/api.dart';
import '../config/payment_helpers.dart';
import '../services/payment_pending_session.dart';
import '../services/payment_tracking_controller.dart';
import '../services/remote_config_service.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';

enum _PaymentTrackPhase {
  idle,
  tracking,
  applying,
  success,
  cancelled,
  insufficient,
  failed,
}

/// Tracks pending subscription payments on the Mtumiaji tab — auto-polls and manual refresh.
class PaymentStatusCard extends StatefulWidget {
  const PaymentStatusCard({
    super.key,
    required this.isPremium,
    required this.isActive,
    this.onPaymentSuccess,
    this.onRetryPayment,
  });

  final bool isPremium;
  final bool isActive;
  final PremiumUnlockCallback? onPaymentSuccess;
  final VoidCallback? onRetryPayment;

  @override
  State<PaymentStatusCard> createState() => _PaymentStatusCardState();
}

class _PaymentStatusCardState extends State<PaymentStatusCard> with TickerProviderStateMixin {
  static const _prefsKey = 'pendingPaymentOrderId';
  static const _maxCancelAttempts = PaymentPendingSession.maxCancelAttempts;

  static const _confirmationHints = [
    'Thibitisha malipo kwa PIN kwenye simu yako.',
    'Ombi la malipo limetumwa — subiri kidogo.',
    'Usifunge app — tunafuatilia malipo yako.',
    'Angalia ujumbe wa malipo kwenye simu yako.',
  ];

  _PaymentTrackPhase _phase = _PaymentTrackPhase.idle;
  String _message = PaymentStatusCopy.noPending;
  String? _orderId;
  bool _polling = false;
  int _pollCount = 0;
  int _cancelCount = 0;
  int _hintIndex = 0;
  Timer? _autoPollTimer;
  Timer? _idleWatchTimer;
  Timer? _hintRotateTimer;
  bool _resendingStk = false;
  bool _handlingCancel = false;
  late final AnimationController _pulseCtrl;
  late final AnimationController _ringCtrl;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))
      ..repeat(reverse: true);
    _ringCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat();
    PaymentTrackingController.instance.onManualRefresh = _onCheckPaymentTap;
    unawaited(_bootstrap());
    _startIdleWatch();
  }

  @override
  void didUpdateWidget(covariant PaymentStatusCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isPremium && !oldWidget.isPremium) {
      _stopTrackingTimers();
      if (mounted) {
        setState(() {
          _phase = _PaymentTrackPhase.success;
          _message = PaymentStatusCopy.success;
        });
      }
      return;
    }
    if (widget.isActive && !oldWidget.isActive) {
      unawaited(_bootstrap());
      _startAutoPoll();
      _startIdleWatch();
    } else if (!widget.isActive && oldWidget.isActive) {
      _stopIdleWatch();
      // Keep polling while payment succeeded but unlock is still applying.
      if (_phase != _PaymentTrackPhase.applying && _phase != _PaymentTrackPhase.tracking) {
        _stopAutoPoll();
      }
    }
    if (_orderId != null &&
        (_phase == _PaymentTrackPhase.applying || _phase == _PaymentTrackPhase.tracking)) {
      _ensurePollingActive();
    }
  }

  @override
  void dispose() {
    PaymentTrackingController.instance.onManualRefresh = null;
    PaymentTrackingController.instance.sync(active: false);
    _stopTrackingTimers();
    _pulseCtrl.dispose();
    _ringCtrl.dispose();
    super.dispose();
  }

  void _stopTrackingTimers() {
    _stopAutoPoll();
    _stopIdleWatch();
    _hintRotateTimer?.cancel();
    _hintRotateTimer = null;
  }

  Future<void> _loadCancelCount() async {
    _cancelCount = await PaymentPendingSession.cancelCount();
  }

  Future<void> _clearCancelCount() async {
    await PaymentPendingSession.clearCancelCount();
    _cancelCount = 0;
  }

  Future<bool> _resendStkNow() async {
    if (!mounted || widget.isPremium || _isTerminalPhase) return false;
    if (_resendingStk) return false;

    final session = await PaymentPendingSession.load();
    if (session == null) return false;

    _resendingStk = true;
    if (mounted) {
      setState(() {
        _message = PaymentStatusCopy.resendStk(_cancelCount, _maxCancelAttempts);
      });
    }

    try {
      final newOrderId = await PaymentPendingSession.resendStk(
        payerName: 'EaMax ${session.phone}',
      );
      if (!mounted) return newOrderId != null;
      if (newOrderId != null && newOrderId.isNotEmpty) {
        setState(() {
          _orderId = newOrderId;
          _message = PaymentStatusCopy.waitingConfirmation;
        });
        unawaited(_pollOnce());
        return true;
      }
      setState(() => _message = PaymentStatusCopy.serverProcessing);
      return false;
    } catch (_) {
      if (mounted) setState(() => _message = PaymentStatusCopy.serverProcessing);
      return false;
    } finally {
      _resendingStk = false;
    }
  }

  Future<void> _finalizeCancelled() async {
    final prefs = await SharedPreferences.getInstance();
    await PaymentPendingSession.clear();
    await prefs.remove(_prefsKey);
    _stopTrackingTimers();
    if (!mounted) return;
    setState(() {
      _phase = _PaymentTrackPhase.cancelled;
      _message = PaymentStatusCopy.cancelFinal;
      _orderId = null;
      _cancelCount = 0;
    });
  }

  Future<void> _bootstrap() async {
    if (widget.isPremium) return;
    final prefs = await SharedPreferences.getInstance();
    final pending = prefs.getString(_prefsKey)?.trim();
    if (!mounted) return;
    if (pending != null && pending.isNotEmpty) {
      await _loadCancelCount();
      if (!mounted) return;
      setState(() {
        _orderId = pending;
        _phase = _PaymentTrackPhase.tracking;
        _message = PaymentStatusCopy.requestSent;
      });
      if (widget.isActive) {
        _startHintRotation();
      }
      unawaited(_pollOnce());
      _startAutoPoll();
    }
  }

  void _startHintRotation() {
    _hintRotateTimer?.cancel();
    if (_phase != _PaymentTrackPhase.tracking && _phase != _PaymentTrackPhase.applying) return;
    _hintRotateTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!mounted) return;
      if (_phase != _PaymentTrackPhase.tracking && _phase != _PaymentTrackPhase.applying) return;
      setState(() {
        _hintIndex = (_hintIndex + 1) % _confirmationHints.length;
        if (_phase == _PaymentTrackPhase.tracking) {
          _message = _confirmationHints[_hintIndex];
        } else if (_phase == _PaymentTrackPhase.applying) {
          _message = PaymentStatusCopy.applyingRetry;
        }
      });
    });
  }

  void _startIdleWatch() {
    if (widget.isPremium) return;
    _idleWatchTimer?.cancel();
    _idleWatchTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!mounted) return;
      unawaited(_watchForNewPendingOrder());
    });
  }

  void _stopIdleWatch() {
    _idleWatchTimer?.cancel();
    _idleWatchTimer = null;
  }

  Future<void> _watchForNewPendingOrder() async {
    if (_orderId != null && _orderId!.isNotEmpty) return;
    if (_phase == _PaymentTrackPhase.success) return;
    final prefs = await SharedPreferences.getInstance();
    final pending = prefs.getString(_prefsKey)?.trim();
    if (!mounted || pending == null || pending.isEmpty) return;
    await _loadCancelCount();
    if (!mounted) return;
    setState(() {
      _orderId = pending;
      _phase = _PaymentTrackPhase.tracking;
      _message = PaymentStatusCopy.requestSent;
    });
    _startAutoPoll();
    _startHintRotation();
    await _pollOnce();
  }

  void _startAutoPoll() {
    if (widget.isPremium || _orderId == null || _orderId!.isEmpty) return;
    if (_isTerminalPhase) return;
    _autoPollTimer?.cancel();
    _autoPollTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!mounted || widget.isPremium) return;
      unawaited(_pollOnce());
    });
  }

  void _ensurePollingActive() {
    if (_orderId == null || _orderId!.isEmpty || _isTerminalPhase) return;
    _startAutoPoll();
    if (_phase == _PaymentTrackPhase.applying || _phase == _PaymentTrackPhase.tracking) {
      _startHintRotation();
    }
  }

  Future<bool> _tryApplyUnlock(Map<String, dynamic> response) async {
    final granted =
        response['premiumGranted'] == true || response['premium_granted'] == true;
    final userPayload = userPayloadFromPaymentResponse(response) ?? <String, dynamic>{};
    if (granted) {
      userPayload['premiumGranted'] = true;
      userPayload['isPremium'] = true;
      userPayload['is_premium'] = true;
    } else if (!shouldKeepPaymentUnlockPolling(response) &&
        !isPaymentSuccessResponse(response)) {
      return false;
    }
    try {
      return await widget.onPaymentSuccess?.call(userPayload: userPayload) ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<void> _finishUnlockSuccess() async {
    await PaymentPendingSession.clear();
    await _clearCancelCount();
    _stopTrackingTimers();
    HapticFeedback.mediumImpact();
    if (!mounted) return;
    setState(() {
      _phase = _PaymentTrackPhase.success;
      _message = PaymentStatusCopy.success;
      _orderId = null;
    });
  }

  Future<void> _stayOnApplyingUnlockLoop({required int pollAttempt}) async {
    if (!mounted) return;
    setState(() {
      _phase = _PaymentTrackPhase.applying;
      _message = pollAttempt > 3 ? PaymentStatusCopy.applyingRetry : PaymentStatusCopy.applying;
    });
    _ensurePollingActive();
  }

  bool get _isTerminalPhase =>
      _phase == _PaymentTrackPhase.success ||
      _phase == _PaymentTrackPhase.cancelled ||
      _phase == _PaymentTrackPhase.insufficient ||
      _phase == _PaymentTrackPhase.failed;

  void _stopAutoPoll() {
    _autoPollTimer?.cancel();
    _autoPollTimer = null;
  }

  Future<void> _onCheckPaymentTap() async {
    if (_polling) return;
    HapticFeedback.lightImpact();
    final prefs = await SharedPreferences.getInstance();
    final pending = prefs.getString(_prefsKey)?.trim();
    if (!mounted) return;
    if ((pending == null || pending.isEmpty) && _orderId == null) {
      setState(() {
        _phase = _PaymentTrackPhase.idle;
        _message = PaymentStatusCopy.noPending;
      });
      return;
    }
    if (pending != null && pending.isNotEmpty) {
      if (_orderId != pending) {
        _orderId = pending;
        await _loadCancelCount();
      }
      if (_phase == _PaymentTrackPhase.idle || _isTerminalPhase) {
        setState(() {
          _phase = _PaymentTrackPhase.tracking;
          _message = PaymentStatusCopy.requestSent;
        });
      }
    }
    await _pollOnce();
    if (_orderId != null && _orderId!.isNotEmpty && !_isTerminalPhase) {
      _ensurePollingActive();
    }
  }

  Future<void> _handleCancelled(String orderId, Map<String, dynamic> response) async {
    if (_handlingCancel || _resendingStk) return;

    final sessionAge = await PaymentPendingSession.sessionAge();
    if (sessionAge < kPaymentTerminalGracePeriod && _pollCount < kPaymentMinPollsBeforeTerminal) {
      if (!mounted) return;
      setState(() {
        _phase = _PaymentTrackPhase.tracking;
        _message = PaymentStatusCopy.checking;
      });
      _ensurePollingActive();
      return;
    }

    _handlingCancel = true;
    try {
      final count = await PaymentPendingSession.incrementCancelCount();
      _cancelCount = count;
      if (!mounted) return;

      if (count >= _maxCancelAttempts) {
        await _finalizeCancelled();
        return;
      }

      final left = _maxCancelAttempts - count;
      setState(() {
        _phase = _PaymentTrackPhase.tracking;
        _message = PaymentStatusCopy.cancelSoft(count, left);
      });

      await _resendStkNow();
      _ensurePollingActive();
    } finally {
      _handlingCancel = false;
    }
  }

  Future<void> _handleInsufficient(Map<String, dynamic> response) async {
    final prefs = await SharedPreferences.getInstance();
    await PaymentPendingSession.clear();
    await prefs.remove(_prefsKey);
    await _clearCancelCount();
    _stopTrackingTimers();
    setState(() {
      _phase = _PaymentTrackPhase.insufficient;
      _message = PaymentStatusCopy.insufficient;
      _orderId = null;
    });
  }

  Future<void> _pollOnce() async {
    final orderId = _orderId?.trim();
    if (orderId == null || orderId.isEmpty || widget.isPremium) {
      if (widget.isPremium && orderId != null && orderId.isNotEmpty) {
        await _finishUnlockSuccess();
      }
      return;
    }

    setState(() {
      _polling = true;
      _pollCount += 1;
    });
    try {
      final response = await PaymentPendingSession.checkBestPaymentStatus();
      if (!mounted) return;

      final sessionAge = await PaymentPendingSession.sessionAge();
      if (shouldDeferPaymentTerminal(
        sessionAge: sessionAge,
        pollCount: _pollCount,
        response: response,
      )) {
        setState(() {
          _phase = _PaymentTrackPhase.tracking;
          _message = _pollCount <= 1 ? PaymentStatusCopy.requestSent : PaymentStatusCopy.checking;
        });
        _ensurePollingActive();
        return;
      }

      if (shouldKeepPaymentUnlockPolling(response)) {
        final unlocked = await _tryApplyUnlock(response);
        if (!mounted) return;
        if (unlocked || widget.isPremium) {
          await _finishUnlockSuccess();
          return;
        }
        await _stayOnApplyingUnlockLoop(pollAttempt: _pollCount);
        return;
      }

      if (isPaymentSuccessResponse(response)) {
        final unlocked = await _tryApplyUnlock(response);
        if (!mounted) return;
        if (!unlocked && !widget.isPremium) {
          await _stayOnApplyingUnlockLoop(pollAttempt: _pollCount);
          return;
        }
        await _finishUnlockSuccess();
        return;
      }

      final status = paymentStatusFromResponse(response);

      if (isPaymentCancelledStatus(status)) {
        await _handleCancelled(orderId, response);
        return;
      }

      if (isPaymentInsufficientFunds(status) ||
          (response['terminal'] == true && isPaymentInsufficientFunds(status))) {
        await _handleInsufficient(response);
        return;
      }

      if (response['terminal'] == true || isPaymentTerminalFailure(status)) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.remove(_prefsKey);
        await _clearCancelCount();
        _stopTrackingTimers();
        setState(() {
          _phase = _PaymentTrackPhase.failed;
          _message = paymentStatusUserMessage(response);
          _orderId = null;
        });
        return;
      }

      setState(() {
        _phase = _PaymentTrackPhase.tracking;
        _message = _confirmationHints[_hintIndex];
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        if (_phase == _PaymentTrackPhase.idle) {
          _message = PaymentStatusCopy.networkError;
        } else {
          _message = PaymentStatusCopy.serverProcessing;
        }
      });
    } finally {
      if (mounted) setState(() => _polling = false);
    }
  }

  bool get _showRetry =>
      _phase == _PaymentTrackPhase.cancelled ||
      _phase == _PaymentTrackPhase.insufficient ||
      _phase == _PaymentTrackPhase.failed;

  double get _progressValue {
    switch (_phase) {
      case _PaymentTrackPhase.idle:
        return 0.05;
      case _PaymentTrackPhase.tracking:
        return 0.45;
      case _PaymentTrackPhase.applying:
        return 0.78;
      case _PaymentTrackPhase.success:
        return 1.0;
      case _PaymentTrackPhase.cancelled:
      case _PaymentTrackPhase.insufficient:
      case _PaymentTrackPhase.failed:
        return 1.0;
    }
  }

  String get _phaseLabel {
    switch (_phase) {
      case _PaymentTrackPhase.idle:
        return 'TAYARI';
      case _PaymentTrackPhase.tracking:
        return 'INASUBIRI UTHIBITISHO';
      case _PaymentTrackPhase.applying:
        return 'INASASISHA AKAUNTI';
      case _PaymentTrackPhase.success:
        return 'IMEKAMILIKA';
      case _PaymentTrackPhase.cancelled:
        return 'UMEKATISHA';
      case _PaymentTrackPhase.insufficient:
        return 'SALIO HALITOSHI';
      case _PaymentTrackPhase.failed:
        return 'IMESHINDWA';
    }
  }

  Color _accentForPhase(AppThemeColors t) {
    switch (_phase) {
      case _PaymentTrackPhase.success:
        return const Color(0xFF22C55E);
      case _PaymentTrackPhase.cancelled:
      case _PaymentTrackPhase.failed:
        return const Color(0xFFF97316);
      case _PaymentTrackPhase.insufficient:
        return const Color(0xFFEAB308);
      case _PaymentTrackPhase.applying:
      case _PaymentTrackPhase.tracking:
        return t.accent;
      case _PaymentTrackPhase.idle:
        return t.text2;
    }
  }

  IconData _iconForPhase() {
    switch (_phase) {
      case _PaymentTrackPhase.success:
        return Icons.verified_rounded;
      case _PaymentTrackPhase.cancelled:
        return Icons.phonelink_erase_rounded;
      case _PaymentTrackPhase.insufficient:
        return Icons.account_balance_wallet_outlined;
      case _PaymentTrackPhase.failed:
        return Icons.error_outline_rounded;
      case _PaymentTrackPhase.applying:
        return Icons.cloud_sync_rounded;
      case _PaymentTrackPhase.tracking:
        return Icons.phonelink_ring_rounded;
      case _PaymentTrackPhase.idle:
        return Icons.payments_outlined;
    }
  }

  void _syncTrackingController() {
    final ctrl = PaymentTrackingController.instance;
    if (widget.isPremium || !RemoteConfigService.paymentsEnabled) {
      ctrl.sync(active: false);
      return;
    }
    final active = _orderId != null &&
        _orderId!.isNotEmpty &&
        !_isTerminalPhase &&
        _phase != _PaymentTrackPhase.idle;
    final spinning = _polling ||
        _resendingStk ||
        _phase == _PaymentTrackPhase.tracking ||
        _phase == _PaymentTrackPhase.applying;
    var title = PaymentStatusCopy.checking;
    if (_phase == _PaymentTrackPhase.applying) {
      title = 'Malipo yamepokelewa — tunafungua channel zote';
    } else if (_resendingStk) {
      title = 'Tunatuma ombi la malipo tena';
    } else if (_phase == _PaymentTrackPhase.tracking && _pollCount <= 1) {
      title = PaymentStatusCopy.requestSent;
    }
    ctrl.sync(active: active, polling: spinning, statusLine: title);
  }

  @override
  Widget build(BuildContext context) {
    if (!RemoteConfigService.paymentsEnabled || widget.isPremium) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        PaymentTrackingController.instance.sync(active: false);
      });
      return const SizedBox.shrink();
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _syncTrackingController();
    });

    final t = context.watch<ThemeController>().colors;
    final accent = _accentForPhase(t);
    final active = _polling || _phase == _PaymentTrackPhase.tracking || _phase == _PaymentTrackPhase.applying;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            const Color(0xFF1A2332),
            const Color(0xFF0D1420).withValues(alpha: 0.98),
          ],
        ),
        border: Border.all(color: accent.withValues(alpha: 0.4)),
        boxShadow: [
          BoxShadow(color: accent.withValues(alpha: 0.12), blurRadius: 22),
          BoxShadow(color: Colors.black.withValues(alpha: 0.32), blurRadius: 18, offset: const Offset(0, 10)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(_iconForPhase(), size: 18, color: accent),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Hali ya Malipo',
                      style: rajdhani(16, weight: FontWeight.w700).copyWith(color: Colors.white),
                    ),
                    Text(
                      _phaseLabel,
                      style: rajdhani(10, weight: FontWeight.w600).copyWith(
                        color: accent,
                        letterSpacing: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
              if (active)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: accent.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: accent.withValues(alpha: 0.3)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(
                        width: 8,
                        height: 8,
                        child: CircularProgressIndicator(strokeWidth: 1.5, color: accent),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        'LIVE',
                        style: rajdhani(9, weight: FontWeight.w700).copyWith(color: accent, letterSpacing: 1),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: _progressValue,
              minHeight: 5,
              backgroundColor: Colors.white.withValues(alpha: 0.08),
              color: accent,
            ),
          ),
          const SizedBox(height: 6),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Hatua 1: Ombi',
                style: rajdhani(9).copyWith(color: t.text2),
              ),
              Text(
                'Hatua 2: PIN',
                style: rajdhani(9).copyWith(color: t.text2),
              ),
              Text(
                'Hatua 3: Malipo',
                style: rajdhani(9).copyWith(color: t.text2),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Center(
            child: GestureDetector(
              onTap: _polling ? null : _onCheckPaymentTap,
              child: AnimatedBuilder(
                animation: Listenable.merge([_pulseCtrl, _ringCtrl]),
                builder: (context, child) {
                  final scale = active ? 1.0 + (_pulseCtrl.value * 0.035) : 1.0;
                  return Transform.scale(
                    scale: scale,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        if (active)
                          SizedBox(
                            width: 88,
                            height: 88,
                            child: CircularProgressIndicator(
                              value: _ringCtrl.value,
                              strokeWidth: 2,
                              color: accent.withValues(alpha: 0.25),
                            ),
                          ),
                        Container(
                          width: 76,
                          height: 76,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: [accent.withValues(alpha: 0.3), accent.withValues(alpha: 0.1)],
                            ),
                            border: Border.all(color: accent.withValues(alpha: 0.55), width: 2),
                            boxShadow: [BoxShadow(color: accent.withValues(alpha: 0.22), blurRadius: 18)],
                          ),
                          child: _polling
                              ? Padding(
                                  padding: const EdgeInsets.all(20),
                                  child: CircularProgressIndicator(strokeWidth: 2.5, color: accent),
                                )
                              : Icon(Icons.visibility_rounded, size: 32, color: accent),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Angalia Malipo',
            textAlign: TextAlign.center,
            style: rajdhani(13, weight: FontWeight.w700).copyWith(color: Colors.white, letterSpacing: 0.6),
          ),
          if (_phase == _PaymentTrackPhase.tracking && _cancelCount > 0) ...[
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(_maxCancelAttempts, (i) {
                final filled = i < _cancelCount;
                return Container(
                  width: 10,
                  height: 10,
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: filled ? const Color(0xFFF97316) : Colors.white.withValues(alpha: 0.15),
                    border: Border.all(
                      color: filled ? const Color(0xFFF97316) : Colors.white.withValues(alpha: 0.25),
                    ),
                  ),
                );
              }),
            ),
          ],
          const SizedBox(height: 14),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.05),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
            ),
            child: Column(
              children: [
                Text(
                  _message,
                  textAlign: TextAlign.center,
                  style: rajdhani(14, weight: FontWeight.w500).copyWith(
                    color: Colors.white.withValues(alpha: 0.94),
                    height: 1.4,
                  ),
                ),
                if (active && _pollCount > 0) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Ukaguzi #$_pollCount — tunathibitisha moja kwa moja na seva',
                    textAlign: TextAlign.center,
                    style: rajdhani(11).copyWith(color: t.text2),
                  ),
                ],
                if (_phase == _PaymentTrackPhase.tracking && _cancelCount > 0) ...[
                  const SizedBox(height: 6),
                  Text(
                    'Ombi la malipo limetumwa tena $_cancelCount/$_maxCancelAttempts',
                    textAlign: TextAlign.center,
                    style: rajdhani(11, weight: FontWeight.w600).copyWith(color: accent),
                  ),
                ],
              ],
            ),
          ),
          if (_showRetry && widget.onRetryPayment != null) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () {
                  HapticFeedback.lightImpact();
                  widget.onRetryPayment?.call();
                },
                style: FilledButton.styleFrom(
                  backgroundColor: accent.withValues(alpha: 0.2),
                  foregroundColor: accent,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(color: accent.withValues(alpha: 0.45)),
                  ),
                ),
                icon: const Icon(Icons.replay_rounded, size: 18),
                label: Text(
                  'Anza malipo mapya',
                  style: rajdhani(14, weight: FontWeight.w700),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
