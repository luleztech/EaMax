import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/ads.dart';
import '../config/api.dart';
import '../config/payment_helpers.dart';
import '../models/api_exceptions.dart';
import '../models/app_config.dart';
import '../models/promotion.dart';
import '../screens/force_update_screen.dart';
import '../screens/maintenance_screen.dart';
import '../services/promotion_service.dart';
import '../widgets/promotion_popup.dart';
import '../services/app_config_service.dart';
import '../services/remote_config_service.dart';
import '../services/realtime_service.dart';
import '../services/home_data_cache.dart';
import '../services/update_state.dart';
import '../services/fcm_notifications.dart';
import '../utils/premium_snapshot.dart';
import '../services/user_premium_cache.dart';
import '../services/user_id.dart';
import '../widgets/ad_reward_modal.dart';
import '../widgets/notification_permission_modal.dart';
import '../widgets/offline_required_modal.dart';
import 'combined_home.dart';
import 'main_shell.dart';
import '../screens/loader_screen.dart';

class StreamingApp extends StatefulWidget {
  const StreamingApp({super.key});

  @override
  State<StreamingApp> createState() => _StreamingAppState();
}

class _StreamingAppState extends State<StreamingApp> with WidgetsBindingObserver {
  final GlobalKey<CombinedHomeState> _homeKey = GlobalKey<CombinedHomeState>();

  bool _premium = false;
  DateTime? _premiumExpiresAt;
  bool _channelsPremiumOnly = false;
  int _points = 0;
  bool _congratsOpen = false;

  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;
  Timer? _pendingPaymentWatcher;
  Timer? _premiumRefreshTimer;
  Timer? _configRefreshTimer;
  bool _checkingPendingPayment = false;
  bool _offlineModalVisible = false;
  bool _retryingConnection = false;
  bool _splashDone = false;
  bool _notifPermissionVisible = false;
  bool _maintenanceRetrying = false;
  bool _appConfigChecked = false;
  AppConfig? _appConfig;

  List<Promotion> _promotionQueue = [];
  int _promotionIndex = 0;
  bool _promotionsLoaded = false;
  /// Rewarded-ad sheet (aligned with RN `AdModal.js`).
  bool _adOverlayVisible = false;
  AdRewardPhase _adPhase = AdRewardPhase.prompt;
  int _lastPointsEarned = pointsPerReward;
  /// Set synchronously in [RewardedAd] reward callback so [onAdDismissedFullScreenContent] is safe.
  bool _rewardEarnedThisSession = false;
  bool _homeRefreshing = false;
  bool _bootstrapReady = false;
  final DateTime _appStartedAt = DateTime.now();

  DateTime? _lastFcmSyncAt;
  Timer? _registrationRetryTimer;

  static const _fcmSyncCooldown = Duration(minutes: 2);
  static const _congratsKey = 'premiumCongratsShown';
  static const _channelsPremiumOnlyCacheKey = 'channels_premium_only_cached_v1';
  static const _maxAdLoadAttempts = 3;

  RealtimeEventHandler? _premiumRealtimeHandler;
  RealtimeEventHandler? _pointsRealtimeHandler;
  RealtimeEventHandler? _paymentRealtimeHandler;

  Future<void> _setupRealtime(String uid) async {
    if (kIsWeb) return;
    final rt = RealtimeService.instance;

    _premiumRealtimeHandler ??= (data) {
      unawaited(_applyUserPremiumData(data, uid: uid));
    };
    _pointsRealtimeHandler ??= (data) {
      if (!mounted) return;
      final pts = int.tryParse('${data['points']}');
      if (pts != null) setState(() => _points = pts);
    };
    _paymentRealtimeHandler ??= (_) {
      unawaited(_checkPendingPayment());
    };

    rt.subscribe(kRealtimePremiumChannel, _premiumRealtimeHandler!);
    rt.subscribe(kRealtimePointsChannel, _pointsRealtimeHandler!);
    rt.subscribe(kRealtimePaymentChannel, _paymentRealtimeHandler!);
    await rt.connect(uid);
  }

  Future<void> _hydrateChannelsPremiumOnlyFromCache() async {
    final prefs = await SharedPreferences.getInstance();
    final cached = prefs.getBool(_channelsPremiumOnlyCacheKey);
    if (cached != null && mounted) {
      setState(() => _channelsPremiumOnly = cached);
    }
  }

  /// Persists on success; on failure restores last known value so offline / failed bootstrap
  /// does not default to “points mode” when the real mode is premium-only.
  Future<void> refreshChannelsPremiumOnlySetting() async {
    final fromBundle = RemoteConfigService.cached?.featureFlags.channelsPremiumOnly;
    if (fromBundle != null && mounted) {
      setState(() => _channelsPremiumOnly = fromBundle);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_channelsPremiumOnlyCacheKey, fromBundle);
      return;
    }
    try {
      final s = await settingsApi.getChannelsPremiumOnly();
      if (!mounted) return;
      setState(() => _channelsPremiumOnly = s);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_channelsPremiumOnlyCacheKey, s);
    } catch (_) {
      final prefs = await SharedPreferences.getInstance();
      final cached = prefs.getBool(_channelsPremiumOnlyCacheKey);
      if (cached != null && mounted) {
        setState(() => _channelsPremiumOnly = cached);
      }
    }
  }

  Future<void> _applyUserPremiumData(
    Map<String, dynamic> userData, {
    required String uid,
  }) async {
    if (!mounted) return;
    final blocked = userData['blocked'] == true;
    final endRaw = userData['subscriptionEndDate'] ??
        userData['premiumExpiresAt'] ??
        userData['premium_expires_at'];
    DateTime? expires;
    if (endRaw != null && endRaw.toString().isNotEmpty) {
      expires = DateTime.tryParse(endRaw.toString());
    }
    final apiPremium =
        userData['isPremium'] == true || userData['is_premium'] == true;
    final premium = PremiumSnapshot.resolveActive(
      blocked: blocked,
      apiPremium: apiPremium,
      expiresAt: expires,
    );
    final pts = (userData['points'] as num?)?.toInt() ?? _points;
    setState(() {
      _points = pts;
      _premium = premium;
      _premiumExpiresAt = premium ? expires : null;
    });
    unawaited(UserPremiumCache.save(
      uid: uid,
      premium: premium,
      expiresAt: expires,
      points: pts,
    ));
    if (premium) {
      final prefs = await SharedPreferences.getInstance();
      final shown = prefs.getString('${_congratsKey}_$uid');
      if (shown != '1' && mounted) {
        setState(() => _congratsOpen = true);
        await prefs.setString('${_congratsKey}_$uid', '1');
      }
    }
    unawaited(_syncFcmIfAllowed());
  }

  Future<void> _refreshUserForUi() async {
    try {
      final uid = await ensureLocalUserId();
      await registerUserInDatabase(id: uid, maxRetries: 2);
      final userData = await userApi
          .getUser(uid)
          .timeout(const Duration(seconds: 8));
      await _applyUserPremiumData(userData, uid: uid);
    } on ApiRateLimitedException {
      debugPrint('[Premium] UI refresh rate limited — using cache');
      await _hydratePremiumFromCache();
    } catch (e) {
      debugPrint('[Premium] UI refresh failed: $e');
      await _hydratePremiumFromCache();
    }
  }

  Future<void> _refreshUser({int maxAttempts = 2}) async {
    try {
      final uid = await ensureLocalUserId();

      for (var attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          final userData = await userApi.getUser(uid);
          await _applyUserPremiumData(userData, uid: uid);
          return;
        } on ApiRateLimitedException catch (e) {
          debugPrint('[Premium] getUser rate limited ($attempt/$maxAttempts)');
          await _hydratePremiumFromCache();
          if (attempt < maxAttempts) {
            final waitSec = (e.retryAfterSeconds ?? attempt * 2).clamp(2, 8);
            await Future<void>.delayed(Duration(seconds: waitSec));
            continue;
          }
          return;
        } catch (e) {
          final msg = e.toString().toLowerCase();
          final notFound = msg.contains('not found') || msg.contains('404');
          debugPrint('[Premium] getUser failed ($attempt/$maxAttempts): $e');
          if (notFound) {
            await ensureUserRegistered(uid);
            if (attempt < maxAttempts) continue;
          }
          if (attempt < maxAttempts) {
            await Future<void>.delayed(Duration(seconds: attempt));
            continue;
          }
        }
      }
      await _hydratePremiumFromCache();
    } catch (e) {
      debugPrint('[Premium] _refreshUser error: $e');
      await _hydratePremiumFromCache();
    }
  }

  Future<void> _hydratePremiumFromCache() async {
    try {
      final localId = await getLocalUserId();
      final cached = await UserPremiumCache.load();
      if (localId == null || cached == null || cached.uid != localId) return;
      final premium = PremiumSnapshot.resolveActive(
        blocked: false,
        apiPremium: cached.premium,
        expiresAt: cached.expiresAt,
      );
      if (!mounted) return;
      setState(() {
        _premium = premium;
        _premiumExpiresAt = premium ? cached.expiresAt : null;
        _points = cached.points;
      });
    } catch (_) {}
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    appUpdateState.addListener(_onGlobalUpdateStateChanged);
    unawaited(_hydrateChannelsPremiumOnlyFromCache());
    unawaited(HomeDataCache.loadChannels());
    unawaited(HomeDataCache.loadCarousel());
    onPremiumUnlockRequested = ({userPayload}) => _onPaymentSuccess(userPayload: userPayload);
    _bootstrap();
    unawaited(_initConnectivity());
  }

  @override
  void dispose() {
    appUpdateState.removeListener(_onGlobalUpdateStateChanged);
    WidgetsBinding.instance.removeObserver(this);
    _connectivitySub?.cancel();
    _pendingPaymentWatcher?.cancel();
    _premiumRefreshTimer?.cancel();
    _registrationRetryTimer?.cancel();
    _configRefreshTimer?.cancel();
    unawaited(RealtimeService.instance.disconnect());
    onPremiumUnlockRequested = null;
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_refreshUser());
      unawaited(_syncFcmIfAllowed());
      unawaited(ensureLocalUserId().then((uid) => RealtimeService.instance.connect(uid)));
      unawaited(_maybePromptNotificationPermission());
      if (_splashDone && _appConfigChecked && _appConfig?.shouldBlockAccess != true) {
        unawaited(_loadPromotions());
      }
      final home = _homeKey.currentState;
      if (home != null &&
          DateTime.now().difference(_appStartedAt) > const Duration(seconds: 60)) {
        unawaited(home.reloadRemoteData());
      }
    }
  }

  Future<void> _initConnectivity() async {
    if (kIsWeb) return;
    final connectivity = Connectivity();
    final initial = await connectivity.checkConnectivity();
    _applyConnectivity(initial);
    _connectivitySub = connectivity.onConnectivityChanged.listen(_applyConnectivity);
  }

  bool _hasNetwork(List<ConnectivityResult> results) {
    if (results.isEmpty) return false;
    return results.any((r) => r != ConnectivityResult.none);
  }

  void _applyConnectivity(List<ConnectivityResult> results) {
    if (!mounted || kIsWeb) return;
    final online = _hasNetwork(results);
    if (online) {
      if (_offlineModalVisible) {
        setState(() => _offlineModalVisible = false);
        unawaited(_onConnectivityRestored());
      }
    } else {
      setState(() => _offlineModalVisible = true);
    }
  }

  /// After Wi‑Fi/mobile data is available: reload admin settings, channels, and user so badges match the server.
  Future<void> _onConnectivityRestored() async {
    await _homeKey.currentState?.reloadRemoteData();
    await _refreshUser();
    await _syncFcmIfAllowed();
    await _checkPendingPayment();
    if (_splashDone && _appConfigChecked && _appConfig?.shouldBlockAccess != true) {
      await _loadPromotions();
    }
  }

  Future<void> _retryConnectionTap() async {
    if (_retryingConnection) return;
    setState(() => _retryingConnection = true);
    try {
      final r = await Connectivity().checkConnectivity();
      if (!mounted) return;
      if (_hasNetwork(r)) {
        setState(() => _offlineModalVisible = false);
        await _onConnectivityRestored();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Bado hakuna muunganisho. Washa data ya simu au Wi‑Fi.'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _retryingConnection = false);
    }
  }

  Future<void> _fetchRemoteConfig({bool forceRefresh = false}) async {
    try {
      await RemoteConfigService.fetch(forceRefresh: forceRefresh);
      if (mounted) {
        await refreshChannelsPremiumOnlySetting();
      }
    } catch (_) {}
  }

  Future<void> _fetchAppConfig({bool forceRefresh = false}) async {
    try {
      final config = await AppConfigService.fetch(forceRefresh: forceRefresh);
      if (mounted) {
        setState(() {
          _appConfig = config;
          if (_maintenanceRetrying) _maintenanceRetrying = false;
        });
      }
    } catch (_) {}
  }

  Future<void> _retryAfterMaintenance() async {
    if (_maintenanceRetrying) return;
    setState(() => _maintenanceRetrying = true);
    AppConfigService.invalidateCache();
    RemoteConfigService.invalidateCache();
    await _fetchAppConfig(forceRefresh: true);
    await _fetchRemoteConfig(forceRefresh: true);
  }

  void _onGlobalUpdateStateChanged() {
    if (!mounted) return;
    final blockAccess = appUpdateState.config?.shouldBlockAccess == true;
    setState(() {
      _appConfig = appUpdateState.config;
      if (blockAccess) {
        _points = 0;
        _premium = false;
        _congratsOpen = false;
        _offlineModalVisible = false;
      }
    });
    if (!blockAccess) {
      unawaited(_refreshUser());
    }
  }

  Future<void> _bootstrap() async {
    final cached = AppConfigService.cached;
    if (cached != null && mounted) {
      setState(() => _appConfig = cached);
    }

    final configFuture = _fetchAppConfig(forceRefresh: true);
    final remoteFuture = _fetchRemoteConfig(forceRefresh: true);
    await Future.any([
      Future.wait([configFuture, remoteFuture]).then((_) {}),
      Future<void>.delayed(const Duration(milliseconds: 1200)),
    ]);

    if (!mounted) return;
    setState(() {
      _appConfigChecked = true;
      _appConfig ??= AppConfigService.cached;
    });

    if (_appConfig?.shouldBlockAccess == true) {
      return;
    }

    unawaited(_finishBootstrap());
  }

  Future<void> _prefetchHomeCatalog() async {
    try {
      final all = await channelsApi.getChannels();
      if (all.isEmpty) return;
      final rows = all.map((raw) => Map<String, dynamic>.from(raw as Map)).toList();
      await HomeDataCache.saveChannels(rows);
    } catch (_) {}
  }

  Future<void> _finishBootstrap() async {
    final uid = await ensureLocalUserId();
    await registerUserInDatabase(id: uid, maxRetries: 5);
    unawaited(retryPendingRegistrations());
    await _hydratePremiumFromCache();
    unawaited(getOrCreateUserId());
    await refreshChannelsPremiumOnlySetting();
    await _prefetchHomeCatalog();
    await _refreshUser();
    await _loadPromotions();
    await setupFcmLocalNotifications();
    await _checkPendingPayment();
    _startPendingPaymentWatcher();
    _startPremiumRefreshWatcher();
    _registrationRetryTimer?.cancel();
    _registrationRetryTimer = Timer.periodic(const Duration(minutes: 2), (_) {
      unawaited(retryPendingRegistrations());
    });
    _configRefreshTimer?.cancel();
    _configRefreshTimer = Timer.periodic(const Duration(minutes: 30), (_) {
      unawaited(_fetchAppConfig(forceRefresh: true));
      unawaited(_fetchRemoteConfig(forceRefresh: true));
    });
    unawaited(_setupRealtime(uid));
    if (mounted) setState(() => _bootstrapReady = true);
  }

  Future<void> _maybePromptNotificationPermission() async {
    if (kIsWeb || !_splashDone || _notifPermissionVisible) return;
    if (await isEamaxNotificationPermissionGranted()) {
      await _syncFcmIfAllowed();
      return;
    }
    if (mounted) setState(() => _notifPermissionVisible = true);
  }

  Future<void> _onNotifAllow() async {
    setState(() => _notifPermissionVisible = false);
    await Future<void>.delayed(const Duration(milliseconds: 400));
    if (await requestEamaxNotificationPermission()) {
      await _syncFcmIfAllowed();
    }
  }

  void _onNotifSkip() {
    setState(() => _notifPermissionVisible = false);
  }

  Future<void> _loadPromotions() async {
    try {
      promotionService.invalidateCache();
      final popups = await promotionService.fetchForLaunch(forceRefresh: true);
      if (!mounted) return;
      setState(() {
        if (popups.isNotEmpty || _promotionQueue.isEmpty) {
          _promotionQueue = popups;
          _promotionIndex = 0;
        }
        _promotionsLoaded = true;
      });
    } catch (_) {
      if (mounted) setState(() => _promotionsLoaded = true);
    }
  }

  void _dismissCurrentPromotion() {
    if (_promotionIndex + 1 < _promotionQueue.length) {
      setState(() => _promotionIndex += 1);
    } else {
      setState(() {
        _promotionQueue = [];
        _promotionIndex = 0;
      });
    }
  }

  Promotion? get _activePromotion {
    if (_promotionQueue.isEmpty || _promotionIndex >= _promotionQueue.length) {
      return null;
    }
    return _promotionQueue[_promotionIndex];
  }

  Future<void> _syncFcmIfAllowed() async {
    if (kIsWeb) return;
    final now = DateTime.now();
    if (_lastFcmSyncAt != null &&
        now.difference(_lastFcmSyncAt!) < _fcmSyncCooldown) {
      return;
    }
    _lastFcmSyncAt = now;
    final uid = await getLocalUserId();
    if (uid == null) return;
    if (!await isEamaxNotificationPermissionGranted()) return;
    await ensureEamaxPushReady(uid, isPremium: _premium);
  }

  void _startPendingPaymentWatcher() {
    _pendingPaymentWatcher?.cancel();
    _pendingPaymentWatcher = Timer.periodic(const Duration(seconds: 4), (_) {
      unawaited(_checkPendingPayment());
    });
  }

  /// Keep premium state aligned with the server and revoke only when expiry passes.
  void _startPremiumRefreshWatcher() {
    _premiumRefreshTimer?.cancel();
    _premiumRefreshTimer = Timer.periodic(
      Duration(seconds: _premium ? 60 : 10),
      (_) => unawaited(_refreshUser(maxAttempts: 2)),
    );
  }

  Future<void> _onPaymentSuccess({Map<String, dynamic>? userPayload}) async {
    final uid = await ensureLocalUserId();
    if (userPayload != null) {
      await _applyUserPremiumData(userPayload, uid: uid);
    }
    await retryPendingRegistrations();

    if (!_premium) {
      for (var i = 0; i < 5; i++) {
        await Future<void>.delayed(const Duration(seconds: 2));
        await _refreshUser(maxAttempts: 3);
        if (_premium) break;
      }
    } else {
      await _refreshUser(maxAttempts: 2);
    }

    await _homeKey.currentState?.reloadRemoteData();
    if (mounted) setState(() {});
  }

  Future<void> _checkPendingPayment() async {
    if (_checkingPendingPayment) return;
    _checkingPendingPayment = true;
    final prefs = await SharedPreferences.getInstance();
    final pending = prefs.getString('pendingPaymentOrderId')?.trim();
    if (pending == null || pending.isEmpty) {
      _checkingPendingPayment = false;
      return;
    }
    try {
      final res = await paymentsApi.checkPaymentStatus(pending);
      final st = res['status'] ?? res['raw']?['data']?[0]?['payment_status'];
      if (isPaymentCompleted(st)) {
        await prefs.remove('pendingPaymentOrderId');
        final userPayload = userPayloadFromPaymentResponse(res);
        await _onPaymentSuccess(userPayload: userPayload);
      } else if (isPaymentTerminalFailure(st)) {
        await prefs.remove('pendingPaymentOrderId');
      }
    } catch (_) {
      // Keep silent here; watcher will retry automatically.
    } finally {
      _checkingPendingPayment = false;
    }
  }

  void _openAd() {
    if (_premium) return;
    setState(() {
      _adOverlayVisible = true;
      _adPhase = AdRewardPhase.prompt;
      _lastPointsEarned = pointsPerReward;
    });
  }

  void _closeAdOverlay() {
    setState(() {
      _adOverlayVisible = false;
      _adPhase = AdRewardPhase.prompt;
    });
  }

  Future<void> _onWatchPressed() async {
    if (kIsWeb) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Matangazo hayapatikani kwenye web. Tumia app ya simu.')),
        );
      }
      _closeAdOverlay();
      return;
    }
    setState(() => _adPhase = AdRewardPhase.loading);
    _tryLoadRewarded(attempt: 0);
  }

  void _tryLoadRewarded({required int attempt}) {
    RewardedAd.load(
      adUnitId: rewardedAdUnitIdAndroid,
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (ad) {
          _rewardEarnedThisSession = false;
          ad.fullScreenContentCallback = FullScreenContentCallback(
            onAdDismissedFullScreenContent: (a) {
              a.dispose();
              if (!mounted) return;
              final gotReward = _rewardEarnedThisSession;
              _rewardEarnedThisSession = false;
              setState(() {
                if (gotReward) {
                  _adOverlayVisible = true;
                  _adPhase = AdRewardPhase.success;
                } else {
                  _adOverlayVisible = false;
                  _adPhase = AdRewardPhase.prompt;
                }
              });
              _refreshUser();
            },
          );
          if (!mounted) return;
          setState(() => _adOverlayVisible = false);
          ad.show(
            onUserEarnedReward: (a, r) async {
              _rewardEarnedThisSession = true;
              var earned = pointsPerReward;
              final uid = await getOrCreateUserId();
              if (uid != null) {
                try {
                  final res = await userApi.recordAdWatched(uid, points: pointsPerReward);
                  earned = (res['pointsAdded'] as num?)?.toInt() ?? pointsPerReward;
                } catch (_) {}
              }
              await _refreshUser();
              if (mounted) {
                setState(() => _lastPointsEarned = earned);
              }
            },
          );
        },
        onAdFailedToLoad: (e) {
          if (attempt + 1 < _maxAdLoadAttempts) {
            _tryLoadRewarded(attempt: attempt + 1);
          } else if (mounted) {
            setState(() => _adPhase = AdRewardPhase.error);
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  'Imeshindwa kupakia tangazo: ${e.message}',
                  style: const TextStyle(fontSize: 14),
                ),
                behavior: SnackBarBehavior.floating,
              ),
            );
          }
        },
      ),
    );
  }

  Future<void> _onWatchAgain() async {
    setState(() => _adPhase = AdRewardPhase.loading);
    _tryLoadRewarded(attempt: 0);
  }

  @override
  Widget build(BuildContext context) {
    if (!_splashDone) {
      return LoaderScreen(
        canProceed: _appConfigChecked && (_bootstrapReady || _appConfig?.shouldBlockAccess == true),
        onDone: () {
          setState(() => _splashDone = true);
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (_appConfig?.shouldBlockAccess != true &&
                (!_promotionsLoaded || _promotionQueue.isEmpty)) {
              unawaited(_loadPromotions());
            }
            unawaited(_maybePromptNotificationPermission());
          });
        },
      );
    }

    // ── Maintenance mode ──────────────────────────────────────────────────
    if (_appConfig?.maintenanceMode == true) {
      return MaintenanceScreen(
        config: _appConfig!,
        onRetry: _retryAfterMaintenance,
        isRetrying: _maintenanceRetrying,
      );
    }

    // ── Force update / version gate ───────────────────────────────────────
    if (_appConfig != null && _appConfig!.shouldBlockAccess) {
      return ForceUpdateScreen(config: _appConfig!);
    }

    final activePromo = _promotionsLoaded ? _activePromotion : null;

    return Stack(
      fit: StackFit.expand,
      children: [
        MainShell(
          homeKey: _homeKey,
          isPremium: _premium,
          subscriptionEndDate: _premiumExpiresAt,
          channelsPremiumOnly: _channelsPremiumOnly,
          userPoints: _points,
          onWatchAd: _openAd,
          onPointsRefresh: _refreshUserForUi,
          onPaymentSuccess: _onPaymentSuccess,
          syncPremiumSetting: refreshChannelsPremiumOnlySetting,
          refreshing: _homeRefreshing,
          onRefreshingChange: (v) {
            if (_homeRefreshing != v && mounted) setState(() => _homeRefreshing = v);
          },
        ),
        if (_adOverlayVisible)
          Positioned.fill(
            child: AdRewardModal(
              phase: _adPhase,
              pointsEarned: _lastPointsEarned,
              isWeb: kIsWeb,
              onWatch: _onWatchPressed,
              onClose: _closeAdOverlay,
              onRetry: () {
                setState(() => _adPhase = AdRewardPhase.loading);
                _tryLoadRewarded(attempt: 0);
              },
              onWatchAgain: _onWatchAgain,
            ),
          ),
        if (_congratsOpen)
          Positioned.fill(
            child: GestureDetector(
              onTap: () => setState(() => _congratsOpen = false),
              child: Container(
                color: Colors.black87,
                alignment: Alignment.center,
                padding: const EdgeInsets.all(24),
                child: GestureDetector(
                  onTap: () {},
                  child: Container(
                    constraints: const BoxConstraints(maxWidth: 360),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      gradient: const LinearGradient(colors: [Color(0xFFEAB308), Color(0xFFCA8A04), Color(0xFFA16207)]),
                      border: Border.all(color: const Color(0x80EAB308)),
                    ),
                    padding: const EdgeInsets.all(28),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.star, size: 48, color: Colors.white),
                        const SizedBox(height: 16),
                        const Text('Hongera! Umefanikiwa', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white)),
                        const SizedBox(height: 12),
                        Text(
                          'Umajiunga nasi kama mwanachama wa Premium. Channels zote sasa ni bure kwako – hakuna matangazo, hakuna vikwazo hadi muda wako utakapokwisha.',
                          textAlign: TextAlign.center,
                          style: TextStyle(fontSize: 15, color: Colors.white.withValues(alpha: 0.95), height: 1.45),
                        ),
                        const SizedBox(height: 24),
                        FilledButton(
                          style: FilledButton.styleFrom(backgroundColor: Colors.white),
                          onPressed: () => setState(() => _congratsOpen = false),
                          child: const Text('Sawa', style: TextStyle(color: Color(0xFFA16207), fontWeight: FontWeight.bold)),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        if (!kIsWeb && _offlineModalVisible)
          Positioned.fill(
            child: OfflineRequiredModal(
              isRetrying: _retryingConnection,
              onRetry: _retryConnectionTap,
            ),
          ),
        NotificationPermissionModal(
          visible: _notifPermissionVisible,
          onAllow: () => unawaited(_onNotifAllow()),
          onSkip: _onNotifSkip,
        ),
        if (activePromo != null)
          Positioned.fill(
            child: PromotionPopupOverlay(
              key: ValueKey<int>(activePromo.id),
              promotion: activePromo,
              onDismiss: _dismissCurrentPromotion,
              onPaymentSuccess: ({userPayload}) => _onPaymentSuccess(userPayload: userPayload),
            ),
          ),
      ],
    );
  }
}
