class AppUpgradeRequiredException implements Exception {
  const AppUpgradeRequiredException({
    required this.message,
    required this.minimumVersion,
    required this.playStoreUrl,
    required this.updateTitle,
    required this.updateMessage,
  });

  final String message;
  final String minimumVersion;
  final String playStoreUrl;
  final String updateTitle;
  final String updateMessage;

  @override
  String toString() => 'AppUpgradeRequiredException: $message';
}

class AppMaintenanceException implements Exception {
  const AppMaintenanceException({required this.message});
  final String message;

  @override
  String toString() => 'AppMaintenanceException: $message';
}
