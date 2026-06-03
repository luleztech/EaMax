import '../models/api_exceptions.dart';

/// Swahili-friendly message for errors shown in SnackBars / dialogs.
String userFacingApiError(Object error) {
  if (error is ApiRateLimitedException) {
    final wait = error.retryAfterSeconds ?? 30;
    return 'Maombi mengi kwa muda mfupi. Subiri sekunde $wait kisha jaribu tena.';
  }
  final raw = error.toString().replaceFirst('Exception: ', '').trim();
  if (raw.contains('ApiRateLimitedException')) {
    return 'Maombi mengi kwa muda mfupi. Subiri kidogo kisha jaribu tena.';
  }
  return raw.isEmpty ? 'Hitilafu imetokea. Jaribu tena.' : raw;
}
