/// App version constants — keep in sync with `version:` in pubspec.yaml.
/// The semver string is sent as  `X-App-Version`  on every API request.
/// The backend uses it for version enforcement and the /app-config response.
const String kAppVersion = '1.3.6';
const String kAppBundleId = 'com.eamax';

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
