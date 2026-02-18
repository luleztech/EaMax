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
      premiumPayments,
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
      query(
        "SELECT COALESCE(SUM(amount_cents), 0)::int AS amount_cents FROM subscription_payments WHERE status = 'completed' AND date_trunc('month', created_at) = date_trunc('month', now())",
      ),
    ]);

    return res.json({
      totalUsers: totalUsers.rows[0].count,
      premiumUsers: premiumUsers.rows[0].count,
      newUsersThisMonth: newUsersThisMonth.rows[0].count,
      uninstallUsersThisMonth: uninstallUsersThisMonth.rows[0].count,
      adsWatchedToday: adsToday.rows[0].count,
      totalPointsCollected: totalPoints.rows[0].total_points,
      premiumPaymentsCents: premiumPayments.rows[0].amount_cents,
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

// Admin: give special access (premium for duration) – user receives access for the given time
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

    const userId = Number(id);
    const expiresAt = new Date();

    switch (unit) {
      case 'hours':
        expiresAt.setHours(expiresAt.getHours() + duration);
        break;
      case 'days':
        expiresAt.setDate(expiresAt.getDate() + duration);
        break;
      case 'weeks':
        expiresAt.setDate(expiresAt.getDate() + duration * 7);
        break;
      case 'months':
        expiresAt.setMonth(expiresAt.getMonth() + duration);
        break;
      default:
        expiresAt.setDate(expiresAt.getDate() + duration);
    }

    const updated = await query(
      `UPDATE users
          SET is_premium = TRUE,
              premium_expires_at = $1
        WHERE id = $2
        RETURNING id, external_id, is_premium, premium_expires_at`,
      [expiresAt.toISOString(), userId],
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Unlock all channels for this user (optional; app uses is_premium for full access)
    try {
      await query(
        `INSERT INTO user_unlocked_channels (user_id, channel_id)
         SELECT $1, id FROM channels WHERE is_active = TRUE
         ON CONFLICT (user_id, channel_id) DO NOTHING`,
        [userId],
      );
    } catch (insertErr) {
      console.error('Unlock channels insert (non-fatal):', insertErr);
    }

    const row = updated.rows[0];
    return res.json({
      id: row.id,
      external_id: row.external_id,
      is_premium: row.is_premium,
      premium_expires_at: row.premium_expires_at,
      message: `User is now premium until ${row.premium_expires_at}`,
    });
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

// Admin: list carousel slides (optionally filter by category)
router.get('/carousel', async (req, res, next) => {
  try {
    const category = req.query.category; // football | movies | undefined (all)
    
    let queryStr = 'SELECT * FROM carousel_slides';
    let params = [];
    
    if (category) {
      queryStr += ' WHERE category = $1';
      params.push(category);
    }
    
    queryStr += ' ORDER BY sort_order ASC, created_at DESC';
    
    const result = await query(queryStr, params);
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// Admin: create carousel slide
router.post('/carousel', async (req, res, next) => {
  try {
    const bodySchema = z.object({
      title: z.string().min(1),
      subtitle: z.string().optional(),
      badge: z.string().optional(),
      imageUrl: z.string().optional(),
      gradientStart: z.string().optional(),
      gradientMid: z.string().optional(),
      gradientEnd: z.string().optional(),
      infoIcon: z.string().optional(),
      infoText: z.string().optional(),
      category: z.enum(['football', 'movies', 'habari']).default('football'),
      videoUrl: z.string().optional(),
      isActive: z.boolean().optional().default(true),
      sortOrder: z.number().int().optional().default(0),
    });

    const data = bodySchema.parse(req.body);

    const result = await query(
      `INSERT INTO carousel_slides
         (title, subtitle, badge, image_url, video_url,
          gradient_start, gradient_mid, gradient_end,
          info_icon, info_text, category, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        data.title,
        data.subtitle || null,
        data.badge || null,
        data.imageUrl || null,
        data.videoUrl || null,
        data.gradientStart || '#14532d',
        data.gradientMid || null,
        data.gradientEnd || '#000000',
        data.infoIcon || null,
        data.infoText || null,
        data.category,
        data.isActive,
        data.sortOrder,
      ],
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

// Admin: update carousel slide
router.put('/carousel/:id', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      id: z.string().regex(/^\d+$/),
    });
    const bodySchema = z.object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
      badge: z.string().optional(),
      imageUrl: z.string().optional(),
      gradientStart: z.string().optional(),
      gradientMid: z.string().optional(),
      gradientEnd: z.string().optional(),
      infoIcon: z.string().optional(),
      infoText: z.string().optional(),
      category: z.enum(['football', 'movies', 'habari']).optional(),
      videoUrl: z.string().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    });

    const { id } = paramsSchema.parse(req.params);
    const data = bodySchema.parse(req.body);

    const fields = [];
    const values = [];
    let idx = 1;

    const mapping = {
      title: 'title',
      subtitle: 'subtitle',
      badge: 'badge',
      imageUrl: 'image_url',
      videoUrl: 'video_url',
      gradientStart: 'gradient_start',
      gradientMid: 'gradient_mid',
      gradientEnd: 'gradient_end',
      infoIcon: 'info_icon',
      infoText: 'info_text',
      category: 'category',
      isActive: 'is_active',
      sortOrder: 'sort_order',
    };

    Object.entries(mapping).forEach(([key, column]) => {
      const value = data[key];
      if (value !== undefined) {
        fields.push(`${column} = $${idx}`);
        values.push(value);
        idx += 1;
      }
    });

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(Number(id));

    const updated = await query(
      `UPDATE carousel_slides
          SET ${fields.join(', ')}
        WHERE id = $${idx}
        RETURNING *`,
      values,
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    return res.json(updated.rows[0]);
  } catch (err) {
    return next(err);
  }
});

// Admin: delete carousel slide
router.delete('/carousel/:id', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      id: z.string().regex(/^\d+$/),
    });
    const { id } = paramsSchema.parse(req.params);

    const result = await query('DELETE FROM carousel_slides WHERE id = $1', [
      Number(id),
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

// Admin: list upcoming matches
router.get('/matches', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM upcoming_matches ORDER BY match_time ASC`,
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// Admin: create upcoming match
router.post('/matches', async (req, res, next) => {
  try {
    const bodySchema = z.object({
      league: z.string().min(1),
      team1: z.string().min(1),
      team2: z.string().min(1),
      matchTime: z.string().datetime(), // ISO 8601 string
      pointsRequired: z.number().int().optional().default(15),
      isActive: z.boolean().optional().default(true),
    });

    const data = bodySchema.parse(req.body);

    const result = await query(
      `INSERT INTO upcoming_matches
         (league, team1, team2, match_time, points_required, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.league,
        data.team1,
        data.team2,
        data.matchTime,
        data.pointsRequired,
        data.isActive,
      ],
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

// Admin: update upcoming match
router.put('/matches/:id', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      id: z.string().regex(/^\d+$/),
    });
    const bodySchema = z.object({
      league: z.string().optional(),
      team1: z.string().optional(),
      team2: z.string().optional(),
      matchTime: z.string().datetime().optional(),
      pointsRequired: z.number().int().optional(),
      isActive: z.boolean().optional(),
    });

    const { id } = paramsSchema.parse(req.params);
    const data = bodySchema.parse(req.body);

    const fields = [];
    const values = [];
    let idx = 1;

    const mapping = {
      league: 'league',
      team1: 'team1',
      team2: 'team2',
      matchTime: 'match_time',
      pointsRequired: 'points_required',
      isActive: 'is_active',
    };

    Object.entries(mapping).forEach(([key, column]) => {
      const value = data[key];
      if (value !== undefined) {
        fields.push(`${column} = $${idx}`);
        values.push(value);
        idx += 1;
      }
    });

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(Number(id));

    const updated = await query(
      `UPDATE upcoming_matches
          SET ${fields.join(', ')}
        WHERE id = $${idx}
        RETURNING *`,
      values,
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    return res.json(updated.rows[0]);
  } catch (err) {
    return next(err);
  }
});

// Admin: delete upcoming match
router.delete('/matches/:id', async (req, res, next) => {
  try {
    const paramsSchema = z.object({
      id: z.string().regex(/^\d+$/),
    });
    const { id } = paramsSchema.parse(req.params);

    const result = await query('DELETE FROM upcoming_matches WHERE id = $1', [
      Number(id),
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Match not found' });
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
      title: z.string().min(1, 'Title is required'),
      message: z.string().min(1, 'Message is required'),
      category: z
        .string()
        .min(1, 'Category is required')
        .transform((s) => s.toLowerCase().trim())
        .refine((s) => ['kabumbu', 'movies', 'habari'].includes(s), {
          message: 'Category must be kabumbu, movies, or habari',
        }),
      type: z.enum(['normal', 'scheduled']).default('normal'),
      scheduledFor: z.string().optional().nullable(),
    });

    const data = bodySchema.parse(req.body);

    const result = await query(
      `INSERT INTO notifications
         (title, message, category, type, scheduled_for, sent_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $4 = 'normal' THEN now() ELSE NULL END)
       RETURNING *`,
      [
        data.title,
        data.message,
        data.category,
        data.type,
        data.scheduledFor && data.scheduledFor.trim() !== '' ? data.scheduledFor.trim() : null,
      ],
    );

    const notification = result.rows[0];

    // Send push notifications to all users with FCM tokens (never fail the request)
    if (data.type === 'normal') {
      try {
        const { sendPushNotificationToMultiple, isInitialized } = require('../services/firebase');

        if (typeof isInitialized === 'function' && isInitialized()) {
          const tokensResult = await query(
            `SELECT fcm_token FROM users 
             WHERE fcm_token IS NOT NULL 
             AND blocked = FALSE 
             AND TRIM(fcm_token) != ''`
          );

          const fcmTokens = (tokensResult.rows || [])
            .map((row) => row && row.fcm_token)
            .filter((token) => token && String(token).trim() !== '');

          if (fcmTokens.length > 0) {
            await sendPushNotificationToMultiple(
              fcmTokens,
              data.title,
              data.message,
              {
                notificationId: String(notification.id),
                category: data.category,
                type: 'notification',
              }
            );
          }
        }
      } catch (pushError) {
        console.error('Failed to send push notifications:', pushError);
      }
    }

    return res.status(201).json(notification);
  } catch (err) {
    if (err.name === 'ZodError') {
      const message = err.errors?.map((e) => e.message).join('; ') || err.message;
      return res.status(400).json({ error: 'Validation failed', details: message });
    }
    return next(err);
  }
});

module.exports = router;

