import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/api.dart';
import '../config/payment_helpers.dart';
import '../models/remote_config_bundle.dart';
import '../utils/tz_payment_config.dart';
import 'payment_pending_session.dart';
import 'user_id.dart';

enum CheckoutStage { sending, waiting, success, failed }

/// One mobile-money checkout: sends the USSD/PIN prompt, polls until the server
/// confirms, and supports "Tuma tena". UI listens and renders [stage] and [hint].
class PaymentCheckout extends ChangeNotifier {
  PaymentCheckout({
    required this.plan,
    required this.phone,
    required this.onPaymentSuccess,
  });

  static const prefsPhoneKey = 'eamax_pay_phone_v1';

  static PaymentCheckout? _current;

  /// While a checkout is sending or waiting it is the only status poller; app-wide
  /// watchers stand down so one payer doesn't hit the server several times a second.
  static bool get isRunning {
    final c = _current;
    return c != null &&
        !c._closed &&
        (c.stage == CheckoutStage.sending || c.stage == CheckoutStage.waiting);
  }

  final RemoteSubscriptionPlan plan;
  final String phone;
  final PremiumUnlockCallback? onPaymentSuccess;

  CheckoutStage stage = CheckoutStage.sending;
  String hint = 'Tunatuma ombi la malipo…';
  bool promptOnPhone = false;
  bool canResend = false;
  bool resending = false;

  bool _closed = false;
  Timer? _resendHold;

  TzMobileNetwork get network => TzPaymentConfig.detectNetwork(phone);

  void _set(void Function() change) {
    if (_closed) return;
    change();
    notifyListeners();
  }

  void start() {
    _current = this;
    unawaited(_run());
  }

  /// Stops polling; safe to call more than once.
  void close() {
    _closed = true;
    if (identical(_current, this)) _current = null;
    _resendHold?.cancel();
  }

  @override
  void dispose() {
    close();
    super.dispose();
  }

  Future<void> _run() async {
    _set(() {
      stage = CheckoutStage.sending;
      hint = 'Tunatuma ombi… ${TzPaymentConfig.paymentPromptFor(phone)}';
    });

    try {
      final uid = (await getOrCreateUserId())?.trim() ?? (await ensureLocalUserId());
      if (uid.isEmpty) {
        _fail('Hatukuweza kutambua akaunti yako. Jaribu tena.');
        return;
      }
      unawaited(registerUserInDatabase(id: uid, maxRetries: 1));
      final reset = PaymentPendingSession.resetForNewCheckout();
      final resultFuture = paymentsApi.startPayment(
        externalId: uid,
        bundle: plan.slug,
        amount: plan.priceTzs,
        phone: phone,
        email: '$uid@eamax.app',
        name: 'EaMax $phone',
      );
      await reset;
      final result = await resultFuture;
      if (_closed) return;

      final orderId = (result['orderId']?.toString() ?? '').trim();
      final dispatching = result['dispatching'] == true;
      final pushSent = dispatching || result['ussdSent'] != false;
      debugPrint('[Checkout] order=${orderId.isEmpty ? 'none' : orderId} ussdSent=${result['ussdSent']}');

      if (orderId.isEmpty) {
        _set(() {
          stage = CheckoutStage.waiting;
          promptOnPhone = false;
          canResend = true;
          hint = 'Ombi halijatumwa kwenye simu. Gusa Tuma tena.';
        });
        return;
      }

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('pendingPaymentOrderId', orderId);
      await prefs.setString(prefsPhoneKey, phone);
      await PaymentPendingSession.save(
        orderId: orderId,
        phone: phone,
        bundle: plan.slug,
        amount: plan.priceTzs,
      );

      final onTheWay = result['slowGateway'] == true || result['phoneBusy'] == true;
      if (onTheWay) _holdResend();
      _set(() {
        stage = CheckoutStage.waiting;
        promptOnPhone = pushSent;
        canResend = !onTheWay;
        hint = onTheWay
            ? _promptOnTheWay
            : dispatching
                ? 'Tunatuma ombi. Subiri PIN kwenye simu.'
                : (pushSent ? 'Ingiza PIN kwenye simu yako kuthibitisha.' : 'Ombi halijatumwa kwenye simu. Gusa Tuma tena.');
      });

      await _poll();
    } catch (e) {
      if (_closed) return;
      debugPrint('[Checkout] start failed: $e');
      final busy = _phoneUssdBusy(e);
      if (busy) _holdResend();
      _set(() {
        stage = CheckoutStage.waiting;
        promptOnPhone = busy;
        canResend = !busy;
        hint = busy ? _promptOnTheWay : mapPaymentStartError(e);
      });
    }
  }

  Future<void> _poll() async {
    const maxAttempts = 90;
    for (var i = 0; i < maxAttempts; i++) {
      if (i > 0) {
        await Future<void>.delayed(i < 30 ? const Duration(seconds: 2) : const Duration(seconds: 3));
      }
      if (_closed || stage == CheckoutStage.success) return;

      try {
        final response = await PaymentPendingSession.checkBestPaymentStatus();
        final sessionAge = await PaymentPendingSession.sessionAge();
        if (_closed) return;
        if (i == 0 && response['gatewayNote'] != null) {
          debugPrint('[Checkout] gateway note: ${response['gatewayNote']}');
        }
        if (shouldDeferPaymentTerminal(sessionAge: sessionAge, pollCount: i + 1, response: response) ||
            (shouldKeepPaymentUnlockPolling(response) && !isPaymentSuccessResponse(response))) {
          continue;
        }
        if (isPaymentSuccessResponse(response)) {
          var unlocked = false;
          try {
            unlocked = await onPaymentSuccess?.call(userPayload: userPayloadFromPaymentResponse(response)) ?? false;
          } catch (e) {
            debugPrint('[Checkout] onPaymentSuccess failed: $e');
          }
          if (!unlocked) {
            _set(() => hint = PaymentStatusCopy.applying);
            continue;
          }
          await PaymentPendingSession.clear();
          _succeed();
          return;
        }
        final status = paymentStatusFromResponse(response);
        if (isPaymentCancelledStatus(status)) {
          _set(() => hint = 'Umekatisha ombi. Gusa Tuma tena kupokea PIN mpya.');
          continue;
        }
        if (isPaymentTerminalFailure(status) || response['terminal'] == true) {
          _fail(paymentStatusUserMessage(response));
          return;
        }
      } catch (_) {
        _set(() => hint = PaymentStatusCopy.serverProcessing);
      }
    }
    if (_closed) return;
    _fail(promptOnPhone
        ? 'Muda wa kusubiri umeisha. Hakikisha umethibitisha PIN, kisha jaribu tena.'
        : 'PIN haijatumwa kwenye simu. Jaribu tena.');
  }

  Future<void> resend() async {
    if (_closed || resending || !canResend || stage == CheckoutStage.success) return;
    _set(() {
      resending = true;
      hint = 'Tunatuma ombi la PIN kwenye $phone…';
    });
    try {
      final r = await PaymentPendingSession.resendStk(
        userRequested: true,
        phone: phone,
        bundle: plan.slug,
        amount: plan.priceTzs,
      );
      if (_closed) return;
      if (r.sent && !r.reusedPending) {
        if (r.orderId != null && r.orderId!.isNotEmpty) {
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('pendingPaymentOrderId', r.orderId!);
        }
        _set(() {
          promptOnPhone = true;
          hint = 'Ombi jipya limetumwa. Ingiza PIN kwenye simu yako.';
        });
      } else if (r.dispatching || (r.reusedPending && r.ussdSent != false)) {
        _set(() {
          promptOnPhone = true;
          hint = r.dispatching ? 'Tunatuma ombi. Subiri PIN kwenye simu.' : 'Ombi limetumwa. Ingiza PIN kwenye simu yako.';
        });
      } else if (r.ussdSent == false) {
        _set(() {
          promptOnPhone = false;
          hint = 'Ombi halijatumwa kwenye simu. Gusa Tuma tena.';
        });
      } else if (r.skippedTooSoon) {
        _set(() => hint = 'Subiri sekunde chache, kisha gusa Tuma tena.');
      } else if (r.capped) {
        _set(() => hint = 'Umefika kikomo. Funga USSD kwenye simu, subiri dakika moja, kisha jaribu tena.');
      } else {
        _set(() {
          promptOnPhone = false;
          hint = 'Hatukuweza kutuma ombi tena. Jaribu tena.';
        });
      }
    } catch (e) {
      if (_closed) return;
      final busy = _phoneUssdBusy(e);
      if (busy) _holdResend();
      _set(() {
        promptOnPhone = busy;
        hint = busy ? _promptOnTheWay : mapPaymentStartError(e);
      });
    } finally {
      _set(() => resending = false);
    }
  }

  /// Retry after a terminal failure: a fresh order and a new prompt.
  void retry() {
    if (_closed) return;
    _set(() {
      promptOnPhone = false;
      canResend = false;
    });
    unawaited(_run());
  }

  void _succeed() {
    _set(() {
      stage = CheckoutStage.success;
      hint = 'Chaneli zote zimefunguliwa. Karibu ufurahie Premium.';
    });
  }

  void _fail(String message) {
    _set(() {
      stage = CheckoutStage.failed;
      hint = message;
    });
  }

  static const _promptOnTheWay = 'Utapokea ujumbe kukamilisha malipo kwenye namba uliyoiandika.';

  /// The SIM already has a USSD window open; a crowded gateway is a different case.
  bool _phoneUssdBusy(Object error) {
    final raw = error.toString().toLowerCase();
    return raw.contains('ussd nyingine') ||
        raw.contains('funga dirisha la ussd') ||
        raw.contains('utapokea ujumbe');
  }

  /// M-Pesa refuses another prompt while one is open; hold the button so taps don't pile up.
  void _holdResend() {
    _resendHold?.cancel();
    canResend = false;
    _resendHold = Timer(const Duration(seconds: 30), () {
      _set(() {
        canResend = true;
        if (stage == CheckoutStage.waiting) hint = 'Hujapokea ujumbe? Gusa Tuma tena.';
      });
    });
  }
}
