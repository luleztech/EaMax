const express = require('express');
const { z } = require('zod');
const { query } = require('../db');

const router = express.Router();

// Ensure externalId-based user exists or create new
router.post('/register', async (req, res, next) => {
  try {
    const bodySchema = z.object({
      externalId: z.string().min(1),
    });
    const { externalId } = bodySchema.parse(req.body);

    const existing = await query(
      'SELECT * FROM users WHERE external_id = $1',
      [externalId],
    );

    if (existing.rows.length > 0) {
      return res.json(existing.rows[0]);
    }

    const inserted = await query(
      `INSERT INTO users (external_id)
       VALUES ($1)
       RETURNING *`,
      [externalId],
    );

    return res.status(201).json(inserted.rows[0]);
  } catch (err) {
    return next(err);
  }
});

// Get user summary by externalId
router.get('/:externalId', async (req, res, next) => {
  try {
    const { externalId } = req.params;
    const result = await query(
      'SELECT * FROM users WHERE external_id = $1',
      [externalId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

// Record ad watched and increment points
router.post('/:externalId/ads/watched', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      externalId: z.string().min(1),
    });
    const bodySchema = z.object({
      points: z.number().int().positive().default(10),
    });

    const { externalId } = paramsSchema.parse(req.params);
    const { points } = bodySchema.parse(req.body);

    const userResult = await query(
      'SELECT id FROM users WHERE external_id = $1',
      [externalId],
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = userResult.rows[0].id;

    await query(
      `INSERT INTO ad_events (user_id, points_earned)
       VALUES ($1, $2)`,
      [userId, points],
    );

    const updated = await query(
      `UPDATE users
         SET points = points + $1
       WHERE id = $2
       RETURNING *`,
      [points, userId],
    );

    return res.json({
      user: updated.rows[0],
      pointsAdded: points,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

