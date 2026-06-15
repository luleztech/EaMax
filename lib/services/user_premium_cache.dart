import 'package:shared_preferences/shared_preferences.dart';

/// Offline cache for premium state so paid users stay unlocked across app restarts.
class UserPremiumCache {
  static const _uidKey = 'eamax_user_snapshot_uid_v1';
  static const _premiumKey = 'eamax_user_snapshot_premium_v1';
  static const _expiresKey = 'eamax_user_snapshot_expires_v1';
  static const _pointsKey = 'eamax_user_snapshot_points_v1';

  static Future<void> save({
    required String uid,
    required bool premium,
    DateTime? expiresAt,
    int points = 0,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_uidKey, uid);
    await prefs.setBool(_premiumKey, premium);
    if (expiresAt != null) {
      await prefs.setString(_expiresKey, expiresAt.toIso8601String());
    } else {
      await prefs.remove(_expiresKey);
    }
    await prefs.setInt(_pointsKey, points);
  }

  static Future<({String uid, bool premium, DateTime? expiresAt, int points})?> load() async {
    final prefs = await SharedPreferences.getInstance();
    final uid = prefs.getString(_uidKey)?.trim();
    if (uid == null || uid.isEmpty) return null;
    final expiresRaw = prefs.getString(_expiresKey);
    return (
      uid: uid,
      premium: prefs.getBool(_premiumKey) ?? false,
      expiresAt: expiresRaw != null ? DateTime.tryParse(expiresRaw) : null,
      points: prefs.getInt(_pointsKey) ?? 0,
    );
  }
}
