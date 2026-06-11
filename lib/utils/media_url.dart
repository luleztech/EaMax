/// Detect animated GIF URLs (direct .gif or common CDN query patterns).
bool isLikelyAnimatedGifUrl(String raw) {
  final u = raw.trim().replaceAll(RegExp(r'[\r\n\t]'), '').toLowerCase();
  if (u.isEmpty || u == 'null') return false;
  final path = u.split('#').first.split('?').first;
  if (path.endsWith('.gif')) return true;
  return RegExp(r'(^|[?&])fmt=gif\b|format=gif\b|type=gif\b|\.gif(&|$)').hasMatch(u);
}
