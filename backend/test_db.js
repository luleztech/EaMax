const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/eamax' });

async function run() {
  try {
    const res = await pool.query('SELECT id, name, drm_protected, drm_clear_key FROM channels ORDER BY id DESC LIMIT 5');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch(e) { console.error(e.message); }
  pool.end();
}
run();
