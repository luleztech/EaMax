const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { notifyConfigUpdated } = require('../services/realtimeServer');

const router = express.Router();

const SECTION_LABELS_KEY = 'section_labels';

const ensureAppSettingsTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
};

const defaultSectionLabels = () => ({
  football: {
    channelsTitle: 'Football Channels',
    channelsSubtitle: 'Chagua channel unayotaka kuangalia',
    viewAll: 'View all',
    upcomingMatchesTitle: 'Upcoming Matches',
    viewAllMatches: 'View All',
  },
  movies: {
    viewAll: 'View all',
    searchSectionTitle: 'Machaguo mbalimbali',
    categoryTamthilia: 'Tamthilia',
    categoryWanyama: 'Wanyama',
    categoryKatuni: 'Katuni',
    categoryHabari: 'Habari',
    categorySayansi: 'Sayansi',
    categoryMovies: 'Movies',
  },
});

// Public: get WhatsApp support number
router.get('/whatsapp', async (req, res, next) => {
  try {
    await ensureAppSettingsTable();
    const result = await query(
      "SELECT value FROM app_settings WHERE key = 'whatsapp_number' LIMIT 1",
    );
    if (result.rows.length === 0) {
      return res.json({ number: null });
    }
    return res.json({ number: result.rows[0].value });
  } catch (err) {
    return next(err);
  }
});

// Admin: update WhatsApp number (protected via ADMIN_API_KEY in admin routes)
router.put('/whatsapp', async (req, res, next) => {
  try {
    await ensureAppSettingsTable();
    const bodySchema = z.object({
      number: z.string().min(5),
    });
    const { number } = bodySchema.parse(req.body);

    const result = await query(
      `INSERT INTO app_settings (key, value)
         VALUES ('whatsapp_number', $1)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value,
                       updated_at = now()
       RETURNING key, value`,
      [number],
    );

    try {
      notifyConfigUpdated();
    } catch (_) {}

    return res.json({ number: result.rows[0].value });
  } catch (err) {
    return next(err);
  }
});

// Public: get channels premium-only mode (when true, all channels require payment; no points/ads)
router.get('/channels-premium-only', async (req, res, next) => {
  try {
    await ensureAppSettingsTable();
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

// Public: get payment provider in use (zeno or sonicpesa)
router.get('/payment-provider', async (req, res, next) => {
  try {
    await ensureAppSettingsTable();
    res.set('Cache-Control', 'private, no-store, max-age=0');
    const result = await query(
      "SELECT value FROM app_settings WHERE key = 'payment_provider' LIMIT 1",
    );
    const raw = result.rows.length > 0 ? result.rows[0].value : 'zeno';
    const compact = String(raw).toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    const paymentProvider = compact === 'sonicpesa' ? 'sonicpesa' : 'zeno';
    const zenoConfigured = Boolean(
      process.env.ZENO_API_KEY || process.env.ZENOPAY_API_KEY || process.env.ZENOURI_API_KEY,
    );
    const sonicConfigured = Boolean(process.env.SONICPESA_API_KEY);
    const configured = paymentProvider === 'sonicpesa' ? sonicConfigured : zenoConfigured;
    return res.json({
      paymentProvider,
      configured,
      zenoConfigured,
      sonicConfigured,
    });
  } catch (err) {
    return next(err);
  }
});

// Public: get section labels for app (Football/Movies section titles)
router.get('/section-labels', async (req, res, next) => {
  try {
    await ensureAppSettingsTable();
    const result = await query(
      "SELECT value FROM app_settings WHERE key = $1 LIMIT 1",
      [SECTION_LABELS_KEY],
    );
    const defaults = defaultSectionLabels();
    if (result.rows.length === 0) {
      return res.json(defaults);
    }
    let parsed;
    try {
      parsed = JSON.parse(result.rows[0].value);
    } catch (_) {
      return res.json(defaults);
    }
    const merged = {
      football: { ...defaults.football, ...(parsed.football || {}) },
      movies: { ...defaults.movies, ...(parsed.movies || {}) },
    };
    return res.json(merged);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

