const express = require('express');
const { playbackLimiter } = require('../middleware/rateLimiter');
const { handleRelay } = require('../services/embedPlaybackService');

const router = express.Router();

router.get('/relay', playbackLimiter, (req, res, next) => {
  handleRelay(req, res).catch(next);
});

module.exports = router;
