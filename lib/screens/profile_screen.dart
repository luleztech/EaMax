import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/ionicons_compat.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../services/user_id.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import '../widgets/app_header.dart';

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
    final t = context.watch<ThemeController>().colors;
    final bottom = 32.0 + widget.bottomPadding;
    final letters = (_userId != null && _userId!.length >= 2) ? _userId!.substring(0, 2).toUpperCase() : 'EM';
    final isPremium = widget.isPremium;

    return ColoredBox(
      color: t.bg1,
      child: RefreshIndicator(
        color: t.accent,
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
            const AppHeader(title: 'Akaunti', subtitle: 'AKAUNTI YAKO', logoLetter: 'E'),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 24),
              child: Column(
                children: [
                  Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(colors: [t.accent, t.accent2]),
                      boxShadow: [BoxShadow(color: t.accent.withValues(alpha: 0.4), blurRadius: 20)],
                    ),
                    alignment: Alignment.center,
                    child: Text(letters, style: orbitron(28, weight: FontWeight.w900).copyWith(color: Colors.black)),
                  ),
                  const SizedBox(height: 16),
                  Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: _userId != null && _userId!.isNotEmpty ? _copyUserId : null,
                      borderRadius: BorderRadius.circular(12),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Flexible(
                              child: Text(
                                _userId ?? 'Inapakia...',
                                style: orbitron(18).copyWith(color: t.text, letterSpacing: 0.6),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (_userId != null && _userId!.isNotEmpty) ...[
                              const SizedBox(width: 8),
                              Icon(Ionicons.copy_outline, size: 18, color: t.text2),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    decoration: BoxDecoration(
                      color: isPremium ? t.gold.withValues(alpha: 0.15) : t.card,
                      borderRadius: BorderRadius.circular(100),
                      border: Border.all(color: isPremium ? t.gold.withValues(alpha: 0.4) : t.border),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(isPremium ? Ionicons.star : Ionicons.person_outline, size: 16, color: isPremium ? t.gold : t.text2),
                        const SizedBox(width: 8),
                        Text(
                          isPremium ? 'Premium User' : 'Free User',
                          style: rajdhani(14, weight: FontWeight.w600).copyWith(color: isPremium ? t.gold : t.text2),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            if (_subscriptionTimeActive)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SubscriptionRemainCard(
                  accent: t.accent,
                  remain: _remain,
                  subEnd: widget.subscriptionEndDate,
                ),
              )
            else ...[
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: _MenuTile(
                  t: t,
                  g: [t.accent, t.accent2],
                  icon: Ionicons.key_outline,
                  title: 'Fungua Channel zote',
                  subtitle: 'Chagua vifurushi vya Premium',
                  onTap: widget.onOpenPayments,
                ),
              ),
              const SizedBox(height: 10),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: _MenuTile(
                  t: t,
                  g: [t.free, const Color(0xFF34d399)],
                  icon: Ionicons.play_circle_outline,
                  title: 'Kusanya Point',
                  subtitle: 'Tazama tangazo',
                  onTap: widget.onWatchAd != null ? _onKusanyaPoint : null,
                ),
              ),
            ],
            const SizedBox(height: 10),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: _MenuTile(
                t: t,
                g: [t.accent, t.accent2],
                icon: Ionicons.settings_outline,
                title: 'Settings',
                subtitle: 'Themes, preferences',
                onTap: widget.onOpenSettings,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MenuTile extends StatelessWidget {
  const _MenuTile({
    required this.t,
    required this.g,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  final AppThemeColors t;
  final List<Color> g;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: t.card,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: t.border)),
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        onTap: onTap,
        leading: Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), gradient: LinearGradient(colors: g)),
          alignment: Alignment.center,
          child: Icon(icon, size: 18, color: Colors.black),
        ),
        title: Text(title, style: rajdhani(15, weight: FontWeight.w600).copyWith(color: t.text)),
        subtitle: Text(subtitle, style: rajdhani(12).copyWith(color: t.text2)),
        trailing: Text('›', style: TextStyle(color: t.text2, fontSize: 20)),
      ),
    );
  }
}

class _SubscriptionRemainCard extends StatelessWidget {
  const _SubscriptionRemainCard({
    required this.accent,
    required this.remain,
    required this.subEnd,
  });

  final Color accent;
  final Duration remain;
  final DateTime? subEnd;

  @override
  Widget build(BuildContext context) {
    final d = remain.inDays;
    final h = remain.inHours % 24;
    final m = remain.inMinutes % 60;
    final s = remain.inSeconds % 60;
    final fmt = subEnd != null ? DateFormat.yMMMMd().format(subEnd!) : '';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(22, 22, 22, 20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            const Color(0xFF1E293B),
            const Color(0xFF0F172A).withValues(alpha: 0.95),
          ],
        ),
        border: Border.all(color: AppColors.gold.withValues(alpha: 0.35)),
        boxShadow: [
          BoxShadow(color: AppColors.gold.withValues(alpha: 0.08), blurRadius: 24, spreadRadius: 0),
          BoxShadow(color: Colors.black.withValues(alpha: 0.35), blurRadius: 20, offset: const Offset(0, 12)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.gold.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(Icons.schedule_rounded, size: 22, color: accent),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'Muda uliobaki',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                    decoration: TextDecoration.none,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _CdUnit(accent: accent, v: '$d', l: 'Siku'),
                _Sep(accent: accent),
                _CdUnit(accent: accent, v: h.toString().padLeft(2, '0'), l: 'Masaa'),
                _Sep(accent: accent),
                _CdUnit(accent: accent, v: m.toString().padLeft(2, '0'), l: 'Dakika'),
                _Sep(accent: accent),
                _CdUnit(accent: accent, v: s.toString().padLeft(2, '0'), l: 'Sekunde'),
              ],
            ),
          ),
          if (fmt.isNotEmpty) ...[
            const SizedBox(height: 18),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
              ),
              child: Text(
                'Inaisha tarehe: $fmt',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 14, color: AppColors.muted, decoration: TextDecoration.none),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Sep extends StatelessWidget {
  const _Sep({required this.accent});
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Text(':', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: accent, height: 1)),
    );
  }
}

class _CdUnit extends StatelessWidget {
  const _CdUnit({required this.accent, required this.v, required this.l});
  final Color accent;
  final String v;
  final String l;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: Column(
        children: [
          Text(v, style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: accent, decoration: TextDecoration.none)),
          const SizedBox(height: 4),
          Text(l, style: const TextStyle(fontSize: 11, color: AppColors.muted, decoration: TextDecoration.none)),
        ],
      ),
    );
  }
}
