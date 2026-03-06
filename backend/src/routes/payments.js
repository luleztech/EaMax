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
  week: { amount: 2000, interval: '7 days' },
  month: { amount: 5000, interval: '30 days' },
  year: { amount: 12000, interval: '365 days' },
};

// Start a ZenoPay Mobile Money payment
router.post('/zeno/start', async (req, res, next) => {
  try {
    ensureZenoConfigured();

    const bodySchema = z.object({
      externalId: z.string().min(1),
      bundle: z.enum(['week', 'month', 'year']),
      amount: z.number().int().min(1).optional(), // exact amount user selected (2000, 5000, 12000)
      phone: z.string().min(9).max(15),
      email: z.string().email().optional(),
      name: z.string().optional(),
    });

    const data = bodySchema.parse(req.body);

    // Normalize phone number to ZenoPay format
    // Accept: 0712345678, 0621234567, 255712345678, +255712345678
    // Tanzanian mobile prefixes:
    // - Halotel: 062, 061
    // - Vodacom: 074, 075, 076, 079
    // - Mixx by Yas: 071, 065
    // - Airtel: 078, 068, 069
    let normalizedPhone = data.phone.replace(/\s+/g, ''); // Remove spaces
    
    // Convert international format to local format
    if (normalizedPhone.startsWith('+255')) {
      normalizedPhone = '0' + normalizedPhone.slice(4);
    } else if (normalizedPhone.startsWith('255') && normalizedPhone.length >= 12) {
      normalizedPhone = '0' + normalizedPhone.slice(3);
    }
    
    // Validate Tanzanian mobile number format
    // Must start with 0 and have valid prefix, then 7-8 more digits (total 9-10 digits after 0)
    const validPrefixes = [
      '061', '062', // Halotel
      '065', '071', // Mixx by Yas
      '068', '069', '078', // Airtel
      '074', '075', '076', '079', // Vodacom
    ];
    
    const isValidFormat = /^0[0-9]{8,9}$/.test(normalizedPhone);
    const hasValidPrefix = validPrefixes.some(prefix => normalizedPhone.startsWith(prefix));
    
    if (!isValidFormat || !hasValidPrefix) {
      return res.status(400).json({
        error: 'Invalid Tanzanian phone number. Use format: 061XXXXXXXX, 062XXXXXXXX, 065XXXXXXXX, 068XXXXXXXX, 069XXXXXXXX, 071XXXXXXXX, 074XXXXXXXX, 075XXXXXXXX, 076XXXXXXXX, 078XXXXXXXX, or 079XXXXXXXX',
      });
    }

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

    // Use the exact amount the user selected. If client sends amount, it must match the bundle (anti-tamper).
    if (data.amount != null && data.amount !== planInfo.amount) {
      return res.status(400).json({
        error: `Amount for ${data.bundle} must be ${planInfo.amount} TZS.`,
      });
    }
    const amountToSend = data.amount != null ? data.amount : planInfo.amount;

    const orderId = `${userId}_${Date.now()}`;
    console.log(`[Backend] Generated orderId: ${orderId}`);

    const webhookUrl =
      process.env.ZENO_WEBHOOK_URL ||
      `${process.env.PUBLIC_BASE_URL || 'https://eamax-production.up.railway.app'}/api/payments/zeno/webhook`;
    console.log(`[Backend] Using webhook URL: ${webhookUrl}`);

    // ZenoPay docs show local format (0744963858), but some networks may need international
    // Try local format first (as per docs), but we can switch to international if needed
    // For now, use local format (0XXXXXXXXX) as shown in ZenoPay documentation
    const phoneForZeno = normalizedPhone; // Local format: 0XXXXXXXXX

    const payload = {
      order_id: orderId,
      buyer_email: data.email || 'user@eamax.app',
      buyer_name: data.name || data.externalId,
      buyer_phone: phoneForZeno, // Local format (0XXXXXXXXX) as per ZenoPay docs
      amount: amountToSend,
      webhook_url: webhookUrl,
    };

    // eslint-disable-next-line no-console
    console.log('[ZenoPay] Sending payment request (exact amount):', {
      orderId,
      phone: phoneForZeno,
      phonePrefix: phoneForZeno.substring(0, 3),
      amount: amountToSend,
      bundle: data.bundle,
      network: phoneForZeno.startsWith('061') || phoneForZeno.startsWith('062')
        ? 'Halotel'
        : phoneForZeno.startsWith('065') || phoneForZeno.startsWith('071')
        ? 'Mixx by Yas'
        : phoneForZeno.startsWith('068') || phoneForZeno.startsWith('069') || phoneForZeno.startsWith('078')
        ? 'Airtel'
        : phoneForZeno.startsWith('074') || phoneForZeno.startsWith('075') || phoneForZeno.startsWith('076') || phoneForZeno.startsWith('079')
        ? 'Vodacom'
        : 'Unknown',
    });

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

    // eslint-disable-next-line no-console
    console.log('[ZenoPay] Response:', {
      status: response.status,
      zenoStatus: zenoData.status,
      message: zenoData.message,
      resultcode: zenoData.resultcode,
    });

    if (!response.ok || zenoData.status !== 'success') {
      const errorMsg =
        zenoData.message ||
        `ZenoPay error (code: ${zenoData.resultcode || 'unknown'})` ||
        'Failed to start payment request';
      return res.status(400).json({
        error: errorMsg,
        zenoResponse: zenoData,
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
  console.log('[Payment] Applying completed payment for order:', orderId, 'meta:', meta);
  const payRes = await query(
    'SELECT * FROM subscription_payments WHERE provider_ref = $1 LIMIT 1',
    [orderId],
  );
  if (payRes.rows.length === 0) {
    console.log('[Payment] No payment found for order:', orderId);
    return null;
  }
  const payment = payRes.rows[0];
  console.log('[Payment] Found payment:', payment);

  if (payment.status === 'completed') {
    console.log('[Payment] Payment already completed:', orderId);
    return payment;
  }

  const planInfo = PLAN_CONFIG[payment.plan];
  if (!planInfo) {
    return payment;
  }

  // Mark payment as completed and update user premium
  console.log('[Payment] Starting transaction for payment:', orderId);
  await query('BEGIN');
  try {
    console.log('[Payment] Updating payment status');
    await query(
      `UPDATE subscription_payments
         SET status = 'completed',
             provider_ref = $1
       WHERE id = $2`,
      [meta.transid || meta.reference || orderId, payment.id],
    );

    console.log('[Payment] Updating user premium status');
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

    console.log('[Payment] Unlocking channels for user:', payment.user_id);
    // Unlock all active channels for this user
    await query(
      `INSERT INTO user_unlocked_channels (user_id, channel_id)
       SELECT $1, id FROM channels WHERE is_active = TRUE
       ON CONFLICT (user_id, channel_id) DO NOTHING`,
      [payment.user_id],
    );

    await query('COMMIT');
    console.log('[Payment] Transaction committed successfully for order:', orderId);
  } catch (err) {
    console.error('[Payment] Transaction failed, rolling back:', err);
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
    console.log(`[Backend] Checking status for orderId: ${orderId}`);

    // First check if payment is already completed in our database
    const dbCheck = await query(
      'SELECT status FROM subscription_payments WHERE provider_ref = $1 LIMIT 1',
      [orderId],
    );
    
    if (dbCheck.rows.length > 0 && dbCheck.rows[0].status === 'completed') {
      console.log(`[Backend] Payment already completed in database for ${orderId}`);
      return res.json({
        status: 'COMPLETED',
        raw: { data: [{ payment_status: 'COMPLETED' }] },
      });
    }

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
    console.log(`[Backend] ZenoPay status response for ${orderId}:`, {
      status: statusResp.status,
      data: statusData
    });

    if (!statusResp.ok) {
      console.log(`[Backend] ZenoPay status check failed for ${orderId}:`, statusData);
      return res
        .status(400)
        .json({ error: statusData.message || 'Failed to fetch order status' });
    }

    const paymentStatus =
      statusData.data &&
      Array.isArray(statusData.data) &&
      statusData.data[0]?.payment_status;
    
    console.log(`[Backend] Payment status for ${orderId}: ${paymentStatus}`);

    if (paymentStatus === 'COMPLETED') {
      console.log(`[Backend] Payment completed via polling for ${orderId}, applying payment`);
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
    console.log('[ZenoPay] Webhook received:', req.body);
    ensureZenoConfigured();

    const incomingKey = req.headers['x-api-key'];
    console.log('[ZenoPay] Webhook API key check:', { incomingKey: incomingKey ? 'present' : 'missing', expected: ZENO_API_KEY ? 'present' : 'missing' });
    if (!incomingKey || incomingKey !== ZENO_API_KEY) {
      console.log('[ZenoPay] Webhook rejected: invalid API key');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const bodySchema = z.object({
      order_id: z.string(),
      payment_status: z.string(),
      reference: z.string().optional(),
      transid: z.string().optional(),
      metadata: z.any().optional(),
    }).passthrough(); // Allow additional fields

    const payload = bodySchema.parse(req.body);
    console.log('[ZenoPay] Webhook payload parsed:', payload);

    if (payload.payment_status === 'COMPLETED') {
      console.log('[ZenoPay] Processing completed payment:', payload.order_id);
      await applyCompletedPayment(payload.order_id, payload);
      console.log('[ZenoPay] Payment processing completed for:', payload.order_id);
    } else {
      console.log('[ZenoPay] Ignoring non-completed payment status:', payload.payment_status);
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('[ZenoPay] Webhook error:', err);
    return next(err);
  }
});

// Manual payment completion for testing (remove in production)
router.post('/zeno/complete/:orderId', async (req, res, next) => {
  try {
    const { orderId } = req.params;
    console.log('[Manual] Completing payment for order:', orderId);
    
    const result = await applyCompletedPayment(orderId, { manual: true });
    
    if (result) {
      res.json({ success: true, message: 'Payment completed manually' });
    } else {
      res.status(404).json({ error: 'Payment not found' });
    }
  } catch (err) {
    console.error('[Manual] Completion error:', err);
    return next(err);
  }
});

module.exports = router;

