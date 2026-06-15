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
const _registrationRetryKey = 'user_registration_pending';
const _maxRegistrationRetries = 5;

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
    final token = await FirebaseMessaging.instance
        .getToken()
        .timeout(const Duration(seconds: 5));
    if (token == null || token.isEmpty) return null;
    final external = await userApi
        .resolveExternalIdByFcmToken(token)
        .timeout(const Duration(seconds: 8));
    return (external != null && external.isNotEmpty) ? external : null;
  } catch (_) {
    return null;
  }
}

/// Register user with retry logic and exponential backoff.
/// Returns true if registration succeeded, false otherwise.
/// CRITICAL: User MUST be in database for admin to find them.
Future<bool> _registerWithRetry(String id, {int maxRetries = _maxRegistrationRetries}) async {
  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      final result = await userApi.register(id);
      if (result != null && result['id'] != null) {
        debugPrint('[UserRegistration] Success for $id on attempt $attempt');
        // Clear any pending registration
        final prefs = await SharedPreferences.getInstance();
        await prefs.remove(_registrationRetryKey);
        return true;
      }
    } catch (e) {
      final msg = e.toString().toLowerCase();
      final isRateLimited = msg.contains('429') || msg.contains('maombi mengi');
      final isNetworkError = msg.contains('network') || 
                              msg.contains('connection') || 
                              msg.contains('timeout') ||
                              msg.contains('socket');
      
      if (isRateLimited || isNetworkError) {
        if (attempt < maxRetries) {
          final delayMs = (1000 * attempt).clamp(1000, 10000);
          debugPrint('[UserRegistration] Attempt $attempt failed for $id, retrying in ${delayMs}ms...');
          await Future<void>.delayed(Duration(milliseconds: delayMs));
          continue;
        }
      } else {
        debugPrint('[UserRegistration] Attempt $attempt failed for $id (non-retryable): $e');
        if (attempt == maxRetries) break;
      }
    }
  }
  
  debugPrint('[UserRegistration] All $maxRetries attempts failed for $id');
  // Mark for background retry
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString(_registrationRetryKey, id);
  return false;
}

/// Verify that user exists in database by fetching user details.
Future<bool> _verifyUserExists(String id) async {
  try {
    final user = await userApi.getUser(id);
    return user != null && user['id'] != null;
  } catch (e) {
    debugPrint('[UserRegistration] Verification failed for $id: $e');
    return false;
  }
}

/// Background retry for pending registrations.
/// Call this periodically to ensure users eventually get registered.
Future<void> retryPendingRegistrations() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final pendingId = prefs.getString(_registrationRetryKey)?.trim();
    if (pendingId == null || pendingId.isEmpty) return;
    
    debugPrint('[UserRegistration] Retrying pending registration for $pendingId');
    final success = await _registerWithRetry(pendingId, maxRetries: 3);
    if (success) {
      debugPrint('[UserRegistration] Pending registration succeeded for $pendingId');
    }
  } catch (e) {
    debugPrint('[UserRegistration] Background retry error: $e');
  }
}

Future<String?> _resolveIdentityChain() async {
  final prefs = await SharedPreferences.getInstance();
  
  // 1. Check for existing user ID in storage
  var id = prefs.getString(_storageKey)?.trim();
  if (id != null && id.isNotEmpty) {
    // CRITICAL: Verify user exists in database
    final exists = await _verifyUserExists(id);
    if (exists) {
      unawaited(backup.persistUserIdToFileBackup(id));
      unawaited(_mirrorStableUserIdToAndroid(id));
      return id;
    }
    debugPrint('[UserRegistration] User $id not found in DB, attempting recovery...');
  }

  // 2. Check legacy storage
  id = prefs.getString(_legacyKey)?.trim();
  if (id != null && id.isNotEmpty) {
    await _persistUserIdEverywhere(id);
    final success = await _registerWithRetry(id);
    if (success) return id;
    // Return legacy ID even if registration failed - will retry in background
    return id;
  }

  // 3. Try to recover from native stable storage
  id = await _readStableUserIdNative();
  if (id != null && id.isNotEmpty) {
    await _persistUserIdEverywhere(id);
    final success = await _registerWithRetry(id);
    if (success) return id;
    return id;
  }

  // 4. Try file backup
  id = await backup.readUserIdFromFileBackup();
  if (id != null && id.isNotEmpty) {
    await _persistUserIdEverywhere(id);
    final success = await _registerWithRetry(id);
    if (success) return id;
    return id;
  }

  // 5. Try React Native legacy storage
  id = await _readLegacyRnUserIdNative();
  if (id != null && id.isNotEmpty) {
    await _persistUserIdEverywhere(id);
    final success = await _registerWithRetry(id);
    if (success) return id;
    return id;
  }

  // 6. Try to recover existing user via FCM token (survives app updates)
  id = await _resolveExistingUserViaFcm();
  if (id != null && id.isNotEmpty) {
    debugPrint('[UserRegistration] Recovered user via FCM: $id');
    await _persistUserIdEverywhere(id);
    // Verify and re-register if needed
    final exists = await _verifyUserExists(id);
    if (exists) return id;
    // Re-register the recovered user
    final success = await _registerWithRetry(id);
    if (success) return id;
  }

  // 7. Generate new user ID
  id = generateUserId();
  await _persistUserIdEverywhere(id);
  
  // CRITICAL: Register user in database with retries
  final success = await _registerWithRetry(id);
  if (success) {
    debugPrint('[UserRegistration] New user $id registered successfully');
    return id;
  }
  
  // Registration failed but return ID anyway - will retry in background
  debugPrint('[UserRegistration] Returning userId $id but registration pending - will retry');
  unawaited(Future<void>.delayed(const Duration(seconds: 5), retryPendingRegistrations));
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
/// Also verifies the user exists in database before returning.
Future<String?> getStoredUserId() async {
  try {
    final pending = _identityCreation;
    if (pending != null) await pending;

    final prefs = await SharedPreferences.getInstance();
    var id = prefs.getString(_storageKey)?.trim();
    if (id != null && id.isNotEmpty) {
      // Verify user exists in database
      final exists = await _verifyUserExists(id);
      if (exists) return id;
    }

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
