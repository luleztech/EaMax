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

/// Gateway confirmed payment but premium is not active yet — keep polling and retry unlock.
bool isPaymentGatewayPaidAwaitingUnlock(Map<String, dynamic> response) {
  if (isPaymentSuccessResponse(response)) return false;
  if (isPaymentStillApplying(response)) return true;

  final status = paymentStatusFromResponse(response);
  if (isPaymentTerminalFailure(status)) return false;
  if (!isPaymentCompleted(status)) return false;

  // COMPLETED at gateway without live premium — do not stop until unlock lands.
  if (response['premiumGranted'] == true || response['premium_granted'] == true) {
    return true;
  }
  final user = userPayloadFromPaymentResponse(response);
  if (_userPayloadIsPremium(user)) return false;
  return true;
}

/// Whether the poll response means we should keep checking and try to unlock.
bool shouldKeepPaymentUnlockPolling(Map<String, dynamic> response) =>
    isPaymentStillApplying(response) || isPaymentGatewayPaidAwaitingUnlock(response);

/// User cancelled before completing the STK/USSD steps.
bool isPaymentCancelledStatus(Object? status) {
  final s = normalizedPaymentStatus(status);
  return s == 'CANCELLED' || s == 'CANCELED' || s == 'CANCEL' || s == 'VOID';
}

/// Wallet rejected due to low balance.
bool isPaymentInsufficientFunds(Object? status) {
  final s = normalizedPaymentStatus(status);
  if (s.contains('INSUFFICIENT') ||
      s.contains('NO_BALANCE') ||
      s.contains('NO_FUNDS') ||
      s.contains('LOW_BALANCE') ||
      s.contains('NOT_ENOUGH')) {
    return true;
  }
  const codes = {
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
  return codes.contains(s);
}

/// Best-effort status string from a poll response (top-level or nested gateway field).
String paymentStatusFromResponse(Map<String, dynamic> response) {
  final top = normalizedPaymentStatus(response['status']);
  if (top.isNotEmpty) return top;
  final raw = response['raw'];
  if (raw is Map) {
    final nested = raw['data'];
    if (nested is List && nested.isNotEmpty && nested.first is Map) {
      final ps = normalizedPaymentStatus((nested.first as Map)['payment_status']);
      if (ps.isNotEmpty) return ps;
    }
    final direct = normalizedPaymentStatus(raw['payment_status'] ?? raw['paymentStatus']);
    if (direct.isNotEmpty) return direct;
  }
  return '';
}

/// Swahili copy for terminal failures (cancelled / insufficient / generic).
String paymentFailureUserMessage(Object? status, {int? cancelAttempt}) {
  if (isPaymentCancelledStatus(status)) {
    if (cancelAttempt != null && cancelAttempt >= 3) {
      return PaymentStatusCopy.cancelFinal;
    }
    if (cancelAttempt != null && cancelAttempt > 0) {
      final left = 3 - cancelAttempt;
      return PaymentStatusCopy.cancelSoft(cancelAttempt, left > 0 ? left : 0);
    }
    return 'Mpendwa mteja haujamaliza hatua za malipo.';
  }
  if (isPaymentInsufficientFunds(status)) {
    return PaymentStatusCopy.insufficient;
  }
  final s = normalizedPaymentStatus(status);
  if (s == 'EXPIRED' || s == 'TIMEOUT') {
    return 'Muda wa malipo umeisha. Tafadhali anza malipo mapya.';
  }
  if (s == 'REJECTED' || s == 'DECLINED') {
    return 'Malipo hayakuidhinishwa. Hakikisha una salio la kutosha kisha ujaribu tena.';
  }
  return 'Malipo hayajakamilika. Jaribu tena au wasiliana na msaada.';
}

/// User-facing line from `/api/payments/status` (server `userMessage` or local mapping).
String paymentStatusUserMessage(Map<String, dynamic> response) {
  if (isPaymentSuccessResponse(response)) {
    return PaymentStatusCopy.success;
  }
  if (isPaymentStillApplying(response)) {
    return PaymentStatusCopy.applying;
  }
  final serverMsg = response['userMessage']?.toString().trim();
  if (serverMsg != null && serverMsg.isNotEmpty) {
    if (isPaymentInsufficientFunds(paymentStatusFromResponse(response))) {
      return PaymentStatusCopy.insufficient;
    }
    if (isPaymentCancelledStatus(paymentStatusFromResponse(response))) {
      return 'Mpendwa mteja haujamaliza hatua za malipo.';
    }
    return serverMsg;
  }
  if (response['terminal'] == true || isPaymentTerminalFailure(paymentStatusFromResponse(response))) {
    return paymentFailureUserMessage(paymentStatusFromResponse(response));
  }
  if (isPaymentPending(paymentStatusFromResponse(response))) {
    return PaymentStatusCopy.waitingConfirmation;
  }
  return 'Tunafuatilia hali ya malipo yako…';
}

const kPaymentTerminalGracePeriod = Duration(seconds: 50);
const kPaymentMinPollsBeforeTerminal = 4;

/// Defer scary terminal copy while STK is still landing (gateway noise on fresh orders).
bool shouldDeferPaymentTerminal({
  required Duration sessionAge,
  required int pollCount,
  required Map<String, dynamic> response,
}) {
  if (isPaymentInsufficientFunds(paymentStatusFromResponse(response))) {
    return false;
  }
  if (isPaymentSuccessResponse(response) || shouldKeepPaymentUnlockPolling(response)) {
    return false;
  }
  final withinGrace =
      sessionAge < kPaymentTerminalGracePeriod && pollCount < kPaymentMinPollsBeforeTerminal;
  if (!withinGrace) return false;
  final status = paymentStatusFromResponse(response);
  if (response['terminal'] == true || isPaymentTerminalFailure(status)) {
    return true;
  }
  if (isPaymentCancelledStatus(status)) return true;
  return false;
}

/// Swahili copy shared by payment tracker UI.
abstract final class PaymentStatusCopy {
  static const success = 'Malipo yamepokelewa.';
  static const insufficient = 'Hauna salio la kutosha.';
  static const cancelFinal = 'Umekatisha malipo.';
  static const applying = 'Malipo yamepokelewa — tunafungua channel zote…';
  static const applyingRetry =
      'Malipo yamepokelewa — bado tunasasisha akaunti yako, subiri kidogo…';
  static const requestSent = 'Ombi la malipo limetumwa — angalia simu yako.';
  static const checking = 'Inaangalia malipo yako…';
  static const waitingConfirmation = 'Thibitisha malipo kwa PIN kwenye simu yako.';
  static const noPending = 'Hakuna malipo yanayosubiri kwa sasa.';
  static const networkError = 'Mtandao umeshindwa. Gusa "Angalia Malipo" tena.';
  static const serverProcessing = 'Seva inaendelea kuchakata malipo yako…';

  static String resendStk(int attempt, int max) =>
      'Tunatuma ombi la malipo tena kwenye simu yako ($attempt/$max)…';

  static String cancelSoft(int attempt, int remaining) =>
      'Mpendwa mteja haujamaliza hatua za malipo (jaribio $attempt/3). '
      'Bado una nafasi $remaining — thibitisha kwenye simu yako.';
}

/// User-facing text when `/api/payments/start` or resend throws.
String mapPaymentStartError(Object error) {
  var raw = error.toString().trim();
  const exc = 'Exception: ';
  if (raw.startsWith(exc)) raw = raw.substring(exc.length).trim();
  final lower = raw.toLowerCase();
  if (lower.contains('socketexception') ||
      lower.contains('connection') ||
      lower.contains('network') ||
      lower.contains('failed host') ||
      lower.contains('timed out') ||
      lower.contains('timeout')) {
    return 'Hitilafu ya mtandao. Jaribu tena.';
  }
  if (lower.contains('hayajaweza kutumika') ||
      lower.contains('hayajatumika') ||
      lower.contains('malipo hayajatumika') ||
      lower.contains('sonicpesa haikutuma')) {
    return raw.length < 220
        ? raw
        : 'Hatukuweza kutuma ombi la malipo kwenye simu. Hakikisha nambari sahihi na mtandao wa pesa, kisha jaribu tena.';
  }
  if (lower.contains('upstream') || lower.contains('no response from upstream')) {
    return 'Mtandao wa pesa ulikawia kuthibitisha ombi. Jaribu tena baada ya dakika 1–2.';
  }
  if (lower.contains('500') || lower.contains('502') || lower.contains('503')) {
    return 'Seva ya malipo ina tatizo. Jaribu tena baada ya dakika chache.';
  }
  if (raw.isNotEmpty && raw.length <= 200) return raw;
  return 'Hatukuweza kutuma ombi la malipo. Hakikisha nambari sahihi na ujaribu tena.';
}

/// Called after payment success or admin grant to unlock channels.
/// Returns `true` only when local premium state is confirmed active.
typedef PremiumUnlockCallback = Future<bool> Function({Map<String, dynamic>? userPayload});
