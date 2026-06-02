import 'package:flutter/foundation.dart';

import '../models/app_config.dart';

class AppUpdateState extends ChangeNotifier {
  AppConfig? _config;

  bool get isUpdateRequired => _config != null && _config!.shouldBlockAccess;
  AppConfig? get config => _config;

  void activate(AppConfig config) {
    if (_config != null && _config!.minimumSupportedVersion == config.minimumSupportedVersion &&
        _config!.latestVersion == config.latestVersion &&
        _config!.updateTitle == config.updateTitle &&
        _config!.updateMessage == config.updateMessage &&
        _config!.playStoreUrl == config.playStoreUrl) {
      return;
    }
    _config = config;
    notifyListeners();
  }

  void clear() {
    _config = null;
    notifyListeners();
  }
}

final appUpdateState = AppUpdateState();
