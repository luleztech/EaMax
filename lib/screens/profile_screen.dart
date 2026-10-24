import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/ionicons_compat.dart';
import 'package:intl/intl.dart';

import '../config/app_version.dart';
import '../config/payment_helpers.dart';
import '../services/remote_config_service.dart';
import '../services/user_id.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import '../widgets/template_ui.dart';
import '../widgets/whatsapp_support_tile.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    super.key,
    this.accentColor = AppColors.accentBlue,
    this.bottomPadding = 0,
    this.userPoints = 0,
    this.isPremium = false,
    this.subscriptionEndDate,
    this.onWatchAd,
    this.onPointsRefresh,
    this.onOpenPayments,
    this.onOpenSettings,
    this.onPaymentSuccess,
    this.isActive = false,
  });

  final Color accentColor;
  final double bottomPadding;
  final int userPoints;
  final bool isPremium;
  final DateTime? subscriptionEndDate;
  final VoidCallback? onWatchAd;
  final Future<void> Function()? onPointsRefresh;
  final VoidCallback? onOpenPayments;
  final VoidCallback? onOpenSettings;
  final PremiumUnlockCallback? onPaymentSuccess;
  final bool isActive;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> with WidgetsBindingObserver {
  String? _userId;
  bool _profileStarted = false;
  Duration _remain = Duration.zero;
  Timer? _countdownTimer;

  bool get _subscriptionTimeActive =>
      widget.isPremium &&
      widget.subscriptionEndDate != null &&
      widget.subscriptionEndDate!.isAfter(DateTime.now());

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(ensureLocalUserId().then((id) {
      if (mounted) setState(() => _userId = id);
    }));
    _restartCountdown();
    if (widget.isActive) {
      unawaited(_warmProfile());
    }
  }

  @override
  void didUpdateWidget(covariant ProfileScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isPremium != oldWidget.isPremium ||
        widget.subscriptionEndDate != oldWidget.subscriptionEndDate) {
      _restartCountdown();
    }
    if (widget.isActive && !oldWidget.isActive) {
      unawaited(_warmProfile());
    }
  }

  void _restartCountdown() {
    _countdownTimer?.cancel();
    if (!_subscriptionTimeActive) {
      if (mounted) setState(() => _remain = Duration.zero);
      return;
    }
    _tick();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _countdownTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(widget.onPointsRefresh?.call());
    }
  }

  Future<void> _warmProfile() async {
    if (_profileStarted) return;
    _profileStarted = true;
    final cachedId = await ensureLocalUserId();
    if (!mounted) return;
    setState(() => _userId = cachedId);
    unawaited(widget.onPointsRefresh?.call());
  }

  void _tick() {
    final end = widget.subscriptionEndDate;
    if (end == null || !widget.isPremium) return;
    final diff = end.difference(DateTime.now());
    if (diff.isNegative || diff.inSeconds <= 0) {
      _countdownTimer?.cancel();
      _countdownTimer = null;
      if (mounted) setState(() => _remain = Duration.zero);
      unawaited(widget.onPointsRefresh?.call());
      return;
    }
    if (mounted) setState(() => _remain = diff);
  }

  void _onKusanyaPoint() {
    widget.onWatchAd?.call();
    Future.delayed(const Duration(milliseconds: 8000), () {
      unawaited(widget.onPointsRefresh?.call());
    });
  }

  Future<void> _copyUserId() async {
    final id = _userId?.trim();
    if (id == null || id.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: id));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Jina la mtumiaji limenakiliwa', style: rajdhani(14, weight: FontWeight.w600)),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bottom = 32.0 + widget.bottomPadding;
    final id = _userId?.trim() ?? '';
    final letters = id.length >= 2 ? id.substring(0, 2).toUpperCase() : 'EM';
    final isPremium = widget.isPremium;
    final canEarnPoints = !_subscriptionTimeActive && RemoteConfigService.adsEnabled && widget.onWatchAd != null;

    final rows = <Widget Function(bool last)>[
      if (RemoteConfigService.paymentsEnabled)
        (last) => TplSettingRow(
              icon: TplIconName.card,
              label: 'Payments & subscriptions',
              value: isPremium ? 'Premium' : null,
              last: last,
              onTap: widget.onOpenPayments,
            ),
      if (canEarnPoints)
        (last) => TplSettingRow(
              icon: TplIconName.play,
              label: 'Kusanya Point',
              value: '+${RemoteConfigService.adRewardPoints}',
              last: last,
              onTap: _onKusanyaPoint,
            ),
      (last) => WhatsappSupportTile(last: last),
      (last) => TplSettingRow(
            icon: TplIconName.user,
            iconWidget: const Icon(Icons.settings_outlined, size: 20, color: Tpl.lime400),
            label: 'Settings',
            value: 'Theme',
            last: last,
            onTap: widget.onOpenSettings,
          ),
    ];

    return ColoredBox(
      color: Tpl.slate950,
      child: RefreshIndicator(
        color: Tpl.lime400,
        backgroundColor: Tpl.slate900,
        onRefresh: () async {
          final id = await ensureLocalUserId();
          if (mounted) setState(() => _userId = id);
          await registerUserInDatabase(id: id, maxRetries: 2);
          unawaited(widget.onPointsRefresh?.call());
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: EdgeInsets.only(bottom: bottom),
          children: [
            const TplPageHeader(eyebrow: 'Akaunti yangu', title: 'Mtumiaji'),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 24, 16, 0),
              child: Material(
                color: Tpl.slate900,
                borderRadius: BorderRadius.circular(24),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: id.isNotEmpty ? _copyUserId : null,
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Row(
                      children: [
                        Container(
                          width: 64,
                          height: 64,
                          decoration: const BoxDecoration(color: Tpl.lime400, shape: BoxShape.circle),
                          alignment: Alignment.center,
                          child: Text(letters, style: manrope(20, weight: FontWeight.w800, color: Tpl.slate950)),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Flexible(
                                    child: Text(
                                      id.isEmpty ? 'Inapakia…' : id,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: manrope(18, weight: FontWeight.w800, color: Colors.white),
                                    ),
                                  ),
                                  if (id.isNotEmpty) ...[
                                    const SizedBox(width: 8),
                                    const Icon(Ionicons.copy_outline, size: 14, color: Tpl.slate500),
                                  ],
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                isPremium ? 'Hali: Premium' : 'Hali: Bure',
                                style: manrope(12, color: isPremium ? Tpl.lime400 : Tpl.slate500),
                              ),
                              const SizedBox(height: 4),
                              Text('${widget.userPoints} points', style: manrope(12, color: Tpl.slate400)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            if (_subscriptionTimeActive) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 32, 16, 12),
                child: Text('Muda uliobaki', style: manrope(14, weight: FontWeight.w800, color: Colors.white)),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: _SubscriptionRemainCard(remain: _remain, subEnd: widget.subscriptionEndDate),
              ),
            ],
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 32, 16, 12),
              child: Text('Settings', style: manrope(14, weight: FontWeight.w800, color: Colors.white)),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TplSettingGroup(
                children: [
                  for (var i = 0; i < rows.length; i++) rows[i](i == rows.length - 1),
                ],
              ),
            ),
            const SizedBox(height: 32),
            Text(
              'EaMax for Android • Version $appVersion',
              textAlign: TextAlign.center,
              style: manrope(10, color: Tpl.slate700),
            ),
          ],
        ),
      ),
    );
  }
}

/// Countdown laid out like the template's segmented "Player quality" control.
class _SubscriptionRemainCard extends StatelessWidget {
  const _SubscriptionRemainCard({required this.remain, required this.subEnd});

  final Duration remain;
  final DateTime? subEnd;

  @override
  Widget build(BuildContext context) {
    final units = [
      ('${remain.inDays}', 'Siku'),
      ((remain.inHours % 24).toString().padLeft(2, '0'), 'Masaa'),
      ((remain.inMinutes % 60).toString().padLeft(2, '0'), 'Dakika'),
      ((remain.inSeconds % 60).toString().padLeft(2, '0'), 'Sekunde'),
    ];
    final fmt = subEnd != null ? DateFormat.yMMMMd().format(subEnd!) : '';

    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(color: Tpl.slate900, borderRadius: BorderRadius.circular(16)),
      child: Column(
        children: [
          Row(
            children: [
              for (var i = 0; i < units.length; i++) ...[
                if (i > 0) const SizedBox(width: 8),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    decoration: BoxDecoration(
                      color: i == 0 ? Tpl.lime400 : Colors.transparent,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      children: [
                        Text(
                          units[i].$1,
                          style: manrope(18, weight: FontWeight.w800, color: i == 0 ? Tpl.slate950 : Colors.white),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          units[i].$2,
                          style: manrope(10, weight: FontWeight.w700, color: i == 0 ? Tpl.slate950 : Tpl.slate500),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
          if (fmt.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 12, 8, 6),
              child: Text('Inaisha tarehe: $fmt', style: manrope(12, color: Tpl.slate500)),
            ),
        ],
      ),
    );
  }
}
