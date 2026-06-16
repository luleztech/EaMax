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
// Routes that should never be version-checked (admin panel, webhooks).
// req.path here is relative to the /api/ prefix, e.g. "/admin/...", "/dashboard/..."
function _isAdminRoute(req) {
  const p = req.path || '';
  if (p.startsWith('/admin') || p.startsWith('/dashboard') || p.startsWith('/partner')) {
    return true;
  }
  // Remote config bootstrap — must work even on outdated builds.
  if (p.startsWith('/v2/config')) {
    return true;
  }

  const adminKey = String(req.headers['x-admin-key'] || '').trim();
  if (adminKey && adminKey === process.env.ADMIN_API_KEY) {
    return true;
  }

  return false;
}

const _upgradeBody = () => ({
  error: 'UPDATE_REQUIRED',
  message: config.updateMessage,
  updateTitle: config.updateTitle,
  updateMessage: config.updateMessage,
  minimumSupportedVersion: config.minimumSupportedVersion,
  latestVersion: config.latestVersion,
  playStoreUrl: config.playStoreUrl,
});

function requireAppVersion(req, res, next) {
  // Always skip admin-panel routes.
  if (_isAdminRoute(req)) return next();

  // Maintenance mode overrides everything — even valid versions get blocked.
  if (config.maintenanceMode) {
    return res.status(503).json({
      error: 'maintenance',
      message: config.maintenanceMessage,
    });
  }

  const version = req.headers['x-app-version'];

  if (!version) {
    // No version header = old build that pre-dates our changes.
    // When enforcement is ON, stop these builds so users are forced to update.
    // When enforcement is OFF, allow them through (safe rollout period).
    if (config.requireAppVersion) {
      console.warn(`[VersionCheck] No X-App-Version header — blocking old client (${req.method} ${req.originalUrl})`);
      return res.status(426).json(_upgradeBody());
    }
    return next();
  }

  const tooOld = compareSemver(version, config.minimumSupportedVersion) < 0;
  const belowLatest = compareSemver(version, config.latestVersion) < 0;

  if (config.requireAppVersion && (tooOld || (config.forceUpdate && belowLatest))) {
    if (tooOld) {
      console.warn(`[VersionCheck] Outdated: ${version} < ${config.minimumSupportedVersion}`);
    } else {
      console.warn(`[VersionCheck] Forced update required: ${version} < ${config.latestVersion}`);
    }
    return res.status(426).json(_upgradeBody());
  }

  if (tooOld) {
    console.warn(`[VersionCheck] Soft-warn: ${version} < ${config.minimumSupportedVersion} (enforcement off)`);
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
