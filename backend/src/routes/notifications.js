const express = require('express');
const { z } = require('zod');
const { query } = require('../db');

const router = express.Router();

// Public: list latest sent notifications (for admin recent list & in-app)
// ?limit=10 returns last 10; default 10
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const result = await query(
      `SELECT id, title, message, category, type, sent_at, clicks
         FROM notifications
        WHERE sent_at IS NOT NULL
        ORDER BY sent_at DESC
        LIMIT $1`,
      [limit],
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// Public: track click on a notification
router.post('/:id/click', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      id: z.string().regex(/^\d+$/),
    });
    const { id } = paramsSchema.parse(req.params);

    const updated = await query(
      `UPDATE notifications
          SET clicks = clicks + 1
        WHERE id = $1
        RETURNING id, clicks`,
      [Number(id)],
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    return res.json(updated.rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

