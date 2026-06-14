require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');

const { query } = require('./db');
const { generalLimiter, catalogLimiter, paymentStartLimiter, authLimiter } = require('./middleware/rateLimiter');
const { requireAppVersion, attachVersionInfo } = require('./middleware/appVersion');
const appConfigRouter = require('./routes/appConfig');
const usersRouter = require('./routes/users');
const channelsRouter = require('./routes/channels');
const refreshStreamRouter = require('./routes/refreshStream');

const getRawBody = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
};
const adminRouter = require('./routes/admin');
const notificationsRouter = require('./routes/notifications');
const settingsRouter = require('./routes/settings');
const carouselRouter = require('./routes/carousel');
const paymentsRouter = require('./routes/payments');
const matchesRouter = require('./routes/matches');
const promotionsRouter = require('./routes/promotions');
const dashboardRouter = require('./routes/dashboard');
const partnerRouter = require('./routes/partner');
const { initializeRealtimeServer } = require('./services/realtimeServer');

const app = express();

// Railway / reverse proxies: use X-Forwarded-For so rate limits are per client, not one shared IP.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

// ── Security headers (helmet) ──────────────────────────────────────────────
// Sets X-Content-Type-Options, X-Frame-Options, HSTS, etc.
// contentSecurityPolicy is disabled because this is a JSON API, not a website.
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS ──────────────────────────────────────────────────────────────────
// Mobile clients do not send an Origin header so broad CORS is acceptable
// here.  The real protection is the X-App-Version / rate-limit / auth layer.
app.use(cors({ origin: '*' }));

// ── Body parsing ──────────────────────────────────────────────────────────
app.use(express.json({ verify: getRawBody }));
app.use(morgan('dev'));

// ── Attach parsed version info to every request ───────────────────────────
app.use(attachVersionInfo);

// ── Public config endpoint (no rate-limit, no version check) ─────────────
// Must be mounted before the general limiter and version middleware so that
// even an outdated client can discover it needs to update.
app.use('/app-config', appConfigRouter);

// ── Rate limiting (mobile API; admin/dashboard/partner + X-Admin-Key skipped) ─
app.use('/api/channels', catalogLimiter);
app.use('/api/carousel', catalogLimiter);
app.use('/api/settings', catalogLimiter);
app.use('/api/matches', catalogLimiter);
app.use('/api/promotions', catalogLimiter);
app.use('/api/', generalLimiter);
app.use('/api/payments', paymentStartLimiter);
app.use('/api/users/register', authLimiter);

// ── Version enforcement (opt-in via REQUIRE_APP_VERSION=true) ─────────────
// Skips admin / dashboard / partner routes automatically (no X-App-Version
// header on those requests).
app.use('/api/', requireAppVersion);

// Ensure drm_clear_key column exists on channels (run once on startup)
query(
  `ALTER TABLE channels ADD COLUMN IF NOT EXISTS drm_clear_key TEXT`
).catch((err) => {
  if (err.message && !err.message.includes('does not exist')) {
    // eslint-disable-next-line no-console
    console.warn('Migration drm_clear_key (non-fatal):', err.message);
  }
});

// Ensure drm_type column exists: NONE | CLEARKEY | WIDEVINE | PLAYREADY
query(
  `ALTER TABLE channels ADD COLUMN IF NOT EXISTS drm_type VARCHAR(32) DEFAULT 'NONE'`
).catch((err) => {
  if (err.message && !err.message.includes('does not exist')) {
    // eslint-disable-next-line no-console
    console.warn('Migration drm_type (non-fatal):', err.message);
  }
});
query(
  `UPDATE channels SET drm_type = 'CLEARKEY' WHERE drm_protected = true AND (drm_type IS NULL OR drm_type = 'NONE')`
).catch(() => {});
query(
  `ALTER TABLE channels ADD COLUMN IF NOT EXISTS license_url TEXT`
).catch((err) => {
  if (err.message && !err.message.includes('does not exist')) {
    // eslint-disable-next-line no-console
    console.warn('Migration license_url (non-fatal):', err.message);
  }
});

// Mobile money number used for each payment (admin user list)
query(
  `ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS buyer_phone VARCHAR(20)`
).catch((err) => {
  if (err.message && !err.message.includes('does not exist')) {
    console.warn('Migration buyer_phone (non-fatal):', err.message);
  }
});

// Track which payment provider was used for each order
query(
  `ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(32) NOT NULL DEFAULT 'zeno'`
).catch((err) => {
  if (err.message && !err.message.includes('does not exist')) {
    console.warn('Migration payment_provider (non-fatal):', err.message);
  }
});

// Throttle auto Push reminders for expired subscriptions (7-day repeat)
query(
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expiry_reminder_sent_at TIMESTAMPTZ`
).catch((err) => {
  if (err.message && !err.message.includes('does not exist')) {
    console.warn('Migration subscription_expiry_reminder_sent_at (non-fatal):', err.message);
  }
});

// Payments: completed_at timestamp for accurate revenue stats
query(
  `ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`
).catch((err) => {
  if (err.message && !err.message.includes('does not exist')) {
    // eslint-disable-next-line no-console
    console.warn('Migration completed_at (non-fatal):', err.message);
  }
});
// Backfill completed_at for existing completed payments (best-effort)
query(
  `UPDATE subscription_payments
     SET completed_at = COALESCE(completed_at, created_at)
   WHERE status = 'completed' AND completed_at IS NULL`
).catch(() => {});

// Alias support:
// - channels.stream_alias: optional alias key instead of stream_url
// - stream_aliases table stores alias -> real stream url
query(
  `ALTER TABLE channels ADD COLUMN IF NOT EXISTS stream_alias TEXT`
).catch((err) => {
  if (err.message && !err.message.includes('does not exist')) {
    // eslint-disable-next-line no-console
    console.warn('Migration stream_alias (non-fatal):', err.message);
  }
});
query(
  `ALTER TABLE channels ALTER COLUMN stream_url DROP NOT NULL`
).catch(() => {});
query(
  `ALTER TABLE channels ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0`
).catch((err) => {
  if (err.message && !err.message.includes('does not exist')) {
    console.warn('Migration channels.sort_order (non-fatal):', err.message);
  }
});
// Do not reset sort_order = 0 — that is a valid position after admin drag-and-drop reorder.
query(
  `UPDATE channels SET sort_order = id WHERE sort_order IS NULL`
).catch(() => {});
query(
  `CREATE TABLE IF NOT EXISTS stream_aliases (
     alias TEXT PRIMARY KEY,
     stream_url TEXT NOT NULL,
     channel_id INTEGER REFERENCES channels(id),
     is_active BOOLEAN NOT NULL DEFAULT TRUE,
     created_at TIMESTAMP DEFAULT NOW(),
     updated_at TIMESTAMP DEFAULT NOW()
   )`
).catch((err) => {
  if (err.message && !err.message.includes('does not exist')) {
    // eslint-disable-next-line no-console
    console.warn('Migration stream_aliases (non-fatal):', err.message);
  }
});
query(
  `ALTER TABLE stream_aliases ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`
).catch(() => {});
query(
  `ALTER TABLE stream_aliases ADD COLUMN IF NOT EXISTS channel_id INTEGER REFERENCES channels(id)`
).catch(() => {});
query(
  `ALTER TABLE stream_aliases ALTER COLUMN stream_url DROP NOT NULL`
).catch(() => {});

// Notification push job status (async broadcast from admin panel)
query(
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS push_status VARCHAR(16) DEFAULT 'completed'`
).catch(() => {});
query(
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS push_error TEXT`
).catch(() => {});

query(
  `CREATE TABLE IF NOT EXISTS promotions (
     id SERIAL PRIMARY KEY,
     title TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     image_url TEXT,
     button_text TEXT NOT NULL DEFAULT 'Learn More',
     button_url TEXT,
     type VARCHAR(24) NOT NULL DEFAULT 'text',
     priority INTEGER NOT NULL DEFAULT 3,
     is_active BOOLEAN NOT NULL DEFAULT TRUE,
     show_mode VARCHAR(16) NOT NULL DEFAULT 'daily',
     start_at TIMESTAMPTZ,
     end_at TIMESTAMPTZ,
     target_audience VARCHAR(24) NOT NULL DEFAULT 'all',
     target_max_version VARCHAR(16),
     target_min_version VARCHAR(16),
     background_style VARCHAR(24) NOT NULL DEFAULT 'dark_glass',
     force_update BOOLEAN NOT NULL DEFAULT FALSE,
     min_required_version VARCHAR(16),
     views_count INTEGER NOT NULL DEFAULT 0,
     clicks_count INTEGER NOT NULL DEFAULT 0,
     close_count INTEGER NOT NULL DEFAULT 0,
     last_viewed_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`
).catch(() => {});
query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS offer_amount_tsh INTEGER`).catch(() => {});
query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS offer_period_days INTEGER`).catch(() => {});
query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS offer_countdown_minutes INTEGER`).catch(() => {});
query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS offer_ends_at TIMESTAMPTZ`).catch(() => {});
query(
  `CREATE TABLE IF NOT EXISTS promotion_events (
     id SERIAL PRIMARY KEY,
     promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     external_id VARCHAR(64),
     event_type VARCHAR(16) NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`
).catch(() => {});

// notification_deliveries: allow NULL fcm_token (topic / client-reported delivery)
query(
  `ALTER TABLE notification_deliveries
     ALTER COLUMN fcm_token DROP NOT NULL`
).catch((err) => {
  if (err?.code !== '42P01' && !String(err?.message || '').includes('does not exist')) {
    console.warn('Migration notification_deliveries fcm_token (non-fatal):', err.message);
  }
});

// Notification click tracking (unique by user + notification for real click analytics)
query(
  `CREATE TABLE IF NOT EXISTS notification_clicks (
     id SERIAL PRIMARY KEY,
     notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (notification_id, user_id)
   )`
).catch((err) => {
  if (err.message && !err.message.includes('does not exist')) {
    console.warn('Migration notification_clicks (non-fatal):', err.message);
  }
});

// Simple health check (no DB required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'EaMax backend is running' });
});

// Database health check
app.get('/health/db', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Database health check failed', err);
    res.status(500).json({ status: 'error', database: 'disconnected', error: err.message });
  }
});

// Public API for mobile apps
app.use('/api/users', usersRouter);
app.use('/api/channels', channelsRouter);
app.use('/api/refreshStream', refreshStreamRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/carousel', carouselRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/promotions', promotionsRouter);

// Admin API (for EaAdmin)
app.use('/api/admin', adminRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/partner', partnerRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (Zod and others)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  if (err.name === 'ZodError') {
    const message = err.errors?.map((e) => `${e.path?.join('.') || 'field'}: ${e.message}`).join('; ') || err.message;
    return res.status(400).json({ error: 'Validation failed', details: message });
  }
  const message = err.message || 'Internal server error';
  const details = process.env.NODE_ENV === 'development' ? (err.stack || undefined) : undefined;
  return res.status(500).json({ error: message, details });
});

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';

// One HTTP server: Express + WebSocket (Railway exposes a single PORT)
const server = http.createServer(app);
const { broadcastToUser, notifyPremiumUpdate, notifyPaymentReceived } = initializeRealtimeServer(server);

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`EaMax backend listening on ${HOST}:${PORT} (HTTP + WebSocket)`);
});

global.realtimeServer = {
  broadcastToUser,
  notifyPremiumUpdate,
  notifyPaymentReceived,
};

// Daily FCM reminders for expired subscriptions (7-day throttle per user unless manual force)
const DAY_MS = 24 * 60 * 60 * 1000;
let expiryReminderTimer = null;
try {
  const { sendExpiredSubscriptionReminders } = require('./services/expiredSubscriptionReminders');
  expiryReminderTimer = setInterval(() => {
    sendExpiredSubscriptionReminders({ force: false }).catch((err) => {
      console.error('[ExpiredReminder] scheduled run failed:', err.message || err);
    });
  }, DAY_MS);
  // First run 2 minutes after boot (avoid cold-start contention)
  setTimeout(() => {
    sendExpiredSubscriptionReminders({ force: false }).catch((err) => {
      console.error('[ExpiredReminder] initial run failed:', err.message || err);
    });
  }, 120000);
} catch (e) {
  console.warn('[ExpiredReminder] scheduler not started:', e.message || e);
}

