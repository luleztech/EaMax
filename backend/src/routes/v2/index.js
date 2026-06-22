const express = require('express');
const configRouter = require('./config');
const channelsRouter = require('./channels');
const analyticsRouter = require('./analytics');

const router = express.Router();

router.use('/config', configRouter);
router.use('/channels', channelsRouter);
router.use('/analytics', analyticsRouter);

module.exports = router;
