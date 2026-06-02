import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config/app_version.dart';
import '../models/app_config.dart';

/// Fetches and caches the remote app configuration from  GET /app-config.
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
  static const String _configUrl =
      'https://eamax-production.up.railway.app/app-config';
  static const Duration _fetchTimeout = Duration(seconds: 10);
  static const Duration _cacheTtl = Duration(minutes: 30);

  static AppConfig? _cached;
  static DateTime? _cachedAt;

  static bool get _cacheValid =>
      _cached != null &&
      _cachedAt != null &&
      DateTime.now().difference(_cachedAt!) < _cacheTtl;

  /// Fetch config from the server. Returns cached value if still fresh.
  /// Never throws — returns null on any network or parse error.
  static Future<AppConfig?> fetch({bool forceRefresh = false}) async {
    if (!forceRefresh && _cacheValid) return _cached;

    try {
      final response = await http.get(
        Uri.parse(_configUrl),
        headers: {
          'X-App-Version': kAppVersion,
          'X-App-Bundle': kAppBundleId,
          'Content-Type': 'application/json',
        },
      ).timeout(_fetchTimeout);

      if (response.statusCode == 200) {
        final json = jsonDecode(response.body);
        if (json is Map<String, dynamic>) {
          final config = AppConfig.fromJson(json);
          _cached = config;
          _cachedAt = DateTime.now();
          return config;
        }
      }
    } catch (e, st) {
      debugPrint('[AppConfigService] fetch error: $e\n$st');
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
