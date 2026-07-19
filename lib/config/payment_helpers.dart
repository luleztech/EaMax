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

bool _userPayloadIsPremium(Map<String, dynamic>? user) {
  if (user == null) return false;
  final snap = PremiumSnapshot.fromDynamic(user);
  return snap?.isPremium == true;
}

/// True when polling response means payment succeeded AND premium is active on the user.
///
/// If the backend is still applying entitlements (`applying: true`), keep polling.
bool isPaymentSuccessResponse(Map<String, dynamic> response) {
  if (isPaymentStillApplying(response)) return false;

  final user = userPayloadFromPaymentResponse(response);
  if (_userPayloadIsPremium(user)) return true;

  // Explicit grant flag from backend (when present).
  if (response['premiumGranted'] == true || response['premium_granted'] == true) {
    return true;
  }

  final st = response['status'] ?? response['raw']?['data']?[0]?['payment_status'];
  // COMPLETED alone is not enough — require a premium user snapshot when status says done.
  if (isPaymentCompleted(st) && user != null) {
    // User object present but not premium yet → still applying.
    return false;
  }
  return false;
}

/// Keep polling while the server is still applying premium after gateway confirmation.
bool isPaymentStillApplying(Map<String, dynamic> response) =>
    response['applying'] == true;

/// Called after payment success or admin grant to unlock channels.
/// Returns `true` only when local premium state is confirmed active.
typedef PremiumUnlockCallback = Future<bool> Function({Map<String, dynamic>? userPayload});
