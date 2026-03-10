#!/usr/bin/env node

/**
 * Run the notification delivery tracking migration
 * Usage: node backend/scripts/run-notification-migration.js
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('Starting notification delivery tracking migration...');
    
    const migrationPath = path.join(__dirname, '../sql/migrations/002_add_notification_delivery_tracking.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    await client.query(sql);
    
    console.log('✅ Migration completed successfully!');
    console.log('Added columns: sent_count, delivered_count to notifications table');
    console.log('Created table: notification_deliveries');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
