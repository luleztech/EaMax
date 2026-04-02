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
  });

  final Color accentColor;
  final double bottomPadding;
  final int userPoints;
  final VoidCallback? onWatchAd;
  final Future<void> Function()? onPointsRefresh;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  String? _userId;
  bool _premium = false;
  int _points = 0;
  bool _loading = true;
  DateTime? _subEnd;
  Duration _remain = Duration.zero;
  Timer? _countdownTimer;

  @override
  void initState() {
    super.initState();
    _points = widget.userPoints;
    _load(true);
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant ProfileScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.userPoints != oldWidget.userPoints) {
      _points = widget.userPoints;
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
      setState(() {
        _premium = userData['isPremium'] == true;
        _points = (userData['points'] as num?)?.toInt() ?? 0;
        final end = userData['subscriptionEndDate']?.toString();
        if (_premium && end != null) {
          _subEnd = DateTime.tryParse(end);
        } else {
          _subEnd = null;
        }
      });
      _countdownTimer?.cancel();
      if (_premium && _subEnd != null) {
        _tick();
        _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
      }
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  void _tick() {
    if (!_premium || _subEnd == null) return;
    final diff = _subEnd!.difference(DateTime.now());
    if (mounted) setState(() => _remain = diff.isNegative ? Duration.zero : diff);
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
    final bottom = 100.0 + widget.bottomPadding;

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
                    const SizedBox(height: 16),
                    Center(
                      child: Container(
                        width: 100,
                        height: 100,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: ac.withValues(alpha: 0.12),
                          border: Border.all(color: const Color(0x4D22C55E), width: 3),
                        ),
                        child: Icon(Icons.person, size: 48, color: ac),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      _userId ?? '...',
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white, letterSpacing: 1),
                    ),
                    const SizedBox(height: 12),
                    Center(
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        decoration: BoxDecoration(
                          color: _premium ? const Color(0x33FBBF24) : const Color(0x339CA3AF),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: _premium ? const Color(0x66FBBF24) : const Color(0x669CA3AF)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(_premium ? Icons.workspace_premium : Icons.account_circle, size: 16, color: _premium ? AppColors.gold : AppColors.muted),
                            const SizedBox(width: 8),
                            Text(
                              _premium ? 'Premium User' : 'Free User',
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                                color: _premium ? AppColors.gold : AppColors.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 24),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: const Color(0x801F2937),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0x80374151)),
                        ),
                        child: _premium
                            ? _PremiumCountdown(
                                accent: ac,
                                remain: _remain,
                                subEnd: _subEnd,
                              )
                            : _PointsSection(
                                points: _points,
                                onWatchAd: widget.onWatchAd == null
                                    ? null
                                    : () {
                                        widget.onWatchAd?.call();
                                        Future.delayed(const Duration(milliseconds: 7500), () => _load(false));
                                        Future.delayed(const Duration(milliseconds: 10000), () => _load(false));
                                        Future.delayed(const Duration(milliseconds: 12000), () => _load(false));
                                      },
                              ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Row(
                        children: [
                          Expanded(child: _StatCard(icon: Icons.history, accent: ac, label: 'Historia ya Kutazama', value: '0')),
                          const SizedBox(width: 12),
                          Expanded(child: _StatCard(icon: Icons.download, accent: ac, label: 'Vilivyopakuliwa', value: '0')),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: const Color(0x801F2937),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0x80374151)),
                        ),
                        child: Column(
                          children: [
                            _DetailRow(
                              icon: Icons.calendar_today,
                              label: 'Tarehe ya Kujiunga:',
                              value: DateFormat.yMMMMd().format(DateTime.now()),
                            ),
                            const SizedBox(height: 16),
                            _DetailRow(
                              icon: Icons.verified_user,
                              label: 'Hali ya Akaunti:',
                              value: _premium ? 'Premium' : 'Bure',
                              valueColor: _premium ? AppColors.gold : Colors.white,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PremiumCountdown extends StatelessWidget {
  const _PremiumCountdown({
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

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.schedule, size: 20, color: accent),
            const SizedBox(width: 8),
            const Text('Muda uliobaki ni', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white)),
          ],
        ),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _Cd(accent: accent, v: '$d', l: 'Siku'),
            Text(':', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: accent, height: 0.8)),
            _Cd(accent: accent, v: h.toString().padLeft(2, '0'), l: 'Masaa'),
            Text(':', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: accent, height: 0.8)),
            _Cd(accent: accent, v: m.toString().padLeft(2, '0'), l: 'Dakika'),
            Text(':', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: accent, height: 0.8)),
            _Cd(accent: accent, v: s.toString().padLeft(2, '0'), l: 'Sekunde'),
          ],
        ),
        const SizedBox(height: 16),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0x1A22C55E),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0x3322C55E)),
          ),
          child: Column(
            children: [
              const Text(
                'Muda wa matumizi ulio salia kwa mteja wa malipo',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, color: Color(0xFFD1D5DB), height: 1.4),
              ),
              if (fmt.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text('Inaisha tarehe: $fmt', textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, color: AppColors.muted)),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _Cd extends StatelessWidget {
  const _Cd({required this.accent, required this.v, required this.l});
  final Color accent;
  final String v;
  final String l;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: Column(
        children: [
          Text(v, style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: accent)),
          Text(l, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
        ],
      ),
    );
  }
}

class _PointsSection extends StatelessWidget {
  const _PointsSection({required this.points, this.onWatchAd});
  final int points;
  final VoidCallback? onWatchAd;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.star, size: 20, color: AppColors.gold),
            const SizedBox(width: 8),
            const Expanded(child: Text('Jumla ya Points', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white))),
            if (onWatchAd != null)
              Material(
                borderRadius: BorderRadius.circular(20),
                color: Colors.transparent,
                child: InkWell(
                  onTap: onWatchAd,
                  borderRadius: BorderRadius.circular(20),
                  child: Ink(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      gradient: const LinearGradient(colors: [Color(0xFF22C55E), Color(0xFF16A34A)]),
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.add, color: Colors.white, size: 16),
                        SizedBox(width: 6),
                        Text('Vuna Points', style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w700)),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 16),
        Center(
          child: Column(
            children: [
              Container(
                width: 120,
                height: 120,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0x1AFBBF24),
                  border: Border.all(color: const Color(0x4DFBBF24), width: 3),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.star, color: AppColors.gold, size: 32),
                    const SizedBox(height: 8),
                    Text('$points', style: const TextStyle(fontSize: 36, fontWeight: FontWeight.bold, color: AppColors.gold)),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              const Text('Points Zilizokusanywa', style: TextStyle(fontSize: 14, color: AppColors.muted)),
            ],
          ),
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.icon, required this.accent, required this.label, required this.value});
  final IconData icon;
  final Color accent;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0x801F2937),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0x80374151)),
      ),
      child: Column(
        children: [
          Icon(icon, size: 24, color: accent),
          const SizedBox(height: 8),
          Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white)),
          const SizedBox(height: 4),
          Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.icon, required this.label, required this.value, this.valueColor});
  final IconData icon;
  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 20, color: AppColors.muted),
        const SizedBox(width: 12),
        Expanded(child: Text(label, style: const TextStyle(fontSize: 14, color: AppColors.muted))),
        Text(value, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: valueColor ?? Colors.white)),
      ],
    );
  }
}
