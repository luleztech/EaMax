const fs = require('fs');
const path = require('path');
const { query } = require('../db');

const MIGRATION_FILE = path.join(__dirname, '../../sql/migrations/010_enterprise_control_plane.sql');

let ran = false;

async function runEnterpriseMigrations() {
  if (ran) return;
  ran = true;
  try {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
    await query(sql);
    // eslint-disable-next-line no-console
    console.log('[Migrations] Enterprise control plane schema OK');
  } catch (err) {
    console.warn('[Migrations] Enterprise control plane (non-fatal):', err.message || err);
  }
}

module.exports = { runEnterpriseMigrations };
