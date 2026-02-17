require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { query } = require('./db');
const usersRouter = require('./routes/users');
const channelsRouter = require('./routes/channels');
const adminRouter = require('./routes/admin');
const notificationsRouter = require('./routes/notifications');

const app = express();

app.use(
  cors({
    origin: '*', // you can restrict this to your app bundle IDs / domains later
  }),
);
app.use(express.json());
app.use(morgan('dev'));

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

// Admin API (for EaAdmin)
app.use('/api/admin', adminRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`EaMax backend listening on ${HOST}:${PORT}`);
});

