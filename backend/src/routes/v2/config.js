const express = require('express');
const { buildConfigBundle } = require('../../services/configBundleService');

const router = express.Router();

/**
 * GET /api/v2/config/bundle
 *
 * Public bootstrap endpoint — no auth. Returns all remote-operational config
 * so the mobile app never hardcodes prices, player settings, or feature flags.
 *
 * Query: platform=android|ios|web
 * Headers: X-App-Version (optional, for force-update logic)
 */
router.get('/bundle', async (req, res, next) => {
  try {
    const clientVersion = req.headers['x-app-version'] || null;
    const platform = String(req.query.platform || 'android').toLowerCase();
    const bundle = await buildConfigBundle({ clientVersion, platform });
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(bundle);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
