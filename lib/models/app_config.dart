import '../config/app_version.dart';

class AppConfig {
  const AppConfig({
    required this.minimumSupportedVersion,
    required this.latestVersion,
    required this.forceUpdate,
    required this.maintenanceMode,
    required this.maintenanceMessage,
    required this.playStoreUrl,
    required this.updateTitle,
    required this.updateMessage,
  });

  final String minimumSupportedVersion;
  final String latestVersion;
  final bool forceUpdate;
  final bool maintenanceMode;
  final String maintenanceMessage;
  final String playStoreUrl;
  final String updateTitle;
  final String updateMessage;

  factory AppConfig.fromJson(Map<String, dynamic> json) {
    return AppConfig(
      minimumSupportedVersion:
          json['minimumSupportedVersion']?.toString() ?? '1.0.0',
      latestVersion: json['latestVersion']?.toString() ?? appVersion,
      forceUpdate: json['forceUpdate'] == true,
      maintenanceMode: json['maintenanceMode'] == true,
      maintenanceMessage: json['maintenanceMessage']?.toString() ??
          'App iko chini ya matengenezo. Jaribu tena baadaye.',
      playStoreUrl: json['playStoreUrl']?.toString() ??
          'https://play.google.com/store/apps/details?id=com.eamax',
      updateTitle: json['updateTitle']?.toString() ?? 'Update Required',
      updateMessage: json['updateMessage']?.toString() ??
          'A new version is available. Please update to continue using the app.',
    );
  }

  /// True when the installed build is older than the server-mandated minimum.
  bool get isCurrentVersionTooOld =>
      compareSemver(appVersion, minimumSupportedVersion) < 0;

  /// True when the installed build is older than the current published version.
  bool get isCurrentVersionBelowLatest =>
      compareSemver(appVersion, latestVersion) < 0;

  /// True when the app must be blocked.
  ///
  /// Installed builds at or above [latestVersion] are never blocked, so users
  /// on the current Play release never get a stuck update screen.
  /// - Always block builds below [minimumSupportedVersion].
  /// - Otherwise block only when [forceUpdate] is true and below [latestVersion].
  bool get shouldBlockAccess {
    if (isCurrentVersionTooOld) return true;
    if (!isCurrentVersionBelowLatest) return false;
    return forceUpdate;
  }
}
