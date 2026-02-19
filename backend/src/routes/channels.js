const express = require('express');
const { z } = require('zod');
const { query } = require('../db');

const router = express.Router();

// Public: list active channels, optionally filter by category
router.get('/', async (req, res, next) => {
  try {
    const schema = z.object({
      category: z.enum(['football', 'movies', 'habari', 'tamthilia', 'wanyama', 'katuni', 'sayansi']).optional(),
    });
    const parsed = schema.safeParse(req.query);

    let sql = 'SELECT * FROM channels WHERE is_active = TRUE';
    const params = [];

    if (parsed.success && parsed.data.category) {
      sql += ' AND category = $1';
      params.push(parsed.data.category);
    }

    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);
    const rows = (result.rows || []).map((row) => {
      const pts = row.points_required != null ? Number(row.points_required) : 0;
      return {
        ...row,
        points_required: pts,
        pointsRequired: Number.isNaN(pts) ? 0 : pts,
      };
    });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

