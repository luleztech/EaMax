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

/// True only when money is confirmed (polling `/zeno/status` or user record).
///
/// **Never** treat `SUCCESS` / `success` as paid — the start-payment API uses that
/// for “request accepted, check your phone”, not “payment completed”.
bool isPaymentCompleted(Object? status) {
  final s = normalizedPaymentStatus(status);
  return s == 'COMPLETED' ||
      s == 'SUCCESS' ||
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
