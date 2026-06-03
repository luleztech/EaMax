import 'package:package_info_plus/package_info_plus.dart';

/// Fallback semver — keep in sync with `version:` in pubspec.yaml.
/// After [initAppVersion], [appVersion] comes from the installed build.
const String kAppVersion = '1.3.10';
const String kAppBundleId = 'com.eamax';

String _installedVersion = kAppVersion;

/// Semver sent as `X-App-Version` and used for update checks.
String get appVersion => _installedVersion;

/// Load version from the platform package info (matches Play Store versionName).
Future<void> initAppVersion() async {
  try {
    final info = await PackageInfo.fromPlatform();
    final v = info.version.trim();
    if (v.isNotEmpty) _installedVersion = v;
  } catch (_) {
    // Keep [kAppVersion] fallback.
  }
}

/// Compare two semver strings.  Returns negative if [a] < [b].
int compareSemver(String a, String b) {
  final pa = a.split('.').map(int.tryParse).toList();
  final pb = b.split('.').map(int.tryParse).toList();
  final len = pa.length > pb.length ? pa.length : pb.length;
  for (var i = 0; i < len; i++) {
    final diff = (i < pa.length ? pa[i] ?? 0 : 0) -
        (i < pb.length ? pb[i] ?? 0 : 0);
    if (diff != 0) return diff;
  }
  return 0;
}
