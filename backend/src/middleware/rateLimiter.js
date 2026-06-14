const rateLimit = require('express-rate-limit');

const ADMIN_KEY = () => String(process.env.ADMIN_API_KEY || 'super-secret-admin-key').trim();

/** Paths served only to EaAdmin — never count against mobile rate limits. */
function isAdminApiPath(req) {
  const path = apiPath(req);
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

function apiPath(req) {
  return String(
    req.originalUrl ||
    (req.baseUrl ? `${req.baseUrl}${req.path || ''}` : req.url || ''),
  ).toLowerCase();
}

function shouldSkipRateLimit(req) {
  return isAdminApiPath(req) || hasValidAdminKey(req);
}

function isPaymentStartRoute(req) {
  const path = apiPath(req);
  const method = String(req.method || 'GET').toUpperCase();
  return method === 'POST' && (path.endsWith('/start') || path.endsWith('/zeno/start'));
}

function isPromotionAnalyticsRoute(req) {
  const path = apiPath(req);
  const method = String(req.method || 'GET').toUpperCase();
  return method === 'POST' && /\/api\/promotions\/\d+\/(view|click|close)$/.test(path);
}

function isPaymentsApiPath(req) {
  return apiPath(req).startsWith('/api/payments');
}

/** Prefer the real client IP behind Railway / reverse proxies. */
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (xff) return xff;
  return req.ip || 'unknown';
}

/** Per-device-ish key for catalog reads so one shared edge IP does not block all users. */
function catalogRateLimitKey(req) {
  const bundle = String(req.headers['x-app-bundle'] || '').trim();
  if (bundle === 'com.eamax') {
    return `catalog:${bundle}:${clientIp(req)}`;
  }
  return `catalog:${clientIp(req)}`;
}

/**
 * Read-heavy catalog routes (channels list, carousel, settings, matches).
 * Higher cap so home-screen refresh + resume does not blank the channel list.
 */
const catalogLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_CATALOG_MAX || 800),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Maombi mengi sana. Jaribu tena baadaye.' },
  skip: shouldSkipRateLimit,
  keyGenerator: catalogRateLimitKey,
});

/**
 * General API rate limiter — protects write-heavy / user routes.
 * Payment routes and promotion analytics are excluded (separate limiters below).
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Maombi mengi sana. Jaribu tena baadaye.' },
  skip: (req) => {
    if (shouldSkipRateLimit(req)) return true;
    if (isPaymentsApiPath(req) || isPromotionAnalyticsRoute(req)) return true;
    const path = apiPath(req);
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
 * Only limits POST /start (STK / offer payment creation) — NOT status polling.
 * Keyed per user externalId when present so shared IPs are not punished.
 */
const paymentStartLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PAYMENT_START_MAX || 40),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Maombi mengi ya malipo. Subiri kidogo kisha jaribu tena.' },
  keyGenerator: (req) => {
    const ext = req.body?.externalId;
    if (ext && String(ext).trim()) return `pay-start:${String(ext).trim()}`;
    return `pay-start-ip:${req.ip}`;
  },
  skip: (req) => shouldSkipRateLimit(req) || !isPaymentStartRoute(req),
});

/**
 * Auth / registration limiter — prevents device-ID farming.
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
  paymentStartLimiter,
  authLimiter,
  shouldSkipRateLimit,
};
