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
      latestVersion: json['latestVersion']?.toString() ?? kAppVersion,
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
      compareSemver(kAppVersion, minimumSupportedVersion) < 0;

  /// True when the installed build is older than the current published version.
  bool get isCurrentVersionBelowLatest =>
      compareSemver(kAppVersion, latestVersion) < 0;

  /// True when the app must be blocked.
  ///
  /// This matches server-side semantics:
  /// - Always block builds below the minimum supported version.
  /// - Block additional builds only when forceUpdate is enabled and the build
  ///   is below the current latest version.
  bool get shouldBlockAccess =>
      isCurrentVersionTooOld || (forceUpdate && isCurrentVersionBelowLatest);
}
