import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/channel_ui.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import 'channel_card.dart';

class ChannelRail extends StatelessWidget {
  const ChannelRail({
    super.key,
    required this.title,
    required this.channels,
    required this.lockedFor,
    required this.onChannel,
    required this.isPremium,
    required this.channelsPremiumOnly,
    this.tileWidth = kHomeRailTileWidth,
    this.railHeight = kHomeRailHeight,
    this.loadingChannelId,
  });

  final String title;
  final List<ChannelUi> channels;
  final bool Function(ChannelUi) lockedFor;
  final void Function(ChannelUi) onChannel;
  final bool isPremium;
  final bool channelsPremiumOnly;
  final double tileWidth;
  final double railHeight;
  final int? loadingChannelId;

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    if (channels.isEmpty) return const SizedBox.shrink();

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
                    title,
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
                  child: Text('${channels.length}', style: rajdhani(10.5, weight: FontWeight.w700).copyWith(color: t.text2.withValues(alpha: 0.95))),
                ),
              ],
            ),
          ),
          SizedBox(
            height: railHeight,
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(18, 0, 18, kRailListBottomPadding),
              scrollDirection: Axis.horizontal,
              clipBehavior: Clip.none,
              itemCount: channels.length,
              separatorBuilder: (_, __) => const SizedBox(width: 12),
              itemBuilder: (context, i) {
                final ch = channels[i];
                return SizedBox(
                  width: tileWidth,
                  height: kHomeRailCardHeight,
                  child: ChannelCard(
                    width: tileWidth,
                    channel: ch,
                    badge: channelBadgeFor(
                      ch,
                      isPremium: isPremium,
                      channelsPremiumOnly: channelsPremiumOnly,
                    ),
                    onPress: () => onChannel(ch),
                    isLoading: loadingChannelId == ch.id,
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
