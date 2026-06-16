const express = require('express');
const configRouter = require('./config');
const channelsRouter = require('./channels');

const router = express.Router();

router.use('/config', configRouter);
router.use('/channels', channelsRouter);

module.exports = router;
