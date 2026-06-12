/**
 * Premium subscription state — expiry date is authoritative.
 * The is_premium flag is kept in sync for admin queries but must not revoke access
 * while premium_expires_at is still in the future.
 */

const parsePremiumExpiresAt = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const isPremiumActive = (row, now = new Date()) => {
  if (!row || row.blocked === true) return false;
  const expiresAt = parsePremiumExpiresAt(row.premium_expires_at);
  if (expiresAt) return expiresAt > now;
  return row.is_premium === true;
};

const buildPremiumPayload = (row, now = new Date()) => {
  const expiresAt = parsePremiumExpiresAt(row.premium_expires_at);
  const active = isPremiumActive(row, now);
  const iso = expiresAt ? expiresAt.toISOString() : null;
  return {
    isPremium: active,
    is_premium: active,
    premiumExpiresAt: iso,
    premium_expires_at: iso,
    subscriptionEndDate: iso,
  };
};

const shouldClearStalePremiumFlag = (row, now = new Date()) => {
  if (row.is_premium !== true) return false;
  const expiresAt = parsePremiumExpiresAt(row.premium_expires_at);
  return expiresAt != null && expiresAt <= now;
};

const shouldRestorePremiumFlag = (row, now = new Date()) => {
  if (row.is_premium === true) return false;
  const expiresAt = parsePremiumExpiresAt(row.premium_expires_at);
  return expiresAt != null && expiresAt > now;
};

module.exports = {
  parsePremiumExpiresAt,
  isPremiumActive,
  buildPremiumPayload,
  shouldClearStalePremiumFlag,
  shouldRestorePremiumFlag,
};
