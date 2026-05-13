require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');

const { query } = require('./db');
const usersRouter = require('./routes/users');
const channelsRouter = require('./routes/channels');

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
const dashboardRouter = require('./routes/dashboard');
const { initializeRealtimeServer } = require('./services/realtimeServer');

const app = express();

app.use(
  cors({
    origin: '*', // you can restrict this to your app bundle IDs / domains later
  }),
);
app.use(express.json({ verify: getRawBody }));
app.use(morgan('dev'));

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
app.use('/api/notifications', notificationsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/carousel', carouselRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/matches', matchesRouter);

// Admin API (for EaAdmin)
app.use('/api/admin', adminRouter);
app.use('/api/dashboard', dashboardRouter);

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

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`EaMax backend listening on ${HOST}:${PORT}`);
});

// Create HTTP server and initialize WebSocket for real-time updates
const server = http.createServer(app);
const { broadcastToUser, notifyPremiumUpdate, notifyPaymentReceived } = initializeRealtimeServer(server);

// Listen on HTTPS/HTTP with WebSocket support
const REALTIME_PORT = process.env.REALTIME_PORT || 3001;
server.listen(REALTIME_PORT, HOST, () => {
  console.log(`EaMax real-time server listening on ${HOST}:${REALTIME_PORT}`);
});

// Export realtime functions for use in route handlers
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

