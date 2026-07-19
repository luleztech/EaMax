import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../config/api.dart';
import '../models/app_config.dart';

/// Fetches and caches the remote app configuration from GET /app-config.
///
/// The config drives:
///   - Force-update blocking screen
///   - Maintenance-mode blocking screen
///   - Minimum supported version enforcement
///
/// Design choices:
///   - Cache is valid for [_cacheTtl] so periodic re-checks are cheap.
///   - A failed fetch returns the last known-good cache (if any), otherwise
///     `null` — meaning the app proceeds normally (never blocks on network error).
class AppConfigService {
  static const Duration _fetchTimeout = Duration(seconds: 20);
  static const Duration _cacheTtl = Duration(minutes: 30);

  static AppConfig? _cached;
  static DateTime? _cachedAt;
  static bool _fetchInFlight = false;

  static bool get _cacheValid =>
      _cached != null &&
      _cachedAt != null &&
      DateTime.now().difference(_cachedAt!) < _cacheTtl;

  /// Fetch config from the server. Returns cached value if still fresh.
  /// Never throws — returns null on any network or parse error.
  static Future<AppConfig?> fetch({bool forceRefresh = false}) async {
    if (!forceRefresh && _cacheValid) return _cached;
    if (_fetchInFlight && !forceRefresh) return _cached;
    _fetchInFlight = true;

    try {
      final response = await apiClient.get(
        '/app-config',
        options: Options(
          receiveTimeout: _fetchTimeout,
          sendTimeout: _fetchTimeout,
        ),
      );

      if (response.statusCode == 200 && response.data is Map) {
        final config = AppConfig.fromJson(Map<String, dynamic>.from(response.data as Map));
        _cached = config;
        _cachedAt = DateTime.now();
        return config;
      }
    } on DioException catch (e) {
      // Soft-fail: app continues with cache / defaults. Avoid noisy TimeoutException stacks.
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout ||
          e.type == DioExceptionType.sendTimeout) {
        debugPrint('[AppConfigService] fetch timed out — using cache/defaults');
      } else {
        debugPrint('[AppConfigService] fetch error: ${e.message}');
      }
    } on TimeoutException {
      debugPrint('[AppConfigService] fetch timed out — using cache/defaults');
    } catch (e) {
      debugPrint('[AppConfigService] fetch error: $e');
    } finally {
      _fetchInFlight = false;
    }

    return _cached;
  }

  /// Force-invalidate cache (e.g. after coming back online).
  static void invalidateCache() {
    _cachedAt = null;
  }

  /// Returns the last successfully fetched config without making a request.
  static AppConfig? get cached => _cached;
}
