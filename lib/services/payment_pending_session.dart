import 'package:shared_preferences/shared_preferences.dart';

import '../config/api.dart';
import '../config/payment_helpers.dart';
import '../services/user_id.dart';
import 'payment_tracking_controller.dart';

/// Outcome of a real wallet re-push while a checkout is still being checked.
class PaymentResendResult {
  const PaymentResendResult({
    this.orderId,
    this.phone = '',
    this.attempt = 0,
    this.skippedTooSoon = false,
    this.capped = false,
  });

  final String? orderId;
  final String phone;
  final int attempt;
  final bool skippedTooSoon;
  final bool capped;

  bool get sent => orderId != null && orderId!.isNotEmpty;
}

/// Persisted STK session so [PaymentStatusCard] can resend prompts while tracking.
class PaymentPendingSession {
  PaymentPendingSession({
    required this.orderId,
    required this.phone,
    required this.bundle,
    required this.amount,
    this.promotionId,
  });

  final String orderId;
  final String phone;
  final String bundle;
  final int amount;
  final int? promotionId;

  static const orderKey = 'pendingPaymentOrderId';
  static const relatedOrdersKey = 'pendingPaymentRelatedOrderIds';
  static const bundleKey = 'pendingPaymentBundle';
  static const amountKey = 'pendingPaymentAmount';
  static const phoneKey = 'eamax_pay_phone_v1';
  static const promotionIdKey = 'pendingPaymentPromotionId';
  static const resendCountKey = 'paymentStkResendCount';
  static const resendAnchorKey = 'paymentStkResendAnchorOrder';
  static const resendInFlightKey = 'paymentStkResendInFlight';
  static const promptAtKey = 'pendingPaymentLastPromptAt';
  static const startedAtKey = 'pendingPaymentStartedAt';
  static const cancelCountKey = 'paymentTrackCancelCount';
  /// Safety stop so a stuck checkout cannot create endless wallet prompts.
  static const maxAutoResends = 12;
  static const pendingResendGap = Duration(seconds: 25);
  static const cancelResendGap = Duration(seconds: 8);
  static const maxCancelAttempts = maxAutoResends;

  static Future<void> save({
    required String orderId,
    required String phone,
    required String bundle,
    required int amount,
    int? promotionId,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(orderKey, orderId);
    await prefs.setString(phoneKey, phone);
    await prefs.setString(bundleKey, bundle);
    await prefs.setInt(amountKey, amount);
    if (promotionId != null) {
      await prefs.setInt(promotionIdKey, promotionId);
    } else {
      await prefs.remove(promotionIdKey);
    }
    await prefs.setString(resendAnchorKey, orderId);
    await prefs.setInt(resendCountKey, 0);
    await prefs.setInt(cancelCountKey, 0);
    await prefs.remove(resendInFlightKey);
    final now = DateTime.now().millisecondsSinceEpoch;
    await prefs.setInt(startedAtKey, now);
    await prefs.setInt(promptAtKey, now);
    // A new checkout is its own session. Do not keep earlier order ids,
    // or a repeat payment inherits the last attempt's success or failure.
    await prefs.setStringList(relatedOrdersKey, [orderId]);
    PaymentTrackingController.instance.sync(
      active: true,
      polling: true,
      statusLine: PaymentStatusCopy.requestSent,
    );
  }

  static Future<void> updateOrderId(String orderId) async {
    final prefs = await SharedPreferences.getInstance();
    final previous = prefs.getString(orderKey)?.trim() ?? '';
    await prefs.setString(orderKey, orderId);
    if (previous.isNotEmpty && previous != orderId) {
      await _rememberRelatedOrder(previous);
    }
    await _rememberRelatedOrder(orderId);
  }

  static Future<void> _rememberRelatedOrder(String orderId) async {
    final id = orderId.trim();
    if (id.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getStringList(relatedOrdersKey) ?? <String>[];
    if (existing.contains(id)) return;
    existing.add(id);
    // Keep a short window of STK attempts so we can still detect a paid prior prompt.
    while (existing.length > 6) {
      existing.removeAt(0);
    }
    await prefs.setStringList(relatedOrdersKey, existing);
  }

  /// Active order plus prior STK attempts from the same payment session.
  static Future<List<String>> allOrderIds() async {
    final prefs = await SharedPreferences.getInstance();
    final primary = prefs.getString(orderKey)?.trim() ?? '';
    final related = prefs.getStringList(relatedOrdersKey) ?? const <String>[];
    final out = <String>[];
    void add(String id) {
      final t = id.trim();
      if (t.isEmpty || out.contains(t)) return;
      out.add(t);
    }

    add(primary);
    for (final id in related) {
      add(id);
    }
    return out;
  }

  /// Poll primary + related order ids; prefer success / applying over bare pending.
  static Future<Map<String, dynamic>> checkBestPaymentStatus() async {
    final ids = await allOrderIds();
    if (ids.isEmpty) {
      return {'status': 'PENDING', 'raw': <String, dynamic>{}};
    }
    Map<String, dynamic>? best;
    for (final id in ids) {
      final res = await paymentsApi.checkPaymentStatus(id);
      if (isPaymentSuccessResponse(res)) return res;
      if (shouldKeepPaymentUnlockPolling(res)) {
        best = res;
        continue;
      }
      best ??= res;
    }
    return best ?? {'status': 'PENDING', 'raw': <String, dynamic>{}};
  }

  static Future<PaymentPendingSession?> load() async {
    final prefs = await SharedPreferences.getInstance();
    final orderId = prefs.getString(orderKey)?.trim() ?? '';
    final phone = prefs.getString(phoneKey)?.trim() ?? '';
    final bundle = prefs.getString(bundleKey)?.trim() ?? '';
    final amount = prefs.getInt(amountKey) ?? 0;
    if (orderId.isEmpty || phone.isEmpty || bundle.isEmpty || amount <= 0) {
      return null;
    }
    final promo = prefs.getInt(promotionIdKey);
    return PaymentPendingSession(
      orderId: orderId,
      phone: phone,
      bundle: bundle,
      amount: amount,
      promotionId: promo,
    );
  }

  static Future<Duration> sessionAge() async {
    final prefs = await SharedPreferences.getInstance();
    final ms = prefs.getInt(startedAtKey);
    if (ms == null || ms <= 0) return Duration.zero;
    return DateTime.now().difference(DateTime.fromMillisecondsSinceEpoch(ms));
  }

  static Future<bool> withinGracePeriod() async {
    final age = await sessionAge();
    return age < kPaymentTerminalGracePeriod;
  }

  static Future<int> resendCount() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getInt(resendCountKey) ?? 0;
  }

  static Future<int> incrementResendCount() async {
    final prefs = await SharedPreferences.getInstance();
    final next = (prefs.getInt(resendCountKey) ?? 0) + 1;
    await prefs.setInt(resendCountKey, next);
    return next;
  }

  static Future<int> cancelCount() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getInt(cancelCountKey) ?? 0;
  }

  static Future<int> incrementCancelCount() async {
    final prefs = await SharedPreferences.getInstance();
    final next = (prefs.getInt(cancelCountKey) ?? 0) + 1;
    await prefs.setInt(cancelCountKey, next);
    return next;
  }

  static Future<void> clearCancelCount() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(cancelCountKey);
  }

  static Future<Duration> sinceLastPrompt() async {
    final prefs = await SharedPreferences.getInstance();
    final ms = prefs.getInt(promptAtKey) ?? prefs.getInt(startedAtKey);
    if (ms == null || ms <= 0) return const Duration(hours: 1);
    return DateTime.now().difference(DateTime.fromMillisecondsSinceEpoch(ms));
  }

  /// Real wallet prompt to the number the user typed.
  ///
  /// Pending checkouts retry after [pendingResendGap] (prompt never arrived).
  /// A cancel or expired prompt retries after [cancelResendGap], again and again,
  /// until [maxAutoResends]. The phone, plan, and amount stay; the prompt clock
  /// and in-flight flag are refreshed so the next push is a new order.
  static Future<PaymentResendResult> resendStk({
    String? payerName,
    bool userCancelled = false,
  }) async {
    final session = await load();
    if (session == null) {
      return const PaymentResendResult(skippedTooSoon: true);
    }
    final prefs = await SharedPreferences.getInstance();
    final inFlightAt = prefs.getInt(resendInFlightKey) ?? 0;
    if (inFlightAt > 0 &&
        DateTime.now().difference(DateTime.fromMillisecondsSinceEpoch(inFlightAt)) <
            const Duration(seconds: 40)) {
      return PaymentResendResult(phone: session.phone, skippedTooSoon: true);
    }
    final already = prefs.getInt(resendCountKey) ?? 0;
    if (already >= maxAutoResends) {
      return PaymentResendResult(phone: session.phone, attempt: already, capped: true);
    }
    final age = await sinceLastPrompt();
    final gap = userCancelled ? cancelResendGap : pendingResendGap;
    if (age < gap) {
      return PaymentResendResult(phone: session.phone, attempt: already, skippedTooSoon: true);
    }

    await prefs.setInt(resendInFlightKey, DateTime.now().millisecondsSinceEpoch);
    try {
      final uid = await ensureLocalUserId();
      final Map<String, dynamic> result;
      if (session.promotionId != null) {
        result = await paymentsApi.startOfferPayment(
          externalId: uid,
          promotionId: session.promotionId!,
          amount: session.amount,
          phone: session.phone,
          email: '$uid@eamax.app',
          name: payerName ?? 'EaMax ${session.phone}',
        );
      } else {
        result = await paymentsApi.startPayment(
          externalId: uid,
          bundle: session.bundle,
          amount: session.amount,
          phone: session.phone,
          email: '$uid@eamax.app',
          name: payerName ?? 'EaMax ${session.phone}',
        );
      }
      final newOrderId = (result['orderId']?.toString() ?? '').trim();
      if (newOrderId.isEmpty) {
        await _stampPromptClock(prefs);
        return PaymentResendResult(phone: session.phone, attempt: already);
      }
      // Keep earlier order ids so a PIN on a previous prompt still unlocks.
      await updateOrderId(newOrderId);
      final attempt = await incrementResendCount();
      await _stampPromptClock(prefs);
      await prefs.setInt(cancelCountKey, 0);
      return PaymentResendResult(
        orderId: newOrderId,
        phone: session.phone,
        attempt: attempt,
      );
    } catch (_) {
      await _stampPromptClock(prefs);
      rethrow;
    } finally {
      await prefs.remove(resendInFlightKey);
    }
  }

  static Future<void> _stampPromptClock(SharedPreferences prefs) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    await prefs.setInt(promptAtKey, now);
    await prefs.setInt(startedAtKey, now);
  }

  /// Drop every cached checkout so the next payment starts at step 1.
  static Future<void> resetForNewCheckout() async {
    await clear();
    PaymentTrackingController.instance.sync(active: false);
  }

  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(orderKey);
    await prefs.remove(relatedOrdersKey);
    await prefs.remove(bundleKey);
    await prefs.remove(amountKey);
    await prefs.remove(promotionIdKey);
    await prefs.remove(resendCountKey);
    await prefs.remove(resendAnchorKey);
    await prefs.remove(resendInFlightKey);
    await prefs.remove(promptAtKey);
    await prefs.remove(startedAtKey);
    await prefs.remove(cancelCountKey);
    PaymentTrackingController.instance.sync(active: false);
  }
}
