import 'package:shared_preferences/shared_preferences.dart';

import '../config/api.dart';
import '../config/payment_helpers.dart';
import '../services/user_id.dart';
import 'payment_tracking_controller.dart';

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
  static const startedAtKey = 'pendingPaymentStartedAt';
  static const cancelCountKey = 'paymentTrackCancelCount';
  static const maxCancelAttempts = 3;

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
    await prefs.setInt(startedAtKey, DateTime.now().millisecondsSinceEpoch);
    await _rememberRelatedOrder(orderId);
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

  /// Fire a fresh STK for the current session (e.g. after user cancels on phone).
  static Future<String?> resendStk({String? payerName}) async {
    final session = await load();
    if (session == null) return null;
    final uid = await ensureLocalUserId();
    final Map<String, dynamic> result;
    if (session.promotionId != null) {
      result = await paymentsApi.startOfferPayment(
        externalId: uid,
        promotionId: session.promotionId!,
        amount: session.amount,
        phone: session.phone,
        email: '$uid@eamax.app',
        name: payerName ?? uid,
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
    if (newOrderId.isNotEmpty) {
      // Keep the previous order id so we still unlock if the user paid the
      // first STK prompt after a cancel/resend cycle.
      await updateOrderId(newOrderId);
    }
    return newOrderId.isEmpty ? null : newOrderId;
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
    await prefs.remove(startedAtKey);
    await prefs.remove(cancelCountKey);
    PaymentTrackingController.instance.sync(active: false);
  }
}
