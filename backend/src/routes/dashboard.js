const express = require('express');
const { query } = require('../db');

const router = express.Router();

/** DB column is named amount_cents but stores whole TZS (2000, 5000, 12000) from PLAN_CONFIG. */
const paymentAmountTsh = (amountCents) => Math.round(Number(amountCents) || 0);

// Get dashboard statistics with real-time data
router.get('/stats', async (req, res, next) => {
  try {
    // Total registered / installed users (all accounts in DB)
    const totalRegisteredResult = await query(
      `SELECT COUNT(*)::int AS total FROM users`
    );
    const totalUsers = parseInt(totalRegisteredResult.rows[0].total, 10) || 0;

    const activeUsersResult = await query(
      `SELECT COUNT(*)::int AS total FROM users WHERE blocked = FALSE`
    );
    const activeUsers = parseInt(activeUsersResult.rows[0].total, 10) || 0;

    // Get today's new installs (users created today)
    const todayInstallsResult = await query(
      `SELECT COUNT(*) as today
       FROM users
       WHERE DATE(created_at) = CURRENT_DATE
       AND blocked = FALSE`
    );
    const todayInstalls = parseInt(todayInstallsResult.rows[0].today) || 0;

    // Get yesterday's installs for comparison
    const yesterdayInstallsResult = await query(
      `SELECT COUNT(*) as yesterday
       FROM users
       WHERE DATE(created_at) = CURRENT_DATE - INTERVAL '1 day'
       AND blocked = FALSE`
    );
    const yesterdayInstalls = parseInt(yesterdayInstallsResult.rows[0].yesterday) || 0;

    // Calculate daily install change percentage
    const installChange = yesterdayInstalls > 0
      ? (((todayInstalls - yesterdayInstalls) / yesterdayInstalls) * 100).toFixed(1)
      : todayInstalls > 0 ? '100' : '0';

    // Get premium users (active subscriptions)
    const premiumUsersResult = await query(
      `SELECT COUNT(*) as premium
       FROM users
       WHERE is_premium = TRUE
       AND blocked = FALSE
       AND (premium_expires_at IS NULL OR premium_expires_at > NOW())`
    );
    const premiumUsers = parseInt(premiumUsersResult.rows[0].premium) || 0;

    // Expired subscriptions (mutually exclusive with active premium)
    const expiredResult = await query(
      `SELECT COUNT(*)::int AS expired
       FROM users
       WHERE blocked = FALSE
       AND premium_expires_at IS NOT NULL
       AND premium_expires_at <= NOW()`
    );
    const expiredSubscriptions = parseInt(expiredResult.rows[0].expired, 10) || 0;

    // Free users: not blocked, not active premium, not expired
    const freeUsersResult = await query(
      `SELECT COUNT(*)::int AS free
       FROM users
       WHERE blocked = FALSE
       AND NOT (
         is_premium = TRUE
         AND (premium_expires_at IS NULL OR premium_expires_at > NOW())
       )
       AND NOT (
         premium_expires_at IS NOT NULL
         AND premium_expires_at <= NOW()
       )`
    );
    const freeUsers = parseInt(freeUsersResult.rows[0].free, 10) || 0;

    const blockedUsersResult = await query(
      `SELECT COUNT(*)::int AS n FROM users WHERE blocked = TRUE`
    );
    const blockedUsers = parseInt(blockedUsersResult.rows[0].n, 10) || 0;

    // Calculate premium percentage
    const premiumPercentage = activeUsers > 0
      ? ((premiumUsers / activeUsers) * 100).toFixed(1)
      : '0';

    // Get last month's premium count for comparison
    const lastMonthPremiumResult = await query(
      `SELECT COUNT(*) as last_month
       FROM users
       WHERE is_premium = TRUE
       AND blocked = FALSE
       AND created_at <= NOW() - INTERVAL '1 month'
       AND (premium_expires_at IS NULL OR premium_expires_at > NOW())`
    );
    const lastMonthPremium = parseInt(lastMonthPremiumResult.rows[0].last_month) || 0;

    // Calculate premium growth
    const premiumChange = lastMonthPremium > 0
      ? (((premiumUsers - lastMonthPremium) / lastMonthPremium) * 100).toFixed(1)
      : premiumUsers > 0 ? '100' : '0';

    // All-time revenue from completed subscription payments (TZS amounts in amount_cents)
    const totalRevenueResult = await query(
      `SELECT
         COALESCE(SUM(amount_cents), 0)::bigint AS revenue,
         COUNT(*)::int AS payment_count
       FROM subscription_payments
       WHERE status = 'completed'`
    );
    const totalRevenue = paymentAmountTsh(totalRevenueResult.rows[0].revenue);
    const completedPaymentsTotal = parseInt(totalRevenueResult.rows[0].payment_count, 10) || 0;

    // Today's collected revenue
    const revenueResult = await query(
      `SELECT
         COALESCE(SUM(amount_cents), 0)::bigint AS revenue,
         COUNT(*)::int AS payment_count
       FROM subscription_payments
       WHERE status = 'completed'
       AND DATE(COALESCE(completed_at, created_at)) = CURRENT_DATE`
    );
    const todayRevenue = paymentAmountTsh(revenueResult.rows[0].revenue);
    const completedPaymentsToday = parseInt(revenueResult.rows[0].payment_count, 10) || 0;

    // Yesterday for comparison
    const yesterdayRevenueResult = await query(
      `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS revenue
       FROM subscription_payments
       WHERE status = 'completed'
       AND DATE(COALESCE(completed_at, created_at)) = CURRENT_DATE - INTERVAL '1 day'`
    );
    const yesterdayRevenue = paymentAmountTsh(yesterdayRevenueResult.rows[0].revenue);

    const revenueChange = yesterdayRevenue > 0
      ? (((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100).toFixed(1)
      : todayRevenue > 0 ? '100' : '0';

    // Get ads watched this month
    const adsWatchedResult = await query(
      `SELECT COUNT(*) as ads
       FROM ad_events
       WHERE DATE_TRUNC('month', watched_at) = DATE_TRUNC('month', CURRENT_DATE)`
    );
    const adsWatched = parseInt(adsWatchedResult.rows[0].ads) || 0;

    // Get last month's ads for comparison
    const lastMonthAdsResult = await query(
      `SELECT COUNT(*) as ads
       FROM ad_events
       WHERE DATE_TRUNC('month', watched_at) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')`
    );
    const lastMonthAds = parseInt(lastMonthAdsResult.rows[0].ads) || 0;

    // Calculate ads change
    const adsChange = lastMonthAds > 0
      ? (((adsWatched - lastMonthAds) / lastMonthAds) * 100).toFixed(1)
      : adsWatched > 0 ? '100' : '0';

    // Get notification stats
    const notificationStatsResult = await query(
      `SELECT 
         COUNT(*) as total_sent,
         COALESCE(SUM(sent_count), 0) as total_devices_sent,
         COALESCE(SUM(delivered_count), 0) as total_delivered,
         COALESCE(SUM(clicks), 0) as total_clicks
       FROM notifications
       WHERE sent_at IS NOT NULL
       AND DATE_TRUNC('month', sent_at) = DATE_TRUNC('month', CURRENT_DATE)`
    );
    
    const rawStats = notificationStatsResult.rows[0] || {};
    const notificationStats = {
      total_sent: Number(rawStats.total_sent) || 0,
      total_devices_sent: Number(rawStats.total_devices_sent) || 0,
      total_delivered: Number(rawStats.total_delivered) || 0,
      total_clicks: Number(rawStats.total_clicks) || 0,
    };

    // Calculate delivery rate (guard NaN / null from pg bigint)
    const deliveryRate =
      notificationStats.total_devices_sent > 0
        ? (
            (notificationStats.total_delivered / notificationStats.total_devices_sent) *
            100
          ).toFixed(1)
        : '0';

    // Format change percentage properly (no double ++)
    const fmtChange = (val) => {
      const n = parseFloat(val);
      if (isNaN(n)) return '+0%';
      return n >= 0 ? `+${n.toFixed(1)}%` : `${n.toFixed(1)}%`;
    };

    return res.json({
      totalUsers,
      activeUsers,
      todayInstalls,
      installChange: fmtChange(installChange),
      premiumUsers,
      freeUsers,
      expiredSubscriptions,
      blockedUsers,
      premiumPercentage: `${premiumPercentage}%`,
      premiumChange: fmtChange(premiumChange),
      revenue: totalRevenue,
      totalRevenue,
      todayRevenue,
      completedPaymentsTotal,
      completedPaymentsToday,
      revenueChange: fmtChange(revenueChange),
      adsWatched,
      adsChange: fmtChange(adsChange),
      notifications: {
        sent: notificationStats.total_sent,
        devicesSent: notificationStats.total_devices_sent,
        delivered: notificationStats.total_delivered,
        clicks: notificationStats.total_clicks,
        deliveryRate: `${deliveryRate}%`,
      },
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return next(err);
  }
});

// Get users list with pagination and filtering
router.get('/users', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 50000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const filter = req.query.filter || 'all'; // 'all', 'free', 'premium', 'expired', 'blocked'
    const search = req.query.search || '';

    // Include blocked users so admins still see / manage them after blocking
    let whereConditions = [];
    const queryParams = [];
    let paramIndex = 1;

    // Add filter conditions
    if (filter === 'premium') {
      whereConditions.push(`(blocked IS NOT TRUE)`);
      whereConditions.push(
        `(is_premium = TRUE AND (premium_expires_at IS NULL OR premium_expires_at > NOW()))`
      );
    } else if (filter === 'free') {
      whereConditions.push(`(blocked IS NOT TRUE)`);
      whereConditions.push(
        `NOT (is_premium = TRUE AND (premium_expires_at IS NULL OR premium_expires_at > NOW()))`
      );
      whereConditions.push(
        `NOT (premium_expires_at IS NOT NULL AND premium_expires_at <= NOW())`
      );
    } else if (filter === 'expired') {
      whereConditions.push(`(blocked IS NOT TRUE)`);
      whereConditions.push(
        `(premium_expires_at IS NOT NULL AND premium_expires_at <= NOW())`
      );
    } else if (filter === 'blocked') {
      whereConditions.push('(blocked IS TRUE)');
    }

    // Add search condition
    if (search.trim()) {
      queryParams.push(`%${search.trim()}%`);
      whereConditions.push(`external_id ILIKE $${paramIndex}`);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM users ${whereClause}`,
      queryParams
    );
    const total = parseInt(countResult.rows[0].total) || 0;

    // Get users
    queryParams.push(limit);
    queryParams.push(offset);
    
    const usersResult = await query(
      `SELECT 
         u.id,
         u.external_id,
         u.points,
         u.is_premium,
         u.premium_expires_at,
         u.blocked,
         u.created_at,
         u.fcm_token_updated_at,
         u.uninstalled_at,
         COALESCE(
           (
             SELECT string_agg(sub.phone, ', ' ORDER BY sub.phone)
             FROM (
               SELECT DISTINCT trim(sp.buyer_phone) AS phone
               FROM subscription_payments sp
               WHERE sp.user_id = u.id
                 AND sp.status = 'completed'
                 AND sp.buyer_phone IS NOT NULL
                 AND trim(sp.buyer_phone) <> ''
             ) sub
           ),
           ''
         ) AS payment_phones
       FROM users u
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      queryParams
    );

    return res.json({
      users: usersResult.rows,
      total,
      limit,
      offset
    });
  } catch (err) {
    console.error('Dashboard users error:', err);
    return next(err);
  }
});

// Recent subscription payments (all statuses) for admin overview
router.get('/transactions', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 100);

    const result = await query(
      `SELECT
         sp.id,
         sp.user_id,
         u.external_id,
         sp.buyer_phone,
         sp.provider_ref,
         sp.plan,
         sp.amount_cents,
         sp.currency,
         sp.status,
         sp.payment_provider,
         sp.created_at,
         sp.completed_at
       FROM subscription_payments sp
       INNER JOIN users u ON u.id = sp.user_id
       ORDER BY COALESCE(sp.completed_at, sp.created_at) DESC
       LIMIT $1`,
      [limit],
    );

    const normalizeStatus = (raw) => {
      const s = String(raw || 'pending').toLowerCase().trim();
      if (s === 'completed' || s === 'success' || s === 'successful' || s === 'paid') {
        return 'completed';
      }
      if (s === 'failed' || s === 'fail' || s === 'error') {
        return 'failed';
      }
      if (s === 'cancelled' || s === 'canceled' || s === 'cancel') {
        return 'cancelled';
      }
      return 'pending';
    };

    const transactions = (result.rows || []).map((row) => {
      const status = normalizeStatus(row.status);
      const amountTsh = paymentAmountTsh(row.amount_cents);
      const txnId = row.provider_ref ? String(row.provider_ref).trim() : `PAY-${row.id}`;
      const userNumber =
        row.buyer_phone && String(row.buyer_phone).trim()
          ? String(row.buyer_phone).trim()
          : row.external_id || null;

      return {
        id: row.id,
        userId: row.user_id,
        userExternalId: row.external_id || null,
        userNumber,
        transactionId: txnId,
        plan: row.plan,
        amountCents: Number(row.amount_cents) || 0,
        amountTsh,
        amountFormatted: `TSh ${amountTsh.toLocaleString('en-US')}`,
        currency: row.currency || 'TZS',
        status,
        statusLabel:
          status === 'completed'
            ? 'Success'
            : status === 'failed'
              ? 'Failed'
              : status === 'cancelled'
                ? 'Cancelled'
                : 'Pending',
        paymentProvider: row.payment_provider || 'zeno',
        createdAt: row.created_at,
        completedAt: row.completed_at,
      };
    });

    const summary = {
      completed: transactions.filter((t) => t.status === 'completed').length,
      pending: transactions.filter((t) => t.status === 'pending').length,
      failed: transactions.filter((t) => t.status === 'failed').length,
      cancelled: transactions.filter((t) => t.status === 'cancelled').length,
    };

    return res.json({ transactions, summary, limit });
  } catch (err) {
    console.error('Dashboard transactions error:', err);
    return next(err);
  }
});

module.exports = router;
