import 'package:flutter/material.dart';
import 'package:ionicons/ionicons.dart';
import 'package:provider/provider.dart';

import '../models/channel_ui.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import 'safe_network_image.dart';

/// Home horizontal rails — must match [ChannelCard] rail layout.
const double kOriginalRailTileWidth = 212;
const double kHomeRailTileWidth = kOriginalRailTileWidth - 20;
const double kRailHeightReduction = 30;
const double kRailListBottomPadding = 4;

double channelCardCellHeight(double cellWidth) => cellWidth * 4 / 3 + 76;

const double _kChannelGridPosterTrim = 52;

double _channelGridPosterHeight(double cellWidth) =>
    (cellWidth * 4 / 3 - _kChannelGridPosterTrim).clamp(96.0, double.infinity);

double channelGridCellHeight(double cellWidth) => _channelGridPosterHeight(cellWidth) + 1.5;

double channelRailCellHeight(double tileWidth) => tileWidth * 4 / 3 + 1.5;

double channelHomeRailCellHeight(double tileWidth) => channelRailCellHeight(tileWidth) - 20;

/// Poster height inside a home rail tile — keep in sync with Supasoka [ChannelCard] rail mode.
const double _kChannelHomeRailAt212 = (kOriginalRailTileWidth * 4 / 3) + 1.5 - 20;

const double kRailPosterHeightDelta =
    (_kChannelHomeRailAt212 - kRailHeightReduction - kRailListBottomPadding) - (kHomeRailTileWidth * 4 / 3);

/// Visible card height in horizontal rails (title overlay inside poster).
const double kHomeRailCardHeight = (kHomeRailTileWidth * 4 / 3) + kRailPosterHeightDelta;

/// ListView viewport — card + bottom list padding (matches Supasoka).
const double kHomeRailHeight = kHomeRailCardHeight + kRailListBottomPadding;

extension ChannelUiFree on ChannelUi {
  /// Catalog “free” row: depends on admin channel mode (same rules as playback).
  bool isFreeForCatalog(bool channelsPremiumOnly) =>
      channelsPremiumOnly ? unlockToFree : pointsRequired <= 0;

  /// Badge: show “Bure” on card.
  bool get showsBureBadge {
    return pointsRequired <= 0 || unlockToFree;
  }
}

const Map<String, String> kCatLabel = {
  'football': 'Football',
  'movies': 'Movies',
  'mpira': 'Mpira',
  'habari': 'Habari',
  'tamthilia': 'Tamthilia',
  'wanyama': 'Wanyama',
  'katuni': 'Katuni',
  'sayansi': 'Sayansi',
};

String categoryPillLabel(String cat) {
  if (cat.isEmpty) return cat;
  return kCatLabel[cat] ?? '${cat[0].toUpperCase()}${cat.substring(1).toLowerCase()}';
}

String categoryPillIconName(String cat) {
  switch (cat) {
    case 'all':
    case 'zote':
      return 'flame-outline';
    case 'football':
    case 'mpira':
      return 'football-outline';
    case 'movies':
    case 'tamthilia':
      return 'film-outline';
    case 'habari':
      return 'newspaper-outline';
    default:
      return 'tv-outline';
  }
}

class CategoryPillItem {
  const CategoryPillItem({required this.key, required this.label, required this.icon});
  final String key;
  final String label;
  final String icon;
}

List<CategoryPillItem> buildCategoryPillsFromChannels(List<ChannelUi> channels) {
  final cats = channels.map((c) => c.category ?? 'other').toSet().toList()..sort();
  return [
    const CategoryPillItem(key: 'zote', label: 'Zote', icon: 'flame-outline'),
    ...cats.map(
      (k) => CategoryPillItem(
        key: k,
        label: categoryPillLabel(k),
        icon: categoryPillIconName(k),
      ),
    ),
  ];
}

bool channelLockedForViewer(ChannelUi ch, {required bool isPremium, required bool channelsPremiumOnly}) {
  if (isPremium) return false;
  if (ch.isFreeForCatalog(channelsPremiumOnly)) return false;
  if (channelsPremiumOnly) return true;
  return ch.pointsRequired > 0;
}

class ChannelCard extends StatefulWidget {
  const ChannelCard({
    super.key,
    required this.channel,
    required this.onPress,
    this.locked = false,
    this.width,
    this.compactGrid = false,
    this.railPosterHeightDelta = 0,
  });

  final ChannelUi channel;
  final VoidCallback onPress;
  final bool locked;
  final double? width;
  final bool compactGrid;
  final double railPosterHeightDelta;

  @override
  State<ChannelCard> createState() => _ChannelCardState();
}

class _ChannelPoster extends StatelessWidget {
  const _ChannelPoster({
    required this.t,
    required this.ch,
    required this.locked,
    this.titleOverlay = false,
    this.titleOverlayCompact = false,
  });

  final AppThemeColors t;
  final ChannelUi ch;
  final bool locked;
  final bool titleOverlay;
  final bool titleOverlayCompact;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: Stack(
        fit: StackFit.expand,
        children: [
          ColoredBox(color: t.card),
          SafeNetworkImage(imageUrl: ch.thumbnailUrl ?? '', fit: BoxFit.cover, placeholderColor: t.card),
          if (titleOverlay)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: ClipRect(
                child: _ChannelNameOverlay(name: ch.name, compact: titleOverlayCompact),
              ),
            ),
          const Positioned(top: 6, left: 6, child: _LivePill()),
          Positioned(
            top: 6,
            right: 6,
            child: _AccessBadge(colors: t, channel: ch, lockedForViewer: locked),
          ),
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0x8027272a)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChannelNameOverlay extends StatelessWidget {
  const _ChannelNameOverlay({required this.name, required this.compact});
  final String name;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final fs = compact ? 10.0 : 12.0;
    final lines = compact ? 1 : 2;
    final pad = compact
        ? const EdgeInsets.fromLTRB(8, 18, 8, 8)
        : const EdgeInsets.fromLTRB(10, 22, 10, 10);

    return Container(
      width: double.infinity,
      padding: pad,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          stops: [0.0, 0.2, 0.55, 1.0],
          colors: [Colors.transparent, Color(0x00000000), Color(0x6B000000), Color(0xC7000000)],
        ),
      ),
      child: Text(
        name.toUpperCase(),
        textAlign: TextAlign.center,
        maxLines: lines,
        overflow: TextOverflow.ellipsis,
        style: orbitron(fs, weight: FontWeight.w800).copyWith(
          color: Colors.white,
          height: 1.08,
          letterSpacing: compact ? 0.45 : 0.55,
          shadows: const [Shadow(color: Color(0xE0000000), blurRadius: 12, offset: Offset(0, 1))],
        ),
      ),
    );
  }
}

class _ChannelCardState extends State<ChannelCard> {
  double _scale = 1;

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    final ch = widget.channel;
    final w = widget.width;
    final rail = w != null;
    final grid = widget.compactGrid;
    final titleInsidePoster = grid || rail;

    final core = GestureDetector(
      onTapDown: (_) => setState(() => _scale = 0.98),
      onTapUp: (_) => setState(() => _scale = 1),
      onTapCancel: () => setState(() => _scale = 1),
      onTap: widget.onPress,
      child: AnimatedScale(
        scale: _scale,
        duration: const Duration(milliseconds: 120),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (grid)
              LayoutBuilder(
                builder: (context, c) {
                  final cw = c.maxWidth;
                  final posterH = _channelGridPosterHeight(cw);
                  return AspectRatio(
                    aspectRatio: cw / posterH,
                    child: _ChannelPoster(
                      t: t,
                      ch: ch,
                      locked: widget.locked,
                      titleOverlay: true,
                      titleOverlayCompact: true,
                    ),
                  );
                },
              )
            else if (rail)
              SizedBox(
                width: w ?? kHomeRailTileWidth,
                height: kHomeRailCardHeight,
                child: _ChannelPoster(
                  t: t,
                  ch: ch,
                  locked: widget.locked,
                  titleOverlay: true,
                ),
              )
            else
              AspectRatio(
                aspectRatio: 3 / 4,
                child: _ChannelPoster(t: t, ch: ch, locked: widget.locked),
              ),
            if (!titleInsidePoster) ...[
              const SizedBox(height: 10),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Text(
                  ch.name.toUpperCase(),
                  textAlign: TextAlign.center,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: orbitron(14, weight: FontWeight.w800).copyWith(color: t.text),
                ),
              ),
            ],
          ],
        ),
      ),
    );

    if (w != null && !rail) return SizedBox(width: w, child: core);
    if (rail) return core;
    return core;
  }
}

class _AccessBadge extends StatelessWidget {
  const _AccessBadge({required this.colors, required this.channel, required this.lockedForViewer});
  final AppThemeColors colors;
  final ChannelUi channel;
  final bool lockedForViewer;

  @override
  Widget build(BuildContext context) {
    final t = colors;
    final ch = channel;

    if (ch.pointsRequired <= 0 || ch.unlockToFree) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: const Color(0xFF27272a),
          borderRadius: BorderRadius.circular(4),
          border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
        ),
        child: Text('Bure', style: orbitron(7, weight: FontWeight.w900).copyWith(color: const Color(0xFFa1a1aa), letterSpacing: 0.8)),
      );
    }

    if (lockedForViewer) {
      return Container(
        constraints: const BoxConstraints(maxWidth: 118),
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 3),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.72),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: t.accent.withValues(alpha: 0.85)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Ionicons.lock_closed, size: 11, color: t.accent),
            const SizedBox(width: 4),
            Flexible(
              child: Text('imefungwa', maxLines: 1, overflow: TextOverflow.ellipsis, style: rajdhani(9, weight: FontWeight.w700).copyWith(color: Colors.white)),
            ),
          ],
        ),
      );
    }

    return Container(
      constraints: const BoxConstraints(maxWidth: 124),
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFF14532d).withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: const Color(0xFF22c55e).withValues(alpha: 0.45)),
      ),
      child: Text('zimefunguliwa', maxLines: 1, overflow: TextOverflow.ellipsis, style: rajdhani(8, weight: FontWeight.w700).copyWith(color: const Color(0xFFbbf7d0))),
    );
  }
}

class _LivePill extends StatelessWidget {
  const _LivePill();

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: t.red,
        borderRadius: BorderRadius.circular(4),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.35), blurRadius: 8, offset: const Offset(0, 2))],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 5, height: 5, decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle)),
          const SizedBox(width: 4),
          Text('LIVE', style: orbitron(7, weight: FontWeight.w900).copyWith(color: Colors.white, letterSpacing: 1)),
        ],
      ),
    );
  }
}
