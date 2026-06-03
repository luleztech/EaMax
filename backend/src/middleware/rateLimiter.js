const rateLimit = require('express-rate-limit');

const ADMIN_KEY = () => String(process.env.ADMIN_API_KEY || 'super-secret-admin-key').trim();

/** Paths served only to EaAdmin — never count against mobile rate limits. */
function isAdminApiPath(req) {
  const path = String(
    req.originalUrl ||
    (req.baseUrl ? `${req.baseUrl}${req.path || ''}` : req.url || ''),
  ).toLowerCase();
  return (
    path.startsWith('/api/admin') ||
    path.startsWith('/api/dashboard') ||
    path.startsWith('/api/partner')
  );
}

/** EaAdmin may call a few public settings routes with X-Admin-Key — skip those too. */
function hasValidAdminKey(req) {
  const provided = String(req.headers['x-admin-key'] || '').trim();
  return provided.length > 0 && provided === ADMIN_KEY();
}

function shouldSkipRateLimit(req) {
  return isAdminApiPath(req) || hasValidAdminKey(req);
}

/**
 * Read-heavy catalog routes (channels list, carousel, settings, matches).
 * Higher cap so home-screen refresh + resume does not blank the channel list.
 */
const catalogLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_CATALOG_MAX || 400),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Maombi mengi sana. Jaribu tena baadaye.' },
  skip: shouldSkipRateLimit,
});

/**
 * General API rate limiter — protects write-heavy / user routes.
 * Default 300 requests / 15 minutes per client IP (trust proxy required on Railway).
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Maombi mengi sana. Jaribu tena baadaye.' },
  skip: (req) => {
    if (shouldSkipRateLimit(req)) return true;
    const path = String(
      req.originalUrl ||
      (req.baseUrl ? `${req.baseUrl}${req.path || ''}` : req.url || ''),
    ).toLowerCase();
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET' && (
      path.startsWith('/api/channels') ||
      path.startsWith('/api/carousel') ||
      path.startsWith('/api/settings') ||
      path.startsWith('/api/matches') ||
      path.startsWith('/api/promotions')
    )) {
      return true;
    }
    return false;
  },
});

/**
 * Strict limiter for payment endpoints — prevents brute-force order creation.
 * 15 requests / 60 minutes per IP.
 */
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Maombi mengi ya malipo. Subiri kidogo.' },
  skip: shouldSkipRateLimit,
});

/**
 * Auth / registration limiter — prevents device-ID farming.
 * 20 requests / 15 minutes per IP.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_REGISTER_MAX || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Maombi mengi ya usajili. Subiri kidogo.' },
  skip: shouldSkipRateLimit,
});

module.exports = {
  generalLimiter,
  catalogLimiter,
  paymentLimiter,
  authLimiter,
  shouldSkipRateLimit,
};
