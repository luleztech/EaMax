import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/ads.dart';
import '../config/api.dart';
import '../config/payment_helpers.dart';
import '../services/fcm_notifications.dart';
import '../services/user_id.dart';
import '../theme/app_theme.dart';
import '../widgets/ad_reward_modal.dart';
import '../widgets/offline_required_modal.dart';
import 'combined_home.dart';

class StreamingApp extends StatefulWidget {
  const StreamingApp({super.key});

  @override
  State<StreamingApp> createState() => _StreamingAppState();
}

class _StreamingAppState extends State<StreamingApp> {
  final GlobalKey<CombinedHomeState> _homeKey = GlobalKey<CombinedHomeState>();

  bool _premium = false;
  bool _channelsPremiumOnly = false;
  int _points = 0;
  bool _congratsOpen = false;

  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;
  Timer? _pendingPaymentWatcher;
  bool _checkingPendingPayment = false;
  bool _offlineModalVisible = false;
  bool _retryingConnection = false;

  /// Rewarded-ad sheet (aligned with RN `AdModal.js`).
  bool _adOverlayVisible = false;
  AdRewardPhase _adPhase = AdRewardPhase.prompt;
  int _lastPointsEarned = pointsPerReward;
  /// Set synchronously in [RewardedAd] reward callback so [onAdDismissedFullScreenContent] is safe.
  bool _rewardEarnedThisSession = false;

  static const _congratsKey = 'premiumCongratsShown';
  static const _channelsPremiumOnlyCacheKey = 'channels_premium_only_cached_v1';
  static const _maxAdLoadAttempts = 3;

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

  Future<void> _refreshUser() async {
    try {
      final uid = await getStoredUserId();
      if (uid == null) return;
      final userData = await userApi.getUser(uid);
      if (!mounted) return;
      final premium = userData['isPremium'] == true;
      final pts = (userData['points'] as num?)?.toInt() ?? 0;
      setState(() {
        _points = pts;
        _premium = premium;
      });
      if (premium) {
        final prefs = await SharedPreferences.getInstance();
        final shown = prefs.getString('${_congratsKey}_$uid');
        if (shown != '1') {
          setState(() => _congratsOpen = true);
          await prefs.setString('${_congratsKey}_$uid', '1');
        }
      }
    } catch (_) {}
  }

  @override
  void initState() {
    super.initState();
    unawaited(_hydrateChannelsPremiumOnlyFromCache());
    _bootstrap();
    unawaited(_initConnectivity());
  }

  @override
  void dispose() {
    _connectivitySub?.cancel();
    _pendingPaymentWatcher?.cancel();
    super.dispose();
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
    await _syncFcm();
    await _checkPendingPayment();
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

  Future<void> _bootstrap() async {
    await getOrCreateUserId();
    await refreshChannelsPremiumOnlySetting();
    await _refreshUser();
    await setupFcmLocalNotifications();
    await _syncFcm();
    await _checkPendingPayment();
    _startPendingPaymentWatcher();
  }

  void _startPendingPaymentWatcher() {
    _pendingPaymentWatcher?.cancel();
    _pendingPaymentWatcher = Timer.periodic(const Duration(seconds: 5), (_) {
      unawaited(_checkPendingPayment());
    });
  }

  Future<void> _syncFcm() async {
    if (kIsWeb) return;
    final uid = await getStoredUserId();
    if (uid == null) return;
    try {
      await FirebaseMessaging.instance.subscribeToTopic('all_users');
    } catch (_) {}
    try {
      final tok = await FirebaseMessaging.instance.getToken();
      if (tok != null && tok.isNotEmpty) {
        await userApi.registerFcmToken(uid, tok);
      }
    } catch (_) {}
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
      final res = await paymentsApi.checkZenoStatus(pending);
      final st = res['status'] ?? res['raw']?['data']?[0]?['payment_status'];
      if (isPaymentCompleted(st)) {
        await prefs.remove('pendingPaymentOrderId');
        await _refreshUser();
        await _homeKey.currentState?.reloadRemoteData();
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
    return Stack(
      fit: StackFit.expand,
      children: [
        CombinedHome(
          key: _homeKey,
          isPremium: _premium,
          channelsPremiumOnly: _channelsPremiumOnly,
          userPoints: _points,
          onWatchAd: _openAd,
          onPointsRefresh: _refreshUser,
          onPaymentsActiveChange: (_) {},
          syncPremiumSetting: refreshChannelsPremiumOnlySetting,
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
      ],
    );
  }
}
