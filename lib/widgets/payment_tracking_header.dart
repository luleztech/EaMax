import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../theme/app_theme.dart';
import '../theme/app_typography.dart';

/// Compact home-screen header shown while payment tracking is active.
class PaymentTrackingHeader extends StatefulWidget {
  const PaymentTrackingHeader({
    super.key,
    required this.title,
    required this.isPolling,
    required this.onRefresh,
    required this.onClose,
  });

  final String title;
  final bool isPolling;
  final VoidCallback onRefresh;
  final VoidCallback onClose;

  @override
  State<PaymentTrackingHeader> createState() => _PaymentTrackingHeaderState();
}

class _PaymentTrackingHeaderState extends State<PaymentTrackingHeader>
    with SingleTickerProviderStateMixin {
  late final AnimationController _spinCtrl;

  @override
  void initState() {
    super.initState();
    _spinCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))
      ..repeat();
  }

  @override
  void dispose() {
    _spinCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    final top = MediaQuery.paddingOf(context).top;
    final accent = t.accent;

    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            const Color(0xFF0F172A).withValues(alpha: 0.98),
            const Color(0xFF1E293B).withValues(alpha: 0.94),
          ],
        ),
        border: Border(
          bottom: BorderSide(color: accent.withValues(alpha: 0.35), width: 1),
        ),
        boxShadow: [
          BoxShadow(
            color: accent.withValues(alpha: 0.12),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        children: [
          SizedBox(height: top + 6),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 10, 10),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      colors: [accent.withValues(alpha: 0.35), accent.withValues(alpha: 0.12)],
                    ),
                    border: Border.all(color: accent.withValues(alpha: 0.45)),
                  ),
                  child: Icon(Icons.payments_rounded, size: 17, color: accent),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: rajdhani(15, weight: FontWeight.w700).copyWith(
                          color: Colors.white,
                          letterSpacing: 0.2,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Container(
                            width: 6,
                            height: 6,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: widget.isPolling ? accent : const Color(0xFF22C55E),
                              boxShadow: widget.isPolling
                                  ? [BoxShadow(color: accent.withValues(alpha: 0.6), blurRadius: 6)]
                                  : null,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            widget.isPolling ? 'LIVE' : 'INASUBIRI',
                            style: rajdhani(9, weight: FontWeight.w700).copyWith(
                              color: accent,
                              letterSpacing: 1.3,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                _HeaderIconBtn(
                  onTap: () {
                    HapticFeedback.lightImpact();
                    widget.onRefresh();
                  },
                  child: widget.isPolling
                      ? RotationTransition(
                          turns: _spinCtrl,
                          child: Icon(Icons.refresh_rounded, size: 20, color: accent),
                        )
                      : Icon(Icons.refresh_rounded, size: 20, color: accent),
                ),
                const SizedBox(width: 6),
                _HeaderIconBtn(
                  onTap: () {
                    HapticFeedback.lightImpact();
                    widget.onClose();
                  },
                  child: Icon(Icons.close_rounded, size: 20, color: t.text2),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HeaderIconBtn extends StatelessWidget {
  const _HeaderIconBtn({required this.onTap, required this.child});

  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    return Material(
      color: Colors.white.withValues(alpha: 0.06),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(11),
        side: BorderSide(color: t.border.withValues(alpha: 0.5)),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(width: 36, height: 36, child: Center(child: child)),
      ),
    );
  }
}
