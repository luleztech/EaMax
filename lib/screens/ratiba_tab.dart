import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../theme/ionicons_compat.dart';
import 'package:provider/provider.dart';

import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import '../widgets/pro_shimmer.dart';

/// Upcoming matches schedule (Ratiba) — Supasoka-styled pro list.
class RatibaTab extends StatelessWidget {
  const RatibaTab({
    super.key,
    required this.matches,
    required this.initialLoading,
    required this.refreshing,
    required this.bottomPad,
    required this.onRefresh,
    required this.isPremium,
    required this.channelsPremiumOnly,
  });

  final List<dynamic> matches;
  final bool initialLoading;
  final bool refreshing;
  final double bottomPad;
  final Future<void> Function() onRefresh;
  final bool isPremium;
  final bool channelsPremiumOnly;

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;

    return ColoredBox(
      color: t.bg1,
      child: RefreshIndicator(
        color: t.accent,
        onRefresh: onRefresh,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 8, 18, 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(text: 'RATIBA ', style: orbitron(14, weight: FontWeight.w800).copyWith(color: t.text)),
                          TextSpan(text: 'YA MICHEZO', style: orbitron(14, weight: FontWeight.w800).copyWith(color: t.accent)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (refreshing && matches.isEmpty)
              SliverPadding(
                padding: EdgeInsets.fromLTRB(16, 8, 16, bottomPad),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (_, __) => const Padding(
                      padding: EdgeInsets.only(bottom: 10),
                      child: ShimmerBox(height: 108, radius: 16),
                    ),
                    childCount: 5,
                  ),
                ),
              )
            else if (matches.isEmpty)
              SliverFillRemaining(
                hasScrollBody: false,
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Ionicons.calendar_outline, size: 48, color: t.border),
                        const SizedBox(height: 14),
                        Text(
                          'Hakuna mechi zilizopangwa',
                          textAlign: TextAlign.center,
                          style: rajdhani(15, weight: FontWeight.w600).copyWith(color: t.text2),
                        ),
                      ],
                    ),
                  ),
                ),
              )
            else
              SliverPadding(
                padding: EdgeInsets.fromLTRB(16, 8, 16, bottomPad),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, i) {
                      final m = Map<String, dynamic>.from(matches[i] as Map);
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: _RatibaMatchCard(
                          match: m,
                          isPremium: isPremium,
                          channelsPremiumOnly: channelsPremiumOnly,
                        ),
                      );
                    },
                    childCount: matches.length,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _RatibaMatchCard extends StatelessWidget {
  const _RatibaMatchCard({
    required this.match,
    required this.isPremium,
    required this.channelsPremiumOnly,
  });

  final Map<String, dynamic> match;
  final bool isPremium;
  final bool channelsPremiumOnly;

  String _formatTime(dynamic raw) {
    if (raw == null) return '—';
    try {
      final dt = DateTime.parse(raw.toString()).toLocal();
      return DateFormat('EEE, d MMM · HH:mm').format(dt);
    } catch (_) {
      return raw.toString();
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    final league = match['league']?.toString() ?? 'Ligi';
    final team1 = match['team1']?.toString() ?? '—';
    final team2 = match['team2']?.toString() ?? '—';
    final pts = (match['points_required'] as num?)?.toInt() ?? 0;
    final timeStr = _formatTime(match['match_time']);
    final needsPoints = !channelsPremiumOnly && pts > 0 && !isPremium;

    return Material(
      color: t.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: t.border.withValues(alpha: 0.65)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [t.card, t.card.withValues(alpha: 0.92), t.bg2.withValues(alpha: 0.35)],
          ),
        ),
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: t.accent.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: t.accent.withValues(alpha: 0.35)),
                  ),
                  child: Text(
                    league.toUpperCase(),
                    style: orbitron(8, weight: FontWeight.w900).copyWith(color: t.accent, letterSpacing: 1),
                  ),
                ),
                const Spacer(),
                if (needsPoints)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: t.gold.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(99),
                      border: Border.all(color: t.gold.withValues(alpha: 0.4)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Ionicons.star, size: 11, color: t.gold),
                        const SizedBox(width: 4),
                        Text('$pts pts', style: rajdhani(10, weight: FontWeight.w700).copyWith(color: t.gold)),
                      ],
                    ),
                  )
                else
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: t.free.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(99),
                    ),
                    child: Text('Bure', style: rajdhani(10, weight: FontWeight.w700).copyWith(color: t.free)),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: Text(
                    team1.toUpperCase(),
                    textAlign: TextAlign.end,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: orbitron(13, weight: FontWeight.w800).copyWith(color: t.text, height: 1.1),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: t.bg1,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: t.border),
                    ),
                    child: Text('VS', style: orbitron(11, weight: FontWeight.w900).copyWith(color: t.accent2)),
                  ),
                ),
                Expanded(
                  child: Text(
                    team2.toUpperCase(),
                    textAlign: TextAlign.start,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: orbitron(13, weight: FontWeight.w800).copyWith(color: t.text, height: 1.1),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: t.bg1.withValues(alpha: 0.65),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: t.border.withValues(alpha: 0.5)),
              ),
              child: Row(
                children: [
                  Icon(Ionicons.time_outline, size: 16, color: t.accent),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(timeStr, style: rajdhani(13, weight: FontWeight.w600).copyWith(color: t.text)),
                  ),
                  Icon(Ionicons.chevron_forward, size: 16, color: t.text2),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
