import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/payment_helpers.dart';
import '../models/remote_config_bundle.dart';
import '../services/payment_checkout.dart';
import '../services/remote_config_service.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import '../utils/tz_payment_config.dart';
import '../widgets/template_ui.dart';

/// Step-by-step checkout: 1. package, 2. mobile-money network, 3. phone number,
/// then Lipia and an inline "Angalia simu yako" view that waits for the PIN.
/// Each finished step collapses into a numbered summary that can be reopened.
class PlansTab extends StatefulWidget {
  const PlansTab({
    super.key,
    required this.isPremium,
    required this.subscriptionEndDate,
    required this.onPaymentSuccess,
    required this.onFinished,
    required this.bottomPad,
    this.isActive = false,
  });

  final bool isPremium;
  final DateTime? subscriptionEndDate;
  final PremiumUnlockCallback? onPaymentSuccess;

  /// After a successful payment: leave Malipo (e.g. back to Home).
  final VoidCallback onFinished;
  final double bottomPad;

  /// Visible tab in the shell.
  final bool isActive;

  @override
  State<PlansTab> createState() => _PlansTabState();
}

class _Provider {
  const _Provider(this.network, this.label, this.color);

  final TzMobileNetwork network;
  final String label;
  final Color color;
}

const _providers = [
  _Provider(TzMobileNetwork.mpesa, 'M-Pesa', Color(0xFFE60000)),
  _Provider(TzMobileNetwork.tigo, 'Mixx by Yas', Color(0xFF4FC3F7)),
  _Provider(TzMobileNetwork.airtel, 'Airtel Money', Color(0xFF8B0000)),
  _Provider(TzMobileNetwork.halotel, 'HaloPesa', Color(0xFFFF4500)),
];

_Provider _providerOf(TzMobileNetwork network) =>
    _providers.firstWhere((p) => p.network == network, orElse: () => _providers.first);

/// "Kwa Wiki" reads as "kifurushi cha Wiki", not "cha Kwa Wiki".
String _planPhrase(RemoteSubscriptionPlan plan) =>
    plan.displayName.replaceFirst(RegExp(r'^kwa\s+', caseSensitive: false), '');

/// 0790983488 → 0790 983 488
String _prettyPhone(String digits) => digits.length == 10
    ? '${digits.substring(0, 4)} ${digits.substring(4, 7)} ${digits.substring(7)}'
    : digits;

class _PlansTabState extends State<PlansTab> with WidgetsBindingObserver {
  final _phoneCtrl = TextEditingController();
  final _phoneFocus = FocusNode();
  final _stepKeys = [GlobalKey(), GlobalKey(), GlobalKey()];

  /// Phone input + helper; kept fully above the keyboard while typing.
  final _payBlockKey = GlobalKey();
  bool _keyboardOpen = false;
  double _keyboardOverlap = 0;
  Timer? _revealDebounce;

  String? _selectedSlug;
  TzMobileNetwork? _provider;

  /// Step 3 reopened from its summary; shows the input until focus leaves it.
  bool _editingPhone = false;
  PaymentCheckout? _checkout;

  List<RemoteSubscriptionPlan> get _plans {
    final remote = RemoteConfigService.paymentPlans;
    return remote.isNotEmpty ? remote : defaultSubscriptionPlans();
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _phoneFocus.addListener(() {
      setState(() {
        if (!_phoneFocus.hasFocus) _editingPhone = false;
      });
      if (_phoneFocus.hasFocus) _scheduleReveal();
    });
    TzPaymentConfig.learnedVersion.addListener(_onLearnedChanged);
    unawaited(_restorePhone());
  }

  @override
  void didChangeMetrics() {
    WidgetsBinding.instance.addPostFrameCallback((_) => _measureKeyboardOverlap());
  }

  /// With `extendBody` the tab can reach below the keyboard top; pad the scroll
  /// viewport by exactly that overlap so "visible" really means above the keyboard.
  void _measureKeyboardOverlap() {
    if (!mounted) return;
    final view = View.maybeOf(context);
    final box = context.findRenderObject();
    if (view == null || box is! RenderBox || !box.hasSize) return;
    final inset = view.viewInsets.bottom / view.devicePixelRatio;
    var overlap = 0.0;
    if (inset > 0) {
      final screenH = view.physicalSize.height / view.devicePixelRatio;
      final bottom = box.localToGlobal(Offset(0, box.size.height)).dy;
      overlap = math.max(0.0, bottom - (screenH - inset));
    }
    final open = inset > 0;
    if (open != _keyboardOpen || (overlap - _keyboardOverlap).abs() > 0.5) {
      setState(() {
        _keyboardOpen = open;
        _keyboardOverlap = overlap;
      });
    }
    if (open && _phoneFocus.hasFocus) _scheduleReveal();
  }

  /// Waits for the keyboard animation to settle, then scrolls so the phone box
  /// and its helper sit above the keyboard.
  void _scheduleReveal() {
    _revealDebounce?.cancel();
    _revealDebounce = Timer(const Duration(milliseconds: 90), () {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = _payBlockKey.currentContext;
        if (!mounted || ctx == null || !_phoneFocus.hasFocus) return;
        unawaited(
          Scrollable.ensureVisible(
            ctx,
            alignment: 1,
            alignmentPolicy: ScrollPositionAlignmentPolicy.keepVisibleAtEnd,
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOutCubic,
          ),
        );
      });
    });
  }

  /// Brings a newly opened step into view once its expand animation has finished.
  void _revealStep(int index) {
    Future<void>.delayed(const Duration(milliseconds: 300), () {
      final ctx = _stepKeys[index].currentContext;
      if (!mounted || ctx == null || !ctx.mounted) return;
      unawaited(
        Scrollable.ensureVisible(
          ctx,
          alignment: 1,
          alignmentPolicy: ScrollPositionAlignmentPolicy.keepVisibleAtEnd,
          duration: const Duration(milliseconds: 280),
          curve: Curves.easeOutCubic,
        ),
      );
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _revealDebounce?.cancel();
    TzPaymentConfig.learnedVersion.removeListener(_onLearnedChanged);
    _checkout?.dispose();
    _phoneCtrl.dispose();
    _phoneFocus.dispose();
    super.dispose();
  }

  Future<void> _restorePhone() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final phone = prefs.getString(PaymentCheckout.prefsPhoneKey)?.trim() ?? '';
      if (!mounted || phone.isEmpty || _phoneCtrl.text.isNotEmpty) return;
      setState(() => _phoneCtrl.text = TzPaymentConfig.liveDigits(phone));
    } catch (_) {}
  }

  void _onLearnedChanged() {
    if (mounted) setState(() {});
  }

  RemoteSubscriptionPlan? _selectedPlan(List<RemoteSubscriptionPlan> plans) {
    for (final p in plans) {
      if (p.slug == _selectedSlug) return p;
    }
    return null;
  }

  void _pickPlan(RemoteSubscriptionPlan plan) {
    setState(() => _selectedSlug = plan.slug);
    _revealStep(_provider == null ? 1 : 2);
  }

  void _pickProvider(TzMobileNetwork net) {
    setState(() => _provider = net);
    _revealStep(2);
    if (!TzPaymentConfig.isValidTzLocalPhone(_phoneCtrl.text)) {
      Future<void>.delayed(const Duration(milliseconds: 320), () {
        if (mounted && _provider != null && _checkout == null) _phoneFocus.requestFocus();
      });
    }
  }

  void _editPhone() {
    setState(() => _editingPhone = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _phoneFocus.requestFocus();
    });
  }

  void _onPhoneChanged(String v) {
    setState(() {});
    if (!_phoneFocus.hasFocus) return;
    if (TzPaymentConfig.isValidTzLocalPhone(v) && v.length == 10) {
      // Number complete: drop the keyboard so step 3 collapses and Lipia shows.
      Future<void>.delayed(const Duration(milliseconds: 180), () {
        if (mounted && _phoneFocus.hasFocus && TzPaymentConfig.isValidTzLocalPhone(_phoneCtrl.text)) {
          _phoneFocus.unfocus();
        }
      });
    } else {
      _scheduleReveal();
    }
  }

  Future<void> _pay(RemoteSubscriptionPlan plan, TzMobileNetwork provider) async {
    final phone = TzPaymentConfig.normalizeTzLocalPhone(_phoneCtrl.text);
    if (phone == null || _checkout != null || !RemoteConfigService.paymentsEnabled) return;
    FocusManager.instance.primaryFocus?.unfocus();
    if (TzPaymentConfig.detectNetwork(phone) == TzMobileNetwork.unknown) {
      // A new range (e.g. 070): the payer's chosen network teaches the prefix.
      await TzPaymentConfig.learnPrefix(phone.substring(0, 3), provider);
    }
    if (!mounted) return;
    final checkout = PaymentCheckout(plan: plan, phone: phone, onPaymentSuccess: widget.onPaymentSuccess)
      ..addListener(_onCheckoutChanged);
    setState(() => _checkout = checkout);
    checkout.start();
  }

  void _onCheckoutChanged() {
    if (mounted) setState(() {});
  }

  void _closeCheckout({bool finished = false}) {
    final c = _checkout;
    if (c == null) return;
    c.removeListener(_onCheckoutChanged);
    c.dispose();
    setState(() {
      _checkout = null;
      if (finished) {
        _selectedSlug = null;
        _provider = null;
      }
    });
    if (finished) widget.onFinished();
  }

  @override
  Widget build(BuildContext context) {
    final checkout = _checkout;
    if (checkout != null) {
      return _CheckoutView(
        checkout: checkout,
        bottomPad: widget.bottomPad,
        onBack: _closeCheckout,
        onDone: () => _closeCheckout(finished: true),
      );
    }

    final plans = _plans;
    final plan = _selectedPlan(plans);
    final provider = _provider;

    final subActive =
        widget.isPremium && widget.subscriptionEndDate != null && widget.subscriptionEndDate!.isAfter(DateTime.now());

    final phone = _phoneCtrl.text;
    final digits = phone.replaceAll(RegExp(r'\D'), '');
    final valid = TzPaymentConfig.isValidTzLocalPhone(phone);
    final detected = TzPaymentConfig.detectNetworkLive(phone);
    final mismatch = provider != null && detected != TzMobileNetwork.unknown && detected != provider;
    final phoneDone = valid && !mismatch && !_phoneFocus.hasFocus && !_editingPhone;
    final canPay = plan != null && provider != null && phoneDone && RemoteConfigService.paymentsEnabled;

    return ColoredBox(
      color: Tpl.slate950,
      child: Padding(
        padding: EdgeInsets.only(bottom: _keyboardOverlap),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: EdgeInsets.only(bottom: _keyboardOpen ? 12 : 28 + widget.bottomPad),
          children: [
            const TplPageHeader(title: 'Lipia kifurushi'),
            if (subActive)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
                child: _ActiveSubscriptionBanner(endsAt: widget.subscriptionEndDate!),
              ),
            const SizedBox(height: 20),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _StepSlot(
                    child: plan == null
                        ? _OpenStep(
                            key: _stepKeys[0],
                            number: 1,
                            title: 'Chagua kifurushi',
                            child: _PlanList(plans: plans, onPick: _pickPlan),
                          )
                        : _DoneStep(
                            key: const ValueKey('plan-done'),
                            number: 1,
                            title: 'Umechagua kifurushi cha ${_planPhrase(plan)}',
                            detail: 'TSh ${plan.formattedPrice} · ${plan.displayDurationLabel}',
                            onEdit: () => setState(() => _selectedSlug = null),
                          ),
                  ),
                  if (plan != null) ...[
                    const SizedBox(height: 12),
                    _StepSlot(
                      child: provider == null
                          ? _OpenStep(
                              key: _stepKeys[1],
                              number: 2,
                              title: 'Chagua mtandao',
                              child: _ProviderGrid(selected: null, onSelect: _pickProvider),
                            )
                          : _DoneStep(
                              key: const ValueKey('provider-done'),
                              number: 2,
                              title: 'Unalipa kupitia ${_providerOf(provider).label}',
                              detail: 'Ombi la PIN litatumwa kwa ${TzPaymentConfig.networkFullName(provider)}',
                              dotColor: _providerOf(provider).color,
                              onEdit: () => setState(() => _provider = null),
                            ),
                    ),
                  ],
                  if (plan != null && provider != null) ...[
                    const SizedBox(height: 12),
                    _StepSlot(
                      child: phoneDone
                          ? _DoneStep(
                              key: const ValueKey('phone-done'),
                              number: 3,
                              title:
                                  'Namba itakayotumika kulipia kifurushi cha ${_planPhrase(plan)} kupitia ${_providerOf(provider).label}',
                              detail: _prettyPhone(digits),
                              detailLarge: true,
                              onEdit: _editPhone,
                            )
                          : _OpenStep(
                              key: _stepKeys[2],
                              number: 3,
                              title: 'Namba ya simu',
                              child: _phoneInput(
                                plan: plan,
                                provider: provider,
                                digits: digits,
                                valid: valid,
                                detected: detected,
                                mismatch: mismatch,
                              ),
                            ),
                    ),
                    _StepSlot(
                      child: phoneDone
                          ? Column(
                              key: const ValueKey('pay'),
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                const SizedBox(height: 20),
                                Text(
                                  'Bonyeza Lipia hapo chini kumalizia hatua ya mwisho.',
                                  textAlign: TextAlign.center,
                                  style: manrope(12, weight: FontWeight.w600, color: Tpl.slate400),
                                ),
                                const SizedBox(height: 12),
                                TplPrimaryButton(
                                  label: 'Lipia TSh ${plan.formattedPrice}',
                                  trailing: const TplIcon(TplIconName.chevron, size: 16, color: Tpl.slate950),
                                  onTap: canPay ? () => _pay(plan, provider) : null,
                                ),
                              ],
                            )
                          : const SizedBox.shrink(key: ValueKey('no-pay')),
                    ),
                  ],
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 16, 24, 0),
              child: Text(
                RemoteConfigService.paymentsEnabled
                    ? 'Kifurushi chako kitawezeshwa pindi ukikamilisha malipo yako.'
                    : 'Malipo yamezimwa kwa muda. Jaribu tena baadaye.',
                textAlign: TextAlign.center,
                style: manrope(11, color: Tpl.slate500, height: 1.8),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _phoneInput({
    required RemoteSubscriptionPlan plan,
    required TzMobileNetwork provider,
    required String digits,
    required bool valid,
    required TzMobileNetwork detected,
    required bool mismatch,
  }) {
    final prefix = TzPaymentConfig.prefixOf(digits);
    final badStart =
        digits.isNotEmpty && (!digits.startsWith('0') || (digits.length >= 2 && !RegExp(r'^0[67]').hasMatch(digits)));
    final showError = badStart || (digits.length >= 10 && !valid);
    final unknownPrefix = !badStart && prefix != null && detected == TzMobileNetwork.unknown;
    final chosen = _providerOf(provider).label;

    final (String helper, Color helperColor) = switch (true) {
      _ when badStart => ('Namba ianze na 06 au 07, mfano 0712 345 678.', Tpl.red400),
      _ when showError => ('Namba si sahihi. Andika tarakimu 10 ukianza na 0.', Tpl.red400),
      _ when mismatch => (
        'Namba hii ni ya ${_providerOf(detected).label}, lakini umechagua $chosen.',
        Tpl.red400,
      ),
      _ when unknownPrefix && valid => ('Namba mpya ya $prefix — ombi la PIN litatumwa kupitia $chosen.', Tpl.lime400),
      _ when valid => ('Ombi la PIN litatumwa kwa ${TzPaymentConfig.networkFullName(provider)}.', Tpl.lime400),
      _ => ('Andika namba ya $chosen ukianza na 0.', Tpl.slate500),
    };

    final dotNetwork = detected != TzMobileNetwork.unknown ? detected : provider;

    return Column(
      key: _payBlockKey,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          decoration: BoxDecoration(
            color: Tpl.slate950,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: showError || mismatch
                  ? Tpl.red400
                  : (_phoneFocus.hasFocus ? Tpl.lime400 : Colors.white.withValues(alpha: 0.1)),
            ),
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                decoration: BoxDecoration(
                  border: Border(right: BorderSide(color: Colors.white.withValues(alpha: 0.1))),
                ),
                child: Text('TZ', style: manrope(12, weight: FontWeight.w700, color: Tpl.slate500)),
              ),
              Expanded(
                child: TextField(
                  controller: _phoneCtrl,
                  focusNode: _phoneFocus,
                  keyboardType: TextInputType.phone,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(10),
                  ],
                  onChanged: _onPhoneChanged,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _phoneFocus.unfocus(),
                  // Reveal is handled by [_scheduleReveal] for the whole phone block.
                  scrollPadding: EdgeInsets.zero,
                  style: manrope(16, weight: FontWeight.w700, color: Colors.white),
                  decoration: InputDecoration(
                    isCollapsed: true,
                    border: InputBorder.none,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    hintText: '0XXX XXX XXX',
                    hintStyle: manrope(16, weight: FontWeight.w700, color: Tpl.slate600),
                  ),
                ),
              ),
              if (digits.length >= 3 && !badStart)
                Padding(
                  padding: const EdgeInsets.only(right: 14),
                  child: _NetworkDot(network: dotNetwork),
                ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Text(helper, style: manrope(11, color: helperColor, height: 1.4)),
        if (mismatch) ...[
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerLeft,
            child: GestureDetector(
              onTap: () => setState(() => _provider = detected),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: Tpl.lime400.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: Tpl.lime400.withValues(alpha: 0.4)),
                ),
                child: Text(
                  'Lipia kupitia ${_providerOf(detected).label}',
                  style: manrope(12, weight: FontWeight.w700, color: Tpl.lime400),
                ),
              ),
            ),
          ),
        ],
        // Breathing room between the helper and the keyboard edge.
        const SizedBox(height: 12),
      ],
    );
  }
}

/// Swaps a step between its open and finished forms with a fade and resize.
class _StepSlot extends StatelessWidget {
  const _StepSlot({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return AnimatedSize(
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOutCubic,
      alignment: Alignment.topCenter,
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 220),
        switchInCurve: Curves.easeOutCubic,
        switchOutCurve: Curves.easeInCubic,
        layoutBuilder: (current, previous) => Stack(
          alignment: Alignment.topCenter,
          children: [...previous, ?current],
        ),
        transitionBuilder: (child, anim) => FadeTransition(
          opacity: anim,
          child: SlideTransition(
            position: Tween<Offset>(begin: const Offset(0, 0.04), end: Offset.zero).animate(anim),
            child: child,
          ),
        ),
        child: child,
      ),
    );
  }
}

class _StepNumber extends StatelessWidget {
  const _StepNumber({required this.number, required this.done});

  final int number;
  final bool done;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 28,
      height: 28,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: done ? Tpl.lime400 : Colors.transparent,
        border: Border.all(color: Tpl.lime400, width: 1.5),
      ),
      alignment: Alignment.center,
      child: Text(
        '$number',
        style: manrope(12, weight: FontWeight.w800, color: done ? Tpl.slate950 : Tpl.lime400),
      ),
    );
  }
}

/// The step the payer is on: numbered title and its choices.
class _OpenStep extends StatelessWidget {
  const _OpenStep({super.key, required this.number, required this.title, required this.child});

  final int number;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      decoration: BoxDecoration(
        color: Tpl.slate900,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Tpl.lime400.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              _StepNumber(number: number, done: false),
              const SizedBox(width: 12),
              Expanded(
                child: Text(title, style: manrope(17, weight: FontWeight.w800, color: Colors.white)),
              ),
            ],
          ),
          const SizedBox(height: 16),
          child,
        ],
      ),
    );
  }
}

/// A finished step, collapsed to one line; tapping reopens it.
class _DoneStep extends StatelessWidget {
  const _DoneStep({
    super.key,
    required this.number,
    required this.title,
    required this.detail,
    required this.onEdit,
    this.dotColor,
    this.detailLarge = false,
  });

  final int number;
  final String title;
  final String detail;
  final VoidCallback onEdit;
  final Color? dotColor;
  final bool detailLarge;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onEdit,
      child: Container(
        padding: const EdgeInsets.fromLTRB(14, 14, 12, 14),
        decoration: BoxDecoration(
          color: Tpl.slate900,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Tpl.hairline(0.07)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _StepNumber(number: number, done: true),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: manrope(14, weight: FontWeight.w700, color: Colors.white, height: 1.35)),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      if (dotColor != null)
                        Container(
                          width: 8,
                          height: 8,
                          margin: const EdgeInsets.only(right: 6),
                          decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
                        ),
                      Flexible(
                        child: Text(
                          detail,
                          style: detailLarge
                              ? manrope(18, weight: FontWeight.w800, color: Tpl.lime400, letterSpacing: 0.5)
                              : manrope(12, weight: FontWeight.w600, color: Tpl.slate400),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('Badili', style: manrope(12, weight: FontWeight.w700, color: Tpl.lime400)),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlanList extends StatelessWidget {
  const _PlanList({required this.plans, required this.onPick});

  final List<RemoteSubscriptionPlan> plans;
  final ValueChanged<RemoteSubscriptionPlan> onPick;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < plans.length; i++) ...[
          if (i > 0) const SizedBox(height: 8),
          _PlanTile(plan: plans[i], onTap: () => onPick(plans[i])),
        ],
      ],
    );
  }
}

class _PlanTile extends StatelessWidget {
  const _PlanTile({required this.plan, required this.onTap});

  final RemoteSubscriptionPlan plan;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final badge = plan.badgeText?.trim() ?? '';
    final popular = plan.isPopular;
    return Material(
      color: Tpl.slate950,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: popular ? Tpl.lime400.withValues(alpha: 0.5) : Tpl.hairline(0.08)),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            plan.displayName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: manrope(14, weight: FontWeight.w800, color: Colors.white),
                          ),
                        ),
                        if (badge.isNotEmpty) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                              color: Tpl.lime400.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              badge,
                              style: manrope(9, weight: FontWeight.w800, color: Tpl.lime400),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(plan.displayDurationLabel, style: manrope(11, color: Tpl.slate400)),
                  ],
                ),
              ),
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(text: 'TSh ', style: manrope(10, weight: FontWeight.w800, color: Tpl.slate500)),
                    TextSpan(
                      text: plan.formattedPrice,
                      style: manrope(17, weight: FontWeight.w800, color: Colors.white),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const TplIcon(TplIconName.chevron, size: 14, color: Tpl.slate500),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProviderGrid extends StatelessWidget {
  const _ProviderGrid({required this.selected, required this.onSelect});

  /// Null while an unknown prefix has no network chosen yet.
  final TzMobileNetwork? selected;
  final ValueChanged<TzMobileNetwork> onSelect;

  @override
  Widget build(BuildContext context) {
    Widget chip(_Provider p) => Expanded(
      child: _ProviderChip(provider: p, selected: selected == p.network, onTap: () => onSelect(p.network)),
    );
    return Column(
      children: [
        Row(children: [chip(_providers[0]), const SizedBox(width: 8), chip(_providers[1])]),
        const SizedBox(height: 8),
        Row(children: [chip(_providers[2]), const SizedBox(width: 8), chip(_providers[3])]),
      ],
    );
  }
}

class _ProviderChip extends StatelessWidget {
  const _ProviderChip({required this.provider, required this.selected, required this.onTap});

  final _Provider provider;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = provider.color;
    final onColor = color.computeLuminance() > 0.45 ? Tpl.slate950 : Colors.white;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        height: 44,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          color: selected ? color : color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? color : color.withValues(alpha: 0.45)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (selected)
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: TplIcon(TplIconName.check, size: 14, color: onColor),
              )
            else
              Container(
                width: 8,
                height: 8,
                margin: const EdgeInsets.only(right: 8),
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              ),
            Flexible(
              child: Text(
                provider.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: manrope(12, weight: FontWeight.w800, color: selected ? onColor : Colors.white),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NetworkDot extends StatelessWidget {
  const _NetworkDot({required this.network});

  final TzMobileNetwork network;

  @override
  Widget build(BuildContext context) {
    final p = _providers.firstWhere((e) => e.network == network, orElse: () => _providers.first);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: p.color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            margin: const EdgeInsets.only(right: 5),
            decoration: BoxDecoration(color: p.color, shape: BoxShape.circle),
          ),
          Text(
            p.label,
            style: manrope(10, weight: FontWeight.w700, color: Colors.white),
          ),
        ],
      ),
    );
  }
}

/// Template "Check your phone" step, kept inside the Malipo tab.
class _CheckoutView extends StatelessWidget {
  const _CheckoutView({required this.checkout, required this.bottomPad, required this.onBack, required this.onDone});

  final PaymentCheckout checkout;
  final double bottomPad;
  final VoidCallback onBack;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    final c = checkout;
    final top = MediaQuery.paddingOf(context).top;
    final netLabel = TzPaymentConfig.networkLabel(c.network);
    final amount = 'TSh ${c.plan.formattedPrice}';

    final (String title, Color hintColor) = switch (c.stage) {
      CheckoutStage.sending => ('Tunatuma ombi…', Tpl.slate400),
      CheckoutStage.waiting => ('Angalia simu yako', Tpl.slate400),
      CheckoutStage.success => ('Malipo yamekamilika', Tpl.lime400),
      CheckoutStage.failed => ('Malipo hayajakamilika', Tpl.red400),
    };

    return ColoredBox(
      color: Tpl.slate950,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.fromLTRB(24, math.max(top, 28) + 24, 24, 28 + bottomPad),
        children: [
          Center(child: _CheckoutBadge(stage: c.stage)),
          const SizedBox(height: 24),
          Text(
            title,
            textAlign: TextAlign.center,
            style: manrope(28, weight: FontWeight.w800, color: Colors.white, height: 1.2),
          ),
          const SizedBox(height: 12),
          if (c.stage != CheckoutStage.success)
            Text.rich(
              TextSpan(
                style: manrope(14, color: Tpl.slate400, height: 1.6),
                children: [
                  TextSpan(text: 'Ombi la $netLabel la '),
                  TextSpan(
                    text: amount,
                    style: manrope(14, weight: FontWeight.w800, color: Colors.white),
                  ),
                  TextSpan(text: ' ${c.stage == CheckoutStage.sending ? 'linatumwa' : 'limetumwa'} kwa '),
                  TextSpan(
                    text: c.phone,
                    style: manrope(14, weight: FontWeight.w800, color: Colors.white),
                  ),
                  const TextSpan(text: '.'),
                ],
              ),
              textAlign: TextAlign.center,
            ),
          const SizedBox(height: 24),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 6),
            decoration: BoxDecoration(
              color: Tpl.slate900,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: Tpl.hairline(0.07)),
            ),
            child: Column(
              children: [
                _SummaryRow(label: 'Kifurushi', value: c.plan.displayName),
                _SummaryRow(label: 'Kiasi', value: amount, highlight: true),
                _SummaryRow(label: 'Namba', value: c.phone),
                _SummaryRow(label: 'Mtandao', value: netLabel, last: true),
              ],
            ),
          ),
          const SizedBox(height: 16),
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 200),
            child: Text(
              c.hint,
              key: ValueKey(c.hint),
              textAlign: TextAlign.center,
              style: manrope(12, weight: FontWeight.w600, color: hintColor, height: 1.5),
            ),
          ),
          const SizedBox(height: 24),
          ...switch (c.stage) {
            CheckoutStage.sending => [TplSecondaryButton(label: 'Ghairi', onTap: onBack)],
            CheckoutStage.waiting => [
              TplPrimaryButton(
                label: c.resending ? 'Inatuma…' : 'Tuma ombi tena',
                onTap: c.canResend && !c.resending ? () => unawaited(c.resend()) : null,
              ),
              const SizedBox(height: 12),
              TplSecondaryButton(label: 'Rudi kwenye vifurushi', onTap: onBack),
            ],
            CheckoutStage.success => [
              TplPrimaryButton(
                label: 'Anza kutazama',
                trailing: const TplIcon(TplIconName.play, size: 16, color: Tpl.slate950),
                onTap: onDone,
              ),
            ],
            CheckoutStage.failed => [
              TplPrimaryButton(label: 'Jaribu tena', onTap: c.retry),
              const SizedBox(height: 12),
              TplSecondaryButton(label: 'Rudi kwenye vifurushi', onTap: onBack),
            ],
          },
        ],
      ),
    );
  }
}

class _CheckoutBadge extends StatelessWidget {
  const _CheckoutBadge({required this.stage});

  final CheckoutStage stage;

  @override
  Widget build(BuildContext context) {
    final busy = stage == CheckoutStage.sending || stage == CheckoutStage.waiting;
    final failed = stage == CheckoutStage.failed;
    final color = failed ? Tpl.red400 : Tpl.lime400;
    return SizedBox(
      width: 96,
      height: 96,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (busy)
            const SizedBox(
              width: 96,
              height: 96,
              child: CircularProgressIndicator(strokeWidth: 3, color: Tpl.lime400, backgroundColor: Tpl.slate800),
            ),
          AnimatedContainer(
            duration: const Duration(milliseconds: 250),
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: busy ? Tpl.slate900 : color,
              shape: BoxShape.circle,
              boxShadow: [BoxShadow(color: color.withValues(alpha: 0.2), blurRadius: 24, offset: const Offset(0, 8))],
            ),
            alignment: Alignment.center,
            child: busy
                ? const Icon(Icons.phone_iphone_rounded, size: 34, color: Tpl.lime400)
                : TplIcon(failed ? TplIconName.close : TplIconName.check, size: 38, color: Tpl.slate950),
          ),
        ],
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.label, required this.value, this.highlight = false, this.last = false});

  final String label;
  final String value;
  final bool highlight;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        border: last ? null : Border(bottom: BorderSide(color: Tpl.hairline(0.06))),
      ),
      child: Row(
        children: [
          Text(label, style: manrope(12, color: Tpl.slate500)),
          const Spacer(),
          Text(
            value,
            style: manrope(13, weight: FontWeight.w800, color: highlight ? Tpl.lime400 : Colors.white),
          ),
        ],
      ),
    );
  }
}

class _ActiveSubscriptionBanner extends StatelessWidget {
  const _ActiveSubscriptionBanner({required this.endsAt});

  final DateTime endsAt;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Tpl.lime400.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Tpl.lime400.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: const BoxDecoration(color: Tpl.lime400, shape: BoxShape.circle),
            alignment: Alignment.center,
            child: const TplIcon(TplIconName.check, size: 18, color: Tpl.slate950),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Premium ipo hai',
                  style: manrope(14, weight: FontWeight.w800, color: Colors.white),
                ),
                const SizedBox(height: 2),
                Text('Inaisha ${DateFormat.yMMMd().format(endsAt)}', style: manrope(12, color: Tpl.slate400)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
