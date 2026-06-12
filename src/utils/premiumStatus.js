/**
 * Premium is active until subscriptionEndDate passes.
 * When an expiry date is present it is authoritative over the isPremium flag.
 */
export const resolvePremiumFromUserData = (userData = {}) => {
  const blocked = userData.blocked === true;
  if (blocked) return { premium: false, subEnd: null };

  let subEnd = null;
  const endRaw =
    userData.subscriptionEndDate ||
    userData.premiumExpiresAt ||
    userData.premium_expires_at;
  if (endRaw) {
    const d = new Date(endRaw);
    if (!Number.isNaN(d.getTime())) subEnd = d;
  }

  if (subEnd) {
    return { premium: subEnd > new Date(), subEnd };
  }

  const apiPremium = !!(userData.isPremium || userData.is_premium);
  return { premium: apiPremium, subEnd: null };
};

export const resolvePremiumFromRealtimePayload = (data = {}) => {
  const blocked = data.blocked === true;
  if (blocked) return { premium: false, subEnd: null };

  let subEnd = null;
  const endRaw = data.premiumExpiresAt || data.premium_expires_at || data.subscriptionEndDate;
  if (endRaw) {
    const d = new Date(endRaw);
    if (!Number.isNaN(d.getTime())) subEnd = d;
  }

  if (subEnd) {
    return { premium: subEnd > new Date(), subEnd };
  }

  const apiPremium = !!(data.isPremium || data.is_premium);
  return { premium: apiPremium, subEnd: null };
};
