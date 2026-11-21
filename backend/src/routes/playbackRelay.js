const express = require('express');
const { playbackLimiter } = require('../middleware/rateLimiter');
const {
  handleRelay,
  handleLicenseRelay,
  handleWatchPage,
} = require('../services/embedPlaybackService');

const router = express.Router();

// Server-hosted Shaka page for SokaMax embeds — installed apps open WebView (no APK update).
router.get('/watch', playbackLimiter, (req, res, next) => {
  handleWatchPage(req, res).catch(next);
});

// Media segment / playlist / MPD relay (Exo + HLS + watch-page proxy).
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

module.exports = router;
