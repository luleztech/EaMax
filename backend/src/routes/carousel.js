const express = require('express');
const { query } = require('../db');

const router = express.Router();

// Public: get active carousel slides by category
router.get('/', async (req, res, next) => {
  try {
    const category = req.query.category || 'football'; // Default to football
    
    const result = await query(
      `SELECT id, title, subtitle, badge, image_url, video_url,
              gradient_start, gradient_mid, gradient_end,
              info_icon, info_text
         FROM carousel_slides
        WHERE is_active = TRUE AND category = $1
        ORDER BY sort_order ASC, created_at DESC`,
      [category],
    );

    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

