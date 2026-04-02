import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

import '../config/api.dart';

const _storageKey = 'userId';
const _legacyKey = '@eamax:userId';

String generateUserId() {
  const chars = 'ABCDEF0123456789';
  final r = Random();
  final buf = StringBuffer('User-');
  for (var i = 0; i < 5; i++) {
    buf.write(chars[r.nextInt(chars.length)]);
  }
  return buf.toString();
}

/// Same behavior as React Native `getOrCreateUserId`.
Future<String?> getOrCreateUserId() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    var id = prefs.getString(_storageKey)?.trim();
    if (id != null && id.isNotEmpty) return id;

    final legacy = prefs.getString(_legacyKey)?.trim();
    if (legacy != null && legacy.isNotEmpty) {
      await prefs.setString(_storageKey, legacy);
      try {
        await userApi.register(legacy);
      } catch (_) {}
      return legacy;
    }

    id = generateUserId();
    await prefs.setString(_storageKey, id);
    try {
      await userApi.register(id);
    } catch (_) {}
    return id;
  } catch (_) {
    return null;
  }
}

Future<String?> getStoredUserId() async {
  final prefs = await SharedPreferences.getInstance();
  return prefs.getString(_storageKey)?.trim();
}
