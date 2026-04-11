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

String generateUserId() {
  const chars = 'ABCDEF0123456789';
  final r = Random();
  final buf = StringBuffer('User-');
  for (var i = 0; i < 5; i++) {
    buf.write(chars[r.nextInt(chars.length)]);
  }
  return buf.toString();
}

Future<void> _persistUserIdEverywhere(String id) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString(_storageKey, id);
  await backup.persistUserIdToFileBackup(id);
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

/// Prefer existing id (prefs, file backup, or React Native SQLite on Android).
/// New ids are only generated when no prior id exists — Play Store updates keep subscription.
Future<String?> getOrCreateUserId() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    var id = prefs.getString(_storageKey)?.trim();
    if (id != null && id.isNotEmpty) {
      unawaited(backup.persistUserIdToFileBackup(id));
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

    id = await backup.readUserIdFromFileBackup();
    if (id != null && id.isNotEmpty) {
      await _persistUserIdEverywhere(id);
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
  } catch (_) {
    return null;
  }
}

/// Resolves stored id without registering or creating.
///
/// Reads from the current SharedPreferences key, legacy RN key, file backup,
/// native Android legacy storage, or existing FCM-linked external id.
/// When an id is recovered from backup or legacy storage, it is re-persisted
/// so app updates do not lose the stable identity.
Future<String?> getStoredUserId() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    var id = prefs.getString(_storageKey)?.trim();
    if (id != null && id.isNotEmpty) return id;

    id = prefs.getString(_legacyKey)?.trim();
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
