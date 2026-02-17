const express = require('express');
const { query } = require('../db');

const router = express.Router();

// Public: get active upcoming matches
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, league, team1, team2, match_time, points_required
         FROM upcoming_matches
        WHERE is_active = TRUE AND match_time > now()
        ORDER BY match_time ASC
        LIMIT 20`,
    );

    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
