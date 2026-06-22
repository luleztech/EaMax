import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../config/api.dart';
import '../../services/user_id.dart';

/// Batches playback analytics to POST /api/v2/analytics/playback.
class PlaybackAnalytics {
  PlaybackAnalytics._();

  static final List<Map<String, dynamic>> _queue = [];
  static Timer? _flushTimer;
  static Map<String, dynamic>? _deviceInfoCache;

  static Future<void> track({
    required String eventType,
    int? channelId,
    Map<String, dynamic>? payload,
  }) async {
    _queue.add({
      'eventType': eventType,
      if (channelId != null && channelId > 0) 'channelId': channelId,
      'payload': payload ?? const {},
      'deviceInfo': await _deviceInfo(),
    });
    _scheduleFlush();
  }

  static Future<void> trackChannelOpen({
    required int channelId,
    required String channelName,
    required String engine,
  }) => track(
    eventType: 'channel_open',
    channelId: channelId,
    payload: {'channelName': channelName, 'engine': engine},
  );

  static Future<void> trackStreamFailure({
    required int channelId,
    required String reason,
    int? failoverStep,
  }) => track(
    eventType: 'stream_failure',
    channelId: channelId,
    payload: {
      'reason': reason,
      'failoverStep': ?failoverStep,
    },
  );

  static Future<void> trackBufferEvent({
    required int channelId,
    required bool isBuffering,
  }) => track(
    eventType: 'buffer_event',
    channelId: channelId,
    payload: {'isBuffering': isBuffering},
  );

  static Future<void> trackWatchDuration({
    required int channelId,
    required int seconds,
  }) => track(
    eventType: 'watch_duration',
    channelId: channelId,
    payload: {'seconds': seconds},
  );

  static Future<void> trackAutoHeal({
    required int channelId,
    required String symptom,
    required String action,
  }) => track(
    eventType: 'auto_heal',
    channelId: channelId,
    payload: {'symptom': symptom, 'action': action},
  );

  static Future<void> trackFailoverStep({
    required int channelId,
    required int step,
    required String streamUrl,
  }) => track(
    eventType: 'failover_step',
    channelId: channelId,
    payload: {'step': step, 'streamUrl': streamUrl},
  );

  static void _scheduleFlush() {
    _flushTimer?.cancel();
    _flushTimer = Timer(const Duration(seconds: 5), () {
      unawaited(_flush());
    });
    if (_queue.length >= 10) {
      unawaited(_flush());
    }
  }

  static Future<void> _flush() async {
    if (_queue.isEmpty) return;
    final batch = List<Map<String, dynamic>>.from(_queue);
    _queue.clear();
    _flushTimer?.cancel();
    _flushTimer = null;

    try {
      final userId = await getOrCreateUserId();
      await apiClient.post(
        '/api/v2/analytics/playback',
        data: {
          'userExternalId': ?userId,
          'events': batch,
        },
      );
    } catch (e) {
      debugPrint('[PlaybackAnalytics] flush failed: $e');
      if (_queue.length < 100) {
        _queue.insertAll(0, batch);
      }
    }
  }

  static Future<Map<String, dynamic>> _deviceInfo() async {
    if (_deviceInfoCache != null) return _deviceInfoCache!;
    try {
      final info = await PackageInfo.fromPlatform();
      _deviceInfoCache = {
        'platform': Platform.operatingSystem,
        'osVersion': Platform.operatingSystemVersion,
        'appVersion': info.version,
        'buildNumber': info.buildNumber,
      };
    } catch (_) {
      _deviceInfoCache = {
        'platform': defaultTargetPlatform.name,
      };
    }
    return _deviceInfoCache!;
  }
}
