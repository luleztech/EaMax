/// Normalizes Zeno / backend payment status strings from polling or webhooks.
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
/// **Never** treat `SUCCESS` as paid here — Zeno’s order-status often uses `result: SUCCESS`
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
      s == 'CONFIRMED';
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

/// Called after payment success or admin grant to unlock channels.
typedef PremiumUnlockCallback = Future<void> Function({Map<String, dynamic>? userPayload});
