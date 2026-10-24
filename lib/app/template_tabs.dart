import 'package:flutter/material.dart';

import '../models/carousel_slide.dart';
import '../models/channel_ui.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import '../widgets/pro_shimmer.dart';
import '../widgets/template_ui.dart';
import '../widgets/tpl_hero_carousel.dart';

/// Home: full-bleed hero, category chips, then a 2-column channel grid.
class TplHomeTab extends StatelessWidget {
  const TplHomeTab({
    super.key,
    required this.initialLoading,
    required this.refreshing,
    required this.channelsLoadFailed,
    required this.carousel,
    required this.allChannels,
    required this.category,
    required this.onCategory,
    required this.onViewAll,
    required this.lockedFor,
    required this.isFree,
    required this.onChannel,
    required this.onRefresh,
    required this.bottomPad,
    this.loadingChannelId,
  });

  final bool initialLoading;
  final bool refreshing;
  final bool channelsLoadFailed;
  final List<CarouselSlide> carousel;
  final List<ChannelUi> allChannels;
  final String category;
  final ValueChanged<String> onCategory;
  final ValueChanged<String> onViewAll;
  final bool Function(ChannelUi) lockedFor;
  final bool Function(ChannelUi) isFree;
  final ValueChanged<ChannelUi> onChannel;
  final Future<void> Function() onRefresh;
  final double bottomPad;
  final int? loadingChannelId;

  List<String> _heroImages() {
    final slides = [
      for (final s in carousel)
        if ((s.imageUrl ?? '').trim().isNotEmpty) s.imageUrl!.trim(),
    ];
    if (slides.isNotEmpty) return slides;
    return [
      for (final c in allChannels)
        if ((c.thumbnailUrl ?? '').trim().isNotEmpty) c.thumbnailUrl!.trim(),
    ].take(3).toList();
  }

  @override
  Widget build(BuildContext context) {
    final pills = tplCategoryPills(allChannels, isFree: isFree);
    final cat = pills.any((p) => p.key == category) ? category : 'all';
    final visible = tplFilterChannels(allChannels, cat, isFree: isFree);
    final loading = allChannels.isEmpty && (initialLoading || refreshing);
    final hero = _heroImages();

    return ColoredBox(
      color: Tpl.slate950,
      child: RefreshIndicator(
        color: Tpl.lime400,
        backgroundColor: Tpl.slate900,
        edgeOffset: MediaQuery.paddingOf(context).top,
        onRefresh: onRefresh,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: loading && hero.isEmpty
                  ? const SizedBox(height: 480, child: ShimmerBox(radius: 0, baseColor: Tpl.slate900))
                  : TplHeroCarousel(images: hero),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 20),
                child: TplPillRow(items: pills, selected: cat, onSelect: onCategory),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: TplSectionTitle(
                  title: switch (cat) {
                    'all' => 'All channels',
                    'free' => 'Channel za bure',
                    _ => tplCategoryLabel(cat),
                  },
                  onViewAll: () => onViewAll(cat),
                ),
              ),
            ),
            if (loading)
              const TplChannelGridShimmer()
            else if (visible.isEmpty)
              SliverToBoxAdapter(
                child: TplEmptyState(
                  failed: channelsLoadFailed,
                  message: channelsLoadFailed ? 'Imeshindwa kupakia channel' : 'Hakuna channels',
                ),
              )
            else
              TplChannelGrid(
                channels: visible,
                onChannel: onChannel,
                lockedFor: lockedFor,
                loadingChannelId: loadingChannelId,
              ),
            SliverToBoxAdapter(child: SizedBox(height: 40 + bottomPad)),
          ],
        ),
      ),
    );
  }
}

/// Channels: header with search, chips, count and the full grid.
class TplChannelsTab extends StatefulWidget {
  const TplChannelsTab({
    super.key,
    required this.initialLoading,
    required this.refreshing,
    required this.channelsLoadFailed,
    required this.allChannels,
    required this.category,
    required this.onCategory,
    required this.lockedFor,
    required this.isFree,
    required this.onChannel,
    required this.onRefresh,
    required this.bottomPad,
    this.loadingChannelId,
  });

  final bool initialLoading;
  final bool refreshing;
  final bool channelsLoadFailed;
  final List<ChannelUi> allChannels;
  final String category;
  final ValueChanged<String> onCategory;
  final bool Function(ChannelUi) lockedFor;
  final bool Function(ChannelUi) isFree;
  final ValueChanged<ChannelUi> onChannel;
  final Future<void> Function() onRefresh;
  final double bottomPad;
  final int? loadingChannelId;

  @override
  State<TplChannelsTab> createState() => _TplChannelsTabState();
}

class _TplChannelsTabState extends State<TplChannelsTab> {
  final _searchCtrl = TextEditingController();
  final _searchFocus = FocusNode();
  bool _searchOpen = false;

  @override
  void dispose() {
    _searchCtrl.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  void _toggleSearch() {
    setState(() {
      _searchOpen = !_searchOpen;
      if (_searchOpen) {
        Future.microtask(_searchFocus.requestFocus);
      } else {
        _searchCtrl.clear();
        _searchFocus.unfocus();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final pills = tplCategoryPills(widget.allChannels, isFree: widget.isFree);
    final cat = pills.any((p) => p.key == widget.category) ? widget.category : 'all';
    final filtered = tplFilterChannels(
      widget.allChannels,
      cat,
      query: _searchCtrl.text,
      isFree: widget.isFree,
    );
    final loading = widget.allChannels.isEmpty && (widget.initialLoading || widget.refreshing);

    return ColoredBox(
      color: Tpl.slate950,
      child: RefreshIndicator(
        color: Tpl.lime400,
        backgroundColor: Tpl.slate900,
        onRefresh: widget.onRefresh,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          slivers: [
            SliverToBoxAdapter(
              child: TplPageHeader(
                eyebrow: 'Watch live',
                title: 'Channels',
                trailing: TplIconButton(
                  icon: _searchOpen ? TplIconName.close : TplIconName.search,
                  active: _searchOpen,
                  onTap: _toggleSearch,
                ),
              ),
            ),
            if (_searchOpen)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
                  child: _SearchField(
                    controller: _searchCtrl,
                    focusNode: _searchFocus,
                    onChanged: (_) => setState(() {}),
                  ),
                ),
              ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(top: 24),
                child: TplPillRow(items: pills, selected: cat, onSelect: widget.onCategory, bordered: false),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 28, 16, 16),
                child: Text(
                  loading ? 'Inapakia…' : '${filtered.length} channels',
                  style: manrope(14, weight: FontWeight.w700, color: Tpl.slate400),
                ),
              ),
            ),
            if (loading)
              const TplChannelGridShimmer(crossSpacing: 12)
            else if (filtered.isEmpty)
              SliverToBoxAdapter(
                child: TplEmptyState(
                  failed: widget.channelsLoadFailed,
                  message: widget.channelsLoadFailed
                      ? 'Imeshindwa kupakia channel'
                      : (_searchCtrl.text.trim().isNotEmpty ? 'Hakuna matokeo' : 'Hakuna channels'),
                ),
              )
            else
              TplChannelGrid(
                channels: filtered,
                crossSpacing: 12,
                onChannel: widget.onChannel,
                lockedFor: widget.lockedFor,
                loadingChannelId: widget.loadingChannelId,
              ),
            SliverToBoxAdapter(child: SizedBox(height: 28 + widget.bottomPad)),
          ],
        ),
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.controller, required this.focusNode, required this.onChanged});

  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: Tpl.slate900,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Tpl.hairline(0.07)),
      ),
      child: Row(
        children: [
          const TplIcon(TplIconName.search, size: 18, color: Tpl.slate500),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: controller,
              focusNode: focusNode,
              onChanged: onChanged,
              textInputAction: TextInputAction.search,
              style: manrope(14, weight: FontWeight.w600, color: Colors.white),
              decoration: InputDecoration(
                isCollapsed: true,
                border: InputBorder.none,
                hintText: 'Tafuta channel…',
                hintStyle: manrope(14, weight: FontWeight.w500, color: Tpl.slate500),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
