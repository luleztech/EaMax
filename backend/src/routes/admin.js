const express = require('express');
const { z } = require('zod');
const { query, pool } = require('../db');

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
        SELECT c.id, c.name, c.category, c.stream_url, c.thumbnail_url, c.thumbnail_emoji,
               c.color, c.points_required, c.is_active, c.drm_protected, c.drm_clear_key,
               c.owner_user_id, c.created_at,
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
        result = await query(`
          SELECT id, name, category, stream_url, thumbnail_url, thumbnail_emoji,
                 color, points_required, is_active, drm_protected, drm_clear_key,
                 owner_user_id, created_at,
                 0 AS view_count
          FROM channels
          ORDER BY created_at DESC
          LIMIT 500
        `);
      } else {
        throw e;
      }
    }
    return res.json(
      result.rows.map((row) => {
        const clearKey = row.drm_clear_key != null ? String(row.drm_clear_key) : (row.drmClearKey != null ? String(row.drmClearKey) : '');
        return {
          ...row,
          drm_clear_key: row.drm_clear_key,
          drmClearKey: clearKey,
        };
      })
    );
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
      drmClearKey: z.string().max(2048).optional().nullable(),
      ownerUserId: z.number().int().optional(),
      pointsRequired: z.coerce.number().int().min(0).optional().default(0),
    });

    const data = bodySchema.parse(req.body);

    const drmKeyValue = Object.prototype.hasOwnProperty.call(req.body, 'drmClearKey')
      ? (req.body.drmClearKey != null && String(req.body.drmClearKey).trim() !== ''
        ? String(req.body.drmClearKey).trim()
        : null)
      : null;

    const result = await query(
      `INSERT INTO channels
         (name, category, stream_url, thumbnail_url, thumbnail_emoji, color, is_active, drm_protected, drm_clear_key, owner_user_id, points_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
        drmKeyValue,
        data.ownerUserId || null,
        data.pointsRequired ?? 0,
      ],
    );

    return res.status(201).json({
      ...result.rows[0],
      drmClearKey: result.rows[0].drm_clear_key ?? result.rows[0].drmClearKey,
    });
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
      thumbnailUrl: z.string().url().optional().nullable(),
      thumbnailEmoji: z.string().max(8).optional().nullable(),
      color: z.string().max(16).optional(),
      isActive: z.boolean().optional(),
      drmProtected: z.boolean().optional(),
      drmClearKey: z.string().max(2048).optional().nullable(),
      pointsRequired: z.coerce.number().int().min(0).optional(),
    });

    const { id } = paramsSchema.parse(req.params);
    const data = bodySchema.parse(req.body);

    const channelId = Number(id);
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
      drm_clear_key: data.drmClearKey !== undefined
        ? (data.drmClearKey != null && String(data.drmClearKey).trim() !== '' ? String(data.drmClearKey).trim() : null)
        : undefined,
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

    values.push(channelId);

    const updated = await query(
      `UPDATE channels SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const row = updated.rows[0];
    return res.json({
      ...row,
      drmClearKey: row.drm_clear_key != null ? row.drm_clear_key : '',
    });
  } catch (err) {
    return next(err);
  }
});

router.delete('/channels/:id', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const channelId = Number(idParam);
    if (!idParam || String(channelId) !== String(idParam) || channelId < 1) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    const client = await pool.connect();
    try {
      // Allow up to 2 minutes for channels with many watch events (e.g. BBC News)
      await client.query('SET statement_timeout = 120000');

      let result;
      try {
        result = await client.query(
          `WITH
            _u AS (DELETE FROM user_unlocked_channels WHERE channel_id = $1),
            _w AS (DELETE FROM channel_watch_events WHERE channel_id = $1)
           DELETE FROM channels WHERE id = $1 RETURNING id`,
          [channelId]
        );
      } catch (e) {
        const msg = e.message || '';
        const missingTable = msg.includes('does not exist') || (e.code === '42P01');
        if (!missingTable) throw e;
        // Fallback when dependent tables don't exist
        await client.query('DELETE FROM user_unlocked_channels WHERE channel_id = $1', [channelId]).catch(() => { });
        await client.query('DELETE FROM channel_watch_events WHERE channel_id = $1', [channelId]).catch(() => { });
        result = await client.query('DELETE FROM channels WHERE id = $1 RETURNING id', [channelId]);
      }

      if (!result || result.rowCount === 0) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      return res.status(204).send();
    } finally {
      client.release();
    }
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

    // Send push notifications
    if (data.type === 'normal') {
      const firebase = require('../services/firebase');
      const sendPush = firebase.sendPushNotificationToMultiple;
      const isInit = firebase.isInitialized;

      // Check Firebase is initialized - return error to admin if not
      if (typeof isInit !== 'function' || !isInit()) {
        console.error('[FCM] Firebase not initialized - FIREBASE_SERVICE_ACCOUNT_KEY missing or invalid');
        return res.status(201).json({
          ...notification,
          pushError: 'Firebase not initialized. Set FIREBASE_SERVICE_ACCOUNT_KEY on Railway.',
          sent_count: 0,
        });
      }

      try {
        // Get all active users with valid FCM tokens
        const tokensResult = await query(
          `SELECT u.id as user_id, u.fcm_token 
           FROM users u
           WHERE u.fcm_token IS NOT NULL 
           AND u.blocked = FALSE 
           AND TRIM(u.fcm_token) != ''
           AND u.uninstalled_at IS NULL`
        );

        const userTokenMap = new Map();
        (tokensResult.rows || []).forEach((row) => {
          const token = row?.fcm_token;
          if (token && String(token).trim() !== '') {
            userTokenMap.set(row.user_id, token);
          }
        });

        // Deduplicate tokens so each device receives exactly one notification
        const fcmTokens = [...new Set(userTokenMap.values())];

        console.log(`[FCM] Sending notification ${notification.id} to ${fcmTokens.length} devices...`);

        if (fcmTokens.length === 0) {
          console.warn('[FCM] No valid FCM tokens found - no users have registered their devices yet');
          return res.status(201).json({
            ...notification,
            pushError: 'No users have registered for notifications yet.',
            sent_count: 0,
          });
        }

        // Send via Firebase in batches of 500 (FCM multicast limit)
        const BATCH_SIZE = 500;
        let totalSuccess = 0;
        let totalFailed = 0;
        const invalidTokens = [];

        for (let i = 0; i < fcmTokens.length; i += BATCH_SIZE) {
          const batch = fcmTokens.slice(i, i + BATCH_SIZE);
          const batchResult = await sendPush(
            batch,
            data.title,
            data.message,
            {
              notificationId: String(notification.id),
              category: data.category,
              type: 'notification',
            }
          );

          totalSuccess += batchResult?.sent || 0;
          totalFailed += batchResult?.failed || 0;

          // Collect invalid tokens to clean up
          if (batchResult?.responses) {
            batchResult.responses.forEach((resp, idx) => {
              if (!resp.success && resp.error) {
                const errCode = resp.error?.code || '';
                if (
                  errCode.includes('registration-token-not-registered') ||
                  errCode.includes('invalid-registration-token')
                ) {
                  invalidTokens.push(batch[idx]);
                }
              }
            });
          }
        }

        console.log(`[FCM] Notification ${notification.id}: ${totalSuccess} sent, ${totalFailed} failed`);

        // Clean up invalid/expired FCM tokens so future notifications skip them
        if (invalidTokens.length > 0) {
          console.log(`[FCM] Clearing ${invalidTokens.length} invalid/expired tokens`);
          for (const token of invalidTokens) {
            await query(
              `UPDATE users SET fcm_token = NULL WHERE fcm_token = $1`,
              [token]
            ).catch(() => {});
          }
        }

        // Track delivery attempts in database
        const deliveryRecords = [];
        for (const [userId, token] of userTokenMap.entries()) {
          if (!invalidTokens.includes(token)) {
            deliveryRecords.push([notification.id, userId, token]);
          }
        }

        if (deliveryRecords.length > 0) {
          // Batch insert delivery records (max 100 at a time to avoid param limit)
          const DB_BATCH = 100;
          for (let i = 0; i < deliveryRecords.length; i += DB_BATCH) {
            const chunk = deliveryRecords.slice(i, i + DB_BATCH);
            const deliveryValues = chunk
              .map((_, idx) => {
                const base = idx * 3;
                return `($${base + 1}, $${base + 2}, $${base + 3})`;
              })
              .join(',');
            await query(
              `INSERT INTO notification_deliveries (notification_id, user_id, fcm_token)
               VALUES ${deliveryValues}
               ON CONFLICT (notification_id, user_id) DO NOTHING`,
              chunk.flat()
            ).catch((err) => {
              console.warn('[FCM] Failed to insert delivery records:', err.message);
            });
          }
        }

        // Update sent_count on notification
        await query(
          `UPDATE notifications SET sent_count = $1 WHERE id = $2`,
          [totalSuccess, notification.id]
        ).catch((err) => {
          console.warn('[FCM] Failed to update sent_count:', err.message);
        });

        return res.status(201).json({
          ...notification,
          sent_count: totalSuccess,
          failed_count: totalFailed,
          total_devices: fcmTokens.length,
        });

      } catch (pushErr) {
        console.error('[FCM] Push send error:', pushErr.message || pushErr);
        return res.status(201).json({
          ...notification,
          pushError: `Push failed: ${pushErr.message || pushErr}`,
          sent_count: 0,
        });
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

