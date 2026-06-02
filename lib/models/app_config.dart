import '../config/app_version.dart';

class AppConfig {
  const AppConfig({
    required this.minimumSupportedVersion,
    required this.latestVersion,
    required this.forceUpdate,
    required this.maintenanceMode,
    required this.maintenanceMessage,
    required this.playStoreUrl,
  });

  final String minimumSupportedVersion;
  final String latestVersion;
  final bool forceUpdate;
  final bool maintenanceMode;
  final String maintenanceMessage;
  final String playStoreUrl;

  factory AppConfig.fromJson(Map<String, dynamic> json) {
    return AppConfig(
      minimumSupportedVersion:
          json['minimumSupportedVersion']?.toString() ?? '1.0.0',
      latestVersion: json['latestVersion']?.toString() ?? kAppVersion,
      forceUpdate: json['forceUpdate'] == true,
      maintenanceMode: json['maintenanceMode'] == true,
      maintenanceMessage: json['maintenanceMessage']?.toString() ??
          'App iko chini ya matengenezo. Jaribu tena baadaye.',
      playStoreUrl: json['playStoreUrl']?.toString() ??
          'https://play.google.com/store/apps/details?id=com.eamax',
    );
  }

  /// True when the installed build is older than the server-mandated minimum.
  bool get isCurrentVersionTooOld =>
      compareSemver(kAppVersion, minimumSupportedVersion) < 0;

  /// True when the app must be blocked (either explicit flag or version too old).
  bool get shouldBlockAccess => forceUpdate || isCurrentVersionTooOld;
}
