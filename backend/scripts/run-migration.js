#!/usr/bin/env node
/**
 * Run migration_fcm_and_unlocked.sql on the database.
 * Usage (from repo root):
 *   DATABASE_URL='postgresql://...' node backend/scripts/run-migration.js
 * Or with Railway CLI (from repo root):
 *   npx railway run node backend/scripts/run-migration.js
 */
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Missing DATABASE_URL. Set it or run with: npx railway run node backend/scripts/run-migration.js');
  process.exit(1);
}

const sqlPath = path.join(__dirname, '../sql/migration_fcm_and_unlocked.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('railway.app') || process.env.PGSSLMODE === 'require'
    ? { rejectUnauthorized: false }
    : undefined,
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
