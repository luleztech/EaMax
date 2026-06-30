import '../utils/premium_snapshot.dart';

/// Normalizes Aurax Pay / backend payment status strings from polling or webhooks.
String normalizedPaymentStatus(Object? status) {
  return status?.toString().toUpperCase().trim() ?? '';
}

/// True when gateway still processing (keep polling).
bool isPaymentPending(Object? status) {
  final s = normalizedPaymentStatus(status);
  return s.isEmpty ||
      s == 'PENDING' ||
      s == 'PROCESSING' ||
      s == 'UNKNOWN' ||
      s == 'INITIATED' ||
      s == 'WAITING';
}

/// True only when money is confirmed (polling `/api/payments/status` or user record).
///
/// **Never** treat `SUCCESS` as paid here — some gateways use `SUCCESS` for “STK sent”, not wallet paid.
/// for “HTTP OK / query OK” while `payment_status` is still pending; the backend maps
/// real completion to `COMPLETED` for the app.
bool isPaymentCompleted(Object? status) {
  final s = normalizedPaymentStatus(status);
  return s == 'COMPLETED' ||
      s == 'PAID' ||
      s == 'COMPLETE' ||
      s == 'SUCCEEDED' ||
      s == 'APPROVED' ||
      s == 'SETTLED' ||
      s == 'CONFIRMED' ||
      s == 'SUCCESSFUL' ||
      s == 'COLLECTED';
}

/// Terminal failure — stop polling and let the user start a new payment from step 1.
bool isPaymentTerminalFailure(Object? status) {
  if (status == null) return false;
  final s = status.toString().toUpperCase().trim();
  if (s.isEmpty) return false;
  const failures = {
    'FAILED',
    'CANCELLED',
    'CANCELED',
    'REJECTED',
    'EXPIRED',
    'DECLINED',
    'VOID',
    'CANCEL',
    'ERROR',
  };
  return failures.contains(s);
}

/// Premium payload returned with `/api/payments/status` when payment completes.
Map<String, dynamic>? userPayloadFromPaymentResponse(Map<String, dynamic> response) {
  final user = response['user'];
  if (user is Map) return Map<String, dynamic>.from(user);
  return null;
}

/// True when polling response means payment succeeded and premium should unlock.
bool isPaymentSuccessResponse(Map<String, dynamic> response) {
  final st = response['status'] ?? response['raw']?['data']?[0]?['payment_status'];
  if (isPaymentCompleted(st)) return true;
  final user = userPayloadFromPaymentResponse(response);
  if (user != null) {
    final snap = PremiumSnapshot.fromDynamic(user);
    if (snap?.isPremium == true) return true;
  }
  return false;
}

/// Keep polling while the server is still applying premium after gateway confirmation.
bool isPaymentStillApplying(Map<String, dynamic> response) =>
    response['applying'] == true;

/// Called after payment success or admin grant to unlock channels.
typedef PremiumUnlockCallback = Future<void> Function({Map<String, dynamic>? userPayload});
