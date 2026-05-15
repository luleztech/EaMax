import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/channel_ui.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import 'channel_card.dart';

/// Horizontal channel row with one-time scroll peek + “vuta kulia” hint (Supasoka).
class ChannelRail extends StatefulWidget {
  const ChannelRail({
    super.key,
    required this.title,
    required this.channels,
    required this.lockedFor,
    required this.onChannel,
    this.tileWidth = kHomeRailTileWidth,
    this.railHeight = kHomeRailHeight,
  });

  final String title;
  final List<ChannelUi> channels;
  final bool Function(ChannelUi) lockedFor;
  final void Function(ChannelUi) onChannel;
  final double tileWidth;
  final double railHeight;

  @override
  State<ChannelRail> createState() => _ChannelRailState();
}

class _ChannelRailState extends State<ChannelRail> {
  static bool _scrollHintPlayed = false;

  final ScrollController _scrollController = ScrollController();
  bool _showScrollHint = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _playScrollHintOnce());
  }

  Future<void> _playScrollHintOnce() async {
    if (_scrollHintPlayed || widget.channels.length < 2) return;
    await Future<void>.delayed(const Duration(milliseconds: 450));
    if (!mounted || !_scrollController.hasClients) return;
    final maxOffset = _scrollController.position.maxScrollExtent;
    if (maxOffset < 24) return;

    _scrollHintPlayed = true;
    setState(() => _showScrollHint = true);

    final peekOffset = maxOffset.clamp(0.0, 56.0);
    await _scrollController.animateTo(peekOffset, duration: const Duration(milliseconds: 650), curve: Curves.easeOutCubic);
    if (!mounted) return;
    await Future<void>.delayed(const Duration(milliseconds: 180));
    if (!mounted || !_scrollController.hasClients) return;
    await _scrollController.animateTo(0, duration: const Duration(milliseconds: 520), curve: Curves.easeInOutCubic);
    await Future<void>.delayed(const Duration(milliseconds: 2200));
    if (mounted) setState(() => _showScrollHint = false);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    if (widget.channels.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 2, 18, 10),
            child: Row(
              children: [
                Container(
                  width: 4,
                  height: 22,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(999),
                    gradient: LinearGradient(colors: [t.accent, t.accent.withValues(alpha: 0.4)]),
                    boxShadow: [BoxShadow(color: t.accent.withValues(alpha: 0.28), blurRadius: 10, spreadRadius: -1, offset: const Offset(0, 3))],
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    widget.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: rajdhani(12.5, weight: FontWeight.w800).copyWith(color: t.text.withValues(alpha: 0.92), letterSpacing: 1.05),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(999),
                    color: t.card.withValues(alpha: 0.55),
                    border: Border.all(color: t.border.withValues(alpha: 0.35)),
                  ),
                  child: Text('${widget.channels.length}', style: rajdhani(10.5, weight: FontWeight.w700).copyWith(color: t.text2.withValues(alpha: 0.95))),
                ),
              ],
            ),
          ),
          SizedBox(
            height: widget.railHeight,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                ListView.separated(
                  controller: _scrollController,
                  padding: const EdgeInsets.fromLTRB(18, 0, 18, kRailListBottomPadding),
                  scrollDirection: Axis.horizontal,
                  clipBehavior: Clip.none,
                  itemCount: widget.channels.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 12),
                  itemBuilder: (context, i) {
                    final ch = widget.channels[i];
                    return SizedBox(
                      width: widget.tileWidth,
                      height: kHomeRailCardHeight,
                      child: ChannelCard(
                        width: widget.tileWidth,
                        channel: ch,
                        locked: widget.lockedFor(ch),
                        onPress: () => widget.onChannel(ch),
                      ),
                    );
                  },
                ),
                Positioned(
                  right: 18,
                  bottom: 12,
                  child: IgnorePointer(
                    child: AnimatedOpacity(
                      opacity: _showScrollHint ? 1 : 0,
                      duration: const Duration(milliseconds: 260),
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(999),
                          gradient: LinearGradient(colors: [t.accent.withValues(alpha: 0.92), t.accent2.withValues(alpha: 0.86)]),
                          border: Border.all(color: Colors.white.withValues(alpha: 0.28)),
                          boxShadow: [
                            BoxShadow(color: Colors.black.withValues(alpha: 0.38), blurRadius: 18, offset: const Offset(0, 8)),
                            BoxShadow(color: t.accent.withValues(alpha: 0.26), blurRadius: 24, spreadRadius: -6),
                          ],
                        ),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.swipe_left_rounded, size: 18, color: Colors.black),
                              const SizedBox(width: 7),
                              Text(
                                'Vuta kulia kuona channel zaidi',
                                style: rajdhani(12.5, weight: FontWeight.w900).copyWith(color: Colors.black, letterSpacing: 0.2),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
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
