import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../config/ads.dart';
import '../config/api.dart';
import '../models/remote_config_bundle.dart';
import 'native_android_player.dart';

/// Fetches and caches the server-driven config bundle from GET /api/v2/config/bundle.
///
/// Drives pricing, player settings, feature flags, and emergency controls.
/// Falls back to last-known cache or built-in defaults on network failure.
class RemoteConfigService {
  static const Duration _fetchTimeout = Duration(seconds: 12);
  static const Duration _cacheTtl = Duration(minutes: 5);

  static RemoteConfigBundle? _cached;
  static DateTime? _cachedAt;

  /// Notifies widgets when admin pushes new config (tab visibility, labels, flags).
  static final ValueNotifier<int> configVersion = ValueNotifier(0);

  static bool get _cacheValid =>
      _cached != null &&
      _cachedAt != null &&
      DateTime.now().difference(_cachedAt!) < _cacheTtl;

  static RemoteConfigBundle? get cached => _cached;

  static RemoteFeatureFlags get featureFlags =>
      _cached?.featureFlags ??
      const RemoteFeatureFlags(
        channelsPremiumOnly: false,
        paymentsEnabled: true,
        channelsEnabled: true,
        adsEnabled: true,
        ratibaTab: true,
      );

  static List<RemoteSubscriptionPlan> get paymentPlans {
    final plans = _cached?.paymentConfig.plans;
    if (plans != null && plans.isNotEmpty) return plans;
    return defaultSubscriptionPlans();
  }

  static RemotePlayerConfig get playerConfig =>
      _cached?.playerConfig ??
      RemotePlayerConfig.fromJson(const {});

  static int get adRewardPoints =>
      _cached?.ads.rewardPoints ?? pointsPerReward;

  static bool get paymentsEnabled => featureFlags.paymentsEnabled;

  static bool get channelsEnabled => featureFlags.channelsEnabled;

  static bool get adsEnabled => featureFlags.adsEnabled;

  static bool get ratibaTabEnabled => featureFlags.ratibaTab;

  /// Section label from admin Control Center / settings (football.*, movies.*).
  static String sectionLabel(String section, String key, String fallback) {
    final root = _cached?.sectionLabels;
    if (root == null || root.isEmpty) return fallback;
    final sec = root[section];
    if (sec is Map) {
      final v = sec[key]?.toString().trim();
      if (v != null && v.isNotEmpty) return v;
    }
    return fallback;
  }

  static String categoryLabel(String categoryKey) {
    switch (categoryKey) {
      case 'football':
      case 'mpira':
        return sectionLabel('football', 'channelsTitle', 'Mpira');
      case 'tamthilia':
        return sectionLabel('movies', 'categoryTamthilia', 'Tamthilia');
      case 'wanyama':
        return sectionLabel('movies', 'categoryWanyama', 'Wanyama');
      case 'katuni':
        return sectionLabel('movies', 'categoryKatuni', 'Katuni');
      case 'habari':
        return sectionLabel('movies', 'categoryHabari', 'Habari');
      case 'sayansi':
        return sectionLabel('movies', 'categorySayansi', 'Sayansi');
      case 'movies':
        return sectionLabel('movies', 'categoryMovies', 'Movies');
      default:
        if (categoryKey.isEmpty) return categoryKey;
        return '${categoryKey[0].toUpperCase()}${categoryKey.substring(1).toLowerCase()}';
    }
  }

  static Future<RemoteConfigBundle?> fetch({bool forceRefresh = false}) async {
    if (!forceRefresh && _cacheValid) {
      await _syncNativePlayerConfig();
      return _cached;
    }

    try {
      final response = await apiClient
          .get('/api/v2/config/bundle', queryParameters: {'platform': 'android'})
          .timeout(_fetchTimeout);

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final bundle = RemoteConfigBundle.fromJson(
          Map<String, dynamic>.from(response.data as Map),
        );
        final versionChanged = _cached?.configVersion != bundle.configVersion;
        _cached = bundle;
        _cachedAt = DateTime.now();
        if (versionChanged) {
          configVersion.value = bundle.configVersion;
        }
        await _syncNativePlayerConfig();
        return bundle;
      }
    } on DioError catch (e) {
      debugPrint('[RemoteConfigService] fetch error: ${e.message}');
    } catch (e, st) {
      debugPrint('[RemoteConfigService] fetch error: $e\n$st');
    }

    await _syncNativePlayerConfig();
    return _cached;
  }

  static Future<void> _syncNativePlayerConfig() async {
    if (!NativeAndroidPlayer.supported) return;
    final pc = playerConfig;
    try {
      await NativeAndroidPlayer.syncPlayerConfig(
        bufferMinMs: pc.bufferMinMs,
        bufferMaxMs: pc.bufferMaxMs,
        retryMax: pc.retryMax,
        retryDelayMs: pc.retryDelayMs,
        failoverToWebview: pc.failoverToWebview,
        reconnectEnabled: pc.reconnectEnabled,
      );
    } catch (e) {
      debugPrint('[RemoteConfigService] native player config sync: $e');
    }
  }

  static void invalidateCache() {
    _cachedAt = null;
  }
}
