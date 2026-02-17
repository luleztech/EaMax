const express = require('express');
const { z } = require('zod');
const { query } = require('../db');

const router = express.Router();

const ZENO_API_KEY = process.env.ZENO_API_KEY;
const ZENO_API_BASE = 'https://zenoapi.com/api';

const ensureZenoConfigured = () => {
  if (!ZENO_API_KEY) {
    throw new Error('ZENOPAY API key (ZENOURI_API_KEY) is not configured on the server');
  }
};

// Map bundle to amount and duration
const PLAN_CONFIG = {
  week: { amount: 3000, interval: '7 days' },
  month: { amount: 8000, interval: '30 days' },
  year: { amount: 15000, interval: '365 days' },
};

// Start a ZenoPay Mobile Money payment
router.post('/zeno/start', async (req, res, next) => {
  try {
    ensureZenoConfigured();

    const bodySchema = z.object({
      externalId: z.string().min(1),
      bundle: z.enum(['week', 'month', 'year']),
      phone: z
        .string()
        .regex(/^0[0-9]{8,9}$/, 'Invalid Tanzanian phone number, use format 07XXXXXXXX'),
      email: z.string().email().optional(),
      name: z.string().optional(),
    });

    const data = bodySchema.parse(req.body);

    // Find user by externalId
    const userRes = await query('SELECT id FROM users WHERE external_id = $1', [
      data.externalId,
    ]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = userRes.rows[0].id;

    const planInfo = PLAN_CONFIG[data.bundle];
    if (!planInfo) {
      return res.status(400).json({ error: 'Invalid bundle plan' });
    }

    const orderId = `${userId}-${Date.now()}`;

    const webhookUrl =
      process.env.ZENO_WEBHOOK_URL ||
      `${process.env.PUBLIC_BASE_URL || 'https://eamax-production.up.railway.app'}/api/payments/zeno/webhook`;

    const payload = {
      order_id: orderId,
      buyer_email: data.email || 'user@eamax.app',
      buyer_name: data.name || data.externalId,
      buyer_phone: data.phone,
      amount: planInfo.amount,
      webhook_url: webhookUrl,
    };

    const response = await fetch(
      `${ZENO_API_BASE}/payments/mobile_money_tanzania`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ZENO_API_KEY,
        },
        body: JSON.stringify(payload),
      },
    );

    const zenoData = await response.json();

    if (!response.ok || zenoData.status !== 'success') {
      return res.status(400).json({
        error: zenoData.message || 'Failed to start payment request',
        raw: zenoData,
      });
    }

    // Record payment as pending, store orderId in provider_ref for lookup
    await query(
      `INSERT INTO subscription_payments (user_id, plan, amount_cents, currency, status, provider_ref)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, data.bundle, planInfo.amount, 'TZS', 'pending', orderId],
    );

    return res.json({
      status: 'success',
      orderId,
      message:
        zenoData.message ||
        'Request in progress. You will receive a prompt on your phone.',
    });
  } catch (err) {
    return next(err);
  }
});

// Internal helper: apply completed payment to user
const applyCompletedPayment = async (orderId, meta) => {
  const payRes = await query(
    'SELECT * FROM subscription_payments WHERE provider_ref = $1 LIMIT 1',
    [orderId],
  );
  if (payRes.rows.length === 0) {
    return null;
  }
  const payment = payRes.rows[0];

  if (payment.status === 'completed') {
    return payment;
  }

  const planInfo = PLAN_CONFIG[payment.plan];
  if (!planInfo) {
    return payment;
  }

  // Mark payment as completed and update user premium
  await query('BEGIN');
  try {
    await query(
      `UPDATE subscription_payments
         SET status = 'completed',
             provider_ref = $1
       WHERE id = $2`,
      [meta.transid || meta.reference || orderId, payment.id],
    );

    await query(
      `UPDATE users
          SET is_premium = TRUE,
              premium_expires_at = GREATEST(
                COALESCE(premium_expires_at, now()),
                now()
              ) + $2::interval
        WHERE id = $1`,
      [payment.user_id, planInfo.interval],
    );

    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }

  return payment;
};

// Check payment status (polling from app)
router.get('/zeno/status', async (req, res, next) => {
  try {
    ensureZenoConfigured();

    const paramsSchema = z.object({
      orderId: z.string().min(1),
    });
    const { orderId } = paramsSchema.parse(req.query);

    const statusResp = await fetch(
      `${ZENO_API_BASE}/payments/order-status?order_id=${encodeURIComponent(
        orderId,
      )}`,
      {
        method: 'GET',
        headers: {
          'x-api-key': ZENO_API_KEY,
        },
      },
    );

    const statusData = await statusResp.json();

    if (!statusResp.ok) {
      return res
        .status(400)
        .json({ error: statusData.message || 'Failed to fetch order status' });
    }

    const paymentStatus =
      statusData.data &&
      Array.isArray(statusData.data) &&
      statusData.data[0]?.payment_status;

    if (paymentStatus === 'COMPLETED') {
      await applyCompletedPayment(orderId, statusData.data[0]);
    }

    return res.json({
      status: statusData.result || paymentStatus || 'UNKNOWN',
      raw: statusData,
    });
  } catch (err) {
    return next(err);
  }
});

// Webhook endpoint for ZenoPay
router.post('/zeno/webhook', async (req, res, next) => {
  try {
    ensureZenoConfigured();

    const incomingKey = req.headers['x-api-key'];
    if (!incomingKey || incomingKey !== ZENO_API_KEY) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const bodySchema = z.object({
      order_id: z.string(),
      payment_status: z.string(),
      reference: z.string().optional(),
      transid: z.string().optional(),
      metadata: z.any().optional(),
    });

    const payload = bodySchema.parse(req.body);

    if (payload.payment_status === 'COMPLETED') {
      await applyCompletedPayment(payload.order_id, payload);
    }

    return res.json({ received: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

