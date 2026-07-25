const fs = require('fs');
const path = require('path');
const { query } = require('../db');

const MIGRATIONS_DIR = path.join(__dirname, '../../sql/migrations');
const MIGRATION_FILES = [
  '010_enterprise_control_plane.sql',
  '011_add_channel_audio_language.sql',
  '012_player_system_v3.sql',
  '013_schedule_items.sql',
  '014_schedule_images_reminders.sql',
  '015_widen_subscription_payment_plan.sql',
  '016_ensure_user_channel_unlocks.sql',
];

let ran = false;

async function runEnterpriseMigrations() {
  if (ran) return;
  ran = true;
  for (const file of MIGRATION_FILES) {
    const migrationPath = path.join(MIGRATIONS_DIR, file);
    if (!fs.existsSync(migrationPath)) continue;
    try {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      await query(sql);
      // eslint-disable-next-line no-console
      console.log(`[Migrations] ${file} OK`);
    } catch (err) {
      console.warn(`[Migrations] ${file} (non-fatal):`, err.message || err);
    }
  }
}

module.exports = { runEnterpriseMigrations };
