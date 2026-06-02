import 'package:dio/dio.dart';

import '../models/app_config.dart';
import '../models/api_exceptions.dart';
import '../services/update_state.dart';

class AppUpdateInterceptor extends Interceptor {
  static bool _isAppConfigRequest(RequestOptions options) {
    final path = options.uri.path;
    return path.endsWith('/app-config');
  }

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final config = appUpdateState.config;
    if (config != null && config.shouldBlockAccess && !_isAppConfigRequest(options)) {
      return handler.reject(
        DioError(
          requestOptions: options,
          type: DioErrorType.cancel,
          error: AppUpgradeRequiredException(
            message: config.updateMessage,
            minimumVersion: config.minimumSupportedVersion,
            playStoreUrl: config.playStoreUrl,
            updateTitle: config.updateTitle,
            updateMessage: config.updateMessage,
          ),
        ),
      );
    }
    handler.next(options);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    if (_isAppConfigRequest(response.requestOptions) && response.statusCode == 200) {
      try {
        final config = AppConfig.fromJson(
          Map<String, dynamic>.from(response.data as Map<String, dynamic>),
        );
        if (!config.shouldBlockAccess) {
          appUpdateState.clear();
        } else {
          appUpdateState.activate(config);
        }
      } catch (_) {
        // Ignore parse issues; the update screen will be governed by other paths.
      }
    }

    if (response.statusCode == 426) {
      final data = response.data;
      final updateTitle = _readString(data, 'updateTitle', 'Update Required');
      final updateMessage = _readString(data, 'updateMessage', 'Please update your application.');
      final config = AppConfig(
        minimumSupportedVersion: _readString(data, 'minimumSupportedVersion', ''),
        latestVersion: _readString(data, 'latestVersion', ''),
        forceUpdate: true,
        maintenanceMode: false,
        maintenanceMessage: _readString(data, 'message', updateMessage),
        playStoreUrl: _readString(data, 'playStoreUrl', ''),
        updateTitle: updateTitle,
        updateMessage: updateMessage,
      );
      appUpdateState.activate(config);

      return handler.reject(
        DioError(
          requestOptions: response.requestOptions,
          response: response,
          type: DioErrorType.badResponse,
          error: AppUpgradeRequiredException(
            message: updateMessage,
            minimumVersion: config.minimumSupportedVersion,
            playStoreUrl: config.playStoreUrl,
            updateTitle: updateTitle,
            updateMessage: updateMessage,
          ),
        ),
      );
    }
    handler.next(response);
  }

  String _readString(dynamic data, String key, String fallback) {
    if (data is Map<String, dynamic>) {
      final raw = data[key];
      if (raw is String && raw.isNotEmpty) return raw;
      if (raw != null) return raw.toString();
    }
    return fallback;
  }
}
