import 'dart:async';

import 'package:flutter/foundation.dart';

/// One tray notification at a time; up to [kMaxQueuedNotifications] pending.
const kEamaxTrayNotificationId = 9001;
const kMaxQueuedNotifications = 4;
const kGapBetweenNotifications = Duration(seconds: 5);

class QueuedEamaxNotification {
  QueuedEamaxNotification({
    required this.title,
    required this.body,
    this.notificationId,
    this.messageId,
  });

  final String title;
  final String body;
  final int? notificationId;
  final String? messageId;
}

typedef ShowTrayNotification = Future<void> Function(QueuedEamaxNotification item);
typedef ReportTrayDelivered = Future<void> Function(QueuedEamaxNotification item);
typedef CancelTrayNotification = Future<void> Function();

final List<QueuedEamaxNotification> _pending = [];
final List<int> _recentNotificationIds = [];
bool _draining = false;

Future<void> enqueueEamaxNotification(
  QueuedEamaxNotification item, {
  required ShowTrayNotification show,
  required ReportTrayDelivered reportDelivered,
  required CancelTrayNotification cancelTray,
}) async {
  final nid = item.notificationId;
  if (nid != null) {
    if (_recentNotificationIds.contains(nid)) {
      if (kDebugMode) {
        debugPrint('[EaMaxFCM] Skip duplicate queued notification id=$nid');
      }
      return;
    }
    _recentNotificationIds.add(nid);
    while (_recentNotificationIds.length > 32) {
      _recentNotificationIds.removeAt(0);
    }
  }

  _pending.add(item);
  while (_pending.length > kMaxQueuedNotifications) {
    _pending.removeAt(0);
  }

  unawaited(_drainNotificationQueue(
    show: show,
    reportDelivered: reportDelivered,
    cancelTray: cancelTray,
  ));
}

Future<void> _drainNotificationQueue({
  required ShowTrayNotification show,
  required ReportTrayDelivered reportDelivered,
  required CancelTrayNotification cancelTray,
}) async {
  if (_draining) return;
  _draining = true;
  try {
    while (_pending.isNotEmpty) {
      final item = _pending.removeAt(0);
      await show(item);
      unawaited(reportDelivered(item));
      if (_pending.isNotEmpty) {
        await Future.delayed(kGapBetweenNotifications);
        await cancelTray();
      }
    }
  } finally {
    _draining = false;
    if (_pending.isNotEmpty) {
      unawaited(_drainNotificationQueue(
        show: show,
        reportDelivered: reportDelivered,
        cancelTray: cancelTray,
      ));
    }
  }
}
