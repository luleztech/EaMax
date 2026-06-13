import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Persists last-good home feed data so the UI can paint immediately on cold start.
class HomeDataCache {
  static const _channelsKey = 'home_channels_cache_v1';
  static const _carouselKey = 'home_carousel_cache_v1';
  static const _matchesKey = 'home_matches_cache_v1';
  static const _maxAge = Duration(days: 7);

  static Future<void> saveChannels(List<Map<String, dynamic>> rows) async {
    if (rows.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _channelsKey,
      jsonEncode({
        'savedAt': DateTime.now().toIso8601String(),
        'rows': rows,
      }),
    );
  }

  static Future<List<Map<String, dynamic>>?> loadChannels() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_channelsKey);
    if (raw == null || raw.isEmpty) return null;
    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      if (!_isFresh(map['savedAt']?.toString())) return null;
      final rows = map['rows'];
      if (rows is! List || rows.isEmpty) return null;
      return rows.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return null;
    }
  }

  static Future<void> saveCarousel(List<Map<String, dynamic>> slides) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _carouselKey,
      jsonEncode({
        'savedAt': DateTime.now().toIso8601String(),
        'slides': slides,
      }),
    );
  }

  static Future<List<Map<String, dynamic>>?> loadCarousel() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_carouselKey);
    if (raw == null || raw.isEmpty) return null;
    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      if (!_isFresh(map['savedAt']?.toString())) return null;
      final slides = map['slides'];
      if (slides is! List) return null;
      return slides.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return null;
    }
  }

  static Future<void> saveMatches(List<dynamic> matches) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _matchesKey,
      jsonEncode({
        'savedAt': DateTime.now().toIso8601String(),
        'matches': matches,
      }),
    );
  }

  static Future<List<dynamic>?> loadMatches() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_matchesKey);
    if (raw == null || raw.isEmpty) return null;
    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      if (!_isFresh(map['savedAt']?.toString())) return null;
      final matches = map['matches'];
      if (matches is! List) return null;
      return List<dynamic>.from(matches);
    } catch (_) {
      return null;
    }
  }

  static bool _isFresh(String? savedAt) {
    if (savedAt == null || savedAt.isEmpty) return false;
    final parsed = DateTime.tryParse(savedAt);
    if (parsed == null) return false;
    return DateTime.now().difference(parsed) < _maxAge;
  }
}
