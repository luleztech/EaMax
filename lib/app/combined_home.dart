import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import '../config/api.dart';
import '../models/carousel_slide.dart';
import '../models/channel_ui.dart';
import '../screens/fullscreen_video_page.dart';
import '../screens/payments_screen.dart';
import '../screens/profile_screen.dart';
import '../services/native_android_player.dart';
import '../services/user_id.dart';
import '../theme/app_theme.dart';
import '../widgets/channel_unavailable_modal.dart';
import '../widgets/eamax_carousel.dart';

import 'home_tabs.dart';


class _MalipoScaffold extends StatelessWidget {
  const _MalipoScaffold({required this.bottomPadding, required this.onPaymentSuccess});

  final double bottomPadding;
  final Future<void> Function() onPaymentSuccess;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.scaffold,
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: const Color(0xEE030712),
        elevation: 0,
        foregroundColor: Colors.white,
        title: const Text('Malipo', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: PaymentsScreen(
        bottomPadding: bottomPadding,
        onPaymentSuccess: onPaymentSuccess,
      ),
    );
  }
}

class _Genre {
  const _Genre(this.name, this.key, this.iconStr, this.color);
  final String name;
  final String key;
  final String iconStr;
  final Color color;
}

const _movieGenres = [
  _Genre('Tamthilia', 'tamthilia', 'movie', Color(0xFFEC4899)),
  _Genre('Filamu', 'movies', 'movie', Color(0xFF3B82F6)),
  _Genre('Wanyama', 'wanyama', 'movie', Color(0xFF10B981)),
  _Genre('Katuni', 'katuni', 'movie', Color(0xFFF59E0B)),
  _Genre('Sayansi', 'sayansi', 'movie', Color(0xFF8B5CF6)),
];

String _hexColor(Color c) => '#${(c.value & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';

Color _parseHex(String? s, Color fallback) {
  if (s == null || s.isEmpty) return fallback;
  var x = s.replaceFirst('#', '');
  if (x.length == 6) x = 'FF$x';
  try {
    return Color(int.parse(x, radix: 16));
  } catch (_) {
    return fallback;
  }
}

class CombinedHome extends StatefulWidget {
  const CombinedHome({
    super.key,
    required this.isPremium,
    required this.channelsPremiumOnly,
    required this.userPoints,
    required this.onWatchAd,
    required this.onPointsRefresh,
    required this.onPaymentsActiveChange,
    required this.syncPremiumSetting,
  });

  final bool isPremium;
  final bool channelsPremiumOnly;
  final int userPoints;
  final VoidCallback onWatchAd;
  final Future<void> Function() onPointsRefresh;
  final void Function(bool active) onPaymentsActiveChange;
  /// Refetch channels-premium-only mode (must run when connectivity returns; cached in parent).
  final Future<void> Function() syncPremiumSetting;

  @override
  State<CombinedHome> createState() => CombinedHomeState();
}

class CombinedHomeState extends State<CombinedHome> with SingleTickerProviderStateMixin {
  late final AnimationController _glowCtrl;

  int _tab = 0;
  String _channelFilter = 'zote';
  List<CarouselSlide> _carousel = [];
  List<ChannelUi> _football = [];
  Map<String, List<ChannelUi>> _byCat = {
    for (final g in _movieGenres) g.key: [],
    'habari': [],
  };

  List<dynamic> _matches = [];
  bool _refreshing = false;
  bool _initialLoading = true;

  bool _unlockOpen = false;
  bool _insufficientOpen = false;
  ChannelUi? _selectedChannel;
  int _localPoints = 0;
  int? _loadingChannelId;

  @override
  void initState() {
    super.initState();
    _localPoints = widget.userPoints;
    _glowCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 10))..repeat();
    _loadAll();
    getOrCreateUserId();
  }

  @override
  void dispose() {
    _glowCtrl.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant CombinedHome oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.userPoints != widget.userPoints) {
      _localPoints = widget.userPoints;
    }
  }

  Future<void> _openMalipo() async {
    if (!mounted) return;
    final inset = MediaQuery.paddingOf(context).bottom;
    final bottomPad = kHomeBottomNavScrollPaddingBody + inset;
    widget.onPaymentsActiveChange(true);
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (context) => _MalipoScaffold(
          bottomPadding: bottomPad,
          onPaymentSuccess: widget.onPointsRefresh,
        ),
      ),
    );
    if (!mounted) return;
    widget.onPaymentsActiveChange(_tab == 2);
  }

  Future<void> _loadAll() async {
    try {
      await widget.syncPremiumSetting();
      await Future.wait([_loadSlides(), _loadChannels(), _loadMatches()]);
    } finally {
      if (mounted) setState(() => _initialLoading = false);
    }
  }

  List<CarouselSlide> _mapSlides(List<dynamic> data, List<Color> defGrad) {
    if (data.isEmpty) return [];
    return data.map((slide) {
      final m = Map<String, dynamic>.from(slide as Map);
      return CarouselSlide(
        title: m['title']?.toString(),
        subtitle: m['subtitle']?.toString(),
        badge: m['badge']?.toString(),
        imageUrl: m['image_url']?.toString(),
        videoUrl: m['video_url']?.toString(),
        id: (m['id'] as num?)?.toInt(),
        gradient: [
          _parseHex(m['gradient_start']?.toString(), defGrad[0]),
          _parseHex(m['gradient_mid']?.toString(), defGrad[1]),
          _parseHex(m['gradient_end']?.toString(), defGrad[2]),
        ],
        info: m['info_text'] != null
            ? [CarouselInfoLine(text: m['info_text'].toString())]
            : [],
      );
    }).toList();
  }

  Future<void> _loadSlides() async {
    final football = await settingsApi.getCarouselSlides('football');
    final movies = await settingsApi.getCarouselSlides('movies');
    if (!mounted) return;
    setState(() {
      _carousel = [
        ..._mapSlides(football, const [Color(0xFF14532D), Color(0xFF111827), Color(0xFF000000)]),
        ..._mapSlides(movies, const [Color(0xFF581C87), Color(0xFF111827), Color(0xFF000000)]),
      ];
    });
  }

  Future<void> _loadChannels() async {
    final all = await channelsApi.getChannels();
    final football = <ChannelUi>[];
    final cat = {
      for (final g in _movieGenres) g.key: <ChannelUi>[],
    };
    cat['habari'] = [];

    for (final raw in all) {
      final ch = Map<String, dynamic>.from(raw as Map);
      if (ch['is_active'] != true) continue;
      final category = (ch['category']?.toString() ?? '').toLowerCase();
      final pr = ch['pointsRequired'] ?? ch['points_required'];
      final points = pr is num ? pr.toInt() : int.tryParse('$pr') ?? 0;
      final unlock = ch['unlockToFree'] == true || ch['unlock_to_free'] == true;
      final mapped = ChannelUi(
        id: (ch['id'] as num).toInt(),
        name: ch['name']?.toString() ?? '',
        streamUrl: ch['stream_url']?.toString(),
        thumbnailUrl: ch['thumbnail_url']?.toString(),
        thumbnailEmoji: ch['thumbnail_emoji']?.toString(),
        color: ch['color']?.toString() ?? '#22c55e',
        category: category,
        pointsRequired: points,
        unlockToFree: unlock,
        isLive: ch['is_active'] == true,
        icon: category == 'football' ? 'soccer' : (category == 'movies' ? 'movie' : 'television'),
        apiRow: Map<String, dynamic>.from(ch),
      );
      if (category == 'football') {
        football.add(mapped);
      } else if (cat.containsKey(category)) {
        cat[category]!.add(mapped);
      }
    }
    if (!mounted) return;
    setState(() {
      _football = football;
      _byCat = cat;
    });
  }

  Future<void> _loadMatches() async {
    final m = await matchesApi.getUpcomingMatches();
    if (!mounted) return;
    setState(() => _matches = m);
  }

  /// Syncs admin channel mode + carousel + channels + matches (same as pull-to-refresh).
  Future<void> reloadRemoteData() async {
    setState(() => _refreshing = true);
    try {
      await widget.syncPremiumSetting();
      await Future.wait([_loadSlides(), _loadChannels(), _loadMatches()]);
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  Future<void> _onRefresh() => reloadRemoteData();

  Future<void> _refreshPoints() async {
    final uid = await getStoredUserId();
    if (uid == null) return;
    try {
      final u = await userApi.getUser(uid);
      if (!mounted) return;
      setState(() => _localPoints = (u['points'] as num?)?.toInt() ?? 0);
    } catch (_) {}
  }

  ChannelBadgeUi _channelBadge(ChannelUi ch) {
    if (widget.isPremium) {
      return const ChannelBadgeUi(
        label: 'Imefunguliwa',
        kind: ChannelBadgeKind.premiumMemberUnlocked,
      );
    }
    if (widget.channelsPremiumOnly && !ch.unlockToFree) {
      return const ChannelBadgeUi(
        label: 'Imefungwa',
        kind: ChannelBadgeKind.lockedProChannel,
      );
    }
    if (widget.channelsPremiumOnly && ch.unlockToFree) {
      return const ChannelBadgeUi(label: 'Bure');
    }
    if (ch.pointsRequired <= 0) return const ChannelBadgeUi(label: 'Bure');
    return ChannelBadgeUi(label: '${ch.pointsRequired}');
  }

  List<ChannelSection> _sections() {
    switch (_channelFilter) {
      case 'mpira':
        return _football.isEmpty
            ? []
            : [
                ChannelSection(
                  key: 'football',
                  name: 'Mpira',
                  icon: 'soccer',
                  color: '#4ade80',
                  channels: _football,
                ),
              ];
      case 'movies':
        return _movieGenres
            .map((g) => ChannelSection(
                  key: g.key,
                  name: g.name,
                  icon: g.iconStr,
                  color: _hexColor(g.color),
                  channels: _byCat[g.key] ?? [],
                ))
            .where((s) => s.channels.isNotEmpty)
            .toList();
      case 'habari':
        final h = _byCat['habari'] ?? [];
        return h.isEmpty
            ? []
            : [
                ChannelSection(key: 'habari', name: 'Habari', icon: 'newspaper', color: '#ef4444', channels: h),
              ];
      default:
        final allChannels = [
          ..._football,
          ..._byCat.values.expand((list) => list),
        ];

        final freeChannels = allChannels.where((ch) => ch.unlockToFree || ch.pointsRequired == 0).toList();
        final freeIds = freeChannels.map((ch) => ch.id).toSet();

        final sections = <ChannelSection>[];
        if (freeChannels.isNotEmpty) {
          sections.add(ChannelSection(
            key: 'free',
            name: 'Chaneli za bure',
            icon: 'gift',
            color: '#22c55e',
            channels: freeChannels,
          ));
        }

        final footballNonFree = _football.where((ch) => !freeIds.contains(ch.id)).toList();
        if (footballNonFree.isNotEmpty) {
          sections.add(ChannelSection(key: 'football', name: 'Mpira', icon: 'soccer', color: '#4ade80', channels: footballNonFree));
        }

        for (final g in _movieGenres) {
          final list = (_byCat[g.key] ?? []).where((ch) => !freeIds.contains(ch.id)).toList();
          if (list.isNotEmpty) {
            sections.add(ChannelSection(
              key: g.key,
              name: g.name,
              icon: g.iconStr,
              color: _hexColor(g.color),
              channels: list,
            ));
          }
        }

        final hab = (_byCat['habari'] ?? []).where((ch) => !freeIds.contains(ch.id)).toList();
        if (hab.isNotEmpty) {
          sections.add(ChannelSection(key: 'habari', name: 'Habari', icon: 'newspaper', color: '#ef4444', channels: hab));
        }
        return sections;
    }
  }

  IconData _icon(String name) {
    switch (name) {
      case 'soccer':
        return Icons.sports_soccer;
      case 'movie':
        return Icons.movie;
      case 'newspaper':
        return Icons.article;
      case 'gift':
        return Icons.card_giftcard;
      default:
        return Icons.tv;
    }
  }

  /// Android: native ExoPlayer/WebView stack. Other platforms: [FullscreenVideoPage].
  Future<void> _openVideoPlayback({
    required String url,
    String? channelName,
    Map<String, dynamic>? channelData,
  }) async {
    if (url.isEmpty) return;
    if (kIsWeb) {
      // In-app playback (media_kit + WebView fallback). Opening the raw stream URL in a new
      // tab often triggers a file download instead of playback, especially for .mpd/.m3u8.
      if (!mounted) return;
      final token = _extractPlaybackToken(channelData);
      final playbackHeaders = _extractPlaybackHeaders(channelData);
      final merged = Map<String, String>.from(playbackHeaders);
      if (token.isNotEmpty &&
          !merged.keys.any((k) => k.toLowerCase() == 'authorization')) {
        merged['Authorization'] = 'Bearer $token';
      }
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (_) => FullscreenVideoPage(
            videoUrl: url,
            channelName: channelName,
            httpHeaders: merged.isEmpty ? null : merged,
          ),
        ),
      );
      return;
    }
    if (NativeAndroidPlayer.supported) {
      final ck = _extractClearKeyPayload(channelData);
      final drm = _normalizedDrmType(channelData, ck, url);
      final license = channelData?['licenseUrl'] ?? channelData?['license_url'];
      final token = _extractPlaybackToken(channelData);
      final playbackHeaders = _extractPlaybackHeaders(channelData);
      try {
        await NativeAndroidPlayer.open(
          url: url,
          licenseUrl: license != null ? '$license' : '',
          token: token,
          drmType: drm,
          clearKeyHex: ck,
          headers: playbackHeaders.isEmpty ? null : playbackHeaders,
        );
      } catch (e, st) {
        debugPrint('Native player open failed: $e\n$st');
        if (mounted) await showChannelUnavailableModal(context);
      }
      return;
    }
    if (!mounted) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => FullscreenVideoPage(videoUrl: url, channelName: channelName),
      ),
    );
  }

  String _extractPlaybackToken(Map<String, dynamic>? channelData) {
    if (channelData == null) return '';
    final raw =
        channelData['token'] ??
        channelData['streamToken'] ??
        channelData['stream_token'] ??
        channelData['authToken'] ??
        channelData['auth_token'];
    return raw?.toString().trim() ?? '';
  }

  Map<String, String> _extractPlaybackHeaders(Map<String, dynamic>? channelData) {
    if (channelData == null) return const {};
    final candidates = <Object?>[
      channelData['headers'],
      channelData['streamHeaders'],
      channelData['stream_headers'],
      channelData['drmHeaders'],
      channelData['drm_headers'],
    ];
    for (final candidate in candidates) {
      final parsed = _toStringMap(candidate);
      if (parsed.isNotEmpty) return parsed;
    }
    return const {};
  }

  /// ClearKey payload: hex string or JSON `{"keys":[...]}` from API (never shown to users).
  String _extractClearKeyPayload(Map<String, dynamic>? channelData) {
    if (channelData == null) return '';
    final dynamic raw = channelData['drmClearKey'] ??
        channelData['drm_clear_key'] ??
        channelData['clearKeyHex'] ??
        channelData['clear_keys'] ??
        channelData['clearKeys'];
    if (raw == null) return '';
    if (raw is String) return raw.trim();
    try {
      return jsonEncode(raw);
    } catch (_) {
      return raw.toString();
    }
  }

  String _normalizedDrmType(Map<String, dynamic>? channelData, String clearPayload, String playbackUrl) {
    var d = (channelData?['drmType'] ?? channelData?['drm_type'] ?? 'NONE').toString().trim();
    if (d.isEmpty) d = 'NONE';
    var u = d.toUpperCase().replaceAll(RegExp(r'[\s\-]+'), '_');
    if (u == 'CLEAR_KEY') u = 'CLEARKEY';
    if (u != 'NONE') return u;
    final ul = playbackUrl.toLowerCase();
    if (clearPayload.isNotEmpty && (ul.contains('.mpd') || ul.contains('.m3u8') || ul.contains('.m3u'))) {
      return 'CLEARKEY';
    }
    return 'NONE';
  }

  Map<String, String> _toStringMap(Object? raw) {
    if (raw == null) return const {};
    if (raw is Map) {
      final out = <String, String>{};
      raw.forEach((key, value) {
        final k = key.toString().trim();
        final v = value?.toString().trim() ?? '';
        if (k.isNotEmpty && v.isNotEmpty) out[k] = v;
      });
      return out;
    }
    if (raw is String) {
      final s = raw.trim();
      if (s.isEmpty) return const {};
      try {
        final decoded = jsonDecode(s);
        if (decoded is Map) return _toStringMap(decoded);
      } catch (_) {
        // Keep playback resilient when backend sends non-JSON header blobs.
      }
    }
    return const {};
  }

  Future<void> _openChannel(ChannelUi ch) async {
    final canPlay = widget.isPremium ||
        (widget.channelsPremiumOnly ? ch.unlockToFree : ch.pointsRequired == 0);
    if (canPlay) {
      final quickUrl = ch.streamUrl?.trim();
      if (quickUrl != null && quickUrl.isNotEmpty && mounted) {
        await _openVideoPlayback(
          url: quickUrl,
          channelName: ch.name,
          channelData: ch.apiRow,
        );
        return;
      }
      setState(() => _loadingChannelId = ch.id);
      try {
        final data = await channelsApi.getChannel(ch.id);
        final url = data['streamUrl'] ?? data['stream_url'];
        if (url != null && '$url'.isNotEmpty && mounted) {
          await _openVideoPlayback(
            url: '$url',
            channelName: ch.name,
            channelData: Map<String, dynamic>.from(data),
          );
        } else if (mounted) {
          await showChannelUnavailableModal(context);
        }
      } catch (_) {
        if (mounted) await showChannelUnavailableModal(context);
      } finally {
        if (mounted) setState(() => _loadingChannelId = null);
      }
      return;
    }
    if (widget.channelsPremiumOnly) {
      await _openMalipo();
      return;
    }
    setState(() {
      _selectedChannel = ch;
      _unlockOpen = true;
    });
  }

  Future<void> _unlockFromModal() async {
    final ch = _selectedChannel;
    if (ch == null) return;
    final uid = await getOrCreateUserId();
    if (uid == null) return;
    try {
      await userApi.unlockChannel(uid, ch.id);
      await _refreshPoints();
      await widget.onPointsRefresh();
      setState(() {
        _unlockOpen = false;
        _selectedChannel = null;
      });
      final fastUrl = ch.streamUrl?.trim();
      if (fastUrl != null && fastUrl.isNotEmpty && mounted) {
        await _openVideoPlayback(
          url: fastUrl,
          channelName: ch.name,
          channelData: ch.apiRow,
        );
        return;
      }
      setState(() => _loadingChannelId = ch.id);
      try {
        final data = await channelsApi.getChannel(ch.id);
        final url = data['streamUrl'] ?? data['stream_url'];
        if (url != null && mounted) {
          await _openVideoPlayback(
            url: '$url',
            channelName: ch.name,
            channelData: Map<String, dynamic>.from(data),
          );
        }
      } finally {
        if (mounted) setState(() => _loadingChannelId = null);
      }
    } catch (_) {
      setState(() {
        _unlockOpen = false;
        _insufficientOpen = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final inset = MediaQuery.paddingOf(context).bottom;
    final bottomPad = kHomeBottomNavScrollPaddingBody + inset;
    final w = MediaQuery.sizeOf(context).width;
    final cardW = (w - 44) / 2;
    const cardH = 240.0;

    SchedulerBinding.instance.addPostFrameCallback((_) {
      widget.onPaymentsActiveChange(_tab == 2);
    });

    return Stack(
      fit: StackFit.expand,
      children: [
        const Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: AppColors.backgroundGradient,
              ),
            ),
          ),
        ),
        SafeArea(
          top: true,
          bottom: false,
          child: Column(
            children: [
              if (_tab != 2)
                HomeHeader(
                  points: widget.userPoints,
                  isPremium: widget.isPremium,
                  onPremium: _openMalipo,
                ),
              Expanded(
                child: IndexedStack(
                  index: _tab,
                  children: [
                    HomeMainTab(
                      initialLoading: _initialLoading,
                      refreshing: _refreshing,
                      carousel: _carousel,
                      channelFilter: _channelFilter,
                      onFilter: (k) => setState(() => _channelFilter = k),
                      sections: _sections(),
                      matches: _matches,
                      isPremium: widget.isPremium,
                      channelFilterKey: _channelFilter,
                      bottomPad: bottomPad,
                      glowCtrl: _glowCtrl,
                      cardW: cardW,
                      cardH: cardH,
                      channelBadge: _channelBadge,
                      onChannel: _openChannel,
                      onRefresh: _onRefresh,
                      loadingChannelId: _loadingChannelId,
                      iconFor: _icon,
                    ),
                    ChannelsTab(
                      initialLoading: _initialLoading,
                      refreshing: _refreshing,
                      channelFilter: _channelFilter,
                      onFilter: (k) => setState(() => _channelFilter = k),
                      sections: _sections(),
                      bottomPad: bottomPad,
                      glowCtrl: _glowCtrl,
                      cardW: cardW,
                      cardH: cardH,
                      channelBadge: _channelBadge,
                      onChannel: _openChannel,
                      onRefresh: _onRefresh,
                      loadingChannelId: _loadingChannelId,
                      iconFor: _icon,
                      isPremium: widget.isPremium,
                    ),
                    ProfileScreen(
                      bottomPadding: bottomPad,
                      userPoints: widget.userPoints,
                      onWatchAd: widget.onWatchAd,
                      onPointsRefresh: widget.onPointsRefresh,
                      onOpenPayments: _openMalipo,
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
          child: HomeBottomNav(
            index: _tab,
            onTap: (i) => setState(() => _tab = i),
            bottomInset: inset,
          ),
        ),
        if (_unlockOpen && _selectedChannel != null)
          UnlockChannelOverlay(
            channelName: _selectedChannel!.name,
            pointsRequired: _selectedChannel!.pointsRequired,
            currentPoints: _localPoints,
            channelsPremiumOnly: widget.channelsPremiumOnly,
            onClose: () => setState(() {
              _unlockOpen = false;
              _selectedChannel = null;
            }),
            onUnlock: _unlockFromModal,
            onWatchAd: () {
              setState(() {
                _unlockOpen = false;
              });
              widget.onWatchAd();
            },
            onPremium: () {
              setState(() => _unlockOpen = false);
              _openMalipo();
            },
          ),
        if (_insufficientOpen && _selectedChannel != null)
          InsufficientPointsOverlay(
            channelName: _selectedChannel!.name,
            pointsRequired: _selectedChannel!.pointsRequired,
            userPoints: _localPoints,
            channelsPremiumOnly: widget.channelsPremiumOnly,
            onClose: () => setState(() {
              _insufficientOpen = false;
              _selectedChannel = null;
            }),
            onWatchAd: widget.onWatchAd,
            onPremium: () {
              setState(() => _insufficientOpen = false);
              _openMalipo();
            },
            onPointsUpdated: () async {
              await _refreshPoints();
              await widget.onPointsRefresh();
              return _localPoints;
            },
          ),
      ],
    );
  }
}
