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

// Public: get single channel by id (stream URL from admin) – for fast play on click
router.get('/:id', async (req, res, next) => {
  try {
    const schema = z.object({ id: z.string().regex(/^\d+$/) });
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid channel id' });
    const id = parsed.data.id;
    const result = await query(
      'SELECT id, name, category, stream_url, thumbnail_url, thumbnail_emoji, color, points_required FROM channels WHERE id = $1 AND is_active = TRUE',
      [id]
    );
    if (!result.rows || result.rows.length === 0) return res.status(404).json({ error: 'Channel not found' });
    const row = result.rows[0];
    const pts = row.points_required != null ? Number(row.points_required) : 0;
    return res.json({
      id: row.id,
      name: row.name,
      category: row.category,
      stream_url: row.stream_url,
      streamUrl: row.stream_url,
      thumbnail_url: row.thumbnail_url,
      thumbnail_emoji: row.thumbnail_emoji,
      color: row.color,
      points_required: pts,
      pointsRequired: pts,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

