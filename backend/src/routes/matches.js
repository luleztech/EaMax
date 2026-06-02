const express = require('express');
const { query } = require('../db');

const router = express.Router();

// Public: get active matches configured from EaAdmin
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, league, team1, team2, match_time, points_required
         FROM upcoming_matches
        WHERE is_active = TRUE
        ORDER BY match_time ASC NULLS LAST, id DESC
        LIMIT 100`,
    );

    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
