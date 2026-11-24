const express = require('express');
const { playbackLimiter } = require('../middleware/rateLimiter');
const {
  handleRelay,
  handleLicenseRelay,
  handleWatchPage,
} = require('../services/embedPlaybackService');

const router = express.Router();

// Media segment / playlist relay (Exo + HLS proxy + hosted webplayer).
router.get('/relay', playbackLimiter, (req, res, next) => {
  handleRelay(req, res).catch(next);
});

// PDF 4b: Widevine license relay — injects nv-authorizations server-side for WebView/Shaka.
router.options('/relay/license', (req, res, next) => {
  handleLicenseRelay(req, res).catch(next);
});
router.post('/relay/license', playbackLimiter, express.raw({ type: '*/*', limit: '2mb' }), (req, res, next) => {
  handleLicenseRelay(req, res).catch(next);
});

// Hosted Shaka webplayer — gateway-shaped path so installed WebViewEngine loads it
// (`…/embed/player.php`) instead of about:blank. No app update required.
router.get('/embed/player.php', playbackLimiter, (req, res, next) => {
  handleWatchPage(req, res).catch(next);
});
router.get('/embed/player', playbackLimiter, (req, res, next) => {
  handleWatchPage(req, res).catch(next);
});

module.exports = router;
