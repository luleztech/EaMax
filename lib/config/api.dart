import 'package:dio/dio.dart';

import '../interceptors/app_update_interceptor.dart';
import '../models/api_exceptions.dart';
import '../models/channel_playback.dart';
import 'app_version.dart';

const String apiBaseUrl = 'https://eamax-production.up.railway.app';

final Dio _dio = Dio(BaseOptions(
  baseUrl: apiBaseUrl,
  connectTimeout: const Duration(seconds: 45),
  receiveTimeout: const Duration(seconds: 45),
  sendTimeout: const Duration(seconds: 45),
  responseType: ResponseType.json,
  validateStatus: (status) => status != null,
  headers: <String, String>{
    'Content-Type': 'application/json',
    'X-App-Bundle': kAppBundleId,
  },
))
  ..interceptors.add(_AppVersionHeaderInterceptor())
  ..interceptors.add(AppUpdateInterceptor());

class _AppVersionHeaderInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.headers['X-App-Version'] = appVersion;
    handler.next(options);
  }
}

Dio get apiClient => _dio;

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
  try {
    final response = await _dio.request(
      endpoint,
      data: body,
      options: Options(method: method),
    ).timeout(timeout);

    final data = response.data;
    final statusCode = response.statusCode ?? 500;
    final bodyData = data is Map<String, dynamic> ? data : <String, dynamic>{};

    if (statusCode == 426) {
      throw AppUpgradeRequiredException(
        message: bodyData['message']?.toString() ?? 'Please update your application.',
        minimumVersion: bodyData['minimumSupportedVersion']?.toString() ?? '',
        playStoreUrl: bodyData['playStoreUrl']?.toString() ?? '',
        updateTitle: bodyData['updateTitle']?.toString() ?? 'Update Required',
        updateMessage: bodyData['updateMessage']?.toString() ??
            bodyData['message']?.toString() ?? 'Please update your application.',
      );
    }

    if (statusCode == 503 && bodyData['error'] == 'maintenance') {
      throw AppMaintenanceException(
        message: bodyData['message']?.toString() ?? 'Under maintenance',
      );
    }

    if (statusCode == 429) {
      final retryAfter = int.tryParse(
        response.headers.value('retry-after')?.trim() ?? '',
      );
      throw ApiRateLimitedException(retryAfterSeconds: retryAfter);
    }

    if (statusCode < 200 || statusCode >= 300) {
      final err = bodyData['error']?.toString().trim();
      final detail = bodyData['detail']?.toString().trim();
      if (err != null && err.isNotEmpty) {
        throw Exception((detail?.isNotEmpty ?? false) && detail != err ? '$err ($detail)' : err);
      }
      throw Exception('HTTP $statusCode');
    }

    return data ?? <String, dynamic>{};
  } on DioException catch (e) {
    if (e.error is AppUpgradeRequiredException || e.error is ApiRateLimitedException) {
      rethrow;
    }
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.sendTimeout) {
      throw Exception('Network timeout');
    }
    if (e.error is Exception) {
      rethrow;
    }
    throw Exception(e.message);
  }
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
    } on ApiRateLimitedException catch (e) {
      lastErr = e;
      if (enableRetries && attempt < maxAttempts) {
        final waitSec = e.retryAfterSeconds ?? (2 * attempt);
        await _sleep((waitSec.clamp(1, 30)) * 1000);
        continue;
      }
      rethrow;
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
  Future<List<dynamic>> getChannels({
    String? category,
    Duration? timeout,
    bool enableRetries = true,
  }) async {
    final q = category != null ? '?category=$category' : '';
    final data = await apiRequest(
      '/api/channels$q',
      timeout: timeout,
      enableRetries: enableRetries,
    );
    if (data is List) return data;
    return [];
  }

  Future<Map<String, dynamic>> getChannel(int channelId) async {
    final r = await apiRequest('/api/channels/$channelId');
    return Map<String, dynamic>.from(r as Map);
  }

  /// Server-driven playback with ordered failover streams.
  Future<ChannelPlaybackBundle> getChannelPlayback(int channelId) async {
    final r = await apiRequest('/api/v2/channels/$channelId/playback');
    return ChannelPlaybackBundle.fromJson(Map<String, dynamic>.from(r as Map));
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
  /// Get the currently active payment provider ('aurax' or 'sonicpesa').
  /// Defaults to 'aurax' if not configured.
  Future<String> getPaymentProvider() async {
    try {
      final data = await apiRequest('/api/settings/payment-provider');
      if (data is Map && data.containsKey('paymentProvider')) {
        final provider = data['paymentProvider'] as String;
        return provider == 'sonicpesa' ? 'sonicpesa' : 'aurax';
      }
    } catch (e) {
      // If endpoint fails, default to aurax
    }
    return 'aurax';
  }
  Future<List<dynamic>> getCarouselSlides(
    String category, {
    Duration? timeout,
    bool enableRetries = true,
  }) async {
    final data = await apiRequest(
      '/api/carousel?category=$category',
      timeout: timeout,
      enableRetries: enableRetries,
    );
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

class ScheduleApi {
  /// Leotena-style schedule for the Ratiba tab (programmes + matches).
  Future<List<dynamic>> getSchedule() async {
    try {
      final data = await apiRequest('/api/schedule');
      if (data is List) return data;
      return [];
    } catch (e) {
      final msg = e.toString().toLowerCase();
      if (msg.contains('404') || msg.contains('not found')) {
        // Older backends: fall back to legacy matches endpoint.
        return MatchesApi().getUpcomingMatches();
      }
      rethrow;
    }
  }

  Future<void> setReminder(String scheduleId, String externalId) async {
    final id = int.tryParse(scheduleId);
    if (id == null) return;
    await apiRequest(
      '/api/schedule/$id/remind',
      method: 'POST',
      body: {'externalId': externalId},
      enableRetries: false,
    );
  }

  Future<void> clearReminder(String scheduleId, String externalId) async {
    final id = int.tryParse(scheduleId);
    if (id == null) return;
    await apiRequest(
      '/api/schedule/$id/remind?externalId=${Uri.encodeComponent(externalId)}',
      method: 'DELETE',
      body: {'externalId': externalId},
      enableRetries: false,
    );
  }
}

class PaymentsApi {
  /// Start a payment using the currently active payment provider
  Future<Map<String, dynamic>> startOfferPayment({
    required String externalId,
    required int promotionId,
    required int amount,
    required String phone,
    required String email,
    required String name,
  }) async {
    Object? lastErr;
    for (var attempt = 1; attempt <= 2; attempt++) {
      try {
        final r = await apiRequest(
          '/api/payments/start',
          method: 'POST',
          body: {
            'externalId': externalId,
            'promotionId': promotionId,
            'amount': amount,
            'phone': phone,
            'email': email,
            'name': name,
          },
          enableRetries: false,
          timeout: const Duration(seconds: 50),
        );
        return Map<String, dynamic>.from(r as Map);
      } on ApiRateLimitedException catch (e) {
        lastErr = e;
        if (attempt < 2) {
          final waitSec = e.retryAfterSeconds ?? 3;
          await _sleep((waitSec.clamp(1, 15)) * 1000);
          continue;
        }
        rethrow;
      }
    }
    throw lastErr ?? Exception('Payment start failed');
  }

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

  /// Legacy name: always uses `/api/payments/start` so the server picks Aurax vs SonicPesa from admin settings.
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
final scheduleApi = ScheduleApi();
final paymentsApi = PaymentsApi();
final notificationsApi = NotificationsApi();
