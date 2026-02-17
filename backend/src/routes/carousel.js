const express = require('express');
const { query } = require('../db');

const router = express.Router();

// Public: get active carousel slides
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, title, subtitle, badge, image_url,
              gradient_start, gradient_mid, gradient_end,
              info_icon, info_text
         FROM carousel_slides
        WHERE is_active = TRUE
        ORDER BY sort_order ASC, created_at DESC`,
    );

    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

