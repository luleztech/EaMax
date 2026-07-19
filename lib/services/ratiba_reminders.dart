import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

import '../config/api.dart';
import '../models/schedule_item.dart';
import 'fcm_notifications.dart';
import 'user_id.dart';

const _prefsKey = 'ratiba_reminder_ids_v1';

/// Called when user taps a Ratiba live notification (local or FCM).
void Function(int? scheduleId, int? channelId)? onRatibaNotificationOpen;

bool _tzReady = false;
bool _handlerWired = false;
final Set<String> _memory = {};

void _ensurePayloadHandler() {
  if (_handlerWired) return;
  _handlerWired = true;
  setScheduleNotificationPayloadHandler((payload) {
    handleRatibaNotificationPayload(payload);
  });
}

Future<void> _ensureTz() async {
  if (_tzReady) return;
  tz_data.initializeTimeZones();
  try {
    tz.setLocalLocation(tz.getLocation('Africa/Dar_es_Salaam'));
  } catch (_) {
    // Fallback: fixed EAT offset location
    tz.setLocalLocation(tz.timeZoneDatabase.locations['Etc/GMT-3'] ?? tz.UTC);
  }
  _tzReady = true;
}

int _notifIdFor(String scheduleId) {
  // Stable positive 31-bit id
  return 'ratiba_$scheduleId'.hashCode & 0x7fffffff;
}

Future<Set<String>> loadRatibaReminderIds() async {
  _ensurePayloadHandler();
  final prefs = await SharedPreferences.getInstance();
  final list = prefs.getStringList(_prefsKey) ?? const <String>[];
  _memory
    ..clear()
    ..addAll(list);
  return Set<String>.from(_memory);
}

Future<void> _persist() async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setStringList(_prefsKey, _memory.toList());
}

bool isRatibaReminded(String scheduleId) => _memory.contains(scheduleId);

Future<bool> toggleRatibaReminder(ScheduleItem item) async {
  final id = item.id;
  if (id.isEmpty) return false;
  await loadRatibaReminderIds();
  if (_memory.contains(id)) {
    await clearRatibaReminder(item);
    return false;
  }
  await enableRatibaReminder(item);
  return true;
}

Future<void> enableRatibaReminder(ScheduleItem item) async {
  final id = item.id;
  if (id.isEmpty || item.date == null) return;
  await loadRatibaReminderIds();
  _memory.add(id);
  await _persist();

  final uid = (await getOrCreateUserId())?.trim() ?? '';
  if (uid.isNotEmpty) {
    unawaited(scheduleApi.setReminder(id, uid).catchError((_) {}));
  }

  if (kIsWeb) return;
  await requestEamaxNotificationPermission();
  await _scheduleLocal(item);
}

Future<void> clearRatibaReminder(ScheduleItem item) async {
  final id = item.id;
  if (id.isEmpty) return;
  await loadRatibaReminderIds();
  _memory.remove(id);
  await _persist();

  final uid = (await getOrCreateUserId())?.trim() ?? '';
  if (uid.isNotEmpty) {
    unawaited(scheduleApi.clearReminder(id, uid).catchError((_) {}));
  }

  if (!kIsWeb) {
    await cancelScheduledLocalNotification(_notifIdFor(id));
  }
}

Future<void> _scheduleLocal(ScheduleItem item) async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
  final when = item.date;
  if (when == null) return;

  await _ensureTz();
  await ensureAndroidNotificationChannel();

  final loc = tz.getLocation('Africa/Dar_es_Salaam');
  var scheduled = tz.TZDateTime(loc, when.year, when.month, when.day, when.hour, when.minute);
  final now = tz.TZDateTime.now(loc);
  if (!scheduled.isAfter(now)) {
    // Already due — fire in a few seconds so the user still gets a ping
    scheduled = now.add(const Duration(seconds: 3));
  }

  final channelId = item.channelId;
  final payload = 'schedule:${item.id}:${channelId ?? ''}';

  await scheduleLocalNotificationAt(
    id: _notifIdFor(item.id),
    title: '🔴 LIVE · ${item.title}',
    body: item.subtitle.isNotEmpty
        ? '${item.subtitle} — fungua EaMax kutazama'
        : 'Kipindi chako kimeanza — fungua EaMax',
    when: scheduled,
    payload: payload,
  );
}

/// Re-schedule all saved bells after app start (OS may clear them).
Future<void> resyncRatibaReminders(List<ScheduleItem> schedule) async {
  await loadRatibaReminderIds();
  if (_memory.isEmpty) return;
  for (final item in schedule) {
    if (!_memory.contains(item.id)) continue;
    if (item.date == null) continue;
    unawaited(_scheduleLocal(item));
  }
}

void handleRatibaNotificationPayload(String? payload) {
  if (payload == null || !payload.startsWith('schedule:')) return;
  final parts = payload.split(':');
  if (parts.length < 2) return;
  final scheduleId = int.tryParse(parts[1]);
  final channelId = parts.length > 2 ? int.tryParse(parts[2]) : null;
  onRatibaNotificationOpen?.call(scheduleId, channelId);
}
