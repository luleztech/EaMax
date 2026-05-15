import 'package:flutter/material.dart';
import 'package:ionicons/ionicons.dart';
import 'package:provider/provider.dart';

import '../theme/app_theme.dart';
import '../theme/app_typography.dart';

class AppHeader extends StatelessWidget {
  const AppHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.logoLetter = 'E',
    this.onSettings,
    this.onSearch,
    this.rightSlot,
    this.leftSlot,
  });

  final String title;
  final String? subtitle;
  final String logoLetter;
  final VoidCallback? onSettings;
  final VoidCallback? onSearch;
  final Widget? rightSlot;
  final Widget? leftSlot;

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    final top = MediaQuery.paddingOf(context).top;

    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Colors.black.withValues(alpha: 0.88),
            Colors.black.withValues(alpha: 0.35),
            Colors.transparent,
          ],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(height: top + 8),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                if (leftSlot != null) ...[leftSlot!, const SizedBox(width: 10)],
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(color: t.accent, borderRadius: BorderRadius.circular(8)),
                  alignment: Alignment.center,
                  child: Text(
                    logoLetter,
                    style: inter(18, weight: FontWeight.w900).copyWith(
                      color: Colors.white,
                      fontStyle: FontStyle.italic,
                      height: 1,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title.toUpperCase(),
                        style: inter(21, weight: FontWeight.w900).copyWith(
                          color: t.accent,
                          letterSpacing: -1,
                          height: 1.05,
                        ),
                      ),
                      if (subtitle != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          subtitle!,
                          style: rajdhani(10, weight: FontWeight.w700).copyWith(
                            color: const Color(0xFFa1a1aa),
                            letterSpacing: 2,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                if (rightSlot != null) rightSlot!,
                if (onSettings != null)
                  _IconBtn(
                    onTap: onSettings!,
                    child: const Icon(Ionicons.settings_outline, size: 18, color: Color(0xFFd4d4d8)),
                  ),
                if (onSearch != null)
                  Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: _IconBtn(
                      onTap: onSearch!,
                      child: const Icon(Ionicons.search_outline, size: 18, color: Color(0xFFd4d4d8)),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _IconBtn extends StatelessWidget {
  const _IconBtn({required this.onTap, required this.child});
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    return Material(
      color: const Color(0xCC18181b),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: t.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(width: 38, height: 38, child: Center(child: child)),
      ),
    );
  }
}

class BackBtn extends StatelessWidget {
  const BackBtn({super.key, required this.onPress});
  final VoidCallback onPress;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xCC18181b),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPress,
        child: const SizedBox(
          width: 36,
          height: 36,
          child: Center(
            child: Text('‹', style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w600)),
          ),
        ),
      ),
    );
  }
}
