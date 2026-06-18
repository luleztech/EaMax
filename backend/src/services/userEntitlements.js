const { query, pool } = require('../db');
const {
  isPremiumActive,
  buildPremiumPayload,
  shouldClearStalePremiumFlag,
  shouldRestorePremiumFlag,
} = require('./premiumStatus');

/** Insert unlock rows for every channel (active or not — matches payment completion behavior). */
const unlockAllChannelsInTransaction = async (client, userId) => {
  const result = await client.query(
    `INSERT INTO user_unlocked_channels (user_id, channel_id)
     SELECT $1, id FROM channels
     ON CONFLICT (user_id, channel_id) DO NOTHING`,
    [userId],
  );
  return result.rowCount;
};

const grantPremiumWithIntervalInTransaction = async (client, userId, planInterval) => {
  const userUpdate = await client.query(
    `UPDATE users
        SET is_premium = TRUE,
            blocked = FALSE,
            premium_expires_at = GREATEST(COALESCE(premium_expires_at, now()), now()) + $2::interval
      WHERE id = $1
      RETURNING id, external_id, is_premium, premium_expires_at, blocked`,
    [userId, planInterval],
  );
  if (userUpdate.rowCount !== 1) {
    throw new Error(`Failed to update user id=${userId} (rowCount=${userUpdate.rowCount})`);
  }
  return userUpdate.rows[0];
};

/** Admin grants / extensions — never shorten an existing later expiry. */
const grantPremiumUntilInTransaction = async (client, userId, expiresAt) => {
  const userUpdate = await client.query(
    `UPDATE users
        SET is_premium = TRUE,
            blocked = FALSE,
            premium_expires_at = GREATEST(COALESCE(premium_expires_at, now()), $2::timestamptz)
      WHERE id = $1
      RETURNING id, external_id, is_premium, premium_expires_at, blocked`,
    [userId, expiresAt],
  );
  if (userUpdate.rowCount !== 1) {
    throw new Error(`Failed to update user id=${userId} (rowCount=${userUpdate.rowCount})`);
  }
  return userUpdate.rows[0];
};

/**
 * Grant premium + unlock all channels inside an open transaction.
 * Channel unlock is best-effort so a missing/broken unlock table cannot block premium.
 */
const grantUserEntitlementsInTransaction = async (client, userId, { planInterval = null, expiresAt = null } = {}) => {
  if (!planInterval && !expiresAt) {
    throw new Error('grantUserEntitlementsInTransaction requires planInterval or expiresAt');
  }

  const row = planInterval
    ? await grantPremiumWithIntervalInTransaction(client, userId, planInterval)
    : await grantPremiumUntilInTransaction(client, userId, expiresAt);

  try {
    const channelsUnlocked = await unlockAllChannelsInTransaction(client, userId);
    console.log('[Entitlements] Premium granted:', {
      userId,
      premium_expires_at: row.premium_expires_at,
      channelsUnlocked,
    });
  } catch (unlockErr) {
    console.error('[Entitlements] Channel unlock failed (premium still granted):', unlockErr?.message || unlockErr);
  }

  return row;
};

const userMissingChannelUnlocks = async (userId) => {
  const r = await query(
    `SELECT COUNT(c.id)::int AS total_channels,
            COUNT(uuc.channel_id)::int AS unlocked_channels
       FROM channels c
       LEFT JOIN user_unlocked_channels uuc
         ON uuc.channel_id = c.id AND uuc.user_id = $1`,
    [userId],
  );
  if (!r.rows.length) return false;
  const { total_channels, unlocked_channels } = r.rows[0];
  return total_channels > 0 && unlocked_channels < total_channels;
};

/** Keep is_premium flag aligned with premium_expires_at (expiry date is authoritative). */
const syncUserPremiumFlags = async (userId) => {
  const r = await query(
    'SELECT id, is_premium, premium_expires_at, blocked FROM users WHERE id = $1 LIMIT 1',
    [userId],
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];

  if (shouldClearStalePremiumFlag(row)) {
    await query(
      'UPDATE users SET is_premium = FALSE WHERE id = $1 AND premium_expires_at <= NOW()',
      [userId],
    );
    row.is_premium = false;
  } else if (shouldRestorePremiumFlag(row)) {
    await query('UPDATE users SET is_premium = TRUE WHERE id = $1', [userId]);
    row.is_premium = true;
  }

  return row;
};

const syncUserPremiumFlagsByExternalId = async (externalId) => {
  const r = await query(
    'SELECT id, is_premium, premium_expires_at, blocked FROM users WHERE external_id = $1 LIMIT 1',
    [externalId],
  );
  if (!r.rows.length) return null;
  return syncUserPremiumFlags(r.rows[0].id);
};

const repairUserEntitlements = async (userId, planInterval) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await grantUserEntitlementsInTransaction(client, userId, { planInterval });
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Entitlements] repairUserEntitlements failed:', err?.message || err);
    return false;
  } finally {
    client.release();
  }
};

/** Repair missing premium and/or channel unlocks after a completed payment. */
const repairUserEntitlementsIfNeeded = async (userId, planInterval) => {
  const userRes = await query(
    'SELECT is_premium, premium_expires_at, blocked FROM users WHERE id = $1 LIMIT 1',
    [userId],
  );
  if (!userRes.rows.length) return false;

  const needsPremium = !isPremiumActive(userRes.rows[0]);
  let needsChannels = false;
  try {
    needsChannels = await userMissingChannelUnlocks(userId);
  } catch (err) {
    console.error('[Entitlements] Channel unlock check failed:', err?.message || err);
  }

  if (!needsPremium && !needsChannels) return false;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (needsPremium && planInterval) {
      await grantUserEntitlementsInTransaction(client, userId, { planInterval });
    } else if (needsChannels) {
      await unlockAllChannelsInTransaction(client, userId);
    }
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Entitlements] repairUserEntitlementsIfNeeded failed:', err?.message || err);
    return false;
  } finally {
    client.release();
  }
};

const fetchUserPremiumSnapshotByUserId = async (userId) => {
  await syncUserPremiumFlags(userId);
  const r = await query(
    'SELECT is_premium, premium_expires_at, blocked, external_id, created_at FROM users WHERE id = $1 LIMIT 1',
    [userId],
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return {
    ...buildPremiumPayload(row),
    externalId: row.external_id,
    created_at: row.created_at,
  };
};

const buildUserSummaryResponse = (row) => {
  const premium = buildPremiumPayload(row);
  return {
    id: row.id,
    external_id: row.external_id,
    points: row.points,
    blocked: row.blocked,
    created_at: row.created_at,
    is_premium: row.is_premium,
    premium_expires_at: row.premium_expires_at,
    ...premium,
  };
};

/** Clear is_premium for users whose subscription period has ended (expiry date is authoritative). */
const clearAllExpiredPremiumFlags = async () => {
  const result = await query(
    `UPDATE users
        SET is_premium = FALSE
      WHERE is_premium = TRUE
        AND premium_expires_at IS NOT NULL
        AND premium_expires_at <= NOW()
      RETURNING id`,
  );
  const cleared = result.rowCount != null ? result.rowCount : (result.rows?.length ?? 0);
  if (cleared > 0) {
    console.log(`[Entitlements] Cleared expired premium for ${cleared} user(s)`);
  }
  return cleared;
};

const repairCompletedPaymentsMissingPremium = async () => {
  const PLAN_INTERVALS = { week: '7 days', month: '30 days', year: '90 days' };
  const resolveInterval = (plan) => {
    const key = String(plan || '').toLowerCase();
    if (key.startsWith('offer:')) {
      const days = parseInt(key.split(':')[1], 10);
      if (Number.isFinite(days) && days > 0 && days <= 366) return `${days} days`;
      return null;
    }
    return PLAN_INTERVALS[key] || null;
  };

  const rows = await query(
    `SELECT DISTINCT ON (sp.user_id) sp.user_id, sp.plan
       FROM subscription_payments sp
       JOIN users u ON u.id = sp.user_id
      WHERE sp.status = 'completed'
        AND u.blocked IS NOT TRUE
        AND (u.premium_expires_at IS NULL OR u.premium_expires_at <= NOW())
      ORDER BY sp.user_id, sp.completed_at DESC NULLS LAST
      LIMIT 200`,
  );

  let repaired = 0;
  for (const row of rows.rows) {
    const interval = resolveInterval(row.plan);
    if (!interval) continue;
    const ok = await repairUserEntitlementsIfNeeded(Number(row.user_id), interval);
    if (ok) repaired += 1;
  }
  if (repaired > 0) {
    console.log(`[Entitlements] Boot repair: restored premium for ${repaired} user(s)`);
  }
};

module.exports = {
  unlockAllChannelsInTransaction,
  grantUserEntitlementsInTransaction,
  userMissingChannelUnlocks,
  syncUserPremiumFlags,
  syncUserPremiumFlagsByExternalId,
  repairUserEntitlements,
  repairUserEntitlementsIfNeeded,
  fetchUserPremiumSnapshotByUserId,
  buildUserSummaryResponse,
  repairCompletedPaymentsMissingPremium,
  clearAllExpiredPremiumFlags,
};
