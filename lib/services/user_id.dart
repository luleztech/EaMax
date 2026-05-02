import 'dart:async';
import 'dart:math';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/api.dart';
import 'user_id_backup.dart' as backup;

const _storageKey = 'userId';
const _legacyKey = '@eamax:userId';

const _userIdChannel = MethodChannel('com.eamax/app_data');

/// Concurrent [getOrCreateUserId] calls share one resolution — avoids duplicate random IDs.
Future<String?>? _identityCreation;

String generateUserId() {
  const chars = 'ABCDEF0123456789';
  final r = Random();
  final buf = StringBuffer('User-');
  for (var i = 0; i < 5; i++) {
    buf.write(chars[r.nextInt(chars.length)]);
  }
  return buf.toString();
}

Future<void> _mirrorStableUserIdToAndroid(String id) async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  try {
    await _userIdChannel.invokeMethod<void>('persistStableUserId', <String, dynamic>{'userId': id});
  } catch (_) {}
}

Future<void> _persistUserIdEverywhere(String id) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString(_storageKey, id);
  await prefs.setString(_legacyKey, id);
  await backup.persistUserIdToFileBackup(id);
  await _mirrorStableUserIdToAndroid(id);
}

Future<String?> _readStableUserIdNative() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return null;
  try {
    final v = await _userIdChannel.invokeMethod<String>('readStableUserId');
    final id = v?.trim();
    if (id != null && id.isNotEmpty) return id;
  } catch (_) {}
  return null;
}

Future<String?> _readLegacyRnUserIdNative() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return null;
  try {
    final v = await _userIdChannel.invokeMethod<String>('readLegacyRnUserId');
    final id = v?.trim();
    if (id != null && id.isNotEmpty) return id;
  } catch (_) {}
  return null;
}

/// Existing user in DB for this device (FCM token); no new username after updates.
Future<String?> _resolveExistingUserViaFcm() async {
  if (kIsWeb) return null;
  try {
    final token = await FirebaseMessaging.instance.getToken();
    if (token == null || token.isEmpty) return null;
    final external = await userApi.resolveExternalIdByFcmToken(token);
    return (external != null && external.isNotEmpty) ? external : null;
  } catch (_) {
    return null;
  }
}

Future<String?> _resolveIdentityChain() async {
  final prefs = await SharedPreferences.getInstance();
  var id = prefs.getString(_storageKey)?.trim();
  if (id != null && id.isNotEmpty) {
    unawaited(backup.persistUserIdToFileBackup(id));
    unawaited(_mirrorStableUserIdToAndroid(id));
    return id;
  }

  id = prefs.getString(_legacyKey)?.trim();
  if (id != null && id.isNotEmpty) {
    await _persistUserIdEverywhere(id);
    try {
      await userApi.register(id);
    } catch (_) {}
    return id;
  }

  id = await _readStableUserIdNative();
  if (id != null && id.isNotEmpty) {
    await _persistUserIdEverywhere(id);
    try {
      await userApi.register(id);
    } catch (_) {}
    return id;
  }

  id = await backup.readUserIdFromFileBackup();
  if (id != null && id.isNotEmpty) {
    await _persistUserIdEverywhere(id);
    try {
      await userApi.register(id);
    } catch (_) {}
    return id;
  }

  id = await _readLegacyRnUserIdNative();
  if (id != null && id.isNotEmpty) {
    await _persistUserIdEverywhere(id);
    try {
      await userApi.register(id);
    } catch (_) {}
    return id;
  }

  id = await _resolveExistingUserViaFcm();
  if (id != null && id.isNotEmpty) {
    await _persistUserIdEverywhere(id);
    try {
      await userApi.register(id);
    } catch (_) {}
    return id;
  }

  id = generateUserId();
  await _persistUserIdEverywhere(id);
  try {
    await userApi.register(id);
  } catch (_) {}
  return id;
}

/// Prefer existing id from prefs, native mirror, file backups, RN SQLite, or FCM — then generate once.
Future<String?> getOrCreateUserId() {
  return _identityCreation ??= _completeIdentityCreation();
}

Future<String?> _completeIdentityCreation() async {
  try {
    return await _resolveIdentityChain();
  } catch (e, st) {
    debugPrint('getOrCreateUserId: $e\n$st');
    return null;
  } finally {
    _identityCreation = null;
  }
}

/// Resolves stored id without registering or creating.
Future<String?> getStoredUserId() async {
  try {
    final pending = _identityCreation;
    if (pending != null) await pending;

    final prefs = await SharedPreferences.getInstance();
    var id = prefs.getString(_storageKey)?.trim();
    if (id != null && id.isNotEmpty) return id;

    id = prefs.getString(_legacyKey)?.trim();
    if (id != null && id.isNotEmpty) {
      await _persistUserIdEverywhere(id);
      return id;
    }

    id = await _readStableUserIdNative();
    if (id != null && id.isNotEmpty) {
      await _persistUserIdEverywhere(id);
      return id;
    }

    id = await backup.readUserIdFromFileBackup();
    if (id != null && id.isNotEmpty) {
      await _persistUserIdEverywhere(id);
      return id;
    }

    id = await _readLegacyRnUserIdNative();
    if (id != null && id.isNotEmpty) {
      await _persistUserIdEverywhere(id);
      return id;
    }

    id = await _resolveExistingUserViaFcm();
    if (id != null && id.isNotEmpty) {
      await _persistUserIdEverywhere(id);
      return id;
    }

    return null;
  } catch (_) {
    return null;
  }
}
