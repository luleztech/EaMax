const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway usually provides SSL; keep it optional so it works locally too
  ssl:
    process.env.PGSSLMODE === 'require'
      ? { rejectUnauthorized: false }
      : undefined,
  max: Number(process.env.PG_POOL_MAX || 12),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  allowExitOnIdle: true,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableDbError = (error) => {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    ['57p01', '57p03', '53300', '53400', '08000', '08003', '08006', '08001'].includes(code) ||
    message.includes('too many connections') ||
    message.includes('connection terminated') ||
    message.includes('server closed the connection unexpectedly') ||
    message.includes('terminating connection due to administrator command') ||
    message.includes('connection refused') ||
    message.includes('connection reset by peer')
  );
};

pool.on('error', (err) => {
  // Log unexpected client errors and keep the process alive.
  // This allows the PostgreSQL pool to recover rather than bringing down the service.
  // eslint-disable-next-line no-console
  console.error('Unexpected PG client error', err);
});

async function query(text, params, attempts = 2) {
  const start = Date.now();
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await pool.query(text, params);
      const duration = Date.now() - start;
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('DB query', { text, duration, rows: res.rowCount, attempt });
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !isRetryableDbError(err)) {
        throw err;
      }
      await sleep(150 * Math.pow(2, attempt - 1));
    }
  }

  throw lastError;
}

module.exports = {
  pool,
  query,
};

