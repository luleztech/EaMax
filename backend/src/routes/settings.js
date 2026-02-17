const express = require('express');
const { z } = require('zod');
const { query } = require('../db');

const router = express.Router();

// Public: get WhatsApp support number
router.get('/whatsapp', async (req, res, next) => {
  try {
    const result = await query(
      "SELECT value FROM app_settings WHERE key = 'whatsapp_number' LIMIT 1",
    );
    if (result.rows.length === 0) {
      return res.json({ number: null });
    }
    return res.json({ number: result.rows[0].value });
  } catch (err) {
    return next(err);
  }
});

// Admin: update WhatsApp number (protected via ADMIN_API_KEY in admin routes)
router.put('/whatsapp', async (req, res, next) => {
  try {
    const bodySchema = z.object({
      number: z.string().min(5),
    });
    const { number } = bodySchema.parse(req.body);

    const result = await query(
      `INSERT INTO app_settings (key, value)
         VALUES ('whatsapp_number', $1)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value,
                       updated_at = now()
       RETURNING key, value`,
      [number],
    );

    return res.json({ number: result.rows[0].value });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

