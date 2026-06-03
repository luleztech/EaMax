const express = require('express');
const { z } = require('zod');
const { query } = require('../db');

const router = express.Router();

const TYPE_ALIASES = {
  image: 'picha',
  text: 'ujumbe',
  announcement: 'tangazo',
  force_update: 'tangazo',
};

function normalizeType(type) {
  const t = String(type || 'ujumbe').toLowerCase();
  return TYPE_ALIASES[t] || t;
}

const VALID_TYPES = new Set(['picha', 'ujumbe', 'tangazo', 'ofa']);

const promotionTypeSchema = z
  .string()
  .optional()
  .default('ujumbe')
  .transform((raw) => normalizeType(raw))
  .refine((t) => VALID_TYPES.has(t), {
    message: 'Aina lazima iwe: picha, ujumbe, tangazo, au ofa',
  });

const promotionBodySchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional().default(''),
    imageUrl: z.string().optional().nullable(),
    buttonText: z.string().optional().default(''),
    buttonUrl: z.string().optional().nullable(),
    type: promotionTypeSchema,
    priority: z.number().int().min(1).max(4).default(3),
    isActive: z.boolean().optional().default(true),
    showMode: z.enum(['once', 'daily', 'every_launch']).default('every_launch'),
    targetAudience: z
      .enum(['all', 'free', 'premium', 'android', 'version'])
      .default('all'),
    targetMaxVersion: z.string().optional().nullable(),
    targetMinVersion: z.string().optional().nullable(),
    backgroundStyle: z
      .enum(['gold', 'dark_glass', 'premium_blue', 'red_alert', 'green_success'])
      .default('dark_glass'),
    offerAmountTsh: z.number().int().min(100).optional().nullable(),
    offerPeriodDays: z.number().int().min(1).max(366).optional().nullable(),
    offerCountdownMinutes: z.number().int().min(1).max(10080).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const type = normalizeType(data.type);
    if (type === 'ofa') {
      if (!data.offerAmountTsh) {
        ctx.addIssue({ code: 'custom', message: 'Bei ya ofa inahitajika' });
      }
      if (!data.offerPeriodDays) {
        ctx.addIssue({ code: 'custom', message: 'Muda wa usajili unahitajika (siku)' });
      }
      if (!data.offerCountdownMinutes) {
        ctx.addIssue({ code: 'custom', message: 'Muda wa kuhesabu ofa unahitajika (dakika)' });
      }
    }
    if (type === 'picha' && !data.imageUrl?.trim()) {
      ctx.addIssue({ code: 'custom', message: 'URL ya picha inahitajika' });
    }
  });

function computeOfferEndsAt(countdownMinutes) {
  const mins = Number(countdownMinutes) || 0;
  if (mins <= 0) return null;
  return new Date(Date.now() + mins * 60 * 1000).toISOString();
}

const mapRow = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description || '',
  imageUrl: row.image_url,
  buttonText: row.button_text || '',
  buttonUrl: row.button_url,
  type: normalizeType(row.type),
  priority: Number(row.priority),
  isActive: row.is_active === true,
  showMode: row.show_mode,
  targetAudience: row.target_audience,
  targetMaxVersion: row.target_max_version,
  targetMinVersion: row.target_min_version,
  backgroundStyle: row.background_style,
  offerAmountTsh: row.offer_amount_tsh != null ? Number(row.offer_amount_tsh) : null,
  offerPeriodDays: row.offer_period_days != null ? Number(row.offer_period_days) : null,
  offerCountdownMinutes:
    row.offer_countdown_minutes != null ? Number(row.offer_countdown_minutes) : null,
  offerEndsAt: row.offer_ends_at,
  viewsCount: Number(row.views_count) || 0,
  clicksCount: Number(row.clicks_count) || 0,
  closeCount: Number(row.close_count) || 0,
  lastViewedAt: row.last_viewed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function buildInsertValues(data) {
  const type = normalizeType(data.type);
  const targetAudience = type === 'ofa' ? 'free' : data.targetAudience;
  const offerEndsAt =
    type === 'ofa' ? computeOfferEndsAt(data.offerCountdownMinutes) : null;
  return {
    type,
    targetAudience,
    offerAmountTsh: type === 'ofa' ? data.offerAmountTsh : null,
    offerPeriodDays: type === 'ofa' ? data.offerPeriodDays : null,
    offerCountdownMinutes: type === 'ofa' ? data.offerCountdownMinutes : null,
    offerEndsAt,
    buttonText:
      type === 'ofa'
        ? ''
        : type === 'tangazo'
          ? data.buttonText?.trim() || 'Fungua'
          : data.buttonText?.trim() || '',
  };
}

router.get('/stats', async (req, res, next) => {
  try {
    const [totals, active, expiredOffers] = await Promise.all([
      query(
        `SELECT
           COALESCE(SUM(views_count), 0)::bigint AS views,
           COALESCE(SUM(clicks_count), 0)::bigint AS clicks,
           COUNT(*)::int AS total
         FROM promotions`,
      ),
      query(`SELECT COUNT(*)::int AS n FROM promotions WHERE is_active = TRUE`),
      query(
        `SELECT COUNT(*)::int AS n FROM promotions
          WHERE type = 'ofa' AND offer_ends_at IS NOT NULL AND offer_ends_at < now()`,
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
      expiredPromotions: Number(expiredOffers.rows[0]?.n) || 0,
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
    const built = buildInsertValues(data);
    const result = await query(
      `INSERT INTO promotions (
         title, description, image_url, button_text, button_url,
         type, priority, is_active, show_mode,
         target_audience, target_max_version, target_min_version,
         background_style, force_update, min_required_version,
         offer_amount_tsh, offer_period_days, offer_countdown_minutes, offer_ends_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,FALSE,NULL,$14,$15,$16,$17)
       RETURNING *`,
      [
        data.title,
        data.description || '',
        built.type === 'picha' ? data.imageUrl || null : null,
        built.buttonText,
        data.buttonUrl || null,
        built.type,
        data.priority,
        data.isActive,
        data.showMode,
        built.targetAudience,
        data.targetAudience === 'version' ? data.targetMaxVersion || null : null,
        data.targetMinVersion || null,
        data.backgroundStyle,
        built.offerAmountTsh,
        built.offerPeriodDays,
        built.offerCountdownMinutes,
        built.offerEndsAt,
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
    const built = buildInsertValues(data);
    const existingRes = await query('SELECT offer_ends_at FROM promotions WHERE id = $1', [id]);
    if (built.type === 'ofa' && existingRes.rows[0]?.offer_ends_at) {
      built.offerEndsAt = existingRes.rows[0].offer_ends_at;
    }
    const result = await query(
      `UPDATE promotions SET
         title = $1, description = $2, image_url = $3, button_text = $4, button_url = $5,
         type = $6, priority = $7, is_active = $8, show_mode = $9,
         target_audience = $10, target_max_version = $11, target_min_version = $12,
         background_style = $13, force_update = FALSE, min_required_version = NULL,
         offer_amount_tsh = $14, offer_period_days = $15, offer_countdown_minutes = $16,
         offer_ends_at = $17, updated_at = now()
       WHERE id = $18 RETURNING *`,
      [
        data.title,
        data.description || '',
        built.type === 'picha' ? data.imageUrl || null : null,
        built.buttonText,
        data.buttonUrl || null,
        built.type,
        data.priority,
        data.isActive,
        data.showMode,
        built.targetAudience,
        data.targetAudience === 'version' ? data.targetMaxVersion || null : null,
        data.targetMinVersion || null,
        data.backgroundStyle,
        built.offerAmountTsh,
        built.offerPeriodDays,
        built.offerCountdownMinutes,
        built.offerEndsAt,
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
