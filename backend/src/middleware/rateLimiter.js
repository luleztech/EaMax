const rateLimit = require('express-rate-limit');

/**
 * General API rate limiter — protects all mobile-facing routes.
 * 120 requests / 15 minutes per IP.
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Maombi mengi sana. Jaribu tena baadaye.' },
  skip: (req) => {
    const path = String(req.originalUrl || req.url || '').toLowerCase();
    return (
      path.startsWith('/api/admin') ||
      path.startsWith('/api/dashboard') ||
      path.startsWith('/api/partner')
    );
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
});

/**
 * Auth / registration limiter — prevents device-ID farming.
 * 20 requests / 15 minutes per IP.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Maombi mengi ya usajili. Subiri kidogo.' },
});

module.exports = { generalLimiter, paymentLimiter, authLimiter };
