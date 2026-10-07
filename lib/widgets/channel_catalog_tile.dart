import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/channel_ui.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import '../theme/ionicons_compat.dart';
import 'safe_network_image.dart';

/// Compact TV-guide tile: logo fills the card, name sits underneath.
/// Designed for dense vertical catalogs (no horizontal nested scroll).
class ChannelCatalogTile extends StatefulWidget {
  const ChannelCatalogTile({
    super.key,
    required this.channel,
    required this.badge,
    required this.onPress,
    this.isLoading = false,
    this.accent,
    this.expanded = false,
  });

  final ChannelUi channel;
  final ChannelBadgeUi badge;
  final VoidCallback onPress;
  final bool isLoading;
  final Color? accent;
  /// Full-width tile (single in category / odd last row).
  final bool expanded;

  @override
  State<ChannelCatalogTile> createState() => _ChannelCatalogTileState();
}

class _ChannelCatalogTileState extends State<ChannelCatalogTile> {
  double _scale = 1;

  Color _channelColor(AppThemeColors t) {
    try {
      final h = widget.channel.color.replaceFirst('#', '');
      return Color(int.parse('FF$h', radix: 16));
    } catch (_) {
      return widget.accent ?? t.accent;
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    final ch = widget.channel;
    final accent = widget.accent ?? t.accent;
    final chColor = _channelColor(t);
    final hasThumb = (ch.thumbnailUrl ?? '').trim().isNotEmpty;

    return GestureDetector(
      onTapDown: (_) => setState(() => _scale = 0.96),
      onTapUp: (_) => setState(() => _scale = 1),
      onTapCancel: () => setState(() => _scale = 1),
      onTap: widget.isLoading ? null : widget.onPress,
      child: AnimatedScale(
        scale: _scale,
        duration: const Duration(milliseconds: 110),
        curve: Curves.easeOutCubic,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(widget.expanded ? 18 : 16),
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      t.card,
                      Color.lerp(t.card, chColor, 0.08)!,
                    ],
                  ),
                  border: Border.all(color: t.border.withValues(alpha: 0.85)),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.28),
                      blurRadius: 12,
                      offset: const Offset(0, 6),
                      spreadRadius: -4,
                    ),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(widget.expanded ? 17 : 15),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      if (hasThumb)
                        SafeNetworkImage(
                          imageUrl: ch.thumbnailUrl!,
                          fit: BoxFit.cover,
                          placeholderColor: t.card,
                        )
                      else
                        DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: [
                                chColor.withValues(alpha: 0.28),
                                t.card,
                                accent.withValues(alpha: 0.12),
                              ],
                            ),
                          ),
                          child: Center(
                            child: ch.thumbnailEmoji != null && ch.thumbnailEmoji!.isNotEmpty
                                ? Text(ch.thumbnailEmoji!, style: const TextStyle(fontSize: 28))
                                : Icon(Ionicons.tv_outline, size: 28, color: chColor.withValues(alpha: 0.85)),
                          ),
                        ),
                      // Soft vignette for badge readability
                      Positioned(
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 36,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                Colors.black.withValues(alpha: 0.45),
                                Colors.transparent,
                              ],
                            ),
                          ),
                        ),
                      ),
                      if (ch.isLive)
                        const Positioned(
                          top: 7,
                          left: 7,
                          child: _MiniLiveDot(),
                        ),
                      Positioned(
                        top: 6,
                        right: 6,
                        child: _MiniAccessBadge(badge: widget.badge, colors: t),
                      ),
                      if (widget.isLoading)
                        ColoredBox(
                          color: Colors.black.withValues(alpha: 0.45),
                          child: Center(
                            child: SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.2,
                                color: accent,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              ch.name,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: rajdhani(widget.expanded ? 13.5 : 12.5, weight: FontWeight.w700).copyWith(
                color: t.text.withValues(alpha: 0.94),
                height: 1.15,
                letterSpacing: 0.15,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MiniLiveDot extends StatelessWidget {
  const _MiniLiveDot();

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        color: t.red,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(color: t.red.withValues(alpha: 0.55), blurRadius: 6, spreadRadius: 0.5),
        ],
        border: Border.all(color: Colors.white.withValues(alpha: 0.85), width: 1.2),
      ),
    );
  }
}

class _MiniAccessBadge extends StatelessWidget {
  const _MiniAccessBadge({required this.badge, required this.colors});

  final ChannelBadgeUi badge;
  final AppThemeColors colors;

  @override
  Widget build(BuildContext context) {
    final b = badge;
    if (b.kind == ChannelBadgeKind.premiumMemberUnlocked) {
      return _chip(
        icon: Ionicons.lock_open,
        label: null,
        bg: const Color(0xE014532d),
        fg: const Color(0xFFbbf7d0),
        border: const Color(0xFF22c55e),
      );
    }
    if (b.kind == ChannelBadgeKind.lockedProChannel) {
      return _chip(
        icon: Ionicons.lock_closed,
        label: null,
        bg: Colors.black.withValues(alpha: 0.72),
        fg: colors.accent,
        border: colors.accent,
      );
    }
    if (b.label == 'Bure') {
      return _chip(
        icon: null,
        label: 'Bure',
        bg: const Color(0xE027272a),
        fg: const Color(0xFFa1a1aa),
        border: Colors.white.withValues(alpha: 0.14),
      );
    }
    return _chip(
      icon: Icons.star_rounded,
      label: b.label,
      bg: const Color(0xE027272a),
      fg: colors.accent,
      border: colors.accent.withValues(alpha: 0.4),
    );
  }

  Widget _chip({
    required IconData? icon,
    required String? label,
    required Color bg,
    required Color fg,
    required Color border,
  }) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: label == null ? 5 : 5, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: border.withValues(alpha: 0.55)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) Icon(icon, size: 10, color: fg),
          if (icon != null && label != null) const SizedBox(width: 3),
          if (label != null)
            Text(
              label,
              style: orbitron(7, weight: FontWeight.w900).copyWith(color: fg, letterSpacing: 0.3),
            ),
        ],
      ),
    );
  }
}
