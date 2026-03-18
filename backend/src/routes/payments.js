const express = require('express');
const { z } = require('zod');
const { query, pool } = require('../db');

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
    // - Halotel: 061, 062, 063
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
      '061', '062', '063', // Halotel
      '065', '071', // Mixx by Yas
      '068', '069', '078', // Airtel
      '074', '075', '076', '079', // Vodacom
    ];
    
    const isValidFormat = /^0[0-9]{8,9}$/.test(normalizedPhone);
    const hasValidPrefix = validPrefixes.some(prefix => normalizedPhone.startsWith(prefix));
    
    if (!isValidFormat || !hasValidPrefix) {
      return res.status(400).json({
        error: 'Invalid Tanzanian phone number. Use format: 061XXXXXXXX, 062XXXXXXXX, 063XXXXXXXX, 065XXXXXXXX, 068XXXXXXXX, 069XXXXXXXX, 071XXXXXXXX, 074XXXXXXXX, 075XXXXXXXX, 076XXXXXXXX, 078XXXXXXXX, or 079XXXXXXXX',
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

    // ZenoPay: Halotel/Halopesa often requires international format (255...) for the payment
    // prompt to reach the user. Other networks work with local format (0...).
    const isHalotel = normalizedPhone.startsWith('061') || normalizedPhone.startsWith('062') || normalizedPhone.startsWith('063');
    const phoneForZeno = isHalotel
      ? '255' + normalizedPhone.slice(1)  // 0612345678 -> 255612345678
      : normalizedPhone;                   // Local format for Vodacom, Airtel, Tigo

    const payload = {
      order_id: orderId,
      buyer_email: data.email || 'user@eamax.app',
      buyer_name: data.name || data.externalId,
      buyer_phone: phoneForZeno,
      amount: amountToSend,
      webhook_url: webhookUrl,
    };
    // Some ZenoPay integrations support explicit provider for Halopesa routing
    if (isHalotel) {
      payload.provider = 'HALOPESA';
    }

    // eslint-disable-next-line no-console
    console.log('[ZenoPay] Sending payment request (exact amount):', {
      orderId,
      phone: phoneForZeno,
      phonePrefix: phoneForZeno.substring(0, 3),
      amount: amountToSend,
      bundle: data.bundle,
      network: (phoneForZeno.startsWith('061') || phoneForZeno.startsWith('062') || phoneForZeno.startsWith('063'))
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

// Internal helper: apply completed payment to user (uses single DB client so transaction works)
// On success: unlocks all channels, starts remaining time, marks payment completed (revenue + premium count in admin)
const applyCompletedPayment = async (orderId, meta) => {
  console.log('[Payment] Applying completed payment for order:', orderId, 'meta:', meta);
  const payRes = await query(
    'SELECT id, user_id, plan, amount_cents, currency, status FROM subscription_payments WHERE provider_ref = $1 LIMIT 1',
    [orderId],
  );
  if (payRes.rows.length === 0) {
    console.log('[Payment] No payment found for order:', orderId);
    return null;
  }
  const payment = payRes.rows[0];

  // Validate real data from DB
  const userId = Number(payment.user_id);
  const paymentId = Number(payment.id);
  const plan = payment.plan && String(payment.plan).toLowerCase();

  if (!userId || !paymentId || Number.isNaN(userId) || Number.isNaN(paymentId)) {
    console.error('[Payment] Invalid payment row:', { user_id: payment.user_id, id: payment.id });
    return null;
  }

  const planInfo = PLAN_CONFIG[plan];
  if (!planInfo || !planInfo.interval) {
    console.error('[Payment] Invalid or missing plan:', plan);
    return null;
  }

  if (payment.status === 'completed') {
    console.log('[Payment] Payment already completed:', orderId);
    return payment;
  }

  console.log('[Payment] Found payment:', { id: paymentId, user_id: userId, plan, amount_cents: payment.amount_cents, interval: planInfo.interval });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Mark payment completed → revenue in admin (SUM(amount_cents) WHERE status='completed')
    const payUpdate = await client.query(
      `UPDATE subscription_payments SET status = 'completed' WHERE id = $1 RETURNING id, status`,
      [paymentId],
    );
    if (payUpdate.rowCount !== 1) {
      throw new Error(`Failed to update payment id=${paymentId} (rowCount=${payUpdate.rowCount})`);
    }
    console.log('[Payment] Payment status set to completed, id:', paymentId);

    // 2) Set user premium + remaining time → premium users count in admin
    const userUpdate = await client.query(
      `UPDATE users
         SET is_premium = TRUE,
             premium_expires_at = GREATEST(COALESCE(premium_expires_at, now()), now()) + $2::interval
       WHERE id = $1
       RETURNING id, is_premium, premium_expires_at`,
      [userId, planInfo.interval],
    );
    if (userUpdate.rowCount !== 1) {
      throw new Error(`Failed to update user id=${userId} (rowCount=${userUpdate.rowCount})`);
    }
    const updatedUser = userUpdate.rows[0];
    console.log('[Payment] User premium updated:', { id: userId, premium_expires_at: updatedUser.premium_expires_at });

    // 3) Unlock all active channels for this user
    const unlockResult = await client.query(
      `INSERT INTO user_unlocked_channels (user_id, channel_id)
       SELECT $1, id FROM channels WHERE is_active = TRUE
       ON CONFLICT (user_id, channel_id) DO NOTHING`,
      [userId],
    );
    console.log('[Payment] Channels unlocked for user:', userId, 'rows inserted/updated:', unlockResult.rowCount);

    await client.query('COMMIT');
    console.log('[Payment] Transaction committed for order:', orderId, '- revenue and premium users will reflect in admin.');
  } catch (err) {
    console.error('[Payment] Transaction failed, rolling back:', err);
    await client.query('ROLLBACK').catch((rollbackErr) => {
      console.error('[Payment] Rollback error:', rollbackErr);
    });
    throw err;
  } finally {
    client.release();
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

    let statusData = {};
    try {
      const text = await statusResp.text();
      if (text && text.trim()) statusData = JSON.parse(text);
    } catch (_) {
      // ZenoPay might return non-JSON (e.g. HTML) for 404
    }
    console.log(`[Backend] ZenoPay status response for ${orderId}:`, {
      status: statusResp.status,
      data: statusData
    });

    // "Order not found" from ZenoPay is normal right after creating the order (or in sandbox) – return PENDING so app keeps polling
    const zenoMessage = String(statusData.message || statusData.error || '').toLowerCase();
    const isOrderNotFound = !statusResp.ok && (
      zenoMessage.includes('no order found') ||
      zenoMessage.includes('order not found') ||
      (zenoMessage.includes('order_id') && zenoMessage.includes('not found')) ||
      statusResp.status === 404
    );
    if (isOrderNotFound) {
      console.log(`[Backend] ZenoPay has no order yet for ${orderId}, returning PENDING so app keeps polling`);
      return res.json({
        status: 'PENDING',
        raw: statusData,
      });
    }

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

    // Also accept data[0].paymentStatus or top-level payment_status / paymentStatus / result
    const firstItem = statusData.data && Array.isArray(statusData.data) ? statusData.data[0] : null;
    const statusNormalized =
      (firstItem && (firstItem.payment_status || firstItem.paymentStatus)) ||
      statusData.payment_status ||
      statusData.paymentStatus ||
      (statusData.result && String(statusData.result).toUpperCase() === 'COMPLETED' ? 'COMPLETED' : null);

    // Treat any completion-like value as COMPLETED (ZenoPay may use "Completed", "SUCCESS", etc. in production)
    const rawStatus = String(paymentStatus || statusNormalized || statusData.result || '').toUpperCase().trim();
    const isCompleted =
      rawStatus === 'COMPLETED' ||
      rawStatus === 'SUCCESS' ||
      rawStatus === 'PAID' ||
      (statusData.status && String(statusData.status).toLowerCase() === 'success' && (rawStatus || firstItem?.payment_status));

    console.log(`[Backend] Payment status for ${orderId}:`, { rawStatus, isCompleted, fullResponse: JSON.stringify(statusData).slice(0, 400) });

    if (isCompleted) {
      console.log(`[Backend] Payment completed via polling for ${orderId}, applying payment`);
      await applyCompletedPayment(orderId, firstItem || statusData || {});
    }

    return res.json({
      status: isCompleted ? 'COMPLETED' : (statusData.result || paymentStatus || statusNormalized || 'UNKNOWN'),
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

    // Accept API key from x-api-key or Authorization: Bearer <key> (ZenoPay may send either)
    const incomingKey = req.headers['x-api-key'] || (req.headers['authorization'] && req.headers['authorization'].startsWith('Bearer ')
      ? req.headers['authorization'].slice(7).trim()
      : null);
    const keyValid = incomingKey && incomingKey === ZENO_API_KEY;
    console.log('[ZenoPay] Webhook API key check:', { incomingKey: incomingKey ? 'present' : 'missing', keyValid });

    const bodySchema = z.object({
      order_id: z.string().optional(),
      orderId: z.string().optional(),
      payment_status: z.string().optional(),
      paymentStatus: z.string().optional(),
      reference: z.string().optional(),
      transid: z.string().optional(),
      metadata: z.any().optional(),
    }).passthrough();

    const payload = bodySchema.parse(req.body);
    const orderId = payload.order_id || payload.orderId;
    const paymentStatus = (payload.payment_status || payload.paymentStatus || '').toUpperCase();
    console.log('[ZenoPay] Webhook payload parsed:', { orderId, paymentStatus });

    if (!orderId) {
      console.log('[ZenoPay] Webhook missing order_id/orderId');
      return res.status(400).json({ error: 'Missing order_id' });
    }

    // If key is missing/invalid, only allow COMPLETED if we have a pending payment for this order (ZenoPay often doesn't send x-api-key on webhooks)
    if (!keyValid) {
      const pendingCheck = await query(
        'SELECT id FROM subscription_payments WHERE provider_ref = $1 AND status = $2 LIMIT 1',
        [orderId, 'pending'],
      );
      if (pendingCheck.rows.length === 0) {
        console.log('[ZenoPay] Webhook rejected: invalid API key and order not found or not pending');
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
      if (paymentStatus === 'COMPLETED') {
        console.warn('[ZenoPay] Webhook accepted without API key (order exists as pending). Configure ZenoPay to send x-api-key if supported.');
      }
    }

    if (paymentStatus === 'COMPLETED') {
      console.log('[ZenoPay] Processing completed payment:', orderId);
      await applyCompletedPayment(orderId, payload);
      console.log('[ZenoPay] Payment processing completed for:', orderId);
    } else {
      console.log('[ZenoPay] Ignoring non-completed payment status:', paymentStatus || '(empty)');
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

