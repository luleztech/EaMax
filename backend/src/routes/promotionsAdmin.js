const express = require('express');
const { z } = require('zod');
const { query } = require('../db');

const router = express.Router();

const promotionBodySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
  imageUrl: z.string().optional().nullable(),
  buttonText: z.string().optional().default('Learn More'),
  buttonUrl: z.string().optional().nullable(),
  type: z.enum(['image', 'text', 'announcement', 'force_update']).default('text'),
  priority: z.number().int().min(1).max(4).default(3),
  isActive: z.boolean().optional().default(true),
  showMode: z.enum(['once', 'daily', 'every_launch']).default('daily'),
  startAt: z.string().optional().nullable(),
  endAt: z.string().optional().nullable(),
  targetAudience: z
    .enum(['all', 'free', 'premium', 'android', 'version'])
    .default('all'),
  targetMaxVersion: z.string().optional().nullable(),
  targetMinVersion: z.string().optional().nullable(),
  backgroundStyle: z
    .enum(['gold', 'dark_glass', 'premium_blue', 'red_alert', 'green_success'])
    .default('dark_glass'),
  forceUpdate: z.boolean().optional().default(false),
  minRequiredVersion: z.string().optional().nullable(),
});

const mapRow = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description || '',
  imageUrl: row.image_url,
  buttonText: row.button_text,
  buttonUrl: row.button_url,
  type: row.type,
  priority: Number(row.priority),
  isActive: row.is_active === true,
  showMode: row.show_mode,
  startAt: row.start_at,
  endAt: row.end_at,
  targetAudience: row.target_audience,
  targetMaxVersion: row.target_max_version,
  targetMinVersion: row.target_min_version,
  backgroundStyle: row.background_style,
  forceUpdate: row.force_update === true,
  minRequiredVersion: row.min_required_version,
  viewsCount: Number(row.views_count) || 0,
  clicksCount: Number(row.clicks_count) || 0,
  closeCount: Number(row.close_count) || 0,
  lastViewedAt: row.last_viewed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

router.get('/stats', async (req, res, next) => {
  try {
    const [totals, active, expired] = await Promise.all([
      query(
        `SELECT
           COALESCE(SUM(views_count), 0)::bigint AS views,
           COALESCE(SUM(clicks_count), 0)::bigint AS clicks,
           COUNT(*)::int AS total
         FROM promotions`,
      ),
      query(
        `SELECT COUNT(*)::int AS n FROM promotions
          WHERE is_active = TRUE
            AND (start_at IS NULL OR start_at <= now())
            AND (end_at IS NULL OR end_at >= now())`,
      ),
      query(
        `SELECT COUNT(*)::int AS n FROM promotions
          WHERE end_at IS NOT NULL AND end_at < now()`,
      ),
    ]);
    const row = totals.rows[0] || {};
    const views = Number(row.views) || 0;
    const clicks = Number(row.clicks) || 0;
    return res.json({
      totalPromotions: Number(row.total) || 0,
      totalViews: views,
      totalClicks: clicks,
      ctrPercent: views > 0 ? Number(((clicks / views) * 100).toFixed(1)) : 0,
      activePromotions: Number(active.rows[0]?.n) || 0,
      expiredPromotions: Number(expired.rows[0]?.n) || 0,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM promotions ORDER BY priority ASC, updated_at DESC`,
    );
    return res.json(result.rows.map(mapRow));
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = promotionBodySchema.parse(req.body);
    const result = await query(
      `INSERT INTO promotions (
         title, description, image_url, button_text, button_url,
         type, priority, is_active, show_mode, start_at, end_at,
         target_audience, target_max_version, target_min_version,
         background_style, force_update, min_required_version
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        data.title,
        data.description || '',
        data.imageUrl || null,
        data.buttonText,
        data.buttonUrl || null,
        data.type,
        data.priority,
        data.isActive,
        data.showMode,
        data.startAt || null,
        data.endAt || null,
        data.targetAudience,
        data.targetMaxVersion || null,
        data.targetMinVersion || null,
        data.backgroundStyle,
        data.forceUpdate,
        data.minRequiredVersion || null,
      ],
    );
    return res.status(201).json(mapRow(result.rows[0]));
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: err.message });
    }
    return next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const data = promotionBodySchema.parse(req.body);
    const result = await query(
      `UPDATE promotions SET
         title = $1, description = $2, image_url = $3, button_text = $4, button_url = $5,
         type = $6, priority = $7, is_active = $8, show_mode = $9, start_at = $10, end_at = $11,
         target_audience = $12, target_max_version = $13, target_min_version = $14,
         background_style = $15, force_update = $16, min_required_version = $17,
         updated_at = now()
       WHERE id = $18 RETURNING *`,
      [
        data.title,
        data.description || '',
        data.imageUrl || null,
        data.buttonText,
        data.buttonUrl || null,
        data.type,
        data.priority,
        data.isActive,
        data.showMode,
        data.startAt || null,
        data.endAt || null,
        data.targetAudience,
        data.targetMaxVersion || null,
        data.targetMinVersion || null,
        data.backgroundStyle,
        data.forceUpdate,
        data.minRequiredVersion || null,
        id,
      ],
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    return res.json(mapRow(result.rows[0]));
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: err.message });
    }
    return next(err);
  }
});

router.patch('/:id/toggle', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = z.object({ isActive: z.boolean() }).parse(req.body);
    const result = await query(
      `UPDATE promotions SET is_active = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [body.isActive, id],
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    return res.json(mapRow(result.rows[0]));
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const result = await query('DELETE FROM promotions WHERE id = $1 RETURNING id', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true, id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
