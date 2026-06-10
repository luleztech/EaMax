import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/api.dart';
import '../config/app_version.dart';
import '../models/promotion.dart';
import 'user_id.dart';

const _cacheTtlMs = 5 * 60 * 1000;

class PromotionService {
  List<Promotion> _cached = [];
  DateTime? _cachedAt;

  static String _platformParam() {
    if (kIsWeb) return 'web';
    if (defaultTargetPlatform == TargetPlatform.android) return 'android';
    return 'ios';
  }

  void invalidateCache() {
    _cached = [];
    _cachedAt = null;
  }

  Future<List<Promotion>> fetchForLaunch({bool forceRefresh = false}) async {
    final all = await fetchEligible(forceRefresh: forceRefresh);
    return _filterByShowMode(all);
  }

  Future<List<Promotion>> fetchEligible({bool forceRefresh = false}) async {
    if (!forceRefresh &&
        _cached.isNotEmpty &&
        _cachedAt != null &&
        DateTime.now().difference(_cachedAt!).inMilliseconds < _cacheTtlMs) {
      return _cached;
    }

    try {
      final uid = await getStoredUserId();
      final q = <String, String>{
        'appVersion': appVersion,
        'platform': _platformParam(),
      };
      if (uid != null && uid.isNotEmpty) q['externalId'] = uid;
      final query = q.entries.map((e) => '${e.key}=${Uri.encodeComponent(e.value)}').join('&');
      final data = await apiRequest('/api/promotions/active?$query');
      final list = data is Map && data['promotions'] is List
          ? (data['promotions'] as List)
              .map((e) => Promotion.fromJson(Map<String, dynamic>.from(e as Map)))
              .where((p) => p.id > 0 && p.title.isNotEmpty)
              .toList()
          : <Promotion>[];

      _cached = list;
      _cachedAt = DateTime.now();

      return list;
    } catch (_) {
      return _cached;
    }
  }

  Future<List<Promotion>> _filterByShowMode(List<Promotion> list) async {
    final prefs = await SharedPreferences.getInstance();
    final today = DateTime.now().toIso8601String().substring(0, 10);
    final now = DateTime.now();
    final out = <Promotion>[];

    for (final p in list) {
      if (p.isOfa) {
        if (_isLocalOfaExpired(prefs, p, now)) continue;
        final serverEnd = p.offerEndsAt;
        if (serverEnd != null && !serverEnd.isAfter(now)) continue;
      }

      if (p.showMode == 'every_launch') {
        out.add(p);
        continue;
      }
      if (p.showMode == 'once') {
        if (prefs.getBool('promo_once_${p.id}') == true) continue;
        out.add(p);
        continue;
      }
      if (p.showMode == 'daily') {
        if (prefs.getString('promo_daily_${p.id}') == today) continue;
        out.add(p);
        continue;
      }
      out.add(p);
    }
    return out;
  }

  bool _isLocalOfaExpired(SharedPreferences prefs, Promotion p, DateTime now) {
    if (!p.isOfa) return false;
    final endRaw = prefs.getString('promo_ofa_end_${p.id}');
    if (endRaw == null) return false;
    final end = DateTime.tryParse(endRaw);
    return end != null && !end.isAfter(now);
  }

  Future<DateTime?> localOfaEndsAt(Promotion p) async {
    final prefs = await SharedPreferences.getInstance();
    final endRaw = prefs.getString('promo_ofa_end_${p.id}');
    if (endRaw == null) return null;
    return DateTime.tryParse(endRaw);
  }

  Future<void> markShown(Promotion p) async {
    final prefs = await SharedPreferences.getInstance();
    if (p.isOfa) {
      final mins = p.offerCountdownMinutes ?? 0;
      if (mins > 0 && prefs.getString('promo_ofa_end_${p.id}') == null) {
        final ends = DateTime.now().add(Duration(minutes: mins));
        await prefs.setString('promo_ofa_end_${p.id}', ends.toIso8601String());
      }
    }
    if (p.showMode == 'once') {
      await prefs.setBool('promo_once_${p.id}', true);
    } else if (p.showMode == 'daily') {
      final today = DateTime.now().toIso8601String().substring(0, 10);
      await prefs.setString('promo_daily_${p.id}', today);
    }
  }

  Future<void> reportView(int id) async {
    final uid = await getStoredUserId();
    if (uid == null) return;
    try {
      await apiRequest('/api/promotions/$id/view', method: 'POST', body: {'externalId': uid});
    } catch (_) {}
  }

  Future<void> reportClick(int id) async {
    final uid = await getStoredUserId();
    if (uid == null) return;
    try {
      await apiRequest('/api/promotions/$id/click', method: 'POST', body: {'externalId': uid});
    } catch (_) {}
  }

  Future<void> reportClose(int id) async {
    final uid = await getStoredUserId();
    if (uid == null) return;
    try {
      await apiRequest('/api/promotions/$id/close', method: 'POST', body: {'externalId': uid});
    } catch (_) {}
  }

}

final promotionService = PromotionService();
