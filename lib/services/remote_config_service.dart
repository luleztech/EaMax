import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../config/api.dart';
import '../models/remote_config_bundle.dart';

/// Fetches and caches the server-driven config bundle from GET /api/v2/config/bundle.
///
/// Drives pricing, player settings, feature flags, and emergency controls.
/// Falls back to last-known cache or built-in defaults on network failure.
class RemoteConfigService {
  static const Duration _fetchTimeout = Duration(seconds: 12);
  static const Duration _cacheTtl = Duration(minutes: 15);

  static RemoteConfigBundle? _cached;
  static DateTime? _cachedAt;

  static bool get _cacheValid =>
      _cached != null &&
      _cachedAt != null &&
      DateTime.now().difference(_cachedAt!) < _cacheTtl;

  static RemoteConfigBundle? get cached => _cached;

  static List<RemoteSubscriptionPlan> get paymentPlans {
    final plans = _cached?.paymentConfig.plans;
    if (plans != null && plans.isNotEmpty) return plans;
    return defaultSubscriptionPlans();
  }

  static RemotePlayerConfig get playerConfig =>
      _cached?.playerConfig ??
      RemotePlayerConfig.fromJson(const {});

  static RemoteFeatureFlags get featureFlags =>
      _cached?.featureFlags ??
      const RemoteFeatureFlags(
        channelsPremiumOnly: false,
        paymentsEnabled: true,
        channelsEnabled: true,
        adsEnabled: true,
        ratibaTab: true,
      );

  static Future<RemoteConfigBundle?> fetch({bool forceRefresh = false}) async {
    if (!forceRefresh && _cacheValid) return _cached;

    try {
      final response = await apiClient
          .get('/api/v2/config/bundle', queryParameters: {'platform': 'android'})
          .timeout(_fetchTimeout);

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final bundle = RemoteConfigBundle.fromJson(
          Map<String, dynamic>.from(response.data as Map),
        );
        _cached = bundle;
        _cachedAt = DateTime.now();
        return bundle;
      }
    } on DioError catch (e) {
      debugPrint('[RemoteConfigService] fetch error: ${e.message}');
    } catch (e, st) {
      debugPrint('[RemoteConfigService] fetch error: $e\n$st');
    }

    return _cached;
  }

  static void invalidateCache() {
    _cachedAt = null;
  }
}
