#!/usr/bin/env node
/**
 * Safe SonicPesa premium backfill — only users with confirmed debits.
 *
 * Usage (dry-run default — no DB writes):
 *   DATABASE_URL='postgresql://...' SONICPESA_API_KEY='...' node backend/scripts/backfill-sonicpesa-premium.js
 *
 * Apply repairs:
 *   DATABASE_URL='...' SONICPESA_API_KEY='...' node backend/scripts/backfill-sonicpesa-premium.js --apply
 *
 * Railway:
 *   npx railway run node backend/scripts/backfill-sonicpesa-premium.js --apply
 *
 * Options:
 *   --apply           Write premium + channel unlocks (default: dry-run only)
 *   --days=N          Look back N days (default 14, max 90)
 *   --limit=N         Max rows per phase (default 100, max 2000)
 *   --skip-pending    Only repair completed rows / unlocks (faster, no pending poll)
 */
const { backfillSonicPesaMissingEntitlements } = require('../src/routes/payments');
const { pool } = require('../src/db');

const parseArgInt = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const n = Number(hit.split('=')[1]);
  return Number.isFinite(n) ? n : fallback;
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Missing DATABASE_URL.');
    process.exit(1);
  }
  if (!process.env.SONICPESA_API_KEY) {
    console.error('Missing SONICPESA_API_KEY — required so pending rows are verified live before any grant.');
    process.exit(1);
  }

  const apply = process.argv.includes('--apply');
  const skipPending = process.argv.includes('--skip-pending');
  const days = parseArgInt('days', 14);
  const limit = parseArgInt('limit', 100);

  console.log(
    apply
      ? '[Backfill] APPLY mode — will grant premium only after SonicPesa confirms payment.'
      : '[Backfill] DRY-RUN — no writes. Pass --apply to execute.',
  );

  const stats = await backfillSonicPesaMissingEntitlements({
    days,
    limit,
    dryRun: !apply,
    skipPending,
  });

  console.log('\n[Backfill] Summary:', JSON.stringify(stats, null, 2));

  if (!apply) {
    console.log('\nRe-run with --apply to perform repairs.');
  }
}

main()
  .catch((err) => {
    console.error('[Backfill] Fatal:', err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {
      /* ignore */
    }
  });
