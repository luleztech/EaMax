const config = require('../config/appVersionConfig');

/**
 * Compare two semver strings (major.minor.patch).
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareSemver(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Middleware: enforces minimum app version on mobile-client requests.
 *
 * Mobile clients MUST send  `X-App-Version: <semver>`  on every request.
 * Admin-panel / webhook / server-to-server traffic does not send this header
 * and is therefore passed through unchanged.
 *
 * Enforcement is opt-in via  REQUIRE_APP_VERSION=true  (Railway env var).
 * While that var is absent / false, the middleware only logs — safe to deploy
 * before the new APK reaches all users.
 */
function requireAppVersion(req, res, next) {
  const version = req.headers['x-app-version'];

  if (!version) {
    return next();
  }

  if (config.maintenanceMode) {
    return res.status(503).json({
      error: 'maintenance',
      message: config.maintenanceMessage,
    });
  }

  const tooOld = compareSemver(version, config.minimumSupportedVersion) < 0;

  if (tooOld) {
    if (config.requireAppVersion) {
      return res.status(426).json({
        error: 'upgrade_required',
        message: 'Tafadhali sasisha app yako ili uendelee.',
        minimumSupportedVersion: config.minimumSupportedVersion,
        latestVersion: config.latestVersion,
        playStoreUrl: config.playStoreUrl,
      });
    }
    console.warn(
      `[VersionCheck] Outdated client: ${version} < ${config.minimumSupportedVersion} — enforcement is off`
    );
  }

  next();
}

/**
 * Lightweight middleware: attaches parsed version to req for downstream logging.
 */
function attachVersionInfo(req, _res, next) {
  req.appVersion = req.headers['x-app-version'] || null;
  next();
}

module.exports = { requireAppVersion, attachVersionInfo, compareSemver };
