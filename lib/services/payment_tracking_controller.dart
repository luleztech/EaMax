import 'package:flutter/foundation.dart';

/// Global payment-tracking UI state (home header banner + Mtumiaji card).
class PaymentTrackingController extends ChangeNotifier {
  PaymentTrackingController._();
  static final PaymentTrackingController instance = PaymentTrackingController._();

  bool _active = false;
  bool _polling = false;
  bool _bannerDismissed = false;
  String _statusLine = 'Inaangalia malipo yako';

  Future<void> Function()? onManualRefresh;

  bool get isActive => _active;
  bool get isPolling => _polling;
  bool get bannerDismissed => _bannerDismissed;
  String get statusLine => _statusLine;

  /// Show compact header on Home tab while a payment is being tracked.
  bool get showHomeBanner => _active && !_bannerDismissed;

  void sync({
    required bool active,
    bool polling = false,
    String? statusLine,
  }) {
    final wasActive = _active;
    _active = active;
    _polling = polling;
    if (statusLine != null && statusLine.trim().isNotEmpty) {
      _statusLine = statusLine.trim();
    }
    if (active && !wasActive) {
      _bannerDismissed = false;
    }
    if (!active) {
      _bannerDismissed = false;
      _polling = false;
      _statusLine = 'Inaangalia malipo yako';
    }
    notifyListeners();
  }

  void dismissHomeBanner() {
    if (_bannerDismissed) return;
    _bannerDismissed = true;
    notifyListeners();
  }

  void restoreHomeBanner() {
    if (!_bannerDismissed) return;
    _bannerDismissed = false;
    notifyListeners();
  }
}
