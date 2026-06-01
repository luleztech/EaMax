import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shimmer/shimmer.dart';

import '../models/carousel_slide.dart';
import '../models/channel_ui.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import '../widgets/app_header.dart';
import '../widgets/cat_pill.dart';
import '../widgets/channel_card.dart';
import '../widgets/channel_rail.dart';
import '../widgets/eamax_carousel.dart';
import '../widgets/pro_shimmer.dart';

/// Bottom filter chips — same keys/labels/colors as RN `CHANNEL_FILTERS`.
class FilterTabConfig {
  const FilterTabConfig(this.key, this.label, this.color, this.icon);
  final String key;
  final String label;
  final Color color;
  final IconData icon;
}

const kChannelFilters = [
  FilterTabConfig('zote', 'Channel Zote', Color(0xFF60A5FA), Icons.live_tv),
  FilterTabConfig('mpira', 'Mpira', Color(0xFF4ADE80), Icons.sports_soccer),
  FilterTabConfig('movies', 'Movies', Color(0xFFA855F7), Icons.movie),
  FilterTabConfig('habari', 'Habari', Color(0xFFEF4444), Icons.article),
];

class HomeHeader extends StatelessWidget {
  const HomeHeader({
    super.key,
    this.title = 'EaMax',
    this.subtitle = 'LIVE TV',
    required this.points,
    required this.isPremium,
    required this.onPremium,
    this.onSettings,
    this.onSearch,
  });

  final String title;
  final String subtitle;
  final int points;
  final bool isPremium;
  final VoidCallback onPremium;
  final VoidCallback? onSettings;
  final VoidCallback? onSearch;

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    return AppHeader(
      title: title,
      subtitle: subtitle,
      logoLetter: 'E',
      onSettings: onSettings,
      onSearch: onSearch,
      rightSlot: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: t.card,
              borderRadius: BorderRadius.circular(99),
              border: Border.all(color: t.border),
            ),
            child: Row(
              children: [
                Icon(Icons.star_rounded, size: 14, color: t.gold),
                const SizedBox(width: 4),
                Text('$points', style: rajdhani(12, weight: FontWeight.w700).copyWith(color: t.text)),
              ],
            ),
          ),
          if (!isPremium) ...[
            const SizedBox(width: 8),
            Material(
              color: t.accent,
              borderRadius: BorderRadius.circular(99),
              child: InkWell(
                onTap: onPremium,
                borderRadius: BorderRadius.circular(99),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  child: Text('PREMIUM', style: orbitron(9, weight: FontWeight.w900).copyWith(color: Colors.white)),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Vertical space for tab content padding below the main area (bar + gap above safe inset; add `MediaQuery.padding.bottom` for full reserve).
const kHomeBottomNavScrollPaddingBody = 66.0;

class HomeBottomNav extends StatelessWidget {
  const HomeBottomNav({super.key, required this.index, required this.onTap, required this.bottomInset});
  final int index;
  final ValueChanged<int> onTap;
  final double bottomInset;

  static const double _sideMargin = 12;
  static const double _bottomMargin = 6;
  /// Same value for the bar clip and the active tab — keeps corner curve consistent.
  static const double _navRadius = 18;

  @override
  Widget build(BuildContext context) {
    final items = [
      (Icons.home_rounded, 'Nyumbani'),
      (Icons.grid_view_rounded, 'Channel zote'),
      (Icons.person_outline_rounded, 'Mtumiaji'),
    ];
    final safeBottom = bottomInset < 8 ? 8.0 : bottomInset;
    return Padding(
      padding: EdgeInsets.fromLTRB(_sideMargin, 0, _sideMargin, _bottomMargin + safeBottom),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(_navRadius),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.32),
              blurRadius: 14,
              offset: const Offset(0, 8),
              spreadRadius: -3,
            ),
            BoxShadow(
              color: AppColors.accentBlue.withValues(alpha: 0.08),
              blurRadius: 12,
              spreadRadius: -5,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(_navRadius),
          child: Material(
            color: const Color(0xF81E293B),
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(_navRadius),
                border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 4),
              child: Row(
                children: List.generate(3, (i) {
                  final active = index == i;
                  return Expanded(
                    child: _HomeNavItem(
                      icon: items[i].$1,
                      label: items[i].$2,
                      active: active,
                      cornerRadius: _navRadius,
                      onTap: () => onTap(i),
                    ),
                  );
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _HomeNavItem extends StatelessWidget {
  const _HomeNavItem({
    required this.icon,
    required this.label,
    required this.active,
    required this.cornerRadius,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool active;
  final double cornerRadius;
  final VoidCallback onTap;

  static const Color _activeOnGradient = Color(0xFFF0F9FF);

  @override
  Widget build(BuildContext context) {
    final accent = AppColors.accentBlue;
    final r = BorderRadius.circular(cornerRadius);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 1),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: r,
          splashColor: accent.withValues(alpha: 0.14),
          highlightColor: accent.withValues(alpha: 0.06),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 260),
            curve: Curves.easeOutCubic,
            padding: const EdgeInsets.symmetric(vertical: 5, horizontal: 2),
            decoration: BoxDecoration(
              borderRadius: r,
              border: active
                  ? Border.all(color: Colors.white.withValues(alpha: 0.28), width: 1)
                  : null,
              gradient: active
                  ? LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        const Color(0xFF2563EB),
                        accent,
                        const Color(0xFF7DD3FC),
                      ],
                      stops: const [0.0, 0.55, 1.0],
                    )
                  : null,
              color: active ? null : Colors.transparent,
              boxShadow: active
                  ? [
                      BoxShadow(
                        color: accent.withValues(alpha: 0.45),
                        blurRadius: 12,
                        offset: const Offset(0, 4),
                        spreadRadius: -3,
                      ),
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.22),
                        blurRadius: 6,
                        offset: const Offset(0, 3),
                      ),
                    ]
                  : null,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  icon,
                  size: 18,
                  color: active ? _activeOnGradient : AppColors.muted,
                ),
                const SizedBox(height: 1),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    label,
                    maxLines: 1,
                    style: TextStyle(
                      fontSize: 9.5,
                      fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                      color: active ? _activeOnGradient : AppColors.muted,
                      letterSpacing: 0.15,
                      decoration: TextDecoration.none,
                      shadows: active
                          ? [
                              Shadow(
                                color: Colors.black.withValues(alpha: 0.35),
                                blurRadius: 6,
                                offset: const Offset(0, 1),
                              ),
                            ]
                          : null,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

const _homeFilterPills = [
  CategoryPillItem(key: 'zote', label: 'Zote', icon: 'flame-outline'),
  CategoryPillItem(key: 'mpira', label: 'Mpira', icon: 'football-outline'),
  CategoryPillItem(key: 'movies', label: 'Movies', icon: 'film-outline'),
  CategoryPillItem(key: 'habari', label: 'Habari', icon: 'newspaper-outline'),
];

List<ChannelUi> _filterHomeChannels(List<ChannelUi> all, String filterKey, String query) {
  var list = List<ChannelUi>.from(all);
  final needle = query.trim().toLowerCase();
  if (needle.isNotEmpty) {
    return list
        .where((c) =>
            c.name.toLowerCase().contains(needle) ||
            (c.category ?? '').toLowerCase().contains(needle))
        .toList();
  }
  switch (filterKey) {
    case 'mpira':
      return list.where((c) => c.category == 'football' || c.category == 'mpira').toList();
    case 'movies':
      return list
          .where((c) =>
              c.category == 'movies' ||
              c.category == 'tamthilia' ||
              c.category == 'wanyama' ||
              c.category == 'katuni' ||
              c.category == 'sayansi')
          .toList();
    case 'habari':
      return list.where((c) => c.category == 'habari').toList();
    default:
      return list;
  }
}

class HomeMainTab extends StatelessWidget {
  const HomeMainTab({
    super.key,
    required this.initialLoading,
    required this.refreshing,
    required this.carousel,
    required this.allChannels,
    required this.channelFilter,
    required this.onFilter,
    required this.isPremium,
    required this.channelsPremiumOnly,
    required this.searchQuery,
    required this.bottomPad,
    required this.onChannel,
    required this.onRefresh,
  });

  final bool initialLoading;
  final bool refreshing;
  final List<CarouselSlide> carousel;
  final List<ChannelUi> allChannels;
  final String channelFilter;
  final ValueChanged<String> onFilter;
  final bool isPremium;
  final bool channelsPremiumOnly;
  final String searchQuery;
  final double bottomPad;
  final Future<void> Function(ChannelUi) onChannel;
  final Future<void> Function() onRefresh;

  bool _locked(ChannelUi ch) =>
      channelLockedForViewer(ch, isPremium: isPremium, channelsPremiumOnly: channelsPremiumOnly);

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    final fk = _homeFilterPills.any((p) => p.key == channelFilter) ? channelFilter : 'zote';
    final filtered = _filterHomeChannels(allChannels, fk, searchQuery);
    final searching = searchQuery.trim().isNotEmpty;

    final slivers = <Widget>[];

    if ((initialLoading || refreshing) && allChannels.isEmpty) {
      slivers.add(
        SliverPadding(
          padding: EdgeInsets.fromLTRB(16, 8, 16, bottomPad),
          sliver: SliverGrid(
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: 16 / 10,
            ),
            delegate: SliverChildBuilderDelegate((_, __) => const ShimmerBox(radius: 16), childCount: 6),
          ),
        ),
      );
    } else {
      if (carousel.isNotEmpty && !searching) {
        slivers.add(SliverToBoxAdapter(child: EamaxCarousel(items: carousel)));
      }

      if (!searching) {
        slivers.add(
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 22),
              child: Container(
                height: 52,
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  color: t.card.withValues(alpha: 0.45),
                  border: Border.all(color: t.border.withValues(alpha: 0.55)),
                ),
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _homeFilterPills.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 10),
                  itemBuilder: (context, i) {
                    final cat = _homeFilterPills[i];
                    return CatPill(
                      label: cat.label,
                      icon: cat.icon,
                      active: fk == cat.key,
                      onPress: () => onFilter(cat.key),
                    );
                  },
                ),
              ),
            ),
          ),
        );
      }

      if (searching) {
        slivers.add(
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 6),
              child: Text.rich(
                TextSpan(
                  style: rajdhani(12).copyWith(color: t.text2),
                  children: [
                    TextSpan(text: '${filtered.length} matokeo kwa '),
                    TextSpan(text: '"$searchQuery"', style: TextStyle(color: t.accent)),
                  ],
                ),
              ),
            ),
          ),
        );
      }

      if (filtered.isEmpty && !initialLoading) {
        slivers.add(
          SliverFillRemaining(
            hasScrollBody: false,
            child: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.tv_off_outlined, size: 40, color: t.border),
                  const SizedBox(height: 12),
                  Text('Hakuna channels', style: rajdhani(14, weight: FontWeight.w600).copyWith(color: t.text2)),
                ],
              ),
            ),
          ),
        );
      } else if (searching || fk == 'mpira' || fk == 'habari') {
        slivers.add(
          SliverToBoxAdapter(
            child: ChannelRail(
              title: searching ? '🔎 MATOKEO' : (fk == 'mpira' ? 'Mpira' : 'Habari'),
              channels: filtered,
              lockedFor: _locked,
              onChannel: (ch) => onChannel(ch),
            ),
          ),
        );
      } else if (fk == 'movies') {
        for (final key in ['tamthilia', 'movies', 'wanyama', 'katuni', 'sayansi']) {
          final list = filtered.where((c) => c.category == key).toList();
          if (list.isEmpty) continue;
          slivers.add(
            SliverToBoxAdapter(
              child: ChannelRail(
                title: categoryPillLabel(key),
                channels: list,
                lockedFor: _locked,
                onChannel: (ch) => onChannel(ch),
              ),
            ),
          );
        }
      } else {
        final freeOnly = filtered.where((ch) => ch.isFreeForCatalog(channelsPremiumOnly)).toList();
        final freeIds = freeOnly.map((c) => c.id).toSet();

        if (freeOnly.isNotEmpty) {
          slivers.add(
            SliverToBoxAdapter(
              child: ChannelRail(
                title: 'Chaneli za bure',
                channels: freeOnly,
                lockedFor: (_) => false,
                onChannel: (ch) => onChannel(ch),
              ),
            ),
          );
        }

        final mpira = filtered.where((c) => (c.category == 'football' || c.category == 'mpira') && !freeIds.contains(c.id)).toList();
        if (mpira.isNotEmpty) {
          slivers.add(
            SliverToBoxAdapter(
              child: ChannelRail(title: 'Mpira', channels: mpira, lockedFor: _locked, onChannel: (ch) => onChannel(ch)),
            ),
          );
        }

        for (final key in ['tamthilia', 'movies', 'wanyama', 'katuni', 'sayansi']) {
          final list = filtered.where((c) => c.category == key && !freeIds.contains(c.id)).toList();
          if (list.isEmpty) continue;
          slivers.add(
            SliverToBoxAdapter(
              child: ChannelRail(
                title: categoryPillLabel(key),
                channels: list,
                lockedFor: _locked,
                onChannel: (ch) => onChannel(ch),
              ),
            ),
          );
        }

        final habari = filtered.where((c) => c.category == 'habari' && !freeIds.contains(c.id)).toList();
        if (habari.isNotEmpty) {
          slivers.add(
            SliverToBoxAdapter(
              child: ChannelRail(title: 'Habari', channels: habari, lockedFor: _locked, onChannel: (ch) => onChannel(ch)),
            ),
          );
        }
      }

    }

    slivers.add(SliverToBoxAdapter(child: SizedBox(height: bottomPad)));

    return ColoredBox(
      color: t.bg1,
      child: RefreshIndicator(
        color: t.accent,
        onRefresh: onRefresh,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: slivers,
        ),
      ),
    );
  }
}

class ChannelsTab extends StatelessWidget {
  const ChannelsTab({
    super.key,
    required this.initialLoading,
    required this.refreshing,
    required this.allChannels,
    required this.channelFilter,
    required this.onFilter,
    required this.searchQuery,
    required this.bottomPad,
    required this.onChannel,
    required this.onRefresh,
    required this.isPremium,
    required this.channelsPremiumOnly,
  });

  final bool initialLoading;
  final bool refreshing;
  final List<ChannelUi> allChannels;
  final String channelFilter;
  final ValueChanged<String> onFilter;
  final String searchQuery;
  final double bottomPad;
  final Future<void> Function(ChannelUi) onChannel;
  final Future<void> Function() onRefresh;
  final bool isPremium;
  final bool channelsPremiumOnly;

  List<String> _filterKeys() {
    final cats = allChannels.map((c) => c.category ?? 'other').toSet().toList()..sort();
    return ['all', 'free', 'premium', ...cats];
  }

  String _filterLabel(String key) {
    switch (key) {
      case 'all':
        return 'Zote';
      case 'free':
        return 'Bure';
      case 'premium':
        return 'Premium';
      default:
        return categoryPillLabel(key);
    }
  }

  String _filterIcon(String key) {
    switch (key) {
      case 'all':
        return 'flame-outline';
      case 'free':
        return 'flame-outline';
      case 'premium':
        return 'tv-outline';
      default:
        return categoryPillIconName(key);
    }
  }

  List<ChannelUi> _filtered(String fk) {
    var list = List<ChannelUi>.from(allChannels);
    switch (fk) {
      case 'all':
        break;
      case 'free':
        list = list.where((c) => c.isFreeForCatalog(channelsPremiumOnly)).toList();
        break;
      case 'premium':
        list = list.where((c) => !c.isFreeForCatalog(channelsPremiumOnly)).toList();
        break;
      default:
        list = list.where((c) => c.category == fk).toList();
    }
    final q = searchQuery.trim().toLowerCase();
    if (q.isNotEmpty) {
      list = list.where((c) => c.name.toLowerCase().contains(q) || (c.category ?? '').toLowerCase().contains(q)).toList();
    }
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    final keys = _filterKeys();
    var fk = channelFilter;
    if (fk == 'zote') fk = 'all'; // legacy
    if (!keys.contains(fk)) fk = 'all';
    final list = _filtered(fk);

    final w = MediaQuery.sizeOf(context).width;
    const hPad = 12.0;
    const gap = 8.0;
    const inset = 4.0;
    final crossAxis = w >= 320 ? 2 : 1;
    final cellW = crossAxis == 1 ? (w - hPad * 2) : (w - hPad * 2 - gap) / 2;
    final innerW = (cellW - inset * 2).clamp(40.0, double.infinity);
    final posterH = channelGridCellHeight(innerW) - 1.5;
    final tileH = posterH.clamp(56.0, double.infinity);

    bool locked(ChannelUi ch) =>
        channelLockedForViewer(ch, isPremium: isPremium, channelsPremiumOnly: channelsPremiumOnly);

    return ColoredBox(
      color: t.bg1,
      child: RefreshIndicator(
        color: t.accent,
        onRefresh: onRefresh,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: SizedBox(
                height: 44,
                child: ListView.separated(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  scrollDirection: Axis.horizontal,
                  itemCount: keys.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (context, i) {
                    final opt = keys[i];
                    final active = fk == opt;
                    return CatPill(
                      label: _filterLabel(opt),
                      icon: _filterIcon(opt),
                      active: active,
                      onPress: () => onFilter(opt),
                    );
                  },
                ),
              ),
            ),
            if ((initialLoading || refreshing) && list.isEmpty)
              SliverPadding(
                padding: EdgeInsets.fromLTRB(hPad, 0, hPad, bottomPad),
                sliver: SliverGrid(
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: crossAxis,
                    mainAxisSpacing: gap,
                    crossAxisSpacing: gap,
                    childAspectRatio: cellW / tileH,
                  ),
                  delegate: SliverChildBuilderDelegate((_, __) => const ShimmerBox(radius: 16), childCount: 6),
                ),
              )
            else if (list.isEmpty)
              SliverFillRemaining(
                hasScrollBody: false,
                child: Center(
                  child: Text('Hakuna channels', style: rajdhani(14, weight: FontWeight.w600).copyWith(color: t.text2)),
                ),
              )
            else
              SliverPadding(
                padding: EdgeInsets.fromLTRB(hPad, 8, hPad, bottomPad),
                sliver: SliverGrid(
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: crossAxis,
                    mainAxisSpacing: gap,
                    crossAxisSpacing: gap,
                    childAspectRatio: cellW / tileH,
                  ),
                  delegate: SliverChildBuilderDelegate(
                    (context, i) {
                      final ch = list[i];
                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: inset),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(14),
                          child: ChannelCard(
                            compactGrid: true,
                            channel: ch,
                            locked: locked(ch),
                            onPress: () => onChannel(ch),
                          ),
                        ),
                      );
                    },
                    childCount: list.length,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ShimmerHome extends StatelessWidget {
  const _ShimmerHome({required this.cardW, required this.cardH});
  final double cardW;
  final double cardH;

  @override
  Widget build(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width - 32;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Shimmer.fromColors(
            baseColor: const Color(0xFF0C1322),
            highlightColor: const Color(0x2460A5FA),
            child: Container(width: w, height: 320, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20))),
          ),
          const SizedBox(height: 16),
          Row(
            children: List.generate(
              4,
              (_) => Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Shimmer.fromColors(
                    baseColor: const Color(0xFF0C1322),
                    highlightColor: const Color(0x2660A5FA),
                    child: Container(height: 36, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20))),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: List.generate(
              6,
              (_) => Shimmer.fromColors(
                baseColor: const Color(0xFF0C1322),
                highlightColor: const Color(0x2E60A5FA),
                child: Container(
                  width: cardW,
                  height: cardH,
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ShimmerGrid extends StatelessWidget {
  const _ShimmerGrid({required this.cardW, required this.cardH});
  final double cardW;
  final double cardH;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Wrap(
        spacing: 12,
        runSpacing: 12,
        children: List.generate(
          4,
          (_) => Shimmer.fromColors(
            baseColor: const Color(0xFF0C1322),
            highlightColor: const Color(0x2E60A5FA),
            child: Container(
              width: cardW,
              height: cardH,
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
            ),
          ),
        ),
      ),
    );
  }
}

class _FilterRow extends StatelessWidget {
  const _FilterRow({required this.active, required this.onSelect});
  final String active;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: kChannelFilters.map((f) {
          final isOn = active == f.key;
          return Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Material(
                color: isOn ? f.color : const Color(0xB30C1222),
                borderRadius: BorderRadius.circular(22),
                child: InkWell(
                  onTap: () => onSelect(f.key),
                  borderRadius: BorderRadius.circular(22),
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(22),
                      border: Border.all(color: isOn ? f.color : const Color(0x5960A5FA), width: 1.5),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(f.icon, size: 15, color: isOn ? Colors.white : f.color),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            f.label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              color: isOn ? Colors.white : AppColors.muted,
                              letterSpacing: 0.3,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _SectionBlock extends StatelessWidget {
  const _SectionBlock({
    required this.section,
    required this.cardW,
    required this.cardH,
    required this.glowCtrl,
    required this.channelBadge,
    required this.onChannel,
    required this.loadingChannelId,
    required this.iconFor,
    required this.isPremiumUser,
  });

  final ChannelSection section;
  final double cardW;
  final double cardH;
  final AnimationController glowCtrl;
  final ChannelBadgeUi Function(ChannelUi) channelBadge;
  final Future<void> Function(ChannelUi) onChannel;
  final int? loadingChannelId;
  final IconData Function(String) iconFor;
  final bool isPremiumUser;

  Color _secCol() {
    try {
      final h = section.color.replaceFirst('#', '');
      return Color(int.parse('FF$h', radix: 16));
    } catch (_) {
      return AppColors.accentBlue;
    }
  }

  @override
  Widget build(BuildContext context) {
    final sc = _secCol();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: Row(
              children: [
                Icon(iconFor(section.icon), size: 20, color: sc),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(section.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white)),
                ),
                Text('${section.channels.length} channels', style: const TextStyle(fontSize: 13, color: Color(0xFF6B7280))),
              ],
            ),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: List.generate(section.channels.length, (i) {
                final ch = section.channels[i];
                return Container(
                  width: cardW,
                  margin: EdgeInsets.only(right: i < section.channels.length - 1 ? 12 : 0),
                  child: _ChannelCard(
                    channel: ch,
                    sectionColor: sc,
                    cardIndex: i,
                    cardH: cardH,
                    glowCtrl: glowCtrl,
                    badge: channelBadge(ch),
                    loading: loadingChannelId == ch.id,
                    onTap: () => onChannel(ch),
                    iconFor: iconFor,
                    isPremiumUser: isPremiumUser,
                  ),
                );
              }),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChannelCard extends StatelessWidget {
  const _ChannelCard({
    required this.channel,
    required this.sectionColor,
    required this.cardIndex,
    required this.cardH,
    required this.glowCtrl,
    required this.badge,
    required this.loading,
    required this.onTap,
    required this.iconFor,
    required this.isPremiumUser,
  });

  final ChannelUi channel;
  final Color sectionColor;
  final int cardIndex;
  final double cardH;
  final AnimationController glowCtrl;
  final ChannelBadgeUi badge;
  final bool loading;
  final VoidCallback onTap;
  final IconData Function(String) iconFor;
  final bool isPremiumUser;

  Color _glowColor(double t) {
    final n = AppColors.glowColors.length;
    final pos = (t * n + cardIndex * 0.25) % n;
    final i = pos.floor() % n;
    final next = (i + 1) % n;
    final f = pos - pos.floor();
    return Color.lerp(AppColors.glowColors[i], AppColors.glowColors[next], f)!;
  }

  Color _parseChColor() {
    try {
      final h = channel.color.replaceFirst('#', '');
      return Color(int.parse('FF$h', radix: 16));
    } catch (_) {
      return sectionColor;
    }
  }

  IconData _badgeIconFor(ChannelBadgeUi b) {
    switch (b.kind) {
      case ChannelBadgeKind.pointsOrBure:
        return Icons.star;
      case ChannelBadgeKind.lockedProChannel:
        return Icons.lock_rounded;
      case ChannelBadgeKind.premiumMemberUnlocked:
        return Icons.lock_open_rounded;
    }
  }

  Color _badgeIconColor(ChannelBadgeUi b) {
    switch (b.kind) {
      case ChannelBadgeKind.pointsOrBure:
        return isPremiumUser ? const Color(0xFF22C55E) : AppColors.gold;
      case ChannelBadgeKind.lockedProChannel:
        return AppColors.gold;
      case ChannelBadgeKind.premiumMemberUnlocked:
        return const Color(0xFF22C55E);
    }
  }

  Color _badgeLabelColor(ChannelBadgeUi b) {
    if (b.kind == ChannelBadgeKind.premiumMemberUnlocked) return const Color(0xFF22C55E);
    return AppColors.gold;
  }

  @override
  Widget build(BuildContext context) {
    final chC = _parseChColor();
    return AnimatedBuilder(
      animation: glowCtrl,
      builder: (context, _) {
        final glow = _glowColor(glowCtrl.value);
        return Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: loading ? null : onTap,
            borderRadius: BorderRadius.circular(18),
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: glow, width: 1.8),
                boxShadow: [BoxShadow(color: glow.withValues(alpha: 0.45), blurRadius: 18, spreadRadius: 0)],
                color: const Color(0xFF090D18),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: SizedBox(
                  height: cardH,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      if (channel.thumbnailUrl != null && channel.thumbnailUrl!.isNotEmpty)
                        CachedNetworkImage(
                          imageUrl: channel.thumbnailUrl!,
                          fit: BoxFit.cover,
                          placeholder: (_, __) => Container(color: const Color(0xFF090D18)),
                          errorWidget: (_, __, ___) => Container(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: const Alignment(-0.8, -0.8),
                                end: const Alignment(0.8, 1),
                                colors: [
                                  chC.withValues(alpha: 0.33),
                                  chC.withValues(alpha: 0.13),
                                  const Color(0xFF090D18),
                                ],
                              ),
                            ),
                            child: Center(
                              child: channel.thumbnailEmoji != null && channel.thumbnailEmoji!.isNotEmpty
                                  ? Text(channel.thumbnailEmoji!, style: const TextStyle(fontSize: 54))
                                  : Icon(iconFor(channel.icon), size: 56, color: chC.withValues(alpha: 0.8)),
                            ),
                          ),
                        )
                      else
                        Container(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: const Alignment(-0.8, -0.8),
                              end: const Alignment(0.8, 1),
                              colors: [
                                chC.withValues(alpha: 0.33),
                                chC.withValues(alpha: 0.13),
                                const Color(0xFF090D18),
                              ],
                            ),
                          ),
                          child: Center(
                            child: channel.thumbnailEmoji != null && channel.thumbnailEmoji!.isNotEmpty
                                ? Text(channel.thumbnailEmoji!, style: const TextStyle(fontSize: 54))
                                : Icon(iconFor(channel.icon), size: 56, color: chC.withValues(alpha: 0.8)),
                          ),
                        ),
                      Positioned(
                        top: 10,
                        left: 10,
                        right: 10,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            if (channel.isLive)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(color: AppColors.liveRed, borderRadius: BorderRadius.circular(10)),
                                child: const Row(
                                  children: [
                                    SizedBox(width: 6, height: 6, child: DecoratedBox(decoration: BoxDecoration(color: Colors.white, shape: BoxShape.circle))),
                                    SizedBox(width: 4),
                                    Text('LIVE', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: 0.5)),
                                  ],
                                ),
                              )
                            else
                              const Spacer(),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                              decoration: BoxDecoration(
                                color: const Color(0xB8000000),
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(
                                  color: badge.kind == ChannelBadgeKind.premiumMemberUnlocked
                                      ? const Color(0x8022C55E)
                                      : const Color(0x80FBBF24),
                                ),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(_badgeIconFor(badge), size: 11, color: _badgeIconColor(badge)),
                                  const SizedBox(width: 4),
                                  Text(
                                    badge.label,
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w800,
                                      color: _badgeLabelColor(badge),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        child: Container(
                          padding: const EdgeInsets.fromLTRB(10, 32, 10, 10),
                          decoration: const BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [Colors.transparent, Color(0xB8000000), Color(0xF7000000)],
                            ),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Expanded(
                                child: Text(
                                  channel.name,
                                  maxLines: 2,
                                  style: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w800,
                                    color: Colors.white,
                                    letterSpacing: 0.1,
                                    shadows: [Shadow(blurRadius: 6, color: Colors.black87, offset: Offset(0, 1))],
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                                decoration: BoxDecoration(color: const Color(0x8C000000), borderRadius: BorderRadius.circular(8)),
                                child: Row(
                                  children: [
                                    Icon(iconFor(channel.icon), size: 10, color: chC),
                                    const SizedBox(width: 3),
                                    Text(
                                      channel.category ?? 'Channel',
                                      style: const TextStyle(fontSize: 10, color: Color(0xFFC0C0C0), fontWeight: FontWeight.w500),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      if (loading)
                        Container(
                          color: const Color(0x8C000000),
                          child: const Center(child: CircularProgressIndicator(color: Colors.white)),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Modal overlay — `ChannelUnlockModal` in RN. Compact, scrollable, full-width CTAs.
class UnlockChannelOverlay extends StatelessWidget {
  const UnlockChannelOverlay({
    super.key,
    required this.channelName,
    required this.pointsRequired,
    required this.currentPoints,
    required this.channelsPremiumOnly,
    required this.onClose,
    required this.onUnlock,
    required this.onWatchAd,
    required this.onPremium,
  });

  final String channelName;
  final int pointsRequired;
  final int currentPoints;
  final bool channelsPremiumOnly;
  final VoidCallback onClose;
  final Future<void> Function() onUnlock;
  final VoidCallback onWatchAd;
  final VoidCallback onPremium;

  @override
  Widget build(BuildContext context) {
    final canPoints = !channelsPremiumOnly && pointsRequired > 0 && currentPoints >= pointsRequired;
    final premiumOnly = channelsPremiumOnly || pointsRequired == 0;
    final media = MediaQuery.of(context);
    final maxW = (media.size.width - 32).clamp(280.0, 360.0);
    final maxH = media.size.height * 0.88;

    return Positioned.fill(
      child: GestureDetector(
        onTap: onClose,
        child: Container(
          color: Colors.black.withValues(alpha: 0.55),
          alignment: Alignment.center,
          child: SafeArea(
            minimum: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: GestureDetector(
              onTap: () {},
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: maxW, maxHeight: maxH),
                child: Material(
                  color: Colors.transparent,
                  child: Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [Color(0xFF1A1F2E), Color(0xFF0F1419)],
                      ),
                      border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.45),
                          blurRadius: 32,
                          offset: const Offset(0, 16),
                        ),
                      ],
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(20),
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: const Color(0xFFA855F7).withValues(alpha: 0.15),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.lock_rounded, size: 26, color: Color(0xFFC4B5FD)),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              'Fungua Channel',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontSize: media.size.shortestSide < 360 ? 16 : 17,
                                fontWeight: FontWeight.w800,
                                color: Colors.white,
                                letterSpacing: 0.2,
                              ),
                            ),
                            if (channelName.isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Text(
                                channelName,
                                textAlign: TextAlign.center,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.accentBlue.withValues(alpha: 0.95),
                                ),
                              ),
                            ],
                            const SizedBox(height: 10),
                            Text(
                              channelsPremiumOnly
                                  ? 'Channel hii inahitaji malipo. Fanya malipo kufungua.'
                                  : 'Lipa kwa points au fanya malipo kufungua. Points ni bure kwa kutazama matangazo.',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: const Color(0xFFADB5C9),
                                fontSize: 12.5,
                                height: 1.45,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            if (!premiumOnly) ...[
                              const SizedBox(height: 12),
                              Row(
                                children: [
                                  Expanded(
                                    child: _PointsPill(
                                      label: 'Unahitaji',
                                      value: '$pointsRequired',
                                      unit: 'pts',
                                      color: const Color(0xFF3B82F6),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: _PointsPill(
                                      label: 'Una sasa',
                                      value: '$currentPoints',
                                      unit: 'pts',
                                      color: const Color(0xFF22C55E),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                            const SizedBox(height: 14),
                            if (canPoints)
                              _PrimaryCta(
                                onPressed: () => unawaited(onUnlock()),
                                background: const LinearGradient(
                                  colors: [Color(0xFF22C55E), Color(0xFF16A34A)],
                                ),
                                label: 'Fungua kwa points',
                                icon: Icons.verified_rounded,
                              ),
                            if (canPoints && !channelsPremiumOnly) const SizedBox(height: 8),
                            if (!channelsPremiumOnly) ...[
                              _PrimaryCta(
                                onPressed: onWatchAd,
                                background: const LinearGradient(
                                  colors: [Color(0xFF2563EB), Color(0xFF1D4ED8)],
                                ),
                                label: 'Tazama tangazo',
                                icon: Icons.play_circle_filled_rounded,
                              ),
                              const SizedBox(height: 8),
                            ],
                            _OutlinedGoldButton(
                              onPressed: onPremium,
                              label: 'Lipia Sasa',
                            ),
                            const SizedBox(height: 10),
                            SizedBox(
                              width: double.infinity,
                              child: FilledButton(
                                onPressed: onClose,
                                style: FilledButton.styleFrom(
                                  backgroundColor: const Color(0xFFDC2626),
                                  foregroundColor: Colors.white,
                                  padding: const EdgeInsets.symmetric(vertical: 14),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(14),
                                  ),
                                  elevation: 0,
                                ),
                                child: const Text(
                                  'Funga',
                                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, letterSpacing: 0.3),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PointsPill extends StatelessWidget {
  const _PointsPill({
    required this.label,
    required this.value,
    required this.unit,
    required this.color,
  });

  final String label;
  final String value;
  final String unit;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Text(
            label,
            style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: color.withValues(alpha: 0.9)),
          ),
          const SizedBox(height: 2),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                value,
                style: const TextStyle(color: Colors.white, fontSize: 16.5, fontWeight: FontWeight.w800),
              ),
              Text(
                ' $unit',
                style: TextStyle(color: Colors.white.withValues(alpha: 0.78), fontSize: 11.5, fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PrimaryCta extends StatelessWidget {
  const _PrimaryCta({
    required this.onPressed,
    required this.background,
    required this.label,
    required this.icon,
  });

  final VoidCallback onPressed;
  final Gradient background;
  final String label;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: background,
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.35),
              blurRadius: 14,
              offset: const Offset(0, 5),
            ),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onPressed,
            borderRadius: BorderRadius.circular(14),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, color: Colors.white, size: 22),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      label,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: 14.5,
                        letterSpacing: 0.2,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _OutlinedGoldButton extends StatelessWidget {
  const _OutlinedGoldButton({required this.onPressed, required this.label});

  final VoidCallback onPressed;
  final String label;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.gold,
          side: const BorderSide(color: AppColors.gold, width: 1.5),
          padding: const EdgeInsets.symmetric(vertical: 13),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          backgroundColor: AppColors.gold.withValues(alpha: 0.08),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.workspace_premium_rounded, size: 20, color: AppColors.gold),
            const SizedBox(width: 8),
            Text(
              label,
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, letterSpacing: 0.2),
            ),
          ],
        ),
      ),
    );
  }
}

class InsufficientPointsOverlay extends StatelessWidget {
  const InsufficientPointsOverlay({
    super.key,
    required this.channelName,
    required this.pointsRequired,
    required this.userPoints,
    required this.channelsPremiumOnly,
    required this.onClose,
    required this.onWatchAd,
    required this.onPremium,
    required this.onPointsUpdated,
  });

  final String channelName;
  final int pointsRequired;
  final int userPoints;
  final bool channelsPremiumOnly;
  final VoidCallback onClose;
  final VoidCallback onWatchAd;
  final VoidCallback onPremium;
  final Future<int> Function() onPointsUpdated;

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final maxW = (media.size.width - 32).clamp(280.0, 360.0);
    final maxH = media.size.height * 0.88;

    return Positioned.fill(
      child: GestureDetector(
        onTap: onClose,
        child: Container(
          color: Colors.black.withValues(alpha: 0.55),
          alignment: Alignment.center,
          child: SafeArea(
            minimum: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: GestureDetector(
              onTap: () {},
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: maxW, maxHeight: maxH),
                child: Material(
                  color: Colors.transparent,
                  child: Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [Color(0xFF1A1F2E), Color(0xFF0F1419)],
                      ),
                      border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.45),
                          blurRadius: 32,
                          offset: const Offset(0, 16),
                        ),
                      ],
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(20),
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF59E0B).withValues(alpha: 0.18),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.warning_amber_rounded, size: 26, color: Color(0xFFFBBF24)),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              'Points hazitoshi',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontSize: media.size.shortestSide < 360 ? 16 : 17,
                                fontWeight: FontWeight.w800,
                                color: Colors.white,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              channelName,
                              textAlign: TextAlign.center,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w600,
                                color: AppColors.accentBlue.withValues(alpha: 0.95),
                              ),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              'Unahitaji $pointsRequired pts, una $userPoints.',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Color(0xFFADB5C9),
                                fontSize: 12.5,
                                height: 1.45,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            const SizedBox(height: 14),
                            if (!channelsPremiumOnly)
                              _PrimaryCta(
                                onPressed: () {
                                  unawaited(() async {
                                    onWatchAd();
                                    await Future<void>.delayed(const Duration(seconds: 2));
                                    await onPointsUpdated();
                                    onClose();
                                  }());
                                },
                                background: const LinearGradient(
                                  colors: [Color(0xFF2563EB), Color(0xFF1D4ED8)],
                                ),
                                label: 'Vuna points',
                                icon: Icons.auto_awesome_rounded,
                              ),
                            if (!channelsPremiumOnly) const SizedBox(height: 8),
                            _OutlinedGoldButton(
                              onPressed: onPremium,
                              label: 'Lipia Sasa',
                            ),
                            const SizedBox(height: 10),
                            SizedBox(
                              width: double.infinity,
                              child: FilledButton(
                                onPressed: onClose,
                                style: FilledButton.styleFrom(
                                  backgroundColor: const Color(0xFFDC2626),
                                  foregroundColor: Colors.white,
                                  padding: const EdgeInsets.symmetric(vertical: 14),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(14),
                                  ),
                                  elevation: 0,
                                ),
                                child: const Text(
                                  'Funga',
                                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, letterSpacing: 0.3),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
