const express = require('express');
const { z } = require('zod');
const { query, pool } = require('../db');
const { sendPushNotification } = require('../services/firebase');

const router = express.Router();

// Simple API-key auth for admin routes
router.use((req, res, next) => {
  const adminKey = process.env.ADMIN_API_KEY || 'super-secret-admin-key';
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
          "SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total FROM subscription_payments WHERE status = 'completed' AND date_trunc('day', COALESCE(completed_at, created_at)) = date_trunc('day', now())",
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
    const uid = Number(id);

    if (blocked) {
      const updated = await query(
        `UPDATE users
            SET blocked = TRUE,
                is_premium = FALSE,
                premium_expires_at = NULL
          WHERE id = $1
          RETURNING id, external_id, blocked, is_premium, premium_expires_at`,
        [uid],
      );

      if (updated.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      await query('DELETE FROM user_unlocked_channels WHERE user_id = $1', [uid]).catch(() => {});

      return res.json(updated.rows[0]);
    }

    const updated = await query(
      `UPDATE users
          SET blocked = FALSE
        WHERE id = $1
        RETURNING id, external_id, blocked`,
      [uid],
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(updated.rows[0]);
  } catch (err) {
    return next(err);
  }
});

// Admin: remind expired subscribers via FCM (optional single user; force skips 7-day throttle)
router.post('/subscriptions/remind-expired', async (req, res, next) => {
  try {
    const bodySchema = z.object({
      userId: z.number().int().positive().optional(),
      force: z.boolean().optional(),
    });
    const body = bodySchema.parse(req.body || {});
    const { sendExpiredSubscriptionReminders } = require('../services/expiredSubscriptionReminders');
    const result = await sendExpiredSubscriptionReminders({
      userId: body.userId,
      force: body.force === true,
    });
    // Always 200 so admin client can read ok/message without fetch throwing on 503
    return res.status(200).json(result);
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
              blocked = FALSE,
              premium_expires_at = $1
        WHERE id = $2
        RETURNING id, external_id, is_premium, premium_expires_at, blocked`,
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

    // Send push notification to user about admin granting access
    try {
      const userResult = await query('SELECT fcm_token, external_id FROM users WHERE id = $1', [userId]);
      const fcmToken = userResult.rows[0]?.fcm_token;
      const externalId = userResult.rows[0]?.external_id;
      
      if (fcmToken) {
        await sendPushNotification(
          fcmToken,
          'Access Granted!',
          'Admin has granted you premium access. Enjoy all channels!',
          { type: 'admin_access_granted' }
        );
        console.log('[Admin] Push notification sent to user:', userId);
      }

      // Send real-time update via WebSocket if available
      if (global.realtimeServer && externalId) {
        try {
          const row = updated.rows[0];
          global.realtimeServer.notifyPremiumUpdate(externalId, {
            is_premium: row.is_premium,
            premium_expires_at: row.premium_expires_at,
          });
        } catch (err) {
          console.error('[Admin] Failed to send real-time update:', err.message);
        }
      }
    } catch (notifErr) {
      console.error('[Admin] Failed to send notifications:', notifErr.message);
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

// Ensure sort_order exists (idempotent; safe on every reorder request)
const ensureChannelSortOrderColumn = async () => {
  await query(
    `ALTER TABLE channels ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0`,
  ).catch(() => {});
  await query(
    `UPDATE channels SET sort_order = id WHERE sort_order IS NULL OR sort_order = 0`,
  ).catch(() => {});
};

const handleChannelsReorder = async (req, res, next) => {
  try {
    const bodySchema = z.object({
      channelIds: z.array(z.coerce.number().int().positive()).min(1),
    });
    const { channelIds } = bodySchema.parse(req.body);

    await ensureChannelSortOrderColumn();

    for (let i = 0; i < channelIds.length; i += 1) {
      await query('UPDATE channels SET sort_order = $1 WHERE id = $2', [i, channelIds[i]]);
    }

    return res.json({ ok: true, count: channelIds.length });
  } catch (err) {
    return next(err);
  }
};

// Admin: reorder channels (drag-and-drop positions) — PATCH and POST for compatibility
router.patch('/channels/reorder', handleChannelsReorder);
router.post('/channels/reorder', handleChannelsReorder);

// Admin: list channels (with view counts for Most Watched)
router.get('/channels', async (req, res, next) => {
  try {
    let result;
    try {
      result = await query(`
        SELECT c.id, c.name, c.category, c.stream_url, c.stream_alias, c.thumbnail_url, c.thumbnail_emoji,
               c.color, c.points_required, c.is_active, c.drm_protected, c.drm_clear_key,
               COALESCE(c.drm_type, 'NONE') AS drm_type,
               c.owner_user_id, c.created_at,
               COALESCE(c.sort_order, c.id) AS sort_order,
               COALESCE(c.unlock_to_free, false) AS unlock_to_free,
               COALESCE(v.view_count, 0)::int AS view_count
        FROM channels c
        LEFT JOIN (
          SELECT channel_id, COUNT(*) AS view_count
          FROM channel_watch_events
          GROUP BY channel_id
        ) v ON c.id = v.channel_id
        ORDER BY COALESCE(c.sort_order, c.id) ASC, c.id ASC
        LIMIT 500
      `);
    } catch (e) {
      if (e.message && e.message.includes('channel_watch_events')) {
        result = await query(`
          SELECT id, name, category, stream_url, stream_alias, thumbnail_url, thumbnail_emoji,
                 color, points_required, is_active, drm_protected, drm_clear_key,
                 COALESCE(drm_type, 'NONE') AS drm_type,
                 owner_user_id, created_at,
                 COALESCE(sort_order, id) AS sort_order,
                 COALESCE(unlock_to_free, false) AS unlock_to_free,
                 0 AS view_count
          FROM channels
          ORDER BY COALESCE(sort_order, id) ASC, id ASC
          LIMIT 500
        `);
      } else {
        throw e;
      }
    }
    return res.json(
      result.rows.map((row) => {
        const clearKey = row.drm_clear_key != null ? String(row.drm_clear_key) : (row.drmClearKey != null ? String(row.drmClearKey) : '');
        const drmType = (row.drm_type || 'NONE').toUpperCase();
        const unlockToFree = !!(row.unlock_to_free === true);
        return {
          ...row,
          drm_type: drmType,
          drmType,
          drm_clear_key: row.drm_clear_key,
          drmClearKey: clearKey,
          unlock_to_free: unlockToFree,
          unlockToFree,
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
      category: z.enum(['football', 'movies', 'habari', 'tamthilia', 'wanyama', 'katuni', 'sayansi']),
      streamUrl: z.string().url().optional(),
      streamAlias: z.string().min(1).max(128).optional(),
      thumbnailUrl: z.string().url().optional(),
      thumbnailEmoji: z.string().max(8).optional(),
      color: z.string().max(16).optional(),
      isActive: z.boolean().optional().default(true),
      drmType: z.enum(['NONE', 'CLEARKEY', 'WIDEVINE', 'PLAYREADY']).optional().default('NONE'),
      drmClearKey: z.string().max(2048).optional().nullable(),
      ownerUserId: z.number().int().optional(),
      pointsRequired: z.coerce.number().int().min(0).optional().default(0),
      unlockToFree: z.boolean().optional().default(false),
    }).superRefine((data, ctx) => {
      const hasUrl = !!(data.streamUrl && String(data.streamUrl).trim());
      const hasAlias = !!(data.streamAlias && String(data.streamAlias).trim());
      if (!hasUrl && !hasAlias) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'streamUrl or streamAlias is required' });
      }
    });

    const data = bodySchema.parse(req.body);
    const aliasTrimmed = data.streamAlias != null ? String(data.streamAlias).trim() : '';
    const urlTrimmed = data.streamUrl != null ? String(data.streamUrl).trim() : '';
    const drmType = (data.drmType || 'NONE').toUpperCase();
    const needsDrm = drmType !== 'NONE';
    const drmKeyValue = drmType === 'CLEARKEY' && req.body.drmClearKey != null && String(req.body.drmClearKey).trim() !== ''
      ? String(req.body.drmClearKey).trim()
      : null;

    // If channel is alias-only, ensure alias resolves to a real URL so playback won't break.
    if (!urlTrimmed && aliasTrimmed) {
      const aliasTarget = await query(
        `SELECT c.stream_url
         FROM stream_aliases a
         JOIN channels c ON c.id = a.channel_id
         WHERE a.alias = $1 AND a.is_active = TRUE
         LIMIT 1`,
        [aliasTrimmed],
      );
      const targetUrl = aliasTarget.rows?.[0]?.stream_url;
      if (!targetUrl) {
        return res.status(400).json({
          error: 'Alias is not configured',
          details: 'This channel has no stream URL. Configure the alias in Settings so it resolves to a channel with a valid stream URL.',
        });
      }
    }

    const result = await query(
      `INSERT INTO channels
         (name, category, stream_url, stream_alias, thumbnail_url, thumbnail_emoji, color, is_active, drm_protected, drm_type, drm_clear_key, owner_user_id, points_required, unlock_to_free)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        data.name,
        data.category,
        data.streamUrl || null,
        data.streamAlias ? String(data.streamAlias).trim() : null,
        data.thumbnailUrl || null,
        data.thumbnailEmoji || null,
        data.color || null,
        data.isActive,
        needsDrm,
        drmType,
        drmKeyValue,
        data.ownerUserId || null,
        data.pointsRequired ?? 0,
        !!data.unlockToFree,
      ],
    );

    const row = result.rows[0];
    const aliasValue = row.stream_alias != null ? String(row.stream_alias).trim() : '';
    // Only auto-sync alias->channel mapping when the channel has a real stream_url.
    if (aliasValue && row.stream_url) {
      await query(
        `INSERT INTO stream_aliases (alias, channel_id, is_active, updated_at)
         VALUES ($1, $2, TRUE, NOW())
         ON CONFLICT (alias) DO UPDATE SET channel_id = EXCLUDED.channel_id, updated_at = NOW()`,
        [aliasValue, row.id],
      ).catch(() => {});
    }
    return res.status(201).json({
      ...row,
      drm_type: drmType,
      drmType,
      drmClearKey: row.drm_clear_key ?? row.drmClearKey,
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
      category: z.enum(['football', 'movies', 'habari', 'tamthilia', 'wanyama', 'katuni', 'sayansi']).optional(),
      streamUrl: z.string().url().optional(),
      streamAlias: z.string().min(1).max(128).optional().nullable(),
      thumbnailUrl: z.string().url().optional().nullable(),
      thumbnailEmoji: z.string().max(8).optional().nullable(),
      color: z.string().max(16).optional(),
      isActive: z.boolean().optional(),
      drmType: z.enum(['NONE', 'CLEARKEY', 'WIDEVINE', 'PLAYREADY']).optional(),
      drmClearKey: z.string().max(2048).optional().nullable(),
      pointsRequired: z.coerce.number().int().min(0).optional(),
      unlockToFree: z.boolean().optional(),
      sortOrder: z.coerce.number().int().min(0).optional(),
    });

    const { id } = paramsSchema.parse(req.params);
    const data = bodySchema.parse(req.body);

    const channelId = Number(id);
    const fields = [];
    const values = [];
    let idx = 1;

    const drmType = data.drmType != null ? String(data.drmType).toUpperCase() : undefined;
    const needsDrm = drmType !== undefined ? drmType !== 'NONE' : undefined;
    const drmClearKeyValue = data.drmClearKey !== undefined
      ? (data.drmClearKey != null && String(data.drmClearKey).trim() !== '' ? String(data.drmClearKey).trim() : null)
      : undefined;

    const aliasTrimmed = data.streamAlias != null ? String(data.streamAlias).trim() : '';
    const urlTrimmed = data.streamUrl != null ? String(data.streamUrl).trim() : undefined;
    // If update makes channel alias-only, ensure alias resolves to a real URL so playback won't break.
    if (data.streamAlias !== undefined) {
      const current = await query('SELECT stream_url FROM channels WHERE id = $1 LIMIT 1', [channelId]);
      const currentUrl = current.rows?.[0]?.stream_url ? String(current.rows[0].stream_url).trim() : '';
      const nextUrl = urlTrimmed !== undefined ? urlTrimmed : currentUrl;
      if (!nextUrl && aliasTrimmed) {
        const aliasTarget = await query(
          `SELECT c.stream_url
           FROM stream_aliases a
           JOIN channels c ON c.id = a.channel_id
           WHERE a.alias = $1 AND a.is_active = TRUE
           LIMIT 1`,
          [aliasTrimmed],
        );
        const targetUrl = aliasTarget.rows?.[0]?.stream_url;
        if (!targetUrl) {
          return res.status(400).json({
            error: 'Alias is not configured',
            details: 'This channel has no stream URL. Configure the alias in Settings so it resolves to a channel with a valid stream URL.',
          });
        }
      }
    }

    const updates = {
      name: data.name,
      category: data.category,
      stream_url: data.streamUrl,
      ...(data.streamAlias !== undefined && { stream_alias: data.streamAlias != null ? String(data.streamAlias).trim() : null }),
      thumbnail_url: data.thumbnailUrl,
      thumbnail_emoji: data.thumbnailEmoji,
      color: data.color,
      is_active: data.isActive,
      ...(drmType !== undefined && { drm_type: drmType }),
      ...(needsDrm !== undefined && { drm_protected: needsDrm }),
      points_required: data.pointsRequired,
      ...(drmType !== undefined && {
        drm_clear_key: drmType === 'CLEARKEY' ? (drmClearKeyValue ?? null) : null,
      }),
      ...(data.unlockToFree !== undefined && { unlock_to_free: !!data.unlockToFree }),
      ...(data.sortOrder !== undefined && { sort_order: data.sortOrder }),
    };

    if (data.sortOrder !== undefined) {
      await ensureChannelSortOrderColumn();
    }

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
    const newAliasValue = row.stream_alias != null ? String(row.stream_alias).trim() : '';
    if (data.streamAlias !== undefined) {
      // Keep alias mapping in sync when channel alias is edited.
      await query(
        'DELETE FROM stream_aliases WHERE channel_id = $1 AND ($2 = \'\' OR alias <> $2)',
        [channelId, newAliasValue],
      ).catch(() => {});
      // Only auto-sync alias->channel mapping when the channel has a real stream_url.
      if (newAliasValue && row.stream_url) {
        await query(
          `INSERT INTO stream_aliases (alias, channel_id, is_active, updated_at)
           VALUES ($1, $2, TRUE, NOW())
           ON CONFLICT (alias) DO UPDATE SET channel_id = EXCLUDED.channel_id, updated_at = NOW()`,
          [newAliasValue, channelId],
        ).catch(() => {});
      }
    }
    return res.json({
      ...row,
      drmClearKey: row.drm_clear_key != null ? row.drm_clear_key : '',
    });
  } catch (err) {
    return next(err);
  }
});

// Admin: list stream aliases
router.get('/stream-aliases', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         a.alias, a.channel_id, a.is_active, a.created_at, a.updated_at,
         COALESCE(c.name, NULL) AS channel_name
       FROM stream_aliases a
       LEFT JOIN channels c ON c.id = a.channel_id
       ORDER BY a.updated_at DESC`,
    );
    return res.json(result.rows || []);
  } catch (err) {
    return next(err);
  }
});

// Admin: upsert stream alias
router.post('/stream-aliases', async (req, res, next) => {
  try {
    const bodySchema = z.object({
      alias: z.string().min(1).max(128),
      channelId: z.coerce.number().int().positive(),
      isActive: z.boolean().optional(),
    });
    const data = bodySchema.parse(req.body);
    const alias = String(data.alias).trim();
    const channelId = Number(data.channelId);
    const isActive = data.isActive !== undefined ? !!data.isActive : true;
    const channelExists = await query('SELECT id FROM channels WHERE id = $1 LIMIT 1', [channelId]);
    if (!channelExists.rows || channelExists.rows.length === 0) {
      return res.status(400).json({ error: 'Channel not found for alias mapping' });
    }
    const result = await query(
      `INSERT INTO stream_aliases (alias, channel_id, is_active, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (alias) DO UPDATE SET
         channel_id = EXCLUDED.channel_id,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()
       RETURNING alias, channel_id, is_active, created_at, updated_at`,
      [alias, channelId, isActive],
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

// Admin: toggle stream alias active state
router.patch('/stream-aliases/:alias/active', async (req, res, next) => {
  try {
    const paramsSchema = z.object({ alias: z.string().min(1) });
    const bodySchema = z.object({ isActive: z.boolean() });
    const { alias } = paramsSchema.parse(req.params);
    const { isActive } = bodySchema.parse(req.body);
    const result = await query(
      `UPDATE stream_aliases
       SET is_active = $2, updated_at = NOW()
       WHERE alias = $1
       RETURNING alias, channel_id, is_active, created_at, updated_at`,
      [String(alias).trim(), !!isActive],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Alias not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

// Admin: delete stream alias
router.delete('/stream-aliases/:alias', async (req, res, next) => {
  try {
    const paramsSchema = z.object({ alias: z.string().min(1) });
    const { alias } = paramsSchema.parse(req.params);
    const result = await query('DELETE FROM stream_aliases WHERE alias = $1', [String(alias).trim()]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Alias not found' });
    return res.status(204).send();
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
        await client.query('DELETE FROM stream_aliases WHERE channel_id = $1', [channelId]).catch(() => { });
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
      category: z.enum(['football', 'movies', 'habari', 'tamthilia', 'wanyama', 'katuni', 'sayansi']).default('football'),
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
      category: z.enum(['football', 'movies', 'habari', 'tamthilia', 'wanyama', 'katuni', 'sayansi']).optional(),
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
      const sendTopicPush = firebase.sendPushNotificationToTopic;
      const isInit = firebase.isInitialized;

      if (typeof isInit !== 'function' || !isInit()) {
        console.error('[FCM] Firebase not initialized - FIREBASE_SERVICE_ACCOUNT_KEY missing or invalid');
        return res.status(201).json({
          ...notification,
          pushError: 'Firebase not initialized. Set FIREBASE_SERVICE_ACCOUNT_KEY on Railway.',
          sent_count: 0,
        });
      }

      try {
        // Topic broadcast reaches all installs that subscribed to all_users.
        await sendTopicPush(
          'all_users',
          data.title,
          data.message,
          {
            notificationId: String(notification.id),
            category: data.category,
            type: 'notification',
          }
        );

        // Approximate audience size from active users for dashboard "sent" metric.
        const audienceResult = await query(
          `SELECT COUNT(*)::int AS count
           FROM users
           WHERE blocked = FALSE
             AND uninstalled_at IS NULL`
        ).catch(() => ({ rows: [{ count: 0 }] }));
        const audienceCount = Number(audienceResult.rows?.[0]?.count || 0);

        await query(
          `UPDATE notifications SET sent_count = $1 WHERE id = $2`,
          [audienceCount, notification.id],
        ).catch(() => {});

        return res.status(201).json({
          ...notification,
          sent_count: audienceCount,
          failed_count: 0,
          sent_via_topic: true,
          topic: 'all_users',
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

// Admin: clear notification history
// Deletes notification deliveries first, then notification history records.
router.post('/notifications/history/clear', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let deliveriesDeleted = 0;
    let notificationsDeleted = 0;

    // delivery table may not exist on older schemas; keep endpoint resilient
    try {
      const deliveryResult = await client.query('DELETE FROM notification_deliveries');
      deliveriesDeleted = deliveryResult.rowCount || 0;
    } catch (err) {
      const msg = String(err?.message || '');
      const isMissingTable = err?.code === '42P01' || msg.includes('does not exist');
      if (!isMissingTable) throw err;
    }

    const notificationsResult = await client.query('DELETE FROM notifications');
    notificationsDeleted = notificationsResult.rowCount || 0;

    await client.query('COMMIT');
    return res.json({
      ok: true,
      notificationsDeleted,
      deliveriesDeleted,
      message: 'Notification history cleared',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return next(err);
  } finally {
    client.release();
  }
});

// Admin: notification analytics (real sent/delivered/click metrics)
router.get('/notifications/metrics', async (req, res, next) => {
  try {
    const daysRaw = parseInt(String(req.query.days || '30'), 10);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 90) : 30;

    const aggregateResult = await query(
      `SELECT
         COUNT(*)::int AS total_notifications,
         COALESCE(SUM(sent_count), 0)::bigint AS total_sent,
         COALESCE(SUM(delivered_count), 0)::bigint AS total_delivered,
         COALESCE(SUM(clicks), 0)::bigint AS total_clicks
       FROM notifications
       WHERE sent_at IS NOT NULL
         AND sent_at >= NOW() - ($1::text || ' days')::interval`,
      [String(days)],
    );

    const tokensResult = await query(
      `SELECT
         COUNT(*)::int AS installed_users,
         COUNT(*) FILTER (
           WHERE fcm_token IS NOT NULL
             AND TRIM(fcm_token) <> ''
             AND blocked = FALSE
             AND uninstalled_at IS NULL
         )::int AS users_with_token,
         COUNT(*) FILTER (
           WHERE fcm_token IS NOT NULL
             AND TRIM(fcm_token) <> ''
             AND blocked = FALSE
             AND uninstalled_at IS NULL
             AND fcm_token_updated_at >= NOW() - INTERVAL '7 days'
         )::int AS active_tokens_7d,
         COUNT(*) FILTER (
           WHERE fcm_token IS NOT NULL
             AND TRIM(fcm_token) <> ''
             AND blocked = FALSE
             AND uninstalled_at IS NULL
             AND fcm_token_updated_at >= NOW() - INTERVAL '30 days'
         )::int AS active_tokens_30d
       FROM users`,
    );

    const row = aggregateResult.rows?.[0] || {};
    const tok = tokensResult.rows?.[0] || {};
    const totalSent = Number(row.total_sent || 0);
    const totalDelivered = Number(row.total_delivered || 0);
    const totalClicks = Number(row.total_clicks || 0);
    const ctrFromDelivered = totalDelivered > 0 ? (totalClicks / totalDelivered) * 100 : 0;
    const ctrFromSent = totalSent > 0 ? (totalClicks / totalSent) * 100 : 0;
    const deliveryRate = totalSent > 0 ? (totalDelivered / totalSent) * 100 : 0;

    return res.json({
      windowDays: days,
      totals: {
        notifications: Number(row.total_notifications || 0),
        sent: totalSent,
        delivered: totalDelivered,
        clicks: totalClicks,
      },
      rates: {
        deliveryRate: Number(deliveryRate.toFixed(1)),
        ctrFromDelivered: Number(ctrFromDelivered.toFixed(1)),
        ctrFromSent: Number(ctrFromSent.toFixed(1)),
      },
      audience: {
        installedUsers: Number(tok.installed_users || 0),
        usersWithToken: Number(tok.users_with_token || 0),
        activeTokens7d: Number(tok.active_tokens_7d || 0),
        activeTokens30d: Number(tok.active_tokens_30d || 0),
      },
    });
  } catch (err) {
    return next(err);
  }
});

// Admin: Ads statistics – real data from ad_events and users tables
router.get('/ads/stats', async (req, res, next) => {
  try {
    // Check if required tables exist before querying
    const tableCheck = await query(`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ad_events') AS ad_events_exists,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') AS users_exists
    `);
    const { ad_events_exists, users_exists } = tableCheck.rows[0];

    // Base user stats (always available if users table exists)
    let totalPointsResult = { rows: [{ total_points: 0, users_with_points: 0 }] };
    if (users_exists) {
      try {
        totalPointsResult = await query(
          `SELECT COALESCE(SUM(points), 0)::int AS total_points,
                  COUNT(CASE WHEN points > 0 THEN 1 END)::int AS users_with_points
           FROM users`
        );
      } catch (e) {
        console.warn('Failed to query users points:', e.message);
      }
    }

    // If ad_events table does not exist, return zero stats with user points data
    if (!ad_events_exists) {
      const pointsInfo = totalPointsResult.rows[0];
      return res.json({
        adsWatchedToday: 0,
        pointsEarnedToday: 0,
        adsWatchedYesterday: 0,
        todayChange: '+0%',
        adsWatchedThisMonth: 0,
        pointsEarnedThisMonth: 0,
        adsWatchedLastMonth: 0,
        monthChange: '+0%',
        adsWatchedAllTime: 0,
        pointsEarnedAllTime: 0,
        totalPointsCollected: pointsInfo.total_points,
        usersWithPoints: pointsInfo.users_with_points,
        topUsers: [],
        dailyBreakdown: [],
      });
    }

    // Check if points_earned column exists in ad_events
    const colCheck = await query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ad_events' AND column_name = 'points_earned'
      ) AS has_points_earned
    `);
    const hasPointsEarned = colCheck.rows[0].has_points_earned;

    const pointsExpr = hasPointsEarned
      ? 'COALESCE(SUM(points_earned), 0)::int'
      : '0::int';

    const [
      todayResult,
      yesterdayResult,
      thisMonthResult,
      lastMonthResult,
      allTimeResult,
      topUsersResult,
      dailyBreakdownResult,
    ] = await Promise.all([
      // Ads watched today
      query(
        `SELECT COUNT(*)::int AS count, ${pointsExpr} AS points
         FROM ad_events
         WHERE DATE(watched_at AT TIME ZONE 'UTC') = CURRENT_DATE`
      ),
      // Ads watched yesterday
      query(
        `SELECT COUNT(*)::int AS count, ${pointsExpr} AS points
         FROM ad_events
         WHERE DATE(watched_at AT TIME ZONE 'UTC') = CURRENT_DATE - INTERVAL '1 day'`
      ),
      // Ads watched this month
      query(
        `SELECT COUNT(*)::int AS count, ${pointsExpr} AS points
         FROM ad_events
         WHERE DATE_TRUNC('month', watched_at) = DATE_TRUNC('month', CURRENT_DATE)`
      ),
      // Ads watched last month
      query(
        `SELECT COUNT(*)::int AS count, ${pointsExpr} AS points
         FROM ad_events
         WHERE DATE_TRUNC('month', watched_at) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')`
      ),
      // All-time ads watched
      query(
        `SELECT COUNT(*)::int AS count, ${pointsExpr} AS points
         FROM ad_events`
      ),
      // Top 5 users by points earned from ads (or by ads watched if no points_earned)
      hasPointsEarned
        ? query(
            `SELECT u.external_id, COALESCE(SUM(ae.points_earned), 0)::int AS points_from_ads,
                    COUNT(ae.id)::int AS ads_watched
             FROM users u
             JOIN ad_events ae ON ae.user_id = u.id
             GROUP BY u.id, u.external_id
             ORDER BY points_from_ads DESC
             LIMIT 5`
          )
        : query(
            `SELECT u.external_id, 0::int AS points_from_ads,
                    COUNT(ae.id)::int AS ads_watched
             FROM users u
             JOIN ad_events ae ON ae.user_id = u.id
             GROUP BY u.id, u.external_id
             ORDER BY ads_watched DESC
             LIMIT 5`
          ),
      // Daily breakdown for last 7 days
      query(
        `SELECT DATE(watched_at AT TIME ZONE 'UTC') AS day,
                COUNT(*)::int AS ads_count,
                ${pointsExpr} AS points
         FROM ad_events
         WHERE watched_at >= CURRENT_DATE - INTERVAL '6 days'
         GROUP BY DATE(watched_at AT TIME ZONE 'UTC')
         ORDER BY day ASC`
      ),
    ]);

    const today = todayResult.rows[0];
    const yesterday = yesterdayResult.rows[0];
    const thisMonth = thisMonthResult.rows[0];
    const lastMonth = lastMonthResult.rows[0];
    const allTime = allTimeResult.rows[0];
    const pointsInfo = totalPointsResult.rows[0];

    // Calculate change percentages
    const pct = (current, previous) => {
      if (previous > 0) return (((current - previous) / previous) * 100).toFixed(1);
      return current > 0 ? '100' : '0';
    };

    const fmtChange = (val) => {
      const n = parseFloat(val);
      if (isNaN(n)) return '+0%';
      return n >= 0 ? `+${n.toFixed(1)}%` : `${n.toFixed(1)}%`;
    };

    return res.json({
      adsWatchedToday: today.count,
      pointsEarnedToday: today.points,
      adsWatchedYesterday: yesterday.count,
      todayChange: fmtChange(pct(today.count, yesterday.count)),
      adsWatchedThisMonth: thisMonth.count,
      pointsEarnedThisMonth: thisMonth.points,
      adsWatchedLastMonth: lastMonth.count,
      monthChange: fmtChange(pct(thisMonth.count, lastMonth.count)),
      adsWatchedAllTime: allTime.count,
      pointsEarnedAllTime: allTime.points,
      totalPointsCollected: pointsInfo.total_points,
      usersWithPoints: pointsInfo.users_with_points,
      topUsers: topUsersResult.rows.map(row => ({
        userId: row.external_id,
        adsWatched: row.ads_watched,
        pointsFromAds: row.points_from_ads,
      })),
      dailyBreakdown: dailyBreakdownResult.rows.map(row => ({
        day: row.day,
        adsCount: row.ads_count,
        points: row.points,
      })),
    });
  } catch (err) {
    console.error('Ads stats error:', err);
    // Return zero-state instead of crashing, so admin app never gets an error
    return res.json({
      adsWatchedToday: 0,
      pointsEarnedToday: 0,
      adsWatchedYesterday: 0,
      todayChange: '+0%',
      adsWatchedThisMonth: 0,
      pointsEarnedThisMonth: 0,
      adsWatchedLastMonth: 0,
      monthChange: '+0%',
      adsWatchedAllTime: 0,
      pointsEarnedAllTime: 0,
      totalPointsCollected: 0,
      usersWithPoints: 0,
      topUsers: [],
      dailyBreakdown: [],
      _error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// Admin: get channels premium-only setting (same as public, for admin UI consistency)
router.get('/settings/channels-premium-only', async (req, res, next) => {
  try {
    const result = await query(
      "SELECT value FROM app_settings WHERE key = 'channels_premium_only' LIMIT 1",
    );
    if (result.rows.length === 0) {
      return res.json({ channelsPremiumOnly: false });
    }
    const value = result.rows[0].value;
    return res.json({ channelsPremiumOnly: value === 'true' || value === '1' });
  } catch (err) {
    return next(err);
  }
});

// Admin: update channels premium-only (ON = pay only, no ads/points; OFF = points or 0 for free)
router.put('/settings/channels-premium-only', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const channelsPremiumOnly = body.channelsPremiumOnly === true ||
      body.channelsPremiumOnly === 'true' || body.channelsPremiumOnly === 1;
    const value = channelsPremiumOnly ? 'true' : 'false';

    await query(
      `INSERT INTO app_settings (key, value)
       VALUES ('channels_premium_only', $1)
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [value],
    );

    return res.json({ channelsPremiumOnly: !!channelsPremiumOnly });
  } catch (err) {
    console.error('[Admin] channels-premium-only update error:', err?.message || err);
    return next(err);
  }
});

// Admin: get active payment provider selection
router.get('/settings/payment-provider', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store, max-age=0');
    // Ensure table exists
    await query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `).catch(() => {});
    
    const result = await query(
      "SELECT value FROM app_settings WHERE key = 'payment_provider' LIMIT 1",
    );
    const raw = result.rows.length > 0 ? result.rows[0].value : 'zeno';
    const compact = String(raw).toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    const paymentProvider = compact === 'sonicpesa' ? 'sonicpesa' : 'zeno';
    const configured =
      paymentProvider === 'sonicpesa'
        ? Boolean(process.env.SONICPESA_API_KEY)
        : Boolean(
            process.env.ZENO_API_KEY || process.env.ZENOPAY_API_KEY || process.env.ZENOURI_API_KEY,
          );
    console.log('[Admin] Current payment provider (normalized):', paymentProvider, 'raw:', raw);
    return res.json({ paymentProvider, configured });
  } catch (err) {
    console.error('[Admin] get payment-provider error:', err?.message);
    return next(err);
  }
});

router.put('/settings/payment-provider', async (req, res, next) => {
  try {
    console.log('[Admin] Payment provider update request:', req.body);
    
    // Ensure table exists
    await query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `).catch(() => {});
    
    const bodySchema = z.object({
      paymentProvider: z.enum(['zeno', 'sonicpesa']),
    });
    const { paymentProvider } = bodySchema.parse(req.body);
    console.log('[Admin] Validated payment provider:', paymentProvider);

    if (paymentProvider === 'sonicpesa') {
      if (!process.env.SONICPESA_API_KEY) {
        return res.status(400).json({
          error:
            'SonicPesa haijasanidi: weka SONICPESA_API_KEY kwenye seva kabla ya kuwezesha mtoa huduma huyu.',
          paymentProvider,
          configured: false,
        });
      }
    } else if (
      !process.env.ZENO_API_KEY &&
      !process.env.ZENOPAY_API_KEY &&
      !process.env.ZENOURI_API_KEY
    ) {
      return res.status(400).json({
        error:
          'ZenoPay haijasanidi: weka ZENO_API_KEY (au ZENOPAY_API_KEY) kwenye seva kabla ya kuwezesha mtoa huduma huyu.',
        paymentProvider,
        configured: false,
      });
    }

    const result = await query(
      `INSERT INTO app_settings (key, value)
       VALUES ('payment_provider', $1)
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING key, value`,
      [paymentProvider],
    );
    
    console.log('[Admin] Database update result:', result.rows);
    
    if (!result.rows || result.rows.length === 0) {
      throw new Error('Failed to update payment provider in database');
    }

    console.log('[Admin] Payment provider updated successfully to:', paymentProvider);
    return res.json({ paymentProvider, configured: true });
  } catch (err) {
    console.error('[Admin] payment-provider update error:', err?.message || err);
    console.error('[Admin] Error stack:', err?.stack);
    return next(err);
  }
});

module.exports = router;

