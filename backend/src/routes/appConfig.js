const express = require('express');
const config = require('../config/appVersionConfig');
const { compareSemver } = require('../middleware/appVersion');
const { getEmergencyControlsAdmin } = require('../services/emergencyControlsService');

const router = express.Router();

/**
 * GET /app-config
 *
 * Public endpoint — no version check, no auth required.
 * Flutter app fetches this on every startup to:
 *   1. Decide whether to show the force-update screen.
 *   2. Decide whether to show the maintenance screen.
 *
 * Maintenance mode is driven by admin emergency controls (DB) when set.
 */
router.get('/', async (req, res, next) => {
  try {
    const clientVersion = req.headers['x-app-version'] || null;
    const emergency = await getEmergencyControlsAdmin();
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
      maintenanceMode: emergency.maintenanceMode,
      maintenanceMessage: emergency.maintenanceMessageSw || config.maintenanceMessage,
      playStoreUrl: config.playStoreUrl,
      updateTitle: config.updateTitle,
      updateMessage: config.updateMessage,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
