import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../config/api.dart';
import '../services/user_id.dart';
import '../theme/app_theme.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    super.key,
    this.accentColor = AppColors.accentBlue,
    this.bottomPadding = 0,
    this.userPoints = 0,
    this.onWatchAd,
    this.onPointsRefresh,
    this.onOpenPayments,
  });

  final Color accentColor;
  final double bottomPadding;
  final int userPoints;
  final VoidCallback? onWatchAd;
  final Future<void> Function()? onPointsRefresh;
  final VoidCallback? onOpenPayments;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  String? _userId;
  bool _premium = false;
  bool _loading = true;
  DateTime? _subEnd;
  Duration _remain = Duration.zero;
  Timer? _countdownTimer;

  bool get _subscriptionTimeActive =>
      _premium && _subEnd != null && _subEnd!.isAfter(DateTime.now());

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load(true);
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
      _load(false);
    }
  }

  Future<void> _load(bool showLoading) async {
    if (showLoading) setState(() => _loading = true);
    try {
      final id = await getOrCreateUserId();
      if (id == null) {
        if (mounted) setState(() => _loading = false);
        return;
      }
      setState(() => _userId = id);
      final userData = await userApi.getUser(id);
      if (!mounted) return;
      final end = userData['subscriptionEndDate']?.toString();
      final blocked = userData['blocked'] == true;
      setState(() {
        _premium = !blocked && userData['isPremium'] == true;
        _subEnd =
            blocked ? null : ((end != null && end.isNotEmpty) ? DateTime.tryParse(end) : null);
      });
      _countdownTimer?.cancel();
      if (_subscriptionTimeActive) {
        _tick();
        _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
      } else {
        if (mounted) setState(() => _remain = Duration.zero);
      }
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  void _tick() {
    if (_subEnd == null || !_premium) return;
    final diff = _subEnd!.difference(DateTime.now());
    if (diff.isNegative || diff.inSeconds <= 0) {
      _countdownTimer?.cancel();
      _countdownTimer = null;
      if (mounted) setState(() => _remain = Duration.zero);
      _load(false);
      return;
    }
    if (mounted) setState(() => _remain = diff);
  }

  void _onKusanyaPoint() {
    widget.onWatchAd?.call();
    Future.delayed(const Duration(milliseconds: 7500), () => _load(false));
    Future.delayed(const Duration(milliseconds: 10000), () => _load(false));
    Future.delayed(const Duration(milliseconds: 12000), () => _load(false));
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Container(
        color: AppColors.scaffold,
        child: Stack(
          children: [
            const Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFF030712), Color(0xFF111827), Color(0xFF000000)],
                  ),
                ),
              ),
            ),
            Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(color: widget.accentColor),
                  const SizedBox(height: 16),
                  Text('Loading profile...', style: TextStyle(color: Colors.blueGrey.shade400, fontSize: 16)),
                ],
              ),
            ),
          ],
        ),
      );
    }

    final ac = widget.accentColor;
    final bottom = 32.0 + widget.bottomPadding;

    return Container(
      color: AppColors.scaffold,
      child: Stack(
        children: [
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFF030712), Color(0xFF111827), Color(0xFF000000)],
                ),
              ),
            ),
          ),
          SafeArea(
            top: true,
            bottom: false,
            child: RefreshIndicator(
              color: ac,
              onRefresh: () async {
                await widget.onPointsRefresh?.call();
                await _load(false);
              },
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: EdgeInsets.only(bottom: bottom),
                children: [
                  const SizedBox(height: 20),
                  Center(
                    child: Container(
                      width: 100,
                      height: 100,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: ac.withValues(alpha: 0.12),
                        border: Border.all(color: const Color(0x4D22C55E), width: 3),
                        boxShadow: [
                          BoxShadow(
                            color: ac.withValues(alpha: 0.2),
                            blurRadius: 24,
                            spreadRadius: 0,
                          ),
                        ],
                      ),
                      child: Icon(Icons.person_rounded, size: 48, color: ac),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    _userId ?? '...',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                      letterSpacing: 0.8,
                      decoration: TextDecoration.none,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: _premium ? const Color(0x33FBBF24) : const Color(0x339CA3AF),
                        borderRadius: BorderRadius.circular(100),
                        border: Border.all(color: _premium ? const Color(0x66FBBF24) : const Color(0x669CA3AF)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            _premium ? Icons.workspace_premium_rounded : Icons.person_outline_rounded,
                            size: 18,
                            color: _premium ? AppColors.gold : AppColors.muted,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            _premium ? 'Premium User' : 'Free User',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: _premium ? AppColors.gold : AppColors.muted,
                              decoration: TextDecoration.none,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 28),
                  if (_subscriptionTimeActive)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: _SubscriptionRemainCard(
                        accent: ac,
                        remain: _remain,
                        subEnd: _subEnd,
                      ),
                    )
                  else ...[
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: _ProfileActionTile(
                        leading: Container(
                          width: 52,
                          height: 52,
                          decoration: BoxDecoration(
                            color: ac.withValues(alpha: 0.18),
                            borderRadius: BorderRadius.circular(18),
                          ),
                          child: Icon(Icons.lock_open_rounded, color: ac, size: 26),
                        ),
                        title: 'Fungua Channel zote',
                        subtitle: 'Chagua michango na huduma za Premium',
                        onTap: widget.onOpenPayments,
                      ),
                    ),
                    const SizedBox(height: 14),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: _ProfileActionTile(
                        leading: const _GreenPlusBadge(),
                        title: 'Kusanya Point',
                        subtitle: 'Tazama tangazo ufunge Point',
                        onTap: widget.onWatchAd != null ? _onKusanyaPoint : null,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
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

class _ProfileActionTile extends StatelessWidget {
  const _ProfileActionTile({
    required this.leading,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  final Widget leading;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(26),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(26),
            color: const Color(0x801F2937),
            border: Border.all(color: const Color(0x80374151)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.2),
                blurRadius: 16,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
            child: Row(
              children: [
                leading,
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: enabled ? Colors.white : Colors.white54,
                          decoration: TextDecoration.none,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        subtitle,
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.muted,
                          height: 1.25,
                          decoration: TextDecoration.none,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.chevron_right_rounded,
                  color: enabled ? AppColors.muted : Colors.white.withValues(alpha: 0.2),
                  size: 26,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _GreenPlusBadge extends StatelessWidget {
  const _GreenPlusBadge();

  static const _green = Color(0xFF22C55E);

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 52,
      height: 52,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: const Color(0x1A22C55E),
        border: Border.all(color: _green, width: 3),
        boxShadow: [
          BoxShadow(color: _green.withValues(alpha: 0.35), blurRadius: 12, spreadRadius: 0),
        ],
      ),
      child: const Center(
        child: Icon(Icons.add_rounded, color: _green, size: 28),
      ),
    );
  }
}
