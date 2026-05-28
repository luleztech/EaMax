import 'dart:convert';

import 'package:http/http.dart' as http;

const String apiBaseUrl = 'https://eamax-production.up.railway.app';

Future<void> _sleep(int ms) => Future<void>.delayed(Duration(milliseconds: ms));

bool _isTransientNetworkError(Object error) {
  final msg = error.toString().toLowerCase();
  return msg.contains('socketexception') ||
      msg.contains('connection') ||
      msg.contains('timeout') ||
      msg.contains('failed host') ||
      msg.contains('network') ||
      msg.contains('handshake');
}

Future<dynamic> _apiRequestOnce(
  String endpoint, {
  String method = 'GET',
  Map<String, dynamic>? body,
  Duration timeout = const Duration(seconds: 45),
}) async {
  final url = Uri.parse('$apiBaseUrl$endpoint');
  final headers = <String, String>{'Content-Type': 'application/json'};
  final http.Response response;
  switch (method.toUpperCase()) {
    case 'POST':
      response = await http
          .post(url, headers: headers, body: body != null ? jsonEncode(body) : null)
          .timeout(timeout);
    case 'GET':
    default:
      response = await http.get(url, headers: headers).timeout(timeout);
  }

  dynamic decoded;
  final text = response.body;
  if (text.trim().isNotEmpty) {
    try {
      decoded = jsonDecode(text);
    } catch (_) {
      decoded = null;
    }
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    if (decoded is Map) {
      final err = decoded['error']?.toString().trim();
      final detail = decoded['detail']?.toString().trim();
      if (err != null && err.isNotEmpty) {
        throw Exception(detail != null && detail.isNotEmpty && detail != err ? '$err ($detail)' : err);
      }
    }
    throw Exception('HTTP ${response.statusCode}');
  }
  return decoded ?? <String, dynamic>{};
}

Future<dynamic> apiRequest(
  String endpoint, {
  String method = 'GET',
  Map<String, dynamic>? body,
  bool enableRetries = true,
  Duration? timeout,
}) async {
  final maxAttempts = enableRetries ? 4 : 1;
  final effectiveTimeout = timeout ?? const Duration(seconds: 45);
  Object? lastErr;
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await _apiRequestOnce(
        endpoint,
        method: method,
        body: body,
        timeout: effectiveTimeout,
      );
    } catch (e) {
      lastErr = e;
      if (enableRetries && attempt < maxAttempts && _isTransientNetworkError(e)) {
        await _sleep(400 * attempt);
        continue;
      }
      rethrow;
    }
  }
  throw lastErr ?? Exception('Request failed');
}

class UserApi {
  Future<Map<String, dynamic>> register(String externalId) async {
    final r = await apiRequest(
      '/api/users/register',
      method: 'POST',
      body: {'externalId': externalId},
    );
    return Map<String, dynamic>.from(r as Map);
  }

  /// When local storage is empty but this device already registered [fcm_token] in DB.
  Future<String?> resolveExternalIdByFcmToken(String fcmToken) async {
    try {
      final r = await apiRequest(
        '/api/users/resolve-by-fcm',
        method: 'POST',
        body: {'fcmToken': fcmToken},
      );
      if (r is! Map) return null;
      final id = r['externalId']?.toString().trim();
      if (id == null || id.isEmpty) return null;
      return id;
    } catch (_) {
      return null;
    }
  }

  Future<Map<String, dynamic>> getUser(String externalId) async {
    final r = await apiRequest('/api/users/$externalId');
    return Map<String, dynamic>.from(r as Map);
  }

  Future<Map<String, dynamic>> recordAdWatched(String externalId, {int points = 20}) async {
    final r = await apiRequest(
      '/api/users/$externalId/ads/watched',
      method: 'POST',
      body: {'points': points},
    );
    return Map<String, dynamic>.from(r as Map);
  }

  Future<Map<String, dynamic>> unlockChannel(String externalId, int channelId) async {
    final r = await apiRequest(
      '/api/users/$externalId/channels/$channelId/unlock',
      method: 'POST',
    );
    return Map<String, dynamic>.from(r as Map);
  }

  Future<void> registerFcmToken(String externalId, String fcmToken) async {
    await apiRequest(
      '/api/users/$externalId/fcm-token',
      method: 'POST',
      body: {'fcmToken': fcmToken},
    );
  }
}

class ChannelsApi {
  Future<List<dynamic>> getChannels({String? category}) async {
    final q = category != null ? '?category=$category' : '';
    final data = await apiRequest('/api/channels$q');
    if (data is List) return data;
    return [];
  }

  Future<Map<String, dynamic>> getChannel(int channelId) async {
    final r = await apiRequest('/api/channels/$channelId');
    return Map<String, dynamic>.from(r as Map);
  }
}

class SettingsApi {
  Future<Map<String, dynamic>> getWhatsAppNumber() async {
    final r = await apiRequest('/api/settings/whatsapp');
    return Map<String, dynamic>.from(r as Map);
  }

  /// Throws on network/HTTP errors — callers should not treat failures as `false`
  /// (false means “points/ads allowed”, true means “payment only”).
  Future<bool> getChannelsPremiumOnly() async {
    final data = await apiRequest('/api/settings/channels-premium-only');
    if (data is Map) return data['channelsPremiumOnly'] == true;
    return false;
  }
  /// Get the currently active payment provider ('zeno' or 'sonicpesa').
  /// Defaults to 'zeno' if not configured.
  Future<String> getPaymentProvider() async {
    try {
      final data = await apiRequest('/api/settings/payment-provider');
      if (data is Map && data.containsKey('paymentProvider')) {
        final provider = data['paymentProvider'] as String;
        return provider == 'sonicpesa' ? 'sonicpesa' : 'zeno';
      }
    } catch (e) {
      // If endpoint fails, default to zeno for backward compatibility
    }
    return 'zeno';
  }
  Future<List<dynamic>> getCarouselSlides(String category) async {
    final data = await apiRequest('/api/carousel?category=$category');
    if (data is List) return data;
    return [];
  }
}

class MatchesApi {
  Future<List<dynamic>> getUpcomingMatches() async {
    try {
      final data = await apiRequest('/api/matches');
      if (data is List) return data;
      return [];
    } catch (e) {
      final msg = e.toString().toLowerCase();
      if (msg.contains('404') || msg.contains('not found')) return [];
      rethrow;
    }
  }
}

class PaymentsApi {
  /// Start a payment using the currently active payment provider
  Future<Map<String, dynamic>> startPayment({
    required String externalId,
    required String bundle,
    required int amount,
    required String phone,
    required String email,
    required String name,
  }) async {
    final r = await apiRequest(
      '/api/payments/start',
      method: 'POST',
      body: {
        'externalId': externalId,
        'bundle': bundle,
        'amount': amount,
        'phone': phone,
        'email': email,
        'name': name,
      },
      // Non-idempotent: retries can create multiple orders and break auto-upgrade tracking.
      enableRetries: false,
      timeout: const Duration(seconds: 50),
    );
    return Map<String, dynamic>.from(r as Map);
  }

  /// Legacy name: always uses `/api/payments/start` so the server picks Zeno vs SonicPesa from admin settings.
  Future<Map<String, dynamic>> startZenoPayment({
    required String externalId,
    required String bundle,
    required int amount,
    required String phone,
    required String email,
    required String name,
  }) {
    return startPayment(
      externalId: externalId,
      bundle: bundle,
      amount: amount,
      phone: phone,
      email: email,
      name: name,
    );
  }

  /// Check payment status using the unified endpoint
  Future<Map<String, dynamic>> checkPaymentStatus(String orderId) async {
    try {
      final r = await apiRequest('/api/payments/status?orderId=${Uri.encodeComponent(orderId)}');
      return Map<String, dynamic>.from(r as Map);
    } catch (e) {
      final msg = e.toString().toLowerCase();
      if (msg.contains('no order found') || msg.contains('order not found') || msg.contains('404')) {
        return {'status': 'PENDING', 'raw': {}};
      }
      rethrow;
    }
  }

  /// Legacy name: uses `/api/payments/status` so polling follows the order's gateway (or admin default).
  Future<Map<String, dynamic>> checkZenoStatus(String orderId) {
    return checkPaymentStatus(orderId);
  }

  Future<Map<String, dynamic>> completePaymentForTesting(String orderId) async {
    final r = await apiRequest(
      '/api/payments/complete/${Uri.encodeComponent(orderId)}',
      method: 'POST',
    );
    return Map<String, dynamic>.from(r as Map);
  }
}

/// Delivery + click analytics for admin broadcasts ([notificationId] in FCM data).
class NotificationsApi {
  Future<void> reportDelivered(int notificationId, String externalId, {String? fcmToken}) async {
    try {
      await apiRequest(
        '/api/notifications/$notificationId/delivered',
        method: 'POST',
        body: {
          'externalId': externalId,
          if (fcmToken != null && fcmToken.isNotEmpty) 'fcmToken': fcmToken,
        },
      );
    } catch (_) {}
  }

  Future<void> reportClick(int notificationId, String externalId) async {
    try {
      await apiRequest(
        '/api/notifications/$notificationId/click',
        method: 'POST',
        body: {'externalId': externalId},
      );
    } catch (_) {}
  }
}

final userApi = UserApi();
final channelsApi = ChannelsApi();
final settingsApi = SettingsApi();
final matchesApi = MatchesApi();
final paymentsApi = PaymentsApi();
final notificationsApi = NotificationsApi();
