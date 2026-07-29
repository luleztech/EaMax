import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:provider/provider.dart';
import '../config/api.dart';
import '../config/payment_helpers.dart';
import '../models/carousel_slide.dart';
import '../models/channel_playback.dart';
import '../models/channel_ui.dart';
import '../models/schedule_item.dart';
import '../player/core/playback_orchestrator.dart';
import '../player/core/playback_session.dart';
import '../services/player_playback_service.dart';
import '../screens/profile_screen.dart';
import '../screens/settings_screen.dart';
import '../services/home_data_cache.dart';
import '../services/ratiba_reminders.dart';
import '../services/remote_config_service.dart';
import '../services/user_id.dart';
import '../theme/app_theme.dart';
import '../utils/payment_voices.dart';
import '../widgets/channel_card.dart';
import '../widgets/channel_unavailable_modal.dart';
import '../widgets/home_search_bar.dart';
import '../widgets/premium_lock_modal.dart';

import '../screens/ratiba_tab.dart';
import 'home_tabs.dart';

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

const _homeLoadTimeout = Duration(seconds: 30);
const _homeRequestTimeout = Duration(seconds: 30);
const _homeReloadDebounce = Duration(seconds: 25);

int _colorByte(double component) =>
    (component * 255).round().clamp(0, 255).toInt();

String _hexColor(Color c) =>
    '#${_colorByte(c.r).toRadixString(16).padLeft(2, '0')}${_colorByte(c.g).toRadixString(16).padLeft(2, '0')}${_colorByte(c.b).toRadixString(16).padLeft(2, '0')}';

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
    this.subscriptionEndDate,
    required this.channelsPremiumOnly,
    required this.userPoints,
    required this.onWatchAd,
    required this.onPointsRefresh,
    required this.onPaymentSuccess,
    required this.onPaymentsActiveChange,
    required this.syncPremiumSetting,
    this.externalTabIndex = 0,
    this.onRefreshingChange,
  });

  final int externalTabIndex;
  final bool isPremium;
  final DateTime? subscriptionEndDate;
  final bool channelsPremiumOnly;
  final int userPoints;
  final VoidCallback onWatchAd;
  final Future<void> Function() onPointsRefresh;
  final PremiumUnlockCallback onPaymentSuccess;
  final void Function(bool active) onPaymentsActiveChange;
  /// Refetch channels-premium-only mode (must run when connectivity returns; cached in parent).
  final Future<void> Function() syncPremiumSetting;
  final ValueChanged<bool>? onRefreshingChange;

  @override
  State<CombinedHome> createState() => CombinedHomeState();
}

class CombinedHomeState extends State<CombinedHome> with SingleTickerProviderStateMixin {
  late final AnimationController _glowCtrl;

  String _homeChannelFilter = 'zote';
  List<CarouselSlide> _carousel = [];
  List<ChannelUi> _football = [];
  Map<String, List<ChannelUi>> _byCat = {
    for (final g in _movieGenres) g.key: [],
    'habari': [],
  };

  List<ScheduleItem> _schedule = [];
  bool _refreshing = false;
  bool _initialLoading = true;
  bool _channelsLoadFailed = false;
  DateTime? _lastRemoteReload;

  bool _unlockOpen = false;
  bool _insufficientOpen = false;
  ChannelUi? _selectedChannel;
  int _localPoints = 0;
  int? _loadingChannelId;
  // Cache getChannel() results for 5 minutes so repeated taps on the same channel
  // are instant without a network round-trip.
  final Map<int, Map<String, dynamic>> _channelDataCache = {};
  final Map<int, DateTime> _channelDataCacheTime = {};
  final Map<int, ChannelPlaybackBundle> _playbackCache = {};
  final Map<int, DateTime> _playbackCacheTime = {};

  bool _searchOpen = false;
  String _searchQuery = '';
  final FocusNode _searchFocus = FocusNode();

  @override
  void initState() {
    super.initState();
    _localPoints = widget.userPoints;
    _glowCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 10))..repeat();
    RemoteConfigService.configVersion.addListener(_onRemoteConfigChanged);
    unawaited(_hydrateFromCache());
    _loadAll();
    getOrCreateUserId();
    unawaited(PaymentVoices.prepare());
    onRatibaNotificationOpen = _onRatibaNotificationOpen;
    WidgetsBinding.instance.addPostFrameCallback((_) => _enforceTabAvailability());
  }

  void _onRatibaNotificationOpen(int? scheduleId, int? channelId) {
    ChannelUi? ch;
    if (channelId != null) {
      for (final c in _allChannels()) {
        if (c.id == channelId) {
          ch = c;
          break;
        }
      }
    }
    if (ch == null && scheduleId != null) {
      for (final s in _schedule) {
        if (s.id == scheduleId.toString()) {
          if (s.channelId != null) {
            for (final c in _allChannels()) {
              if (c.id == s.channelId) {
                ch = c;
                break;
              }
            }
          }
          break;
        }
      }
    }
    if (ch == null) {
      if (mounted) context.read<AppNav>().setTab(1);
      return;
    }
    unawaited(_openChannel(ch));
  }

  void _onRemoteConfigChanged() {
    if (!mounted) return;
    _playbackCache.clear();
    _playbackCacheTime.clear();
    _channelDataCache.clear();
    _channelDataCacheTime.clear();
    _enforceTabAvailability();
    setState(() {});
  }

  void _enforceTabAvailability() {
    final nav = context.read<AppNav>();
    final tab = nav.currentTab;
    if (tab == 1 && !RemoteConfigService.ratibaTabEnabled) {
      nav.setTab(0);
    } else if (tab > 2) {
      nav.setTab(2);
    }
  }

  void _showFeatureDisabledSnack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
  }

  Future<void> _hydrateFromCache() async {
    final rows = await HomeDataCache.loadChannels();
    final carouselRows = await HomeDataCache.loadCarousel();
    final cachedMatches = await HomeDataCache.loadMatches();
    if (!mounted) return;

    setState(() {
      if (rows != null && rows.isNotEmpty) {
        _applyChannelRows(rows);
      }
      if (carouselRows != null && carouselRows.isNotEmpty) {
        _carousel = _mapSlides(
          carouselRows,
          const [Color(0xFF14532D), Color(0xFF111827), Color(0xFF000000)],
        );
      }
      if (cachedMatches != null && cachedMatches.isNotEmpty) {
        _schedule = [
          for (var i = 0; i < cachedMatches.length; i++)
            if (cachedMatches[i] is Map)
              ScheduleItem.fromJson(Map<String, dynamic>.from(cachedMatches[i] as Map), index: i),
        ];
      }
      // Only cached channels dismiss the loading state — carousel alone must not
      // end shimmer before the channel list fetch completes.
      if (rows != null && rows.isNotEmpty) {
        _initialLoading = false;
      }
    });
  }

  @override
  void dispose() {
    if (identical(onRatibaNotificationOpen, _onRatibaNotificationOpen)) {
      onRatibaNotificationOpen = null;
    }
    RemoteConfigService.configVersion.removeListener(_onRemoteConfigChanged);
    _searchFocus.dispose();
    _glowCtrl.dispose();
    super.dispose();
  }

  void _toggleSearch() {
    setState(() {
      _searchOpen = !_searchOpen;
      if (!_searchOpen) {
        _searchQuery = '';
        _searchFocus.unfocus();
      } else {
        Future.microtask(_searchFocus.requestFocus);
      }
    });
  }

  List<ChannelUi> _allChannels() => [
        ..._football,
        ..._byCat.values.expand((list) => list),
      ];

  @override
  void didUpdateWidget(covariant CombinedHome oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.userPoints != widget.userPoints) {
      _localPoints = widget.userPoints;
    }
  }

  Future<void> _openMalipo() async {
    if (!RemoteConfigService.paymentsEnabled) {
      _showFeatureDisabledSnack('Malipo yamezimwa kwa muda. Jaribu tena baadaye.');
      return;
    }
    if (!mounted) return;
    // Arm voices before the modal opens so step-0 audio is ready.
    unawaited(PaymentVoices.prepare());
    widget.onPaymentsActiveChange(true);
    await PremiumLockModal.show(
      context,
      onPaymentSuccess: widget.onPaymentSuccess,
    );
    if (!mounted) return;
    widget.onPaymentsActiveChange(false);
  }

  void openPaymentsTab() {
    unawaited(_openMalipo());
  }

  Future<void> _loadAll() async {
    if (mounted) setState(() => _channelsLoadFailed = false);
    try {
      unawaited(widget.syncPremiumSetting().catchError((_) {}));
      // Channels first — carousel/matches must not starve or timeout the catalog fetch.
      await _loadChannels();
      if (!mounted) return;
      await Future.wait([
        _loadSlides().catchError((_) {}),
        _loadMatches().catchError((_) {}),
      ]).timeout(_homeLoadTimeout, onTimeout: () => <void>[]);
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
    final football = await settingsApi.getCarouselSlides(
      'football',
      timeout: _homeRequestTimeout,
    );
    final movies = await settingsApi.getCarouselSlides(
      'movies',
      timeout: _homeRequestTimeout,
    );
    if (!mounted) return;
    final slides = [
      ..._mapSlides(football, const [Color(0xFF14532D), Color(0xFF111827), Color(0xFF000000)]),
      ..._mapSlides(movies, const [Color(0xFF581C87), Color(0xFF111827), Color(0xFF000000)]),
    ];
    setState(() => _carousel = slides);
    if (slides.isNotEmpty) {
      unawaited(HomeDataCache.saveCarousel(
        slides
            .map((s) => {
                  'title': s.title,
                  'subtitle': s.subtitle,
                  'badge': s.badge,
                  'image_url': s.imageUrl,
                  'video_url': s.videoUrl,
                  'id': s.id,
                  'gradient_start': _hexColor(s.gradient[0]),
                  'gradient_mid': _hexColor(s.gradient[1]),
                  'gradient_end': _hexColor(s.gradient[2]),
                  'info_text': s.info.isNotEmpty ? s.info.first.text : null,
                })
            .toList(),
      ));
    }
  }

  int _channelSortKey(Map<String, dynamic> ch) {
    final raw = ch['sort_order'] ?? ch['sortOrder'] ?? ch['id'];
    if (raw is num) return raw.toInt();
    return int.tryParse('$raw') ?? (ch['id'] as num?)?.toInt() ?? 0;
  }

  int? _parseChannelId(dynamic idRaw) {
    if (idRaw is num) return idRaw.toInt();
    return int.tryParse('$idRaw');
  }

  void _applyChannelRows(List<Map<String, dynamic>> rows) {
    final football = <ChannelUi>[];
    final cat = {
      for (final g in _movieGenres) g.key: <ChannelUi>[],
    };
    cat['habari'] = [];

    for (final ch in rows) {
      if (ch['is_active'] == false) continue;
      final id = _parseChannelId(ch['id']);
      if (id == null) continue;
      var category = (ch['category']?.toString() ?? '').toLowerCase();
      if (category == 'mpira') category = 'football';
      final pr = ch['pointsRequired'] ?? ch['points_required'];
      final points = pr is num ? pr.toInt() : int.tryParse('$pr') ?? 0;
      final unlock = ch['unlockToFree'] == true || ch['unlock_to_free'] == true;
      final mapped = ChannelUi(
        id: id,
        name: ch['name']?.toString() ?? '',
        streamUrl: ch['stream_url']?.toString(),
        thumbnailUrl: ch['thumbnail_url']?.toString(),
        thumbnailEmoji: ch['thumbnail_emoji']?.toString(),
        color: ch['color']?.toString() ?? '#22c55e',
        category: category,
        pointsRequired: points,
        unlockToFree: unlock,
        isLive: ch['is_active'] != false,
        icon: category == 'football' ? 'soccer' : (category == 'movies' ? 'movie' : 'television'),
        apiRow: Map<String, dynamic>.from(ch),
      );
      if (category == 'football') {
        football.add(mapped);
      } else if (cat.containsKey(category)) {
        cat[category]!.add(mapped);
      } else {
        cat['habari']!.add(mapped);
      }
    }

    _football = football;
    _byCat = cat;
  }

  Future<void> _loadChannels() async {
    try {
      final all = await channelsApi.getChannels(timeout: _homeRequestTimeout);
      if (!mounted) return;
      if (all.isEmpty) {
        setState(() => _channelsLoadFailed = _allChannels().isEmpty);
        return;
      }
      final rows = all.map((raw) => Map<String, dynamic>.from(raw as Map)).toList()
        ..sort((a, b) {
          final c = _channelSortKey(a).compareTo(_channelSortKey(b));
          if (c != 0) return c;
          return ((a['id'] as num?) ?? 0).compareTo((b['id'] as num?) ?? 0);
        });

      setState(() {
        _applyChannelRows(rows);
        _channelsLoadFailed = false;
      });
      unawaited(HomeDataCache.saveChannels(rows));
    } catch (_) {
      if (mounted) {
        setState(() => _channelsLoadFailed = _allChannels().isEmpty);
      }
    }
  }

  Future<void> _loadMatches() async {
    final raw = await scheduleApi.getSchedule();
    if (!mounted) return;
    final parsed = <ScheduleItem>[
      for (var i = 0; i < raw.length; i++)
        if (raw[i] is Map)
          ScheduleItem.fromJson(Map<String, dynamic>.from(raw[i] as Map), index: i),
    ];
    setState(() => _schedule = parsed);
    if (raw.isNotEmpty) unawaited(HomeDataCache.saveMatches(raw));
    unawaited(resyncRatibaReminders(parsed));
  }

  /// Syncs admin channel mode + carousel + channels + matches (same as pull-to-refresh).
  void _setRefreshing(bool value) {
    if (_refreshing == value) return;
    setState(() => _refreshing = value);
    widget.onRefreshingChange?.call(value);
  }

  /// Syncs admin channel mode + carousel + channels + matches (same as pull-to-refresh).
  Future<void> reloadRemoteData() async {
    final now = DateTime.now();
    if (_lastRemoteReload != null &&
        now.difference(_lastRemoteReload!) < _homeReloadDebounce) {
      return;
    }
    _lastRemoteReload = now;
    _setRefreshing(true);
    _channelDataCache.clear();
    _channelDataCacheTime.clear();
    _playbackCache.clear();
    _playbackCacheTime.clear();
    if (mounted) setState(() => _channelsLoadFailed = false);
    try {
      unawaited(widget.syncPremiumSetting().catchError((_) {}));
      await _loadChannels();
      if (!mounted) return;
      await Future.wait([
        _loadSlides().catchError((_) {}),
        _loadMatches().catchError((_) {}),
      ]).timeout(_homeLoadTimeout, onTimeout: () => <void>[]);
    } finally {
      if (mounted) _setRefreshing(false);
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

  /// Opens playback using admin global + per-channel player engine.
  Future<void> _openVideoPlayback({
    required String url,
    String? channelName,
    int? channelId,
    Map<String, dynamic>? channelData,
    List<PlaybackStream>? fallbackStreams,
    String? playbackEngineOverride,
    ChannelPlaybackBundle? playbackBundle,
  }) async {
    if (playbackBundle != null) {
      final session = PlaybackSession.fromBundle(playbackBundle);
      await PlaybackOrchestrator.instance.openSession(
        context: context,
        session: session,
        extractClearKey: _extractClearKeyPayload,
        normalizeDrm: _normalizedDrmType,
        extractToken: _extractPlaybackToken,
        extractHeaders: _extractPlaybackHeaders,
        extractAudioLanguage: _extractAudioLanguage,
      );
      return;
    }
    await PlayerPlaybackService.open(
      context: context,
      url: url,
      channelName: channelName,
      channelId: channelId,
      channelData: channelData,
      fallbackStreams: fallbackStreams,
      playbackEngineOverride: playbackEngineOverride,
      extractClearKey: _extractClearKeyPayload,
      normalizeDrm: _normalizedDrmType,
      extractToken: _extractPlaybackToken,
      extractHeaders: _extractPlaybackHeaders,
      extractAudioLanguage: _extractAudioLanguage,
    );
  }

  String? _playbackEngineFromData(Map<String, dynamic>? data) {
    if (data == null) return null;
    final raw = data['effectiveEngine'] ??
        data['effective_engine'] ??
        data['playbackEngine'] ??
        data['playback_engine'];
    if (raw == null) return null;
    final e = raw.toString().trim();
    if (e.isEmpty || e == 'default' || e == 'global') return null;
    return e;
  }

  String _channelExternalUrl(ChannelUi ch, Map<String, dynamic>? channelData) {
    final rawUrl = channelData?['streamUrl'] ?? channelData?['stream_url'];
    final url = rawUrl != null && '$rawUrl'.trim().isNotEmpty
        ? '$rawUrl'.trim()
        : ch.streamUrl?.trim();
    return url ?? '';
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

  String _extractAudioLanguage(Map<String, dynamic>? channelData) {
    final policy = RemoteConfigService.playerConfig;
    final fallback = policy.defaultLanguage == 'en' ? 'en' : 'sw';
    if (channelData == null) return fallback;
    final raw = channelData['audioLanguage'] ?? channelData['audio_language'];
    final lang = raw?.toString().trim().toLowerCase() ?? '';
    if (lang.isEmpty || lang == 'auto' || lang == 'default') return fallback;
    if (lang == 'sw' || lang == 'en') return lang;
    if (lang.startsWith('en')) return 'en';
    return fallback;
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

  static const Duration _channelCacheTtl = Duration(minutes: 5);

  bool _isChannelDisabledByEmergency(int channelId) {
    final disabled =
        RemoteConfigService.cached?.emergency.disabledChannelIds ?? const [];
    return disabled.contains(channelId);
  }

  Future<ChannelPlaybackBundle?> _resolveChannelPlayback(ChannelUi ch) async {
    if (_isChannelDisabledByEmergency(ch.id)) return null;

    try {
      final playback = await channelsApi.getChannelPlayback(ch.id);
      if (playback.streams.isEmpty) return null;
      return playback;
    } catch (_) {
      return null;
    }
  }

  Future<Map<String, dynamic>?> _legacyChannelData(ChannelUi ch) async {
    if (_isCacheValid(ch.id) && _channelDataCache[ch.id] != null) {
      return Map<String, dynamic>.from(_channelDataCache[ch.id]!);
    }
    try {
      final data = await channelsApi.getChannel(ch.id);
      _channelDataCache[ch.id] = Map<String, dynamic>.from(data);
      _channelDataCacheTime[ch.id] = DateTime.now();
      return Map<String, dynamic>.from(data);
    } catch (_) {
      return null;
    }
  }

  Future<void> _prefetchPlaybackBundle(ChannelUi ch) async {
    if (_isChannelDisabledByEmergency(ch.id)) return;
    try {
      final playback = await _resolveChannelPlayback(ch);
      if (playback == null || playback.streams.isEmpty) return;
      final stream = playback.primary!;
      final channelData = playback.channelDataForStream(stream);
      _channelDataCache[ch.id] = Map<String, dynamic>.from(channelData);
      _channelDataCacheTime[ch.id] = DateTime.now();
    } catch (_) {
      // Non-fatal — instant open already used list URL.
    }
  }

  /// One-tap open: use URL already on the channel card — no network wait.
  Future<void> _instantOpenFromList(ChannelUi ch) async {
    final cachedData = _isCacheValid(ch.id) ? _channelDataCache[ch.id] : null;
    final quickData = cachedData ?? ch.apiRow;
    final quickUrl = _channelExternalUrl(ch, quickData);
    if (quickUrl.isEmpty) return;

    final channelData = quickData != null
        ? Map<String, dynamic>.from(quickData)
        : (ch.apiRow != null
            ? Map<String, dynamic>.from(ch.apiRow!)
            : <String, dynamic>{});

    await _openVideoPlayback(
      url: quickUrl,
      channelName: ch.name,
      channelId: ch.id,
      channelData: channelData,
      playbackEngineOverride: _playbackEngineFromData(channelData),
    );
    unawaited(_prefetchPlaybackBundle(ch));
  }

  Future<void> _launchChannelPlayback(ChannelUi ch) async {
    final cachedData = _isCacheValid(ch.id) ? _channelDataCache[ch.id] : null;
    final quickUrl = _channelExternalUrl(ch, cachedData ?? ch.apiRow);
    if (quickUrl.isNotEmpty) {
      await _instantOpenFromList(ch);
      return;
    }

    final playback = await _resolveChannelPlayback(ch);
    if (playback != null && playback.streams.isNotEmpty) {
      final stream = playback.primary!;
      final channelData = playback.channelDataForStream(stream);
      final enriched = ChannelPlaybackBundle(
        channelId: playback.channelId,
        name: playback.name,
        streams: playback.streams,
        playbackEngine: playback.playbackEngine,
        effectiveEngine: playback.effectiveEngine,
        audioLanguage: _extractAudioLanguage(channelData),
        streamType: playback.streamType,
        playerConfig: playback.playerConfig,
      );
      _channelDataCache[ch.id] = Map<String, dynamic>.from(channelData);
      _channelDataCacheTime[ch.id] = DateTime.now();
      await _openVideoPlayback(
        url: stream.url,
        channelName: ch.name,
        channelId: ch.id,
        channelData: channelData,
        playbackBundle: enriched,
      );
      return;
    }

    final legacy = await _legacyChannelData(ch);
    final legacyUrl = _channelExternalUrl(ch, legacy);
    if (legacyUrl.isNotEmpty && mounted) {
      final channelData = legacy ?? ch.apiRow;
      await _openVideoPlayback(
        url: legacyUrl,
        channelName: ch.name,
        channelId: ch.id,
        channelData: channelData,
        playbackEngineOverride: _playbackEngineFromData(channelData),
      );
      return;
    }

    if (mounted) await showChannelUnavailableModal(context);
  }

  bool _isCacheValid(int channelId) {
    final t = _channelDataCacheTime[channelId];
    return t != null && DateTime.now().difference(t) < _channelCacheTtl;
  }

  Future<void> _openChannel(ChannelUi ch) async {
    if (!RemoteConfigService.channelsEnabled) {
      _showFeatureDisabledSnack('Channels zimezimwa kwa muda. Jaribu tena baadaye.');
      return;
    }
    final canPlay = widget.isPremium ||
        (widget.channelsPremiumOnly ? ch.unlockToFree : ch.pointsRequired == 0);
    if (canPlay) {
      if (_isChannelDisabledByEmergency(ch.id)) {
        if (mounted) await showChannelUnavailableModal(context);
        return;
      }

      final quickUrl = _channelExternalUrl(ch, ch.apiRow);
      if (quickUrl.isNotEmpty) {
        try {
          await _instantOpenFromList(ch);
        } catch (_) {
          if (mounted) await showChannelUnavailableModal(context);
        }
        return;
      }

      setState(() => _loadingChannelId = ch.id);
      try {
        await _launchChannelPlayback(ch);
      } catch (_) {
        if (mounted) await showChannelUnavailableModal(context);
      } finally {
        if (mounted) setState(() => _loadingChannelId = null);
      }
      return;
    }
    // Locked premium / points channel → modern payment modal (voice step 0).
    await _openMalipo();
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
      setState(() => _loadingChannelId = ch.id);
      try {
        await _launchChannelPlayback(ch);
      } catch (_) {
        if (mounted) await showChannelUnavailableModal(context);
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
    final t = context.watch<ThemeController>().colors;
    final tab = widget.externalTabIndex;
    const bottomPad = 100.0;

    SchedulerBinding.instance.addPostFrameCallback((_) {
      widget.onPaymentsActiveChange(tab == 2);
    });

    final stackIndex = tab.clamp(0, 2);

    return Stack(
      fit: StackFit.expand,
      children: [
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [t.bg2, t.bg1],
              ),
            ),
          ),
        ),
        if (!RemoteConfigService.channelsEnabled && tab == 0)
          _FeatureDisabledOverlay(
            title: 'Channels hazipatikani',
            message: 'Channels zimezimwa kwa muda na msimamizi.',
          )
        else
        Column(
          children: [
            if (tab == 0 || tab == 1)
              HomeHeader(
                title: tab == 0 ? 'EaMax' : 'Ratiba',
                subtitle: tab == 0 ? 'MPIRA NA TAMTHILIA' : 'MIPANGO YA VIPINDI NA MECHI',
                points: widget.userPoints,
                onSearch: tab == 0 ? _toggleSearch : null,
                onSettings: () {
                  Navigator.of(context).push<void>(
                    MaterialPageRoute(builder: (_) => const SettingsScreen()),
                  );
                },
              ),
            if (tab == 0 && _searchOpen)
              HomeSearchBar(
                open: _searchOpen,
                query: _searchQuery,
                focusNode: _searchFocus,
                onChanged: (v) => setState(() => _searchQuery = v),
                onClear: () => setState(() => _searchQuery = ''),
              ),
            Expanded(
              child: IndexedStack(
                index: stackIndex,
                children: [
                  HomeMainTab(
                    initialLoading: _initialLoading,
                    refreshing: _refreshing,
                    channelsLoadFailed: _channelsLoadFailed,
                    carousel: _carousel,
                    allChannels: _allChannels(),
                    channelFilter: _homeChannelFilter,
                    onFilter: (k) => setState(() => _homeChannelFilter = k),
                    isPremium: widget.isPremium,
                    channelsPremiumOnly: widget.channelsPremiumOnly,
                    searchQuery: _searchQuery,
                    bottomPad: bottomPad,
                    onChannel: _openChannel,
                    onRefresh: _onRefresh,
                    loadingChannelId: _loadingChannelId,
                  ),
                  RatibaTab(
                    schedule: _schedule,
                    channels: _allChannels(),
                    initialLoading: _initialLoading,
                    refreshing: _refreshing,
                    bottomPad: bottomPad,
                    onRefresh: _onRefresh,
                    isPremium: widget.isPremium,
                    channelsPremiumOnly: widget.channelsPremiumOnly,
                    onOpenChannel: (ch) => unawaited(_openChannel(ch)),
                    onRequirePremium: () => unawaited(_openMalipo()),
                  ),
                  ProfileScreen(
                    bottomPadding: bottomPad,
                    isActive: tab == 2,
                    userPoints: widget.userPoints,
                    isPremium: widget.isPremium,
                    subscriptionEndDate: widget.subscriptionEndDate,
                    onWatchAd: widget.onWatchAd,
                    onPointsRefresh: widget.onPointsRefresh,
                    onOpenPayments: openPaymentsTab,
                    onOpenSettings: () {
                      Navigator.of(context).push<void>(
                        MaterialPageRoute(builder: (_) => const SettingsScreen()),
                      );
                    },
                  ),
                ],
              ),
            ),
          ],
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

class _FeatureDisabledOverlay extends StatelessWidget {
  const _FeatureDisabledOverlay({required this.title, required this.message});

  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.tv_off_outlined, size: 56, color: Color(0xFF6B7280)),
            const SizedBox(height: 16),
            Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.white)),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, color: Color(0xFF9CA3AF))),
          ],
        ),
      ),
    );
  }
}
