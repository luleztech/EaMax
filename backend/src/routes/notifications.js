const express = require('express');
const { z } = require('zod');
const { query } = require('../db');

const router = express.Router();

// Public: list notifications for admin recent list (scheduled pinned first, then sent)
// Scheduled: sent_at IS NULL, scheduled_for set — shown first (pinned). Sent: sent_at set — then by sent_at DESC.
// ?limit=20 returns up to 20 total (scheduled + sent); default 20
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const result = await query(
      `SELECT id, title, message, category, type, sent_at, scheduled_for, clicks
         FROM notifications
        WHERE sent_at IS NOT NULL OR scheduled_for IS NOT NULL
        ORDER BY (CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END) ASC,
                 (CASE WHEN sent_at IS NULL THEN scheduled_for END) ASC NULLS LAST,
                 (CASE WHEN sent_at IS NOT NULL THEN sent_at END) DESC NULLS LAST
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

