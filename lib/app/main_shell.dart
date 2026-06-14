import 'dart:ui';

import 'package:flutter/material.dart';
import '../theme/ionicons_compat.dart';
import 'package:provider/provider.dart';

import '../theme/app_theme.dart';
import 'combined_home.dart';

/// Supasoka-style 5-tab shell with frosted bottom navigation.
class MainShell extends StatelessWidget {
  const MainShell({
    super.key,
    required this.homeKey,
    required this.isPremium,
    required this.subscriptionEndDate,
    required this.channelsPremiumOnly,
    required this.userPoints,
    required this.onWatchAd,
    required this.onPointsRefresh,
    required this.syncPremiumSetting,
    this.refreshing = false,
    this.onRefreshingChange,
  });

  final GlobalKey<CombinedHomeState> homeKey;
  final bool isPremium;
  final DateTime? subscriptionEndDate;
  final bool channelsPremiumOnly;
  final int userPoints;
  final VoidCallback onWatchAd;
  final Future<void> Function() onPointsRefresh;
  final Future<void> Function() syncPremiumSetting;
  final bool refreshing;
  final ValueChanged<bool>? onRefreshingChange;

  @override
  Widget build(BuildContext context) {
    final nav = context.watch<AppNav>();
    final t = context.watch<ThemeController>().colors;
    final bottom = MediaQuery.paddingOf(context).bottom;

    return Scaffold(
      backgroundColor: t.bg1,
      body: Column(
        children: [
          if (refreshing)
            LinearProgressIndicator(
              minHeight: 2,
              backgroundColor: t.border.withValues(alpha: 0.35),
              color: t.accent,
            ),
          Expanded(
            child: CombinedHome(
              key: homeKey,
              isPremium: isPremium,
              subscriptionEndDate: subscriptionEndDate,
              channelsPremiumOnly: channelsPremiumOnly,
              userPoints: userPoints,
              onWatchAd: onWatchAd,
              onPointsRefresh: onPointsRefresh,
              onPaymentsActiveChange: (_) {},
              syncPremiumSetting: syncPremiumSetting,
              externalTabIndex: nav.currentTab,
              onRefreshingChange: onRefreshingChange,
            ),
          ),
        ],
      ),
      bottomNavigationBar: Padding(
        padding: EdgeInsets.fromLTRB(12, 0, 12, bottom + 10),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(24),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(24),
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    const Color(0xFF0B0D12).withValues(alpha: 0.92),
                    const Color(0xFF131722).withValues(alpha: 0.88),
                  ],
                ),
                border: Border.all(color: t.border.withValues(alpha: 0.55)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.40),
                    blurRadius: 20,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              padding: const EdgeInsets.all(8),
              child: Row(
                children: [
                  _TabButton(i: 0, label: 'Home', outline: Ionicons.home_outline, solid: Ionicons.home, selected: nav.currentTab == 0),
                  _TabButton(i: 1, label: 'Ratiba', outline: Ionicons.calendar_outline, solid: Ionicons.calendar, selected: nav.currentTab == 1),
                  _TabButton(i: 2, label: 'Channels', outline: Ionicons.tv_outline, solid: Ionicons.tv, selected: nav.currentTab == 2),
                  _TabButton(i: 3, label: 'Fungua zote', outline: Ionicons.key_outline, solid: Ionicons.key, selected: nav.currentTab == 3),
                  _TabButton(i: 4, label: 'Mtumiaji', outline: Ionicons.person_outline, solid: Ionicons.person, selected: nav.currentTab == 4),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TabButton extends StatelessWidget {
  const _TabButton({
    required this.i,
    required this.label,
    required this.outline,
    required this.solid,
    required this.selected,
  });

  final int i;
  final String label;
  final IconData outline;
  final IconData solid;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    final icon = selected ? solid : outline;
    final active = t.accent;
    const activeIcon = Colors.white;
    const idle = Color(0xFF71717a);
    final activeText = Color.lerp(const Color(0xFFD9FEE7), Colors.white, 0.35)!;

    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => context.read<AppNav>().setTab(i),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 260),
          curve: Curves.easeOutCubic,
          margin: const EdgeInsets.symmetric(horizontal: 2),
          padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 2),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            gradient: selected
                ? LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [active.withValues(alpha: 0.22), active.withValues(alpha: 0.10)],
                  )
                : null,
            border: Border.all(color: selected ? active.withValues(alpha: 0.35) : Colors.transparent),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: active.withValues(alpha: 0.26),
                      blurRadius: 16,
                      spreadRadius: -5,
                      offset: const Offset(0, 8),
                    ),
                  ]
                : null,
          ),
          child: AnimatedScale(
            scale: selected ? 1.04 : 1,
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 21, color: selected ? activeIcon : idle),
                const SizedBox(height: 4),
                Text(
                  label.toUpperCase(),
                  maxLines: 1,
                  textAlign: TextAlign.center,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: label.length > 10 ? 8.5 : 10,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.35,
                    height: 1.1,
                    color: selected ? activeText : idle,
                  ),
                ),
                const SizedBox(height: 3),
                AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  width: selected ? 16 : 0,
                  height: 2.2,
                  decoration: BoxDecoration(color: active, borderRadius: BorderRadius.circular(99)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
