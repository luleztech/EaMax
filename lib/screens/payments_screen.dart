import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/api.dart';
import '../config/payment_helpers.dart';
import '../models/remote_config_bundle.dart';
import '../services/remote_config_service.dart';
import '../services/user_id.dart';
import '../theme/app_theme.dart';

const _accentCta = Color(0xFF22C55E);
const _accentCtaDark = Color(0xFF16A34A);

const _tzPrefixes = [
  '061',
  '062',
  '063',
  '065',
  '067',
  '068',
  '069',
  '071',
  '074',
  '075',
  '076',
  '077',
  '078',
  '079',
];

const _paySurface = Color(0xFF0C1222);
const _paySurface2 = Color(0xFF151B2E);
const _payLine = Color(0x14FFFFFF);
const _payMuted = Color(0xFF8B9CAF);

/// Tight window: prompt should arrive in seconds; long waits feel broken. Halotel/Airtel can retry.
const int _kPaymentWaitSeconds = 60;

enum _PaymentUiPhase {
  none,
  /// User must read “check your phone” before we start polling + countdown.
  instruction,
  waiting,
  timedOut,
  failed,
}

enum _PayDialogTone { success, error, info }

class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({
    super.key,
    this.accentColor = AppColors.accentBlue,
    this.bottomPadding = 0,
    this.onPaymentSuccess,
  });

  final Color accentColor;
  final double bottomPadding;
  final PremiumUnlockCallback? onPaymentSuccess;

  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> {
  String? _selectedBundle;
  final _phoneCtrl = TextEditingController();
  String? _whatsapp;
  String? _userId;
  bool _submitting = false;
  bool _statusOpen = false;
  String _statusTitle = '';
  String _statusMsg = '';
  _PayDialogTone _statusTone = _PayDialogTone.info;
  String? _pendingBundleLabel;
  String? _pollingOrderId;
  Timer? _pollTimer;
  int _notFoundStreak = 0;
  bool _simulating = false;
  int _waitingSeconds = _kPaymentWaitSeconds;
  Timer? _waitingTimer;
  _PaymentUiPhase _paymentUiPhase = _PaymentUiPhase.none;
  String? _sessionEndDetail;

  List<RemoteSubscriptionPlan> _plans = defaultSubscriptionPlans();

  /// Tanzania local MSISDN only (`0` + 8–9 digits). Converts pasted +255/255 to 0…
  String _normalizeToLocal(String raw) {
    var s = raw.replaceAll(RegExp(r'\s+'), '');
    if (s.startsWith('+') && !s.startsWith('+255')) return s;
    if (s.startsWith('+255')) s = '0${s.substring(4)}';
    else if (s.startsWith('00255')) s = '0${s.substring(5)}';
    else if (s.startsWith('255') && s.length >= 12) s = '0${s.substring(3)}';
    if (RegExp(r'^[1-9]\d{8}$').hasMatch(s)) s = '0$s';
    return s;
  }

  bool _phoneValid(String raw) {
    final clean = _normalizeToLocal(raw);
    if (clean.startsWith('+') && !clean.startsWith('+255')) return false;
    if (!RegExp(r'^0\d{8,9}$').hasMatch(clean)) return false;
    return _tzPrefixes.any((p) => clean.startsWith(p));
  }

  String get _cleanPhone => _normalizeToLocal(_phoneCtrl.text);
  bool get _phoneOk => _phoneValid(_phoneCtrl.text);

  @override
  void initState() {
    super.initState();
    RemoteConfigService.configVersion.addListener(_onRemoteConfigChanged);
    _load();
  }

  void _onRemoteConfigChanged() {
    if (!mounted) return;
    RemoteConfigService.invalidateCache();
    RemoteConfigService.fetch(forceRefresh: true).then((_) {
      if (!mounted) return;
      final plans = RemoteConfigService.paymentPlans;
      setState(() {
        _plans = plans;
        if (_selectedBundle != null &&
            !plans.any((p) => p.slug == _selectedBundle)) {
          _selectedBundle = plans.isNotEmpty ? plans.first.slug : null;
        }
      });
    });
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final pending = prefs.getString('pendingPaymentOrderId')?.trim();

    // Load server-driven plans (cached or fallback defaults).
    final plans = RemoteConfigService.paymentPlans;
    if (mounted) setState(() => _plans = plans);

    // Show username instantly from local storage (generate if missing).
    final localUid = await ensureLocalUserId();
    if (mounted) setState(() => _userId = localUid);

    Map<String, dynamic> wMap = <String, dynamic>{};
    String? uid;
    try {
      final parts = await Future.wait([
        RemoteConfigService.fetch().catchError((_) => null),
        settingsApi.getWhatsAppNumber().catchError((_) => <String, dynamic>{}),
        getOrCreateUserId().catchError((_) => localUid),
      ]);
      final bundle = parts[0] as RemoteConfigBundle?;
      if (bundle != null && bundle.paymentConfig.plans.isNotEmpty && mounted) {
        setState(() => _plans = bundle.paymentConfig.plans);
      }
      wMap = parts[1] as Map<String, dynamic>;
      uid = parts[2] as String?;
    } catch (_) {}

    if (!mounted) return;
    final remoteWa = RemoteConfigService.cached?.paymentConfig.whatsappNumber;
    if (remoteWa != null && remoteWa.isNotEmpty) {
      setState(() => _whatsapp = remoteWa.replaceAll(RegExp(r'\s+'), ''));
    }
    final n = wMap['number']?.toString();
    if (n != null && n.isNotEmpty) {
      setState(() => _whatsapp = n.replaceAll(RegExp(r'\s+'), ''));
    }
    if (uid != null && uid.isNotEmpty) {
      setState(() => _userId = uid);
    }

    if (pending != null && pending.isNotEmpty) {
      try {
        final res = await paymentsApi.checkPaymentStatus(pending);
        final st = res['status'] ?? res['raw']?['data']?[0]?['payment_status'];
        if (isPaymentCompleted(st)) {
          await _markPaymentCompleted(
            title: 'Hongera — malipo yamehakikiwa',
            message:
                'Malipo yaliyokuwa yanasubiri yamekamilika. Akaunti yako inasasishwa kwa Premium.',
            userPayload: userPayloadFromPaymentResponse(res),
          );
        } else if (isPaymentTerminalFailure(st)) {
          await prefs.remove('pendingPaymentOrderId');
          if (mounted) {
            setState(() {
              _paymentUiPhase = _PaymentUiPhase.failed;
              _sessionEndDetail = _paymentFailureUserMessage(st);
            });
          }
        } else {
          setState(() {
            _pollingOrderId = pending;
            _paymentUiPhase = _PaymentUiPhase.waiting;
          });
          WidgetsBinding.instance.addPostFrameCallback((_) => _startPolling());
        }
      } catch (e) {
        if (mounted) {
          setState(() {
            _paymentUiPhase = _PaymentUiPhase.failed;
            _sessionEndDetail = _mapPaymentError(e);
          });
        }
      }
    }
  }

  @override
  void dispose() {
    RemoteConfigService.configVersion.removeListener(_onRemoteConfigChanged);
    _pollTimer?.cancel();
    _waitingTimer?.cancel();
    _phoneCtrl.dispose();
    super.dispose();
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _waitingTimer?.cancel();
    setState(() {
      _waitingSeconds = _kPaymentWaitSeconds;
      _paymentUiPhase = _PaymentUiPhase.waiting;
    });

    _waitingTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_waitingSeconds <= 1) {
        timer.cancel();
        setState(() => _waitingSeconds = 0);
        _handleWaitWindowExpired();
        return;
      }
      setState(() => _waitingSeconds -= 1);
    });

    final orderId = _pollingOrderId;
    if (orderId == null || orderId.isEmpty) return;

    var polls = 0;
    _pollTimer = Timer.periodic(const Duration(seconds: 3), (_) async {
      polls++;
      if (!mounted) return;
      try {
        final response = await paymentsApi.checkPaymentStatus(orderId);
        final paymentStatus =
            response['status'] ??
            response['raw']?['data']?[0]?['payment_status'];
        if (response['terminal'] == true || isPaymentTerminalFailure(paymentStatus)) {
          await _finalizeSessionFailed(
            response['userMessage']?.toString() ??
                _paymentFailureUserMessage(paymentStatus),
          );
          return;
        }
        if (isPaymentCompleted(paymentStatus)) {
          await _markPaymentCompleted(
            title: 'Hongera — malipo yamehakikiwa',
            message:
                'Malipo yako yamekamilika kwa uhakika. Akaunti yako inasasishwa; channel zote zitafunguliwa.',
            userPayload: userPayloadFromPaymentResponse(response),
          );
          return;
        }
        if (isPaymentTerminalFailure(paymentStatus)) {
          await _finalizeSessionFailed(
            _paymentFailureUserMessage(paymentStatus),
          );
          return;
        }
      } catch (e) {
        final msg = e.toString().toLowerCase();
        if (msg.contains('no order') || msg.contains('not found')) {
          _notFoundStreak++;
          if (_notFoundStreak >= 12) {
            _pollTimer?.cancel();
            _pollTimer = null;
            _waitingTimer?.cancel();
            _waitingTimer = null;
            await _clearPendingOrderPrefs();
            if (mounted) {
              setState(() {
                _pollingOrderId = null;
                _notFoundStreak = 0;
                _paymentUiPhase = _PaymentUiPhase.timedOut;
                _sessionEndDetail =
                    'Hatukuweza kuthibitisha ombi la malipo. Jaribu tena na mtandao mzuri wa simu.';
              });
            }
          }
        }
      }
      if (polls >= 90) {
        _pollTimer?.cancel();
        _pollTimer = null;
        _waitingTimer?.cancel();
        _waitingTimer = null;
        unawaited(_finalizeSessionTimedOut(
          detail:
              'Muda wa kusubiri umeisha. Hakikisha umeona ombi kwenye simu na umeingiza PIN. Jaribu tena ikiwa haijafika.',
        ));
      }
    });
  }

  Future<void> _clearPendingOrderPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('pendingPaymentOrderId');
  }

  void _handleWaitWindowExpired() {
    if (!mounted || _pollingOrderId == null) return;
    unawaited(_finalizeSessionTimedOut(
      detail:
          'Muda wa dakika 1 umeisha bila uthibitisho. Hakikisha mtandao mzuri na namba sahihi ya Vodacom/M-Pesa, kisha jaribu tena.',
    ));
  }

  Future<void> _finalizeSessionTimedOut({String? detail}) async {
    _pollTimer?.cancel();
    _pollTimer = null;
    _waitingTimer?.cancel();
    _waitingTimer = null;
    // Keep pendingPaymentOrderId — background watcher continues verifying payment.
    if (!mounted) return;
    setState(() {
      _pollingOrderId = null;
      _notFoundStreak = 0;
      _paymentUiPhase = _PaymentUiPhase.timedOut;
      _sessionEndDetail = detail ??
          'Muda wa kusubiri umeisha. Tunathibitisha malipo nyuma ya pazia — ukikamilisha, Premium itafunguliwa.';
    });
  }

  Future<void> _finalizeSessionFailed(String message) async {
    _pollTimer?.cancel();
    _pollTimer = null;
    _waitingTimer?.cancel();
    _waitingTimer = null;
    await _clearPendingOrderPrefs();
    if (!mounted) return;
    setState(() {
      _pollingOrderId = null;
      _notFoundStreak = 0;
      _paymentUiPhase = _PaymentUiPhase.failed;
      _sessionEndDetail = message;
    });
  }

  void _resetPaymentFlowFromStepOne() {
    _pollTimer?.cancel();
    _pollTimer = null;
    _waitingTimer?.cancel();
    _waitingTimer = null;
    setState(() {
      _paymentUiPhase = _PaymentUiPhase.none;
      _pollingOrderId = null;
      _notFoundStreak = 0;
      _waitingSeconds = _kPaymentWaitSeconds;
      _sessionEndDetail = null;
      _selectedBundle = null;
      _pendingBundleLabel = null;
      _phoneCtrl.clear();
    });
  }

  void _showStatus(String title, String msg, _PayDialogTone tone) {
    setState(() {
      _statusOpen = true;
      _statusTitle = title;
      _statusMsg = msg;
      _statusTone = tone;
    });
  }

  String _mapPaymentError(Object e) {
    var raw = e.toString();
    const exc = 'Exception: ';
    if (raw.startsWith(exc)) raw = raw.substring(exc.length).trim();
    final lower = raw.toLowerCase();
    if (lower.contains('socketexception') ||
        lower.contains('connection') ||
        lower.contains('network') ||
        lower.contains('failed host') ||
        lower.contains('timed out')) {
      return 'Hakuna muunganisho thabiti. Washa data ya simu au Wi‑Fi, kisha ujaribu tena.';
    }
    if (lower.contains('401') || lower.contains('403')) {
      return 'Ombi halikuidhinishwa. Fungua tena programu kisha ujaribu.';
    }
    if (lower.contains('user not found') ||
        lower.contains('could not resolve user') ||
        (lower.contains('not found') && lower.contains('user'))) {
      return 'Akaunti haijasawirishwa kwenye seva. Fungua Wasifu kisha jaribu tena, au subiri muunganisho utakapokuwa thabiti.';
    }
    if (lower.contains('404') ||
        lower == 'exception: not found' ||
        (lower.contains('not found') &&
            !lower.contains('order') &&
            !lower.contains('user'))) {
      return 'Huduma ya malipo haipatikani kwa sasa (seva au njia ya malipo). Hakikisha toleo jipya la seva limebandikwa, kisha jaribu tena.';
    }
    if (lower.contains('500') || lower.contains('502') || lower.contains('503')) {
      return 'Seva ya malipo ina tatizo. Jaribu tena baada ya dakika chache.';
    }
    // Do not map “insufficient balance” here — `/api/payments/start` errors are chosen on the server
    // (initiate vs paid). Showing canned salio on the client hid cases where STK was never sent.
    if (lower.contains('hayajaweza kutumika') ||
        lower.contains('hayajatumika') ||
        lower.contains('malipo hayajatumika') ||
        lower.contains('sonicpesa haikutuma')) {
      return raw.length < 220
          ? raw
          : 'Hatukuweza kutuma ombi la malipo kwenye simu. Hakikisha nambari sahihi na mtandao wa pesa, kisha jaribu tena.';
    }
    if (lower.contains('upstream') ||
        lower.contains('no response from upstream')) {
      return 'Mtandao wa pesa ulikawia kuthibitisha ombi. Hakikisha una mtandao mzuri wa simu na nambari sahihi ya malipo, kisha ujaribu tena.';
    }
    if (raw.length > 200) {
      return 'Malipo hayajaweza kukamilika. Jaribu tena au wasiliana na msaada.';
    }
    return raw;
  }

  String _paymentFailureUserMessage(Object? status) {
    final s = normalizedPaymentStatus(status);
    if (s == 'CANCELLED' || s == 'CANCELED' || s == 'CANCEL') {
      return 'Malipo yameghairiwa au haujakamilisha hatua kwenye simu. Unaweza kujaribu tena ukiwa tayari — gusa “Anza upya”.';
    }
    if (s == 'EXPIRED') {
      return 'Muda wa malipo umeisha kabla ya uthibitisho. Anza upya kutoka hatua ya 1.';
    }
    if (s == 'REJECTED' || s == 'DECLINED') {
      return 'Muamala haukuidhinishwa. Hakikisha una salio au namba sahihi, kisha jaribu tena.';
    }
    if (s == 'FAILED' || s == 'ERROR') {
      return 'Malipo hayajaweza kukamilika kwa sasa. Jaribu tena baada ya muda mfupi.';
    }
    return 'Malipo hayajakamilika. Jaribu tena au wasiliana na msaada wa WhatsApp.';
  }

  void _onInstructionContinue() {
    if (!mounted || _pollingOrderId == null) return;
    setState(() => _paymentUiPhase = _PaymentUiPhase.waiting);
    WidgetsBinding.instance.addPostFrameCallback((_) => _startPolling());
  }

  Future<void> _markPaymentCompleted({
    required String title,
    required String message,
    Map<String, dynamic>? userPayload,
  }) async {
    _pollTimer?.cancel();
    _pollTimer = null;
    _waitingTimer?.cancel();
    _waitingTimer = null;

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('pendingPaymentOrderId');

    if (!mounted) return;

    setState(() {
      _pollingOrderId = null;
      _notFoundStreak = 0;
      _paymentUiPhase = _PaymentUiPhase.none;
      _sessionEndDetail = null;
      _pendingBundleLabel = null;
    });

    // Refresh premium + unlock channels before showing success dialog.
    try {
      await widget.onPaymentSuccess?.call(userPayload: userPayload);
    } catch (_) {}

    _showStatus(title, message, _PayDialogTone.success);
  }

  Future<void> _openWhatsApp() async {
    if (_whatsapp == null || _whatsapp!.isEmpty) {
      _showStatus(
        'Hakuna namba ya WhatsApp',
        'Tafadhali wasiliana na admin kuongeza namba ya WhatsApp kwenye sehemu ya Settings.',
        _PayDialogTone.error,
      );
      return;
    }
    final phone = _whatsapp!.startsWith('+')
        ? _whatsapp!.substring(1)
        : _whatsapp!;
    final uri = Uri.parse('https://wa.me/$phone');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      _showStatus(
        'Tatizo',
        'Imeshindwa kufungua WhatsApp kwenye kifaa chako.',
        _PayDialogTone.error,
      );
    }
  }

  Future<void> _send() async {
    if (_selectedBundle == null) {
      _showStatus(
        'Chagua bundle',
        'Tafadhali chagua bundle unayotaka kulipa.',
        _PayDialogTone.error,
      );
      return;
    }
    final clean = _cleanPhone;
    if (!_phoneValid(_phoneCtrl.text)) {
      _showStatus(
        'Nambari ya simu',
        'Hakikisha umeandika namba yako kwa usahihi na ukamilifu.',
        _PayDialogTone.error,
      );
      return;
    }
    if (_userId == null) {
      _showStatus(
        'Tatizo la akaunti',
        'Hatukuweza kutambua akaunti yako. Fungua tena sehemu ya wasifu (Profile) kisha ujaribu tena.',
        _PayDialogTone.error,
      );
      return;
    }

    final bundle = _plans.firstWhere((b) => b.slug == _selectedBundle);
    setState(() => _submitting = true);
    // Let release builds paint “Tunatuma ombi…” before the HTTP work schedules; avoids a dead UI until the waiting modal.
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted) return;
    try {
      // Always use the unified backend start endpoint.
      // The backend decides whether to route to Zeno or SonicPesa based on current settings.
      final result = await paymentsApi.startPayment(
        externalId: _userId!,
        bundle: bundle.slug,
        amount: bundle.priceTzs,
        phone: clean,
        email: '$_userId@eamax.app',
        name: _userId!,
      );

      final orderId = (result['orderId']?.toString() ?? '').trim();
      var serverMsg = (result['message']?.toString() ?? '').trim();
      final usedFallback = result['fallbackFrom']?.toString().trim().isNotEmpty == true;
      if (usedFallback && serverMsg.isEmpty) {
        serverMsg =
            'Ombi limetumwa kupitia ZenoPay. Angalia simu yako na uingize PIN ya malipo (M-Pesa, Halopesa, Tigopesa, Airtel).';
      }

      // Start endpoint never means “paid” — only `orderId` + instruction + polling/webhook.
      // (Backend used to return status: success for “prompt sent”; that must not open success UI.)
      if (orderId.isNotEmpty) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('pendingPaymentOrderId', orderId);
        if (!mounted) return;
        setState(() {
          _pollingOrderId = orderId;
          _notFoundStreak = 0;
          _pendingBundleLabel = bundle.displayName;
        });
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          _startPolling();
        });
      } else {
        final msg = serverMsg.isNotEmpty
            ? serverMsg
            : 'Ombi la malipo la Tsh.${bundle.formattedPrice} (${bundle.displayName}) limepokelewa kwa $clean. '
                  'Ikiwa hutooni ujumbe kwenye simu, jaribu tena au wasiliana na msaada.';
        _showStatus(
          'Tumepokea ombi',
          msg,
          _PayDialogTone.info,
        );
      }
    } catch (e) {
      _showStatus(
        'Malipo hayajatumika',
        _mapPaymentError(e),
        _PayDialogTone.error,
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _simulatePaid() async {
    final id = _pollingOrderId;
    if (id == null || _simulating) return;
    setState(() => _simulating = true);
    try {
      await paymentsApi.completePaymentForTesting(id);
      await _markPaymentCompleted(
        title: 'Hongera — malipo yamehakikiwa',
        message:
            'Malipo yamefaulu (jaribio la maendelezi). Akaunti yako inasasishwa kwa Premium.',
      );
    } catch (e) {
      _showStatus('Tatizo', _mapPaymentError(e), _PayDialogTone.error);
    } finally {
      if (mounted) setState(() => _simulating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!RemoteConfigService.paymentsEnabled) {
      return Material(
        color: const Color(0xFF02040A),
        child: Center(
          child: Padding(
            padding: EdgeInsets.fromLTRB(24, 24, 24, 48 + widget.bottomPadding),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.lock_outline, size: 56, color: widget.accentColor.withValues(alpha: 0.85)),
                const SizedBox(height: 16),
                const Text(
                  'Malipo yamezimwa kwa muda',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.white),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Msimamizi amezima malipo kwa muda. Jaribu tena baadaye.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 14, color: Color(0xFF9CA3AF)),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final bottom = 48.0 + widget.bottomPadding;
    final ac = widget.accentColor;
    final canShowPayCta = _phoneOk && _selectedBundle != null;

    // Material is required for TextField / TextButton (enforced on web).
    return Material(
      color: const Color(0xFF02040A),
      child: Stack(
        children: [
          Positioned.fill(child: _PayAmbientLayer(accent: ac)),
          SafeArea(
            top: true,
            bottom: false,
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(22, 8, 22, bottom),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _PayPremiumHero(accent: ac),
                  const SizedBox(height: 22),
                  _PayTrustStrip(accent: ac),
                  const SizedBox(height: 26),
                  _PayGlassPanel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _PayStepTitle(
                          number: '01',
                          title: 'Nambari ya simu',
                          accent: ac,
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Weka tarakimu 10 zote (anza na 0). Hatua inayofuata itaonekana ukimaliza namba yote.',
                          style: TextStyle(
                            fontSize: 13.5,
                            height: 1.45,
                            color: _payMuted,
                            fontWeight: FontWeight.w500,
                            decoration: TextDecoration.none,
                          ),
                        ),
                        const SizedBox(height: 18),
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 220),
                          curve: Curves.easeOutCubic,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(18),
                            color: _paySurface,
                            border: Border.all(
                              color: _phoneOk
                                  ? _accentCta.withValues(alpha: 0.55)
                                  : _payLine,
                              width: _phoneOk ? 1.5 : 1,
                            ),
                            boxShadow: _phoneOk
                                ? [
                                    BoxShadow(
                                      color: _accentCta.withValues(alpha: 0.18),
                                      blurRadius: 20,
                                      spreadRadius: -4,
                                    ),
                                    BoxShadow(
                                      color: Colors.black.withValues(
                                        alpha: 0.25,
                                      ),
                                      blurRadius: 12,
                                      offset: const Offset(0, 6),
                                    ),
                                  ]
                                : [
                                    BoxShadow(
                                      color: Colors.black.withValues(
                                        alpha: 0.2,
                                      ),
                                      blurRadius: 10,
                                      offset: const Offset(0, 4),
                                    ),
                                  ],
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _phoneCtrl,
                                  keyboardType: TextInputType.phone,
                                  maxLength: 10,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 18,
                                    fontWeight: FontWeight.w600,
                                    letterSpacing: 0.8,
                                    decoration: TextDecoration.none,
                                  ),
                                  decoration: InputDecoration(
                                    border: InputBorder.none,
                                    hintText: '0712345678',
                                    hintStyle: TextStyle(
                                      color: _payMuted.withValues(alpha: 0.65),
                                      fontWeight: FontWeight.w500,
                                    ),
                                    counterText: '',
                                    contentPadding: const EdgeInsets.fromLTRB(
                                      20,
                                      20,
                                      12,
                                      20,
                                    ),
                                    prefixIcon: Padding(
                                      padding: const EdgeInsets.only(left: 4),
                                      child: Icon(
                                        Icons.phone_iphone_rounded,
                                        color: _phoneOk
                                            ? _accentCta
                                            : _payMuted,
                                        size: 22,
                                      ),
                                    ),
                                    prefixIconConstraints: const BoxConstraints(
                                      minWidth: 48,
                                      minHeight: 0,
                                    ),
                                  ),
                                  onChanged: (_) {
                                    setState(() {
                                      if (!_phoneOk) _selectedBundle = null;
                                    });
                                  },
                                ),
                              ),
                              if (_phoneOk)
                                Padding(
                                  padding: const EdgeInsets.only(right: 16),
                                  child: Container(
                                    padding: const EdgeInsets.all(6),
                                    decoration: BoxDecoration(
                                      color: _accentCta.withValues(alpha: 0.15),
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(
                                      Icons.check_rounded,
                                      color: _accentCta,
                                      size: 20,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                        if (!_phoneOk && _phoneCtrl.text.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 12),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Icon(
                                  Icons.info_outline_rounded,
                                  size: 16,
                                  color: Colors.orange.shade300,
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    'Hakikisha umeandika namba yako kwa usahihi na ukamilifu.',
                                    style: TextStyle(
                                      fontSize: 12.5,
                                      height: 1.4,
                                      color: Colors.orange.shade200.withValues(
                                        alpha: 0.95,
                                      ),
                                      decoration: TextDecoration.none,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (_phoneOk) ...[
                    const SizedBox(height: 18),
                    _PayGlassPanel(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _PayStepTitle(
                            number: '02',
                            title: 'Chagua muda',
                            accent: ac,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Gusa chaguo linalokufaa',
                            style: TextStyle(
                              fontSize: 13,
                              color: _payMuted,
                              fontWeight: FontWeight.w500,
                              decoration: TextDecoration.none,
                            ),
                          ),
                          const SizedBox(height: 16),
                          ..._plans.map(
                            (b) => Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: _PriceOptionTile(
                                plan: b,
                                accent: ac,
                                selected: _selectedBundle == b.slug,
                                onTap: () =>
                                    setState(() => _selectedBundle = b.slug),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  if (canShowPayCta) ...[
                    const SizedBox(height: 8),
                    Material(
                      color: Colors.transparent,
                      elevation: 0,
                      child: InkWell(
                        onTap: _submitting ? null : _send,
                        borderRadius: BorderRadius.circular(18),
                        child: Ink(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(18),
                            gradient: const LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [Color(0xFF34D399), _accentCtaDark],
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: _accentCta.withValues(alpha: 0.45),
                                blurRadius: 22,
                                offset: const Offset(0, 10),
                              ),
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.35),
                                blurRadius: 8,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          child: SizedBox(
                            height: 58,
                            width: double.infinity,
                            child: Stack(
                              alignment: Alignment.center,
                              children: [
                                Positioned.fill(
                                  child: DecoratedBox(
                                    decoration: BoxDecoration(
                                      borderRadius: BorderRadius.circular(18),
                                      gradient: LinearGradient(
                                        begin: Alignment.topLeft,
                                        end: Alignment.centerRight,
                                        colors: [
                                          Colors.white.withValues(alpha: 0.22),
                                          Colors.transparent,
                                        ],
                                        stops: const [0.0, 0.45],
                                      ),
                                    ),
                                  ),
                                ),
                                Padding(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 24,
                                  ),
                                  child: _submitting
                                      ? const SizedBox(
                                          width: 26,
                                          height: 26,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2.5,
                                            color: Colors.white,
                                          ),
                                        )
                                      : const Row(
                                          mainAxisAlignment:
                                              MainAxisAlignment.center,
                                          children: [
                                            Icon(
                                              Icons.bolt_rounded,
                                              color: Colors.white,
                                              size: 22,
                                            ),
                                            SizedBox(width: 10),
                                            Text(
                                              'Lipia sasa',
                                              style: TextStyle(
                                                fontSize: 17,
                                                fontWeight: FontWeight.w800,
                                                color: Colors.white,
                                                letterSpacing: 0.6,
                                                decoration: TextDecoration.none,
                                              ),
                                            ),
                                          ],
                                        ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                  if (kDebugMode && _pollingOrderId != null) ...[
                    const SizedBox(height: 12),
                    TextButton(
                      onPressed: _simulating ? null : _simulatePaid,
                      child: Text(
                        _simulating
                            ? '...'
                            : 'Test: Mark as paid (unlock Premium now)',
                      ),
                    ),
                  ],
                  const SizedBox(height: 28),
                  Container(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.04),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: _payLine),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.touch_app_rounded,
                          size: 20,
                          color: ac.withValues(alpha: 0.85),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'Thibitisho hutokea mara moja kwenye simu yako.',
                            style: TextStyle(
                              fontSize: 13,
                              height: 1.45,
                              color: _payMuted,
                              fontWeight: FontWeight.w500,
                              decoration: TextDecoration.none,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  Material(
                    color: Colors.transparent,
                    borderRadius: BorderRadius.circular(18),
                    child: InkWell(
                      onTap: _openWhatsApp,
                      borderRadius: BorderRadius.circular(18),
                      child: Ink(
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.1),
                          ),
                          color: _paySurface2.withValues(alpha: 0.65),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Row(
                            children: [
                              Container(
                                width: 46,
                                height: 46,
                                decoration: BoxDecoration(
                                  gradient: LinearGradient(
                                    colors: [
                                      ac.withValues(alpha: 0.35),
                                      ac.withValues(alpha: 0.12),
                                    ],
                                  ),
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(
                                    color: Colors.white.withValues(alpha: 0.1),
                                  ),
                                ),
                                child: Icon(
                                  Icons.chat_rounded,
                                  color: ac,
                                  size: 22,
                                ),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text(
                                      'Msaada wa haraka',
                                      style: TextStyle(
                                        fontSize: 15,
                                        fontWeight: FontWeight.w700,
                                        color: Colors.white,
                                        decoration: TextDecoration.none,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      'WhatsApp',
                                      style: TextStyle(
                                        fontSize: 12.5,
                                        fontWeight: FontWeight.w600,
                                        color: ac.withValues(alpha: 0.9),
                                        letterSpacing: 0.3,
                                        decoration: TextDecoration.none,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Icon(
                                Icons.arrow_forward_ios_rounded,
                                color: ac.withValues(alpha: 0.7),
                                size: 16,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (_paymentUiPhase == _PaymentUiPhase.instruction &&
              _pollingOrderId != null) ...[
            Positioned.fill(
              child: _PaymentInstructionModal(
                bundleLabel: _pendingBundleLabel,
                onContinue: _onInstructionContinue,
              ),
            ),
          ],
          if (_paymentUiPhase == _PaymentUiPhase.waiting &&
              _pollingOrderId != null) ...[
            Positioned.fill(
              child: _PaymentWaitingModal(
                secondsRemaining: _waitingSeconds,
                totalSeconds: _kPaymentWaitSeconds,
              ),
            ),
          ],
          if (_paymentUiPhase == _PaymentUiPhase.timedOut ||
              _paymentUiPhase == _PaymentUiPhase.failed) ...[
            Positioned.fill(
              child: _PaymentSessionEndedModal(
                failed: _paymentUiPhase == _PaymentUiPhase.failed,
                detail: _sessionEndDetail,
                onStartOver: _resetPaymentFlowFromStepOne,
              ),
            ),
          ],
          if (_submitting) ...[
            Positioned.fill(
              child: AbsorbPointer(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.52),
                  ),
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 300),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const SizedBox(
                            width: 40,
                            height: 40,
                            child: CircularProgressIndicator(
                              strokeWidth: 3,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(height: 20),
                          Text(
                            'Tunatuma ombi la malipo',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w800,
                              color: Colors.white,
                              decoration: TextDecoration.none,
                              shadows: [
                                Shadow(
                                  color: Colors.black.withValues(alpha: 0.35),
                                  blurRadius: 8,
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Usifunge skrini — hii huchukua sekunde chache tu.',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 13.5,
                              height: 1.45,
                              color: Colors.blueGrey.shade200,
                              fontWeight: FontWeight.w500,
                              decoration: TextDecoration.none,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
          if (_statusOpen) ...[
            Positioned.fill(
              child: GestureDetector(
                onTap: () => setState(() => _statusOpen = false),
                child: Container(color: Colors.black54),
              ),
            ),
            Center(
              child: GestureDetector(
                onTap: () {},
                child: Material(
                  color: const Color(0xFF0F172A),
                  borderRadius: BorderRadius.circular(20),
                  child: Container(
                    constraints: const BoxConstraints(maxWidth: 340),
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(0x80475569)),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 72,
                          height: 72,
                          decoration: BoxDecoration(
                            color: switch (_statusTone) {
                              _PayDialogTone.success => const Color(0x3322C55E),
                              _PayDialogTone.error => const Color(0x33F87171),
                              _PayDialogTone.info => const Color(0x332563EB),
                            },
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            switch (_statusTone) {
                              _PayDialogTone.success => Icons.check_circle_rounded,
                              _PayDialogTone.error => Icons.error_outline_rounded,
                              _PayDialogTone.info => Icons.info_outline_rounded,
                            },
                            size: 44,
                            color: switch (_statusTone) {
                              _PayDialogTone.success => _accentCta,
                              _PayDialogTone.error => const Color(0xFFF87171),
                              _PayDialogTone.info => AppColors.accentBlue,
                            },
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          _statusTitle,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          _statusMsg,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.blueGrey.shade300,
                            height: 1.55,
                          ),
                        ),
                        const SizedBox(height: 20),
                        FilledButton(
                          style: FilledButton.styleFrom(
                            backgroundColor: switch (_statusTone) {
                              _PayDialogTone.success => _accentCta,
                              _PayDialogTone.error => const Color(0xFF334155),
                              _PayDialogTone.info => AppColors.accentBlue,
                            },
                          ),
                          onPressed: () => setState(() => _statusOpen = false),
                          child: const Text('Sawa'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _PayAmbientLayer extends StatelessWidget {
  const _PayAmbientLayer({required this.accent});

  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFF02040A), Color(0xFF0B1220), Color(0xFF050810)],
              stops: [0.0, 0.42, 1.0],
            ),
          ),
        ),
        Positioned(
          top: -100,
          right: -80,
          child: Container(
            width: 280,
            height: 280,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: accent.withValues(alpha: 0.11),
            ),
          ),
        ),
        Positioned(
          bottom: 40,
          left: -100,
          child: Container(
            width: 260,
            height: 260,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: _accentCta.withValues(alpha: 0.05),
            ),
          ),
        ),
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.transparent,
                  Colors.black.withValues(alpha: 0.55),
                ],
                stops: const [0.55, 1.0],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Shown right after “Lipia sasa” — instructs user to complete steps on the phone; no success claim until verified.
class _PaymentInstructionModal extends StatelessWidget {
  const _PaymentInstructionModal({
    required this.bundleLabel,
    required this.onContinue,
  });

  final String? bundleLabel;
  final VoidCallback onContinue;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.black.withValues(alpha: 0.82),
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 22),
            child: Container(
              constraints: const BoxConstraints(maxWidth: 420),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(24),
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFF151B2E), Color(0xFF0A0F18)],
                ),
                border: Border.all(color: Color(0x28FFFFFF)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.45),
                    blurRadius: 28,
                    offset: Offset(0, 14),
                  ),
                ],
              ),
              padding: const EdgeInsets.fromLTRB(24, 28, 24, 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 76,
                    height: 76,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(
                        colors: [
                          AppColors.accentBlue.withValues(alpha: 0.35),
                          const Color(0xFF22C55E).withValues(alpha: 0.25),
                        ],
                      ),
                      border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
                    ),
                    child: const Icon(
                      Icons.smartphone_rounded,
                      size: 38,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Hatua inayofuata — simu yako',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 21,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                      height: 1.2,
                    ),
                  ),
                  if (bundleLabel != null && bundleLabel!.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      child: Text(
                        'Chaguo: $bundleLabel',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.accentBlue.withValues(alpha: 0.95),
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  Text(
                    'Angalia katika simu yako na umalizie hatua zilizobakia kukamilisha zoezi zima. '
                    'Baada ya uthibitisho, channel zote zitafunguliwa kwenye akaunti yako.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 15,
                      height: 1.55,
                      color: Colors.white.withValues(alpha: 0.82),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.06),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.verified_outlined,
                          size: 22,
                          color: _accentCta.withValues(alpha: 0.9),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'Hatujathibitishi bado malipo. Utaona ujumbe wa “Hongera” hapa tu baada ya mfumo kuonyesha malipo yamekamilika.',
                            style: TextStyle(
                              fontSize: 13,
                              height: 1.45,
                              color: _payMuted.withValues(alpha: 0.98),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.accentBlue,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                        elevation: 0,
                      ),
                      onPressed: onContinue,
                      child: const Text(
                        'Nimeelewa — endelea',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PaymentSessionEndedModal extends StatelessWidget {
  const _PaymentSessionEndedModal({
    required this.failed,
    required this.detail,
    required this.onStartOver,
  });

  final bool failed;
  final String? detail;
  final VoidCallback onStartOver;

  @override
  Widget build(BuildContext context) {
    final title = failed ? 'Malipo hayajakamilika' : 'Muda wa kusubiri umeisha';
    final fallback = failed
        ? 'Muamala haukufaulu au umeghairiwa. Unaweza kujaribu tena.'
        : 'Hatukuona uthibitisho ndani ya muda. Anza upya kutoka hatua ya 1.';

    return Material(
      color: Colors.black.withValues(alpha: 0.84),
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 22),
            child: Container(
              constraints: const BoxConstraints(maxWidth: 400),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(24),
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFF171F35), Color(0xFF0A0E18)],
                ),
                border: Border.all(color: Color(0x28FFFFFF)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.45),
                    blurRadius: 28,
                    offset: const Offset(0, 14),
                  ),
                ],
              ),
              padding: const EdgeInsets.fromLTRB(24, 28, 24, 22),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 72,
                    height: 72,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: failed
                          ? const Color(0x33F87171)
                          : const Color(0x33FBBF24),
                    ),
                    child: Icon(
                      failed ? Icons.highlight_off_rounded : Icons.timer_off_rounded,
                      size: 36,
                      color: failed ? const Color(0xFFF87171) : const Color(0xFFFBBF24),
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text(
                    title,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 21,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                      height: 1.2,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    (detail != null && detail!.trim().isNotEmpty) ? detail! : fallback,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 14.5,
                      height: 1.5,
                      color: Colors.white.withValues(alpha: 0.78),
                    ),
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.accentBlue,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                        elevation: 0,
                      ),
                      onPressed: onStartOver,
                      child: const Text(
                        'Anza upya — hatua ya 1',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Nambari ya simu na chaguo la bundle vitafutwa ili uanze upya kwa usahihi.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 12,
                      height: 1.45,
                      color: _payMuted.withValues(alpha: 0.95),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PaymentWaitingModal extends StatelessWidget {
  const _PaymentWaitingModal({
    required this.secondsRemaining,
    required this.totalSeconds,
  });

  final int secondsRemaining;
  final int totalSeconds;

  @override
  Widget build(BuildContext context) {
    final total = totalSeconds <= 0 ? 1 : totalSeconds;
    final countdownText =
        'Tunasubiri uthibitisho: $secondsRemaining / $total sekunde';

    return Material(
      color: Colors.black.withValues(alpha: 0.76),
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Container(
              width: double.infinity,
              constraints: const BoxConstraints(maxWidth: 380),
              decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(26),
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF141B2D), Color(0xFF0B1120)],
              ),
              border: Border.all(color: Colors.white24),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.45),
                  blurRadius: 36,
                  offset: const Offset(0, 14),
                ),
              ],
              ),
              padding: const EdgeInsets.all(26),
              child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 82,
                  height: 82,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFF22C55E), Color(0xFF14B8A6)],
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: const Color(0xFF22C55E).withValues(alpha: 0.22),
                        blurRadius: 24,
                        offset: const Offset(0, 10),
                      ),
                    ],
                  ),
                  child: const Icon(
                    Icons.verified_user_rounded,
                    size: 40,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 20),
                const Text(
                  'Subiri uthibitisho kwenye simu',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                    color: Colors.white,
                    height: 1.2,
                  ),
                ),
                const SizedBox(height: 14),
                Text(
                  'Popup ya malipo itaonekana kwenye simu yako. Ingiza namba ya siri kukamilisha. Usifunge skrini hii hadi muda uishe au uthibitisho ukamilike.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 15,
                    height: 1.55,
                    color: Colors.white.withValues(alpha: 0.82),
                  ),
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.symmetric(
                    vertical: 18,
                    horizontal: 20,
                  ),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(18),
                    color: Colors.white.withValues(alpha: 0.07),
                    border: Border.all(color: Colors.white12),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      SizedBox(
                        width: 48,
                        height: 48,
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            CircularProgressIndicator(
                              value: secondsRemaining / total,
                              strokeWidth: 4,
                              color: const Color(0xFF22C55E),
                              backgroundColor: Colors.white.withValues(alpha: 0.12),
                            ),
                            Text(
                              '$secondsRemaining',
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w800,
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Text(
                          countdownText,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 14,
                            height: 1.55,
                            color: Colors.white.withValues(alpha: 0.72),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Ukighairi au ukiacha hatua kwenye simu, malipo hayatakamilika. '
                  'Baada ya muda wa kusubiri bila uthibitisho utaweza kuanza upya kutoka hatua ya 1.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.5,
                    color: Colors.white.withValues(alpha: 0.62),
                  ),
                ),
              ],
            ),
          ),
        ),
        ),
      ),
    );
  }
}

class _PayPremiumHero extends StatelessWidget {
  const _PayPremiumHero({required this.accent});

  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(100),
            border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
            gradient: LinearGradient(
              colors: [
                Colors.white.withValues(alpha: 0.08),
                Colors.white.withValues(alpha: 0.02),
              ],
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.workspace_premium_rounded, size: 16, color: accent),
              const SizedBox(width: 8),
              Text(
                'PREMIUM',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 2,
                  color: accent.withValues(alpha: 0.95),
                  decoration: TextDecoration.none,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 22),
        Text(
          'Fungua channel\nzote papo hapo',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 28,
            height: 1.15,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.75,
            color: accent,
            decoration: TextDecoration.none,
          ),
        ),
        const SizedBox(height: 14),
        Text(
          'Hatua mbili tu — haraka, wazi, bila foleni.',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 14.5,
            height: 1.4,
            fontWeight: FontWeight.w500,
            color: _payMuted,
            decoration: TextDecoration.none,
          ),
        ),
      ],
    );
  }
}

class _PayTrustStrip extends StatelessWidget {
  const _PayTrustStrip({required this.accent});

  final Color accent;

  @override
  Widget build(BuildContext context) {
    const pills = ['M-Pesa', 'Airtel', 'Mix', 'HaloPesa'];
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _payLine),
        gradient: LinearGradient(
          colors: [
            _paySurface.withValues(alpha: 0.9),
            _paySurface2.withValues(alpha: 0.5),
          ],
        ),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.verified_rounded,
                size: 16,
                color: accent.withValues(alpha: 0.9),
              ),
              const SizedBox(width: 8),
              Text(
                'Mitandao ya Tanzania',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: Colors.white.withValues(alpha: 0.85),
                  letterSpacing: 0.4,
                  decoration: TextDecoration.none,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 8,
            runSpacing: 8,
            children: pills
                .map(
                  (p) => Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(100),
                      color: Colors.white.withValues(alpha: 0.06),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.08),
                      ),
                    ),
                    child: Text(
                      p,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: _payMuted,
                        letterSpacing: 0.2,
                        decoration: TextDecoration.none,
                      ),
                    ),
                  ),
                )
                .toList(),
          ),
        ],
      ),
    );
  }
}

class _PayGlassPanel extends StatelessWidget {
  const _PayGlassPanel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: _payLine),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Colors.white.withValues(alpha: 0.07),
            Colors.white.withValues(alpha: 0.02),
          ],
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.35),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: child,
    );
  }
}

class _PayStepTitle extends StatelessWidget {
  const _PayStepTitle({
    required this.number,
    required this.title,
    required this.accent,
  });

  final String number;
  final String title;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 36,
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            gradient: LinearGradient(
              colors: [
                accent.withValues(alpha: 0.55),
                accent.withValues(alpha: 0.2),
              ],
            ),
            boxShadow: [
              BoxShadow(
                color: accent.withValues(alpha: 0.25),
                blurRadius: 10,
                spreadRadius: -2,
              ),
            ],
          ),
          child: Text(
            number,
            style: const TextStyle(
              fontWeight: FontWeight.w900,
              fontSize: 13,
              color: Colors.white,
              letterSpacing: 0.5,
              decoration: TextDecoration.none,
            ),
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Text(
            title,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: Colors.white,
              letterSpacing: -0.3,
              decoration: TextDecoration.none,
            ),
          ),
        ),
      ],
    );
  }
}

class _PriceOptionTile extends StatelessWidget {
  const _PriceOptionTile({
    required this.plan,
    required this.accent,
    required this.selected,
    required this.onTap,
  });

  final RemoteSubscriptionPlan plan;
  final Color accent;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: selected ? _accentCta.withValues(alpha: 0.65) : _payLine,
              width: selected ? 1.5 : 1,
            ),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: selected
                  ? [
                      _accentCta.withValues(alpha: 0.18),
                      _paySurface.withValues(alpha: 0.95),
                    ]
                  : [
                      _paySurface.withValues(alpha: 0.85),
                      _paySurface2.withValues(alpha: 0.4),
                    ],
            ),
            boxShadow: [
              BoxShadow(
                color: selected
                    ? _accentCta.withValues(alpha: 0.12)
                    : Colors.black.withValues(alpha: 0.2),
                blurRadius: selected ? 16 : 10,
                offset: const Offset(0, 5),
              ),
            ],
          ),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  width: 4,
                  decoration: BoxDecoration(
                    borderRadius: const BorderRadius.horizontal(
                      left: Radius.circular(19),
                    ),
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: selected
                          ? [accent, _accentCta]
                          : [
                              Colors.white.withValues(alpha: 0.08),
                              Colors.white.withValues(alpha: 0.04),
                            ],
                    ),
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 14, 16),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (plan.isPopular) ...[
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                    vertical: 3,
                                  ),
                                  decoration: BoxDecoration(
                                    borderRadius: BorderRadius.circular(8),
                                    gradient: const LinearGradient(
                                      colors: [
                                        Color(0xFF059669),
                                        Color(0xFF10B981),
                                      ],
                                    ),
                                  ),
                                  child: const Text(
                                    'INAYOPENDWA',
                                    style: TextStyle(
                                      fontSize: 9,
                                      fontWeight: FontWeight.w900,
                                      color: Colors.white,
                                      letterSpacing: 0.8,
                                      decoration: TextDecoration.none,
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 10),
                              ],
                              Text(
                                plan.displayPriceLine,
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w800,
                                  color: Colors.white,
                                  letterSpacing: -0.4,
                                  decoration: TextDecoration.none,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                '${plan.displayName}  ·  ${plan.displayDurationLabel}',
                                style: TextStyle(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w500,
                                  color: _payMuted,
                                  decoration: TextDecoration.none,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Container(
                          width: 28,
                          height: 28,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: selected ? _accentCta : _payLine,
                              width: 2,
                            ),
                            color: selected
                                ? _accentCta.withValues(alpha: 0.2)
                                : null,
                          ),
                          child: selected
                              ? const Icon(
                                  Icons.check_rounded,
                                  color: _accentCta,
                                  size: 18,
                                )
                              : null,
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
