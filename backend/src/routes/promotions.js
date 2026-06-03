const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { compareSemver } = require('../middleware/appVersion');

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

const promotionRowToJson = (row) => {
  const type = normalizeType(row.type);
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    imageUrl: row.image_url || null,
    image_url: row.image_url || null,
    buttonText: row.button_text || '',
    button_text: row.button_text || '',
    buttonUrl: row.button_url || null,
    button_url: row.button_url || null,
    type,
    priority: Number(row.priority) || 3,
    active: row.is_active === true,
    is_active: row.is_active === true,
    showMode: row.show_mode || 'daily',
    show_mode: row.show_mode || 'daily',
    target: row.target_audience || 'all',
    target_audience: row.target_audience || 'all',
    targetMaxVersion: row.target_max_version || null,
    target_max_version: row.target_max_version || null,
    targetMinVersion: row.target_min_version || null,
    target_min_version: row.target_min_version || null,
    backgroundStyle: row.background_style || 'dark_glass',
    background_style: row.background_style || 'dark_glass',
    offerAmountTsh: row.offer_amount_tsh != null ? Number(row.offer_amount_tsh) : null,
    offer_amount_tsh: row.offer_amount_tsh != null ? Number(row.offer_amount_tsh) : null,
    offerPeriodDays: row.offer_period_days != null ? Number(row.offer_period_days) : null,
    offer_period_days: row.offer_period_days != null ? Number(row.offer_period_days) : null,
    offerCountdownMinutes:
      row.offer_countdown_minutes != null ? Number(row.offer_countdown_minutes) : null,
    offer_countdown_minutes:
      row.offer_countdown_minutes != null ? Number(row.offer_countdown_minutes) : null,
    offerEndsAt: row.offer_ends_at,
    offer_ends_at: row.offer_ends_at,
    viewsCount: Number(row.views_count) || 0,
    clicksCount: Number(row.clicks_count) || 0,
    closeCount: Number(row.close_count) || 0,
    lastViewedAt: row.last_viewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

async function resolveUserContext(externalId) {
  if (!externalId) {
    return { userId: null, isPremium: false, blocked: false };
  }
  const result = await query(
    `SELECT id, is_premium, blocked, premium_expires_at
       FROM users WHERE external_id = $1 LIMIT 1`,
    [externalId],
  );
  if (!result.rows.length) {
    return { userId: null, isPremium: false, blocked: false };
  }
  const row = result.rows[0];
  const exp = row.premium_expires_at ? new Date(row.premium_expires_at) : null;
  const activePremium =
    row.is_premium === true && (!exp || exp > new Date());
  return {
    userId: row.id,
    isPremium: activePremium,
    blocked: row.blocked === true,
  };
}

function matchesTargeting(row, ctx, appVersion, platform) {
  const target = String(row.target_audience || 'all').toLowerCase();
  if (ctx.blocked) return false;
  if (target === 'premium' && !ctx.isPremium) return false;
  if (target === 'free' && ctx.isPremium) return false;
  if (target === 'android' && String(platform || '').toLowerCase() !== 'android') {
    return false;
  }
  const ver = String(appVersion || '').trim();
  if (row.target_max_version && ver) {
    if (compareSemver(ver, row.target_max_version) > 0) return false;
  }
  if (row.target_min_version && ver) {
    if (compareSemver(ver, row.target_min_version) < 0) return false;
  }
  return true;
}

function isPromotionActive(row, now = new Date()) {
  if (row.is_active !== true) return false;
  const type = normalizeType(row.type);
  if (type === 'ofa' && row.offer_ends_at) {
    const end = new Date(row.offer_ends_at);
    if (!Number.isNaN(end.getTime()) && end < now) return false;
  }
  return true;
}

async function recordPromotionEvent(promotionId, eventType, userId, externalId) {
  await query(
    `INSERT INTO promotion_events (promotion_id, user_id, external_id, event_type)
     VALUES ($1, $2, $3, $4)`,
    [promotionId, userId || null, externalId || null, eventType],
  ).catch(() => {});

  const column =
    eventType === 'click'
      ? 'clicks_count'
      : eventType === 'close'
        ? 'close_count'
        : 'views_count';

  await query(
    `UPDATE promotions
        SET ${column} = COALESCE(${column}, 0) + 1,
            last_viewed_at = CASE WHEN $2 = 'view' THEN now() ELSE last_viewed_at END,
            updated_at = now()
      WHERE id = $1`,
    [promotionId, eventType],
  ).catch(() => {});
}

router.get('/active', async (req, res, next) => {
  try {
    const schema = z.object({
      externalId: z.string().optional(),
      appVersion: z.string().optional(),
      platform: z.string().optional(),
    });
    const parsed = schema.safeParse(req.query);
    const externalId = parsed.success ? parsed.data.externalId?.trim() : '';
    const appVersion =
      parsed.success && parsed.data.appVersion
        ? parsed.data.appVersion.trim()
        : req.headers['x-app-version'] || '';
    const platform =
      parsed.success && parsed.data.platform
        ? parsed.data.platform.trim().toLowerCase()
        : 'android';

    const ctx = await resolveUserContext(externalId);
    const result = await query(
      `SELECT * FROM promotions
        WHERE is_active = TRUE
        ORDER BY priority ASC, id DESC`,
    );

    const now = new Date();
    const eligible = (result.rows || [])
      .filter((row) => isPromotionActive(row, now))
      .filter((row) => matchesTargeting(row, ctx, appVersion, platform))
      .map(promotionRowToJson);

    return res.json({ promotions: eligible });
  } catch (err) {
    return next(err);
  }
});

const eventSchema = z.object({
  externalId: z.string().optional(),
});

router.post('/:id/view', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const body = eventSchema.parse(req.body || {});
    const ctx = await resolveUserContext(body.externalId?.trim());
    await recordPromotionEvent(id, 'view', ctx.userId, body.externalId?.trim());
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/click', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const body = eventSchema.parse(req.body || {});
    const ctx = await resolveUserContext(body.externalId?.trim());
    await recordPromotionEvent(id, 'click', ctx.userId, body.externalId?.trim());
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/close', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const body = eventSchema.parse(req.body || {});
    const ctx = await resolveUserContext(body.externalId?.trim());
    await recordPromotionEvent(id, 'close', ctx.userId, body.externalId?.trim());
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
