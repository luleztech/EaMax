import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import '../config/payment_helpers.dart';
import '../services/remote_config_service.dart';
import '../widgets/template_ui.dart';
import 'combined_home.dart';

/// Template shell: Home / Channels / (Ratiba) / Plans / Mtumiaji.
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
    required this.onPaymentSuccess,
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
  final PremiumUnlockCallback onPaymentSuccess;
  final Future<void> Function() syncPremiumSetting;
  final bool refreshing;
  final ValueChanged<bool>? onRefreshingChange;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: RemoteConfigService.configVersion,
      builder: (context, _, _) => _buildShell(context),
    );
  }

  Widget _buildShell(BuildContext context) {
    final nav = context.watch<AppNav>();
    final items = [
      (AppNav.home, 'Home', TplIconName.home),
      (AppNav.channels, 'Channels', TplIconName.tv),
      if (RemoteConfigService.ratibaTabEnabled) (AppNav.ratiba, 'Ratiba', TplIconName.calendar),
      if (RemoteConfigService.paymentsEnabled) (AppNav.plans, 'Malipo', TplIconName.card),
      (AppNav.profile, 'Mtumiaji', TplIconName.user),
    ];

    return Scaffold(
      backgroundColor: Tpl.slate950,
      extendBody: true,
      body: Stack(
        children: [
          Positioned.fill(
            child: CombinedHome(
              key: homeKey,
              isPremium: isPremium,
              subscriptionEndDate: subscriptionEndDate,
              channelsPremiumOnly: channelsPremiumOnly,
              userPoints: userPoints,
              onWatchAd: onWatchAd,
              onPointsRefresh: onPointsRefresh,
              onPaymentSuccess: onPaymentSuccess,
              onPaymentsActiveChange: (_) {},
              syncPremiumSetting: syncPremiumSetting,
              externalTabIndex: nav.currentTab,
              onRefreshingChange: onRefreshingChange,
            ),
          ),
          if (refreshing)
            const Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: LinearProgressIndicator(minHeight: 2, backgroundColor: Colors.transparent, color: Tpl.lime400),
            ),
        ],
      ),
      bottomNavigationBar: ClipRect(
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
          child: Container(
            decoration: BoxDecoration(
              color: Tpl.slate950.withValues(alpha: 0.95),
              border: Border(top: BorderSide(color: Tpl.hairline(0.06))),
            ),
            padding: EdgeInsets.fromLTRB(
              12,
              8,
              12,
              MediaQuery.paddingOf(context).bottom.clamp(12.0, double.infinity),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                for (final item in items)
                  _TabButton(
                    label: item.$2,
                    icon: item.$3,
                    selected: nav.currentTab == item.$1,
                    onTap: () => context.read<AppNav>().setTab(item.$1),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TabButton extends StatelessWidget {
  const _TabButton({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final TplIconName icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? Tpl.lime400 : Tpl.slate500;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minWidth: 64),
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Stack(
          clipBehavior: Clip.none,
          alignment: Alignment.topCenter,
          children: [
            Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TplIcon(icon, color: color),
                const SizedBox(height: 6),
                Text(label, style: manrope(10, weight: FontWeight.w700, color: color)),
              ],
            ),
            Positioned(
              top: -16,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                width: selected ? 24 : 0,
                height: 2,
                decoration: BoxDecoration(color: Tpl.lime400, borderRadius: BorderRadius.circular(999)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
