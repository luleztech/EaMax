const express = require('express');
const { z } = require('zod');
const { query } = require('../db');

const router = express.Router();

// Simple API-key auth for admin routes
router.use((req, res, next) => {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    return res
      .status(500)
      .json({ error: 'ADMIN_API_KEY is not configured on the server' });
  }
  const provided = req.headers['x-admin-key'];
  if (!provided || provided !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
});

// Dashboard stats for EaAdmin
router.get('/dashboard', async (req, res, next) => {
  try {
    // Check if tables exist first
    const tableCheck = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      ) AS users_exists,
      EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'ad_events'
      ) AS ad_events_exists
    `);

    const { users_exists, ad_events_exists } = tableCheck.rows[0];

    // If tables don't exist, return zeros
    if (!users_exists || !ad_events_exists) {
      return res.json({
        totalUsers: 0,
        premiumUsers: 0,
        newUsersThisMonth: 0,
        uninstallUsersThisMonth: 0,
        adsWatchedToday: 0,
        totalPointsCollected: 0,
        revenue: 0,
        message: 'Database tables not initialized. Please run the schema.sql script.',
      });
    }

    const [
      totalUsers,
      premiumUsers,
      newUsersThisMonth,
      uninstallUsersThisMonth,
      adsToday,
      totalPoints,
    ] = await Promise.all([
      query('SELECT COUNT(*)::int AS count FROM users'),
      query(
        "SELECT COUNT(*)::int AS count FROM users WHERE is_premium = TRUE AND (premium_expires_at IS NULL OR premium_expires_at > now())",
      ),
      query(
        "SELECT COUNT(*)::int AS count FROM users WHERE date_trunc('month', created_at) = date_trunc('month', now())",
      ),
      query(
        "SELECT COUNT(*)::int AS count FROM users WHERE uninstalled_at IS NOT NULL AND date_trunc('month', uninstalled_at) = date_trunc('month', now())",
      ),
      query(
        "SELECT COUNT(*)::int AS count FROM ad_events WHERE date_trunc('day', watched_at) = date_trunc('day', now())",
      ),
      query('SELECT COALESCE(SUM(points), 0)::int AS total_points FROM users'),
    ]);

    return res.json({
      totalUsers: totalUsers.rows[0].count,
      premiumUsers: premiumUsers.rows[0].count,
      newUsersThisMonth: newUsersThisMonth.rows[0].count,
      uninstallUsersThisMonth: uninstallUsersThisMonth.rows[0].count,
      adsWatchedToday: adsToday.rows[0].count,
      totalPointsCollected: totalPoints.rows[0].total_points,
      revenue: 0, // TODO: Calculate from subscription_payments table
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Dashboard stats error:', err);
    // Return default values on error instead of crashing
    return res.json({
      totalUsers: 0,
      premiumUsers: 0,
      newUsersThisMonth: 0,
      uninstallUsersThisMonth: 0,
      adsWatchedToday: 0,
      totalPointsCollected: 0,
      revenue: 0,
      error: err.message,
    });
  }
});

// Admin: list users (basic)
router.get('/users', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, external_id, is_premium, premium_expires_at, points, blocked, created_at
         FROM users
        ORDER BY created_at DESC
        LIMIT 200`,
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// Admin: block / unblock user
router.patch('/users/:id/block', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      id: z.string().regex(/^\d+$/),
    });
    const bodySchema = z.object({
      blocked: z.boolean(),
    });

    const { id } = paramsSchema.parse(req.params);
    const { blocked } = bodySchema.parse(req.body);

    const updated = await query(
      `UPDATE users
          SET blocked = $1
        WHERE id = $2
        RETURNING id, external_id, blocked`,
      [blocked, Number(id)],
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(updated.rows[0]);
  } catch (err) {
    return next(err);
  }
});

// Admin: give special access (premium for duration)
router.post('/users/:id/special-access', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      id: z.string().regex(/^\d+$/),
    });
    const bodySchema = z.object({
      duration: z.number().int().positive(),
      unit: z.enum(['hours', 'days', 'weeks', 'months']),
    });

    const { id } = paramsSchema.parse(req.params);
    const { duration, unit } = bodySchema.parse(req.body);

    // Calculate expiration date
    const expiresAt = new Date();
    const multiplier = {
      hours: 1,
      days: 24,
      weeks: 24 * 7,
      months: 24 * 30,
    }[unit];
    expiresAt.setHours(expiresAt.getHours() + duration * multiplier);

    const updated = await query(
      `UPDATE users
          SET is_premium = TRUE,
              premium_expires_at = $1
        WHERE id = $2
        RETURNING id, external_id, is_premium, premium_expires_at`,
      [expiresAt.toISOString(), Number(id)],
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(updated.rows[0]);
  } catch (err) {
    return next(err);
  }
});

// Admin: create or update channels
router.get('/channels', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM channels ORDER BY created_at DESC LIMIT 500',
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/channels', async (req, res, next) => {
  try {
    const bodySchema = z.object({
      name: z.string().min(1),
      category: z.enum(['football', 'movies', 'habari']),
      streamUrl: z.string().url(),
      thumbnailUrl: z.string().url().optional(),
      thumbnailEmoji: z.string().max(8).optional(),
      color: z.string().max(16).optional(),
      isActive: z.boolean().optional().default(true),
      drmProtected: z.boolean().optional().default(false),
      ownerUserId: z.number().int().optional(),
    });

    const data = bodySchema.parse(req.body);

    const result = await query(
      `INSERT INTO channels
         (name, category, stream_url, thumbnail_url, thumbnail_emoji, color, is_active, drm_protected, owner_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        data.name,
        data.category,
        data.streamUrl,
        data.thumbnailUrl || null,
        data.thumbnailEmoji || null,
        data.color || null,
        data.isActive,
        data.drmProtected,
        data.ownerUserId || null,
      ],
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.put('/channels/:id', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      id: z.string().regex(/^\d+$/),
    });
    const bodySchema = z.object({
      name: z.string().min(1).optional(),
      category: z.enum(['football', 'movies', 'habari']).optional(),
      streamUrl: z.string().url().optional(),
      thumbnailUrl: z.string().url().optional(),
      thumbnailEmoji: z.string().max(8).optional(),
      color: z.string().max(16).optional(),
      isActive: z.boolean().optional(),
      drmProtected: z.boolean().optional(),
    });

    const { id } = paramsSchema.parse(req.params);
    const data = bodySchema.parse(req.body);

    const fields = [];
    const values = [];
    let idx = 1;

    Object.entries({
      name: data.name,
      category: data.category,
      stream_url: data.streamUrl,
      thumbnail_url: data.thumbnailUrl,
      thumbnail_emoji: data.thumbnailEmoji,
      color: data.color,
      is_active: data.isActive,
      drm_protected: data.drmProtected,
    }).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = $${idx}`);
        values.push(value);
        idx += 1;
      }
    });

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(Number(id));

    const updated = await query(
      `UPDATE channels
          SET ${fields.join(', ')}
        WHERE id = $${idx}
        RETURNING *`,
      values,
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    return res.json(updated.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete('/channels/:id', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      id: z.string().regex(/^\d+$/),
    });
    const { id } = paramsSchema.parse(req.params);

    const result = await query('DELETE FROM channels WHERE id = $1', [
      Number(id),
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

// Admin: create notification
router.post('/notifications', async (req, res, next) => {
  try {
    const bodySchema = z.object({
      title: z.string().min(1),
      message: z.string().min(1),
      category: z.enum(['kabumbu', 'movies', 'habari']),
      type: z.enum(['normal', 'scheduled']).default('normal'),
      scheduledFor: z.string().datetime().optional(),
    });

    const data = bodySchema.parse(req.body);

    const result = await query(
      `INSERT INTO notifications
         (title, message, category, type, scheduled_for, sent_at)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $4 = 'normal' THEN now() ELSE NULL END)
       RETURNING *`,
      [
        data.title,
        data.message,
        data.category,
        data.type,
        data.scheduledFor || null,
      ],
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

