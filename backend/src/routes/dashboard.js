const express = require('express');
const { query } = require('../db');

const router = express.Router();

// Get dashboard statistics with real-time data
router.get('/stats', async (req, res, next) => {
  try {
    // Get total users
    const totalUsersResult = await query(
      `SELECT COUNT(*) as total FROM users WHERE blocked = FALSE`
    );
    const totalUsers = parseInt(totalUsersResult.rows[0].total) || 0;

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
      : todayInstalls > 0 ? '+100' : '0';

    // Get premium users (active subscriptions)
    const premiumUsersResult = await query(
      `SELECT COUNT(*) as premium
       FROM users
       WHERE is_premium = TRUE
       AND blocked = FALSE
       AND (premium_expires_at IS NULL OR premium_expires_at > NOW())`
    );
    const premiumUsers = parseInt(premiumUsersResult.rows[0].premium) || 0;

    // Get free users
    const freeUsers = totalUsers - premiumUsers;

    // Get expired subscriptions
    const expiredResult = await query(
      `SELECT COUNT(*) as expired
       FROM users
       WHERE is_premium = TRUE
       AND premium_expires_at IS NOT NULL
       AND premium_expires_at <= NOW()
       AND blocked = FALSE`
    );
    const expiredSubscriptions = parseInt(expiredResult.rows[0].expired) || 0;

    // Calculate premium percentage
    const premiumPercentage = totalUsers > 0
      ? ((premiumUsers / totalUsers) * 100).toFixed(1)
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
      : premiumUsers > 0 ? '+100' : '0';

    // Get this month's revenue (amount_cents / 100 = TSh)
    const revenueResult = await query(
      `SELECT COALESCE(SUM(amount_cents), 0) / 100.0 as revenue
       FROM subscription_payments
       WHERE payment_status = 'completed'
       AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)`
    );
    const revenue = parseFloat(revenueResult.rows[0].revenue) || 0;

    // Get last month's revenue for comparison
    const lastMonthRevenueResult = await query(
      `SELECT COALESCE(SUM(amount_cents), 0) / 100.0 as revenue
       FROM subscription_payments
       WHERE payment_status = 'completed'
       AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')`
    );
    const lastMonthRevenue = parseFloat(lastMonthRevenueResult.rows[0].revenue) || 0;

    // Calculate revenue change
    const revenueChange = lastMonthRevenue > 0
      ? (((revenue - lastMonthRevenue) / lastMonthRevenue) * 100).toFixed(1)
      : revenue > 0 ? '+100' : '0';

    // Get ads watched this month
    const adsWatchedResult = await query(
      `SELECT COUNT(*) as ads
       FROM ad_events
       WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)`
    );
    const adsWatched = parseInt(adsWatchedResult.rows[0].ads) || 0;

    // Get last month's ads for comparison
    const lastMonthAdsResult = await query(
      `SELECT COUNT(*) as ads
       FROM ad_events
       WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')`
    );
    const lastMonthAds = parseInt(lastMonthAdsResult.rows[0].ads) || 0;

    // Calculate ads change
    const adsChange = lastMonthAds > 0
      ? (((adsWatched - lastMonthAds) / lastMonthAds) * 100).toFixed(1)
      : adsWatched > 0 ? '+100' : '0';

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
    
    const notificationStats = notificationStatsResult.rows[0] || {
      total_sent: 0,
      total_devices_sent: 0,
      total_delivered: 0,
      total_clicks: 0
    };

    // Calculate delivery rate
    const deliveryRate = notificationStats.total_devices_sent > 0
      ? ((notificationStats.total_delivered / notificationStats.total_devices_sent) * 100).toFixed(1)
      : '0';

    return res.json({
      totalUsers,
      todayInstalls,
      installChange: installChange >= 0 ? `+${installChange}%` : `${installChange}%`,
      premiumUsers,
      freeUsers,
      expiredSubscriptions,
      premiumPercentage: `${premiumPercentage}%`,
      premiumChange: premiumChange >= 0 ? `+${premiumChange}%` : `${premiumChange}%`,
      revenue,
      revenueChange: revenueChange >= 0 ? `+${revenueChange}%` : `${revenueChange}%`,
      adsWatched,
      adsChange: adsChange >= 0 ? `+${adsChange}%` : `${adsChange}%`,
      notifications: {
        sent: parseInt(notificationStats.total_sent) || 0,
        devicesSent: parseInt(notificationStats.total_devices_sent) || 0,
        delivered: parseInt(notificationStats.total_delivered) || 0,
        clicks: parseInt(notificationStats.total_clicks) || 0,
        deliveryRate: `${deliveryRate}%`
      }
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return next(err);
  }
});

// Get users list with pagination and filtering
router.get('/users', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const filter = req.query.filter || 'all'; // 'all', 'free', 'premium', 'expired'
    const search = req.query.search || '';

    let whereConditions = ['blocked = FALSE'];
    const queryParams = [];
    let paramIndex = 1;

    // Add filter conditions
    if (filter === 'premium') {
      whereConditions.push(
        `(is_premium = TRUE AND (premium_expires_at IS NULL OR premium_expires_at > NOW()))`
      );
    } else if (filter === 'free') {
      whereConditions.push(
        `(is_premium = FALSE OR (is_premium = TRUE AND premium_expires_at IS NOT NULL AND premium_expires_at <= NOW()))`
      );
    } else if (filter === 'expired') {
      whereConditions.push(
        `(is_premium = TRUE AND premium_expires_at IS NOT NULL AND premium_expires_at <= NOW())`
      );
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
         id,
         external_id,
         points,
         is_premium,
         premium_expires_at,
         blocked,
         created_at,
         fcm_token_updated_at,
         uninstalled_at
       FROM users
       ${whereClause}
       ORDER BY created_at DESC
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

module.exports = router;
