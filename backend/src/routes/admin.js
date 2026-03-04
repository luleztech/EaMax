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
    const tableCheck = await query(`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') AS users_exists,
             EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ad_events') AS ad_events_exists,
             EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'subscription_payments') AS payments_exists
    `);
    const { users_exists, ad_events_exists, payments_exists } = tableCheck.rows[0];

    if (!users_exists || !ad_events_exists) {
      return res.json({
        totalUsers: 0,
        premiumUsers: 0,
        newUsersThisMonth: 0,
        uninstallUsersThisMonth: 0,
        adsWatchedToday: 0,
        adsWatchedThisMonth: 0,
        totalPointsCollected: 0,
        revenueTsh: 0,
        message: 'Database tables not initialized. Run schema.sql.',
      });
    }

    const [
      totalUsers,
      premiumUsers,
      newUsersThisMonth,
      uninstallUsersThisMonth,
      adsToday,
      adsThisMonth,
      totalPoints,
      revenueResult,
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
      query(
        "SELECT COUNT(*)::int AS count FROM ad_events WHERE date_trunc('month', watched_at) = date_trunc('month', now())",
      ),
      query('SELECT COALESCE(SUM(points), 0)::int AS total_points FROM users'),
      payments_exists
        ? query(
            "SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total FROM subscription_payments WHERE status = 'completed' AND date_trunc('month', created_at) = date_trunc('month', now())",
          )
        : Promise.resolve({ rows: [{ total: 0 }] }),
    ]);

    const revenueTsh = Number(revenueResult.rows[0]?.total ?? 0);

    return res.json({
      totalUsers: totalUsers.rows[0].count,
      premiumUsers: premiumUsers.rows[0].count,
      newUsersThisMonth: newUsersThisMonth.rows[0].count,
      uninstallUsersThisMonth: uninstallUsersThisMonth.rows[0].count,
      adsWatchedToday: adsToday.rows[0].count,
      adsWatchedThisMonth: adsThisMonth.rows[0].count,
      totalPointsCollected: totalPoints.rows[0].total_points,
      revenueTsh,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return res.json({
      totalUsers: 0,
      premiumUsers: 0,
      newUsersThisMonth: 0,
      uninstallUsersThisMonth: 0,
      adsWatchedToday: 0,
      adsWatchedThisMonth: 0,
      totalPointsCollected: 0,
      revenueTsh: 0,
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

// Admin: list channels (with view counts for Most Watched)
router.get('/channels', async (req, res, next) => {
  try {
    let result;
    try {
      result = await query(`
        SELECT c.*,
               COALESCE(v.view_count, 0)::int AS view_count
        FROM channels c
        LEFT JOIN (
          SELECT channel_id, COUNT(*) AS view_count
          FROM channel_watch_events
          GROUP BY channel_id
        ) v ON c.id = v.channel_id
        ORDER BY c.created_at DESC
        LIMIT 500
      `);
    } catch (e) {
      if (e.message && e.message.includes('channel_watch_events')) {
        result = await query(
          'SELECT *, 0 AS view_count FROM channels ORDER BY created_at DESC LIMIT 500',
        );
      } else {
        throw e;
      }
    }
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
        pointsRequired: z.coerce.number().int().min(0).optional().default(0),
      });

      const data = bodySchema.parse(req.body);

      const result = await query(
        `INSERT INTO channels
         (name, category, stream_url, thumbnail_url, thumbnail_emoji, color, is_active, drm_protected, owner_user_id, points_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
          data.pointsRequired ?? 0,
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
      pointsRequired: z.coerce.number().int().min(0).optional(),
    });

    const { id } = paramsSchema.parse(req.params);
    const data = bodySchema.parse(req.body);

    const fields = [];
    const values = [];
    let idx = 1;

    const updates = {
      name: data.name,
      category: data.category,
      stream_url: data.streamUrl,
      thumbnail_url: data.thumbnailUrl,
      thumbnail_emoji: data.thumbnailEmoji,
      color: data.color,
      is_active: data.isActive,
      drm_protected: data.drmProtected,
      points_required: data.pointsRequired,
    };
    Object.entries(updates).forEach(([key, value]) => {
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
    const channelId = Number(id);

    // Delete dependent rows first (user_unlocked_channels references channels)
    await query('DELETE FROM user_unlocked_channels WHERE channel_id = $1', [channelId]);

    const result = await query('DELETE FROM channels WHERE id = $1', [channelId]);

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
      title: z.union([z.string(), z.null()]).optional(),
      subtitle: z.union([z.string(), z.null()]).optional(),
      badge: z.union([z.string(), z.null()]).optional(),
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
        data.title || null,
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
      title: z.union([z.string(), z.null()]).optional(),
      subtitle: z.union([z.string(), z.null()]).optional(),
      badge: z.union([z.string(), z.null()]).optional(),
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
      scheduledFor: z
        .string()
        .optional()
        .nullable()
        .transform((v) => (v && String(v).trim() !== '' ? String(v).trim() : null)),
    });

    const data = bodySchema.parse(req.body);

    const sentAt = data.type === 'normal' ? new Date() : null;
    let result;
    try {
      result = await query(
        `INSERT INTO notifications
           (title, message, category, type, scheduled_for, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          data.title,
          data.message,
          data.category,
          data.type,
          data.scheduledFor,
          sentAt,
        ],
      );
    } catch (dbErr) {
      console.error('Notifications INSERT failed:', dbErr);
      return res.status(500).json({
        error: 'Failed to save notification',
        details: process.env.NODE_ENV === 'development' ? dbErr.message : undefined,
      });
    }

    const notification = result.rows[0];
    if (!notification) {
      console.error('Notifications INSERT returned no row');
      return res.status(500).json({ error: 'Failed to save notification' });
    }

    // Send push notifications (never fail the HTTP request)
    if (data.type === 'normal') {
      try {
        const firebase = require('../services/firebase');
        const sendPush = firebase.sendPushNotificationToMultiple;
        const isInit = firebase.isInitialized;

        if (typeof isInit === 'function' && isInit()) {
          const tokensResult = await query(
            `SELECT fcm_token FROM users 
             WHERE fcm_token IS NOT NULL 
             AND blocked = FALSE 
             AND TRIM(fcm_token) != ''`
          );

          const rawTokens = (tokensResult.rows || [])
            .map((row) => row && row.fcm_token)
            .filter((token) => token && String(token).trim() !== '');
          // Deduplicate so each device receives exactly one notification
          const fcmTokens = [...new Set(rawTokens)];

          if (fcmTokens.length > 0 && typeof sendPush === 'function') {
            await sendPush(
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
      } catch (pushErr) {
        console.error('Push send error (notification still saved):', pushErr.message || pushErr);
      }
    }

    return res.status(201).json(notification);
  } catch (err) {
    if (err.name === 'ZodError') {
      const message = err.errors?.map((e) => e.message).join('; ') || err.message;
      return res.status(400).json({ error: 'Validation failed', details: message });
    }
    console.error('POST /notifications error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

module.exports = router;

