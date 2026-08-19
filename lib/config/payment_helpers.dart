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
      s == 'WAITING' ||
      // SonicPesa / some gateways use SUCCESS for “STK sent”, not wallet paid.
      s == 'SUCCESS' ||
      s == 'OK';
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
    'TIMEOUT',
    'REVERSED',
    'INSUFFICIENT_FUNDS',
    'INSUFFICIENT_BALANCE',
    'INSUFFICIENT',
    'NO_BALANCE',
    'NO_FUNDS',
    'LOW_BALANCE',
    'BALANCE_TOO_LOW',
    'NOT_ENOUGH_BALANCE',
    'FUNDS_INSUFFICIENT',
  };
  if (failures.contains(s)) return true;
  if (s.contains('INSUFFICIENT') ||
      s.contains('NO_BALANCE') ||
      s.contains('NO_FUNDS') ||
      s.contains('LOW_BALANCE') ||
      s.contains('NOT_ENOUGH')) {
    return true;
  }
  return false;
}

/// Premium payload returned with `/api/payments/status` when payment completes.
Map<String, dynamic>? userPayloadFromPaymentResponse(Map<String, dynamic> response) {
  final user = response['user'];
  if (user is Map) return Map<String, dynamic>.from(user);
  return null;
}

bool _userPayloadIsPremium(Map<String, dynamic>? user) {
  if (user == null) return false;
  final snap = PremiumSnapshot.fromDynamic(user);
  return snap?.isPremium == true;
}

/// True when polling response means payment succeeded AND premium is active on the user.
///
/// If the backend is still applying entitlements (`applying: true`), keep polling.
/// Never treat gateway `COMPLETED` alone as unlock — entitlements must be live
/// (`premiumGranted` or an active user premium payload).
bool isPaymentSuccessResponse(Map<String, dynamic> response) {
  if (isPaymentStillApplying(response)) return false;

  if (response['premiumGranted'] == true || response['premium_granted'] == true) {
    return true;
  }

  final user = userPayloadFromPaymentResponse(response);
  if (_userPayloadIsPremium(user)) return true;

  // Backend sometimes returns COMPLETED with user premium but without the flag.
  final status = normalizedPaymentStatus(response['status']);
  if ((status == 'COMPLETED' || status == 'PAID' || status == 'SUCCESSFUL') &&
      _userPayloadIsPremium(user)) {
    return true;
  }

  return false;
}

/// Keep polling while the server is still applying premium after gateway confirmation.
bool isPaymentStillApplying(Map<String, dynamic> response) =>
    response['applying'] == true;

/// Called after payment success or admin grant to unlock channels.
/// Returns `true` only when local premium state is confirmed active.
typedef PremiumUnlockCallback = Future<bool> Function({Map<String, dynamic>? userPayload});
