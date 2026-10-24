import 'package:flutter/material.dart';

import '../models/channel_ui.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import 'channel_card.dart';
import 'pro_shimmer.dart';
import 'safe_network_image.dart';

/// Stroke icons drawn from the Figma template's 24×24 SVG paths.
enum TplIconName { home, tv, card, user, play, search, chevron, check, close, bell, calendar, star, lock, chat, logout }

class TplIcon extends StatelessWidget {
  const TplIcon(this.name, {super.key, this.size = 20, this.color});

  final TplIconName name;
  final double size;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? IconTheme.of(context).color ?? Colors.white;
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(painter: _TplIconPainter(name, c)),
    );
  }
}

class _TplIconPainter extends CustomPainter {
  _TplIconPainter(this.name, this.color);

  final TplIconName name;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 24, size.height / 24);
    final p = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.8
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final path = Path();
    switch (name) {
      case TplIconName.home:
        path
          ..moveTo(3, 10)
          ..lineTo(12, 3)
          ..lineTo(21, 10)
          ..moveTo(5, 9)
          ..lineTo(5, 20)
          ..lineTo(19, 20)
          ..lineTo(19, 9)
          ..moveTo(9, 20)
          ..lineTo(9, 14)
          ..lineTo(15, 14)
          ..lineTo(15, 20);
      case TplIconName.tv:
        path
          ..addRRect(RRect.fromLTRBR(3, 5, 21, 19, const Radius.circular(3)))
          ..moveTo(9, 2)
          ..lineTo(12, 5)
          ..lineTo(15, 2)
          ..moveTo(8, 22)
          ..lineTo(16, 22);
      case TplIconName.card:
        path
          ..addRRect(RRect.fromLTRBR(3, 5, 21, 19, const Radius.circular(3)))
          ..moveTo(3, 10)
          ..lineTo(21, 10)
          ..moveTo(7, 15)
          ..lineTo(10, 15);
      case TplIconName.user:
        path
          ..addOval(Rect.fromCircle(center: const Offset(12, 8), radius: 4))
          ..moveTo(4, 21)
          ..cubicTo(4.5, 17, 7.1, 15, 12, 15)
          ..cubicTo(16.9, 15, 19.5, 17, 20, 21);
      case TplIconName.play:
        path
          ..moveTo(9, 7)
          ..lineTo(17, 12)
          ..lineTo(9, 17)
          ..close();
      case TplIconName.search:
        path
          ..addOval(Rect.fromCircle(center: const Offset(11, 11), radius: 7))
          ..moveTo(20, 20)
          ..lineTo(16, 16);
      case TplIconName.chevron:
        path
          ..moveTo(9, 18)
          ..lineTo(15, 12)
          ..lineTo(9, 6);
      case TplIconName.check:
        path
          ..moveTo(5, 12)
          ..lineTo(9, 16)
          ..lineTo(19, 6);
      case TplIconName.close:
        path
          ..moveTo(6, 6)
          ..lineTo(18, 18)
          ..moveTo(18, 6)
          ..lineTo(6, 18);
      case TplIconName.bell:
        path
          ..moveTo(18, 8)
          ..arcToPoint(const Offset(6, 8), radius: const Radius.circular(6), clockwise: false)
          ..cubicTo(6, 15, 3, 15, 3, 17)
          ..lineTo(21, 17)
          ..cubicTo(21, 15, 18, 15, 18, 8)
          ..moveTo(10, 21)
          ..lineTo(14, 21);
      case TplIconName.calendar:
        path
          ..addRRect(RRect.fromLTRBR(3, 5, 21, 21, const Radius.circular(3)))
          ..moveTo(3, 10)
          ..lineTo(21, 10)
          ..moveTo(8, 3)
          ..lineTo(8, 7)
          ..moveTo(16, 3)
          ..lineTo(16, 7);
      case TplIconName.star:
        path
          ..moveTo(12, 3)
          ..lineTo(14.8, 8.8)
          ..lineTo(21, 9.6)
          ..lineTo(16.5, 13.9)
          ..lineTo(17.6, 20.1)
          ..lineTo(12, 17.2)
          ..lineTo(6.4, 20.1)
          ..lineTo(7.5, 13.9)
          ..lineTo(3, 9.6)
          ..lineTo(9.2, 8.8)
          ..close();
      case TplIconName.lock:
        path
          ..addRRect(RRect.fromLTRBR(5, 11, 19, 21, const Radius.circular(3)))
          ..moveTo(8, 11)
          ..lineTo(8, 7.5)
          ..arcToPoint(const Offset(16, 7.5), radius: const Radius.circular(4))
          ..lineTo(16, 11);
      case TplIconName.chat:
        path
          ..moveTo(21, 12)
          ..arcToPoint(const Offset(7.6, 19.9), radius: const Radius.circular(9))
          ..lineTo(3, 21)
          ..lineTo(4.1, 16.4)
          ..arcToPoint(const Offset(21, 12), radius: const Radius.circular(9))
          ..close();
      case TplIconName.logout:
        path
          ..moveTo(10, 4)
          ..lineTo(5, 4)
          ..lineTo(5, 20)
          ..lineTo(10, 20)
          ..moveTo(14, 8)
          ..lineTo(18, 12)
          ..lineTo(14, 16)
          ..moveTo(18, 12)
          ..lineTo(9, 12);
    }
    canvas.drawPath(path, p);
  }

  @override
  bool shouldRepaint(covariant _TplIconPainter old) => old.name != name || old.color != color;
}

/// `active:scale-[.98]` press feedback used by every tappable in the template.
class TplPressable extends StatefulWidget {
  const TplPressable({super.key, required this.child, this.onTap, this.pressedScale = 0.98});

  final Widget child;
  final VoidCallback? onTap;
  final double pressedScale;

  @override
  State<TplPressable> createState() => _TplPressableState();
}

class _TplPressableState extends State<TplPressable> {
  bool _down = false;

  void _set(bool v) {
    if (widget.onTap == null || _down == v) return;
    setState(() => _down = v);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => _set(true),
      onTapUp: (_) => _set(false),
      onTapCancel: () => _set(false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _down ? widget.pressedScale : 1,
        duration: const Duration(milliseconds: 150),
        child: widget.child,
      ),
    );
  }
}

/// Eyebrow + large title used at the top of Channels / Plans / Mtumiaji.
class TplPageHeader extends StatelessWidget {
  const TplPageHeader({super.key, this.eyebrow, required this.title, this.subtitle, this.trailing});

  final String? eyebrow;
  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, top > 28 ? top : 28, 16, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (eyebrow != null) ...[
                  Text(
                    eyebrow!.toUpperCase(),
                    style: manrope(12, weight: FontWeight.w700, color: Tpl.lime400, letterSpacing: 1.2),
                  ),
                  const SizedBox(height: 4),
                ],
                Text(title, style: manrope(30, weight: FontWeight.w800, color: Colors.white, height: 1.2)),
                if (subtitle != null) ...[
                  const SizedBox(height: 8),
                  Text(subtitle!, style: manrope(14, color: Tpl.slate400, height: 1.4)),
                ],
              ],
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// `.icon-button` — 44px slate circle.
class TplIconButton extends StatelessWidget {
  const TplIconButton({super.key, required this.icon, required this.onTap, this.active = false});

  final TplIconName icon;
  final VoidCallback onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return TplPressable(
      onTap: onTap,
      pressedScale: 0.95,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: active ? Tpl.slate800 : Tpl.slate900,
        ),
        alignment: Alignment.center,
        child: TplIcon(icon, color: active ? Colors.white : Tpl.slate300),
      ),
    );
  }
}

/// Rounded category chip.
class TplPill extends StatelessWidget {
  const TplPill({super.key, required this.label, required this.active, required this.onTap, this.bordered = true});

  final String label;
  final bool active;
  final VoidCallback onTap;
  final bool bordered;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: active ? Tpl.lime400 : Tpl.slate900,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: !active && bordered ? Tpl.hairline(0.05) : Colors.transparent),
        ),
        child: Text(
          label,
          style: manrope(12, weight: FontWeight.w700, color: active ? Tpl.slate950 : Tpl.slate400),
        ),
      ),
    );
  }
}

class TplPillItem {
  const TplPillItem(this.key, this.label);
  final String key;
  final String label;
}

/// Horizontally scrolling pill row; [bleedRight] lets chips run under the screen edge.
class TplPillRow extends StatelessWidget {
  const TplPillRow({
    super.key,
    required this.items,
    required this.selected,
    required this.onSelect,
    this.bordered = true,
  });

  final List<TplPillItem> items;
  final String selected;
  final ValueChanged<String> onSelect;
  final bool bordered;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 34,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (_, i) => Center(
          child: TplPill(
            label: items[i].label,
            active: items[i].key == selected,
            bordered: bordered,
            onTap: () => onSelect(items[i].key),
          ),
        ),
      ),
    );
  }
}

class TplSectionTitle extends StatelessWidget {
  const TplSectionTitle({super.key, required this.title, this.onViewAll});

  final String title;
  final VoidCallback? onViewAll;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: manrope(20, weight: FontWeight.w800, color: Colors.white, letterSpacing: -0.4),
            ),
          ),
          if (onViewAll != null)
            GestureDetector(
              onTap: onViewAll,
              behavior: HitTestBehavior.opaque,
              child: Row(
                children: [
                  Text('View all', style: manrope(12, weight: FontWeight.w700, color: Tpl.lime400)),
                  const SizedBox(width: 4),
                  const TplIcon(TplIconName.chevron, size: 14, color: Tpl.lime400),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// `.primary-button` — lime, 48px tall, 16px radius.
class TplPrimaryButton extends StatelessWidget {
  const TplPrimaryButton({super.key, required this.label, this.onTap, this.trailing, this.expand = true});

  final String label;
  final VoidCallback? onTap;
  final Widget? trailing;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return TplPressable(
      onTap: onTap,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 150),
        opacity: enabled ? 1 : 0.3,
        child: Container(
          width: expand ? double.infinity : null,
          constraints: const BoxConstraints(minHeight: 48),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          decoration: BoxDecoration(
            color: Tpl.lime400,
            borderRadius: BorderRadius.circular(16),
            boxShadow: [BoxShadow(color: Tpl.lime400.withValues(alpha: 0.1), blurRadius: 15, offset: const Offset(0, 10))],
          ),
          child: Row(
            mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: manrope(14, weight: FontWeight.w800, color: Tpl.slate950),
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 8), trailing!],
            ],
          ),
        ),
      ),
    );
  }
}

/// `.secondary-button` — translucent white outline.
class TplSecondaryButton extends StatelessWidget {
  const TplSecondaryButton({super.key, required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return TplPressable(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withValues(alpha: 0.2)),
        ),
        child: Text(label, textAlign: TextAlign.center, style: manrope(14, weight: FontWeight.w700, color: Colors.white)),
      ),
    );
  }
}

class TplToggle extends StatelessWidget {
  const TplToggle({super.key, required this.value});

  final bool value;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 150),
      width: 48,
      height: 28,
      decoration: BoxDecoration(
        color: value ? Tpl.lime400 : Tpl.slate700,
        borderRadius: BorderRadius.circular(999),
      ),
      child: AnimatedAlign(
        duration: const Duration(milliseconds: 150),
        alignment: value ? Alignment.centerRight : Alignment.centerLeft,
        child: Container(
          margin: const EdgeInsets.all(4),
          width: 20,
          height: 20,
          decoration: const BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,
            boxShadow: [BoxShadow(color: Color(0x33000000), blurRadius: 3, offset: Offset(0, 1))],
          ),
        ),
      ),
    );
  }
}

/// `.setting-row` inside a rounded slate group; pass `last: true` to drop the divider.
class TplSettingRow extends StatelessWidget {
  const TplSettingRow({
    super.key,
    required this.icon,
    required this.label,
    this.iconWidget,
    this.value,
    this.trailing,
    this.onTap,
    this.last = false,
  });

  final TplIconName icon;
  final Widget? iconWidget;
  final String label;
  final String? value;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        highlightColor: Colors.white.withValues(alpha: 0.05),
        splashColor: Colors.white.withValues(alpha: 0.04),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            border: last ? null : Border(bottom: BorderSide(color: Tpl.hairline(0.05))),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(color: Tpl.slate800, borderRadius: BorderRadius.circular(12)),
                alignment: Alignment.center,
                child: iconWidget ?? TplIcon(icon, color: Tpl.lime400),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Text(label, style: manrope(14, weight: FontWeight.w600, color: Tpl.slate300)),
              ),
              if (value != null) ...[
                Text(value!, style: manrope(12, color: Tpl.slate500)),
                const SizedBox(width: 16),
              ],
              trailing ?? (onTap != null ? const TplIcon(TplIconName.chevron, size: 16, color: Tpl.slate300) : const SizedBox()),
            ],
          ),
        ),
      ),
    );
  }
}

class TplSettingGroup extends StatelessWidget {
  const TplSettingGroup({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(24),
      child: ColoredBox(color: Tpl.slate900, child: Column(children: children)),
    );
  }
}

/// Template channel card: 3:4 poster, name underneath.
class TplChannelCard extends StatelessWidget {
  const TplChannelCard({
    super.key,
    required this.channel,
    required this.onTap,
    this.locked = false,
    this.loading = false,
  });

  final ChannelUi channel;
  final VoidCallback onTap;
  final bool locked;
  final bool loading;

  /// Poster (3:4) + 8px gap + one 14px line of text.
  static double heightForWidth(double w) => w * 4 / 3 + 8 + 20;

  @override
  Widget build(BuildContext context) {
    return TplPressable(
      onTap: loading ? null : onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AspectRatio(
            aspectRatio: 3 / 4,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(color: Colors.black.withValues(alpha: 0.3), blurRadius: 15, offset: const Offset(0, 10), spreadRadius: -3),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    const ColoredBox(color: Tpl.slate900),
                    _poster(),
                    if (locked)
                      Positioned(
                        top: 8,
                        right: 8,
                        child: Container(
                          width: 28,
                          height: 28,
                          decoration: BoxDecoration(
                            color: Tpl.slate950.withValues(alpha: 0.7),
                            shape: BoxShape.circle,
                          ),
                          alignment: Alignment.center,
                          child: const TplIcon(TplIconName.lock, size: 14, color: Tpl.lime400),
                        ),
                      ),
                    if (loading)
                      ColoredBox(
                        color: Tpl.slate950.withValues(alpha: 0.55),
                        child: const Center(
                          child: SizedBox(
                            width: 26,
                            height: 26,
                            child: CircularProgressIndicator(strokeWidth: 2.5, color: Tpl.lime400),
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
            channel.name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: manrope(14, weight: FontWeight.w800, color: Colors.white, height: 1.4),
          ),
        ],
      ),
    );
  }

  Widget _poster() {
    final url = channel.thumbnailUrl?.trim() ?? '';
    final fallback = _ChannelFallback(channel: channel);
    if (url.isEmpty) return fallback;
    return SafeNetworkImage(
      imageUrl: url,
      fit: BoxFit.cover,
      placeholderColor: Tpl.slate900,
      errorWidget: (_, _, _) => fallback,
    );
  }
}

class _ChannelFallback extends StatelessWidget {
  const _ChannelFallback({required this.channel});

  final ChannelUi channel;

  @override
  Widget build(BuildContext context) {
    final emoji = channel.thumbnailEmoji?.trim() ?? '';
    return ColoredBox(
      color: Tpl.slate900,
      child: Center(
        child: emoji.isNotEmpty
            ? Text(emoji, style: const TextStyle(fontSize: 44))
            : const TplIcon(TplIconName.tv, size: 40, color: Tpl.slate600),
      ),
    );
  }
}

/// 2-column channel grid sliver with template spacing.
class TplChannelGrid extends StatelessWidget {
  const TplChannelGrid({
    super.key,
    required this.channels,
    required this.onChannel,
    required this.lockedFor,
    this.loadingChannelId,
    this.crossSpacing = 16,
    this.padding = const EdgeInsets.symmetric(horizontal: 16),
  });

  final List<ChannelUi> channels;
  final ValueChanged<ChannelUi> onChannel;
  final bool Function(ChannelUi) lockedFor;
  final int? loadingChannelId;
  final double crossSpacing;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return SliverPadding(
      padding: padding,
      sliver: SliverLayoutBuilder(
        builder: (context, c) {
          final cellW = (c.crossAxisExtent - crossSpacing) / 2;
          return SliverGrid(
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: crossSpacing,
              mainAxisSpacing: 24,
              mainAxisExtent: TplChannelCard.heightForWidth(cellW),
            ),
            delegate: SliverChildBuilderDelegate(
              (context, i) {
                final ch = channels[i];
                return TplChannelCard(
                  channel: ch,
                  locked: lockedFor(ch),
                  loading: loadingChannelId == ch.id,
                  onTap: () => onChannel(ch),
                );
              },
              childCount: channels.length,
            ),
          );
        },
      ),
    );
  }
}

class TplChannelGridShimmer extends StatelessWidget {
  const TplChannelGridShimmer({super.key, this.crossSpacing = 16, this.count = 6});

  final double crossSpacing;
  final int count;

  @override
  Widget build(BuildContext context) {
    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      sliver: SliverLayoutBuilder(
        builder: (context, c) {
          final cellW = (c.crossAxisExtent - crossSpacing) / 2;
          return SliverGrid(
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: crossSpacing,
              mainAxisSpacing: 24,
              mainAxisExtent: TplChannelCard.heightForWidth(cellW),
            ),
            delegate: SliverChildBuilderDelegate(
              (_, _) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AspectRatio(aspectRatio: 3 / 4, child: ShimmerBox(radius: 16, width: cellW)),
                  const SizedBox(height: 10),
                  ShimmerBox(width: cellW * 0.6, height: 14, radius: 6),
                ],
              ),
              childCount: count,
            ),
          );
        },
      ),
    );
  }
}

class TplEmptyState extends StatelessWidget {
  const TplEmptyState({super.key, required this.message, this.failed = false});

  final String message;
  final bool failed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child: Column(
        children: [
          Icon(failed ? Icons.cloud_off_outlined : Icons.tv_off_outlined, size: 40, color: Tpl.slate700),
          const SizedBox(height: 12),
          Text(message, style: manrope(14, weight: FontWeight.w600, color: Tpl.slate400)),
        ],
      ),
    );
  }
}

/// Category chips derived from the channels the backend actually returned.
const _kTplCategoryOrder = ['football', 'movies', 'tamthilia', 'habari', 'katuni', 'wanyama', 'sayansi'];
const _kTplCategoryLabel = {
  'football': 'Football',
  'movies': 'Movies',
  'habari': 'News',
  'katuni': 'Kids',
};

String tplCategoryLabel(String key) {
  if (key == 'all') return 'All';
  if (key == 'free') return 'Bure';
  return _kTplCategoryLabel[key] ?? categoryPillLabel(key);
}

String tplNormalizeCategory(String? raw) {
  final c = (raw ?? '').toLowerCase();
  if (c == 'mpira') return 'football';
  return c.isEmpty ? 'other' : c;
}

/// When [isFree] is given and matches at least one channel, a "Bure" pill follows "All".
List<TplPillItem> tplCategoryPills(List<ChannelUi> channels, {bool Function(ChannelUi)? isFree}) {
  final present = channels.map((c) => tplNormalizeCategory(c.category)).toSet()..remove('free');
  final ordered = [
    ..._kTplCategoryOrder.where(present.contains),
    ...(present.difference(_kTplCategoryOrder.toSet()).toList()..sort()),
  ];
  return [
    const TplPillItem('all', 'All'),
    if (isFree != null && channels.any(isFree)) const TplPillItem('free', 'Bure'),
    for (final k in ordered) TplPillItem(k, tplCategoryLabel(k)),
  ];
}

List<ChannelUi> tplFilterChannels(
  List<ChannelUi> channels,
  String category, {
  String query = '',
  bool Function(ChannelUi)? isFree,
}) {
  var list = switch (category) {
    'all' => channels,
    'free' when isFree != null => channels.where(isFree).toList(),
    _ => channels.where((c) => tplNormalizeCategory(c.category) == category).toList(),
  };
  final q = query.trim().toLowerCase();
  if (q.isNotEmpty) {
    list = list
        .where((c) => c.name.toLowerCase().contains(q) || (c.category ?? '').toLowerCase().contains(q))
        .toList();
  }
  return list;
}
