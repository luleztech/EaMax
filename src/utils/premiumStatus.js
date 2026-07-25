/**
 * Premium is active until subscriptionEndDate passes.
 * When an expiry date is present it is authoritative over the isPremium flag.
 * Allow a small clock-skew window so just-granted expiry is not treated as expired.
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

  const now = Date.now();
  const skewMs = 15 * 60 * 1000;

  if (subEnd) {
    if (subEnd.getTime() > now - skewMs) {
      return { premium: true, subEnd };
    }
    const apiPremium = !!(userData.isPremium || userData.is_premium);
    return {
      premium: apiPremium && subEnd.getTime() > now - 60 * 60 * 1000,
      subEnd,
    };
  }

  const apiPremium = !!(userData.isPremium || userData.is_premium);
  return { premium: apiPremium, subEnd: null };
};

export const resolvePremiumFromRealtimePayload = (data = {}) => {
  return resolvePremiumFromUserData(data);
};
