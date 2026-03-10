require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { query } = require('./db');
const usersRouter = require('./routes/users');
const channelsRouter = require('./routes/channels');
const adminRouter = require('./routes/admin');
const notificationsRouter = require('./routes/notifications');
const settingsRouter = require('./routes/settings');
const carouselRouter = require('./routes/carousel');
const paymentsRouter = require('./routes/payments');
const matchesRouter = require('./routes/matches');
const dashboardRouter = require('./routes/dashboard');

const app = express();

app.use(
  cors({
    origin: '*', // you can restrict this to your app bundle IDs / domains later
  }),
);
app.use(express.json());
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

