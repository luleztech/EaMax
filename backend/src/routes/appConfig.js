const express = require('express');
const config = require('../config/appVersionConfig');
const { compareSemver } = require('../middleware/appVersion');

const router = express.Router();

/**
 * GET /app-config
 *
 * Public endpoint — no version check, no auth required.
 * Flutter app fetches this on every startup to:
 *   1. Decide whether to show the force-update screen.
 *   2. Decide whether to show the maintenance screen.
 *
 * The client also compares `minimumSupportedVersion` against its own build
 * to gate access without needing a 426 response.
 */
router.get('/', (req, res) => {
    const clientVersion = req.headers['x-app-version'] || null;
  const belowMinimum =
    clientVersion !== null &&
    compareSemver(clientVersion, config.minimumSupportedVersion) < 0;
  const belowLatest =
    clientVersion !== null &&
    compareSemver(clientVersion, config.latestVersion) < 0;

  return res.json({
    minimumSupportedVersion: config.minimumSupportedVersion,
    latestVersion: config.latestVersion,
    forceUpdate: (config.forceUpdate && belowLatest) || belowMinimum,
    maintenanceMode: config.maintenanceMode,
    maintenanceMessage: config.maintenanceMessage,
    playStoreUrl: config.playStoreUrl,
    updateTitle: config.updateTitle,
    updateMessage: config.updateMessage,
  });
});

module.exports = router;
