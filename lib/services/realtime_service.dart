import 'dart:async';
import 'dart:convert';
import 'dart:io' show WebSocket;

import 'package:flutter/foundation.dart';

import '../config/api.dart';

typedef RealtimeEventHandler = void Function(Map<String, dynamic> data);

/// WebSocket client for instant premium/payment/points updates from the backend.
class RealtimeService {
  RealtimeService._();
  static final RealtimeService instance = RealtimeService._();

  WebSocket? _socket;
  String? _userId;
  bool _connected = false;
  Timer? _heartbeatTimer;
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;

  final Map<String, Set<RealtimeEventHandler>> _handlers = {};

  static String get _wsBaseUrl {
    final uri = Uri.parse(apiBaseUrl);
    final scheme = uri.scheme == 'https' ? 'wss' : 'ws';
    final portPart = uri.hasPort ? ':${uri.port}' : '';
    return '$scheme://${uri.host}$portPart';
  }

  bool get isConnected => _connected;

  void subscribe(String channel, RealtimeEventHandler handler) {
    _handlers.putIfAbsent(channel, () => {}).add(handler);
  }

  void unsubscribe(String channel, RealtimeEventHandler handler) {
    _handlers[channel]?.remove(handler);
  }

  Future<void> connect(String userId, {String? fcmToken}) async {
    if (kIsWeb) return;
    if (userId.trim().isEmpty) return;
    if (_connected && _userId == userId) return;

    await disconnect();
    _userId = userId;

    try {
      final q = <String, String>{'userId': userId};
      if (fcmToken != null && fcmToken.isNotEmpty) {
        q['fcmToken'] = fcmToken;
      }
      final wsUri = Uri.parse(_wsBaseUrl).replace(queryParameters: q);
      _socket = await WebSocket.connect(wsUri.toString()).timeout(
        const Duration(seconds: 8),
      );
      _connected = true;
      _reconnectAttempts = 0;
      _startHeartbeat();

      _socket!.listen(
        _onMessage,
        onError: (Object e) {
          debugPrint('[RealtimeService] socket error: $e');
          _scheduleReconnect();
        },
        onDone: _scheduleReconnect,
        cancelOnError: true,
      );
      debugPrint('[RealtimeService] connected userId=$userId');
    } catch (e) {
      debugPrint('[RealtimeService] connect failed: $e');
      _scheduleReconnect();
    }
  }

  Future<void> disconnect() async {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _connected = false;
    try {
      await _socket?.close();
    } catch (_) {}
    _socket = null;
  }

  void _onMessage(dynamic raw) {
    try {
      final message = jsonDecode(raw.toString()) as Map<String, dynamic>;
      final type = message['type']?.toString();
      if (type == 'connected' || type == 'pong') return;
      if (type != 'update') return;
      final channel = message['channel']?.toString();
      final data = message['data'];
      if (channel == null || channel.isEmpty) return;
      if (data is! Map) return;
      final payload = Map<String, dynamic>.from(data);
      final handlers = _handlers[channel];
      if (handlers == null || handlers.isEmpty) return;
      for (final handler in handlers.toList()) {
        handler(payload);
      }
    } catch (e) {
      debugPrint('[RealtimeService] message parse error: $e');
    }
  }

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 45), (_) {
      if (!_connected || _socket == null) return;
      try {
        _socket!.add(jsonEncode({'type': 'ping'}));
      } catch (_) {}
    });
  }

  void _scheduleReconnect() {
    if (_userId == null || _userId!.isEmpty) return;
    if (_reconnectTimer?.isActive == true) return;
    _connected = false;
    _heartbeatTimer?.cancel();
    _reconnectAttempts++;
    final delaySec = (_reconnectAttempts.clamp(1, 8) * 2).clamp(2, 30);
    _reconnectTimer = Timer(Duration(seconds: delaySec), () {
      final uid = _userId;
      if (uid != null) unawaited(connect(uid));
    });
  }
}

const kRealtimePremiumChannel = 'user_premium_update';
const kRealtimePointsChannel = 'user_points_update';
const kRealtimePaymentChannel = 'payment_received';
const kRealtimeConfigChannel = 'config_updated';
