const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { query, pool } = require('../db');
const { sendPushNotification } = require('../services/firebase');

const PAYMENT_PROVIDER_SETTING_KEY = 'payment_provider';
const PAYMENT_PROVIDERS = {
  ZENO: 'zeno',
  SONICPESA: 'sonicpesa',
};
const SONICPESA_API_BASE = 'https://api.sonicpesa.com/api/v1';
const SONICPESA_API_KEY = process.env.SONICPESA_API_KEY;
const SONICPESA_WEBHOOK_SECRET = process.env.SONICPESA_WEBHOOK_SECRET;

const ensureSonicPesaConfigured = () => {
  if (!SONICPESA_API_KEY) {
    throw new Error('SONICPESA API key (SONICPESA_API_KEY) is not configured on the server');
  }
};

const getAppSettingValue = async (key, defaultValue = null) => {
  const result = await query('SELECT value FROM app_settings WHERE key = $1 LIMIT 1', [key]);
  if (result.rows.length === 0) return defaultValue;
  return result.rows[0].value;
};

const getSelectedPaymentProvider = async () => {
  const rawValue = await getAppSettingValue(PAYMENT_PROVIDER_SETTING_KEY, PAYMENT_PROVIDERS.ZENO);
  if (typeof rawValue !== 'string') return PAYMENT_PROVIDERS.ZENO;
  const trimmed = rawValue.toLowerCase().trim();
  const compact = trimmed.replace(/[^a-z0-9]/g, '');
  if (compact === 'sonicpesa') return PAYMENT_PROVIDERS.SONICPESA;
  if (compact === 'zenopay' || compact === 'zeno') return PAYMENT_PROVIDERS.ZENO;
  if (Object.values(PAYMENT_PROVIDERS).includes(trimmed)) return trimmed;
  return PAYMENT_PROVIDERS.ZENO;
};

const getPaymentProviderForOrder = async (orderId) => {
  const result = await query(
    'SELECT payment_provider FROM subscription_payments WHERE provider_ref = $1 LIMIT 1',
    [orderId],
  );
  if (result.rows.length === 0) return null;
  return result.rows[0].payment_provider || null;
};

const normalizePhoneForSonicPesa = (normalizedPhone) => {
  if (normalizedPhone.startsWith('0')) {
    return `255${normalizedPhone.slice(1)}`;
  }
  if (normalizedPhone.startsWith('+255')) {
    return normalizedPhone.slice(1);
  }
  return normalizedPhone;
};

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
  // id stays "year" for existing API/clients; duration is 3 months (miezi 3)
  year: { amount: 12000, interval: '90 days' },
};

// Mobile money start: `/start` (used by apps) and legacy `/zeno/start` share this handler.
// Provider is chosen from app_settings.payment_provider (zeno | sonicpesa).
async function handlePaymentStart(req, res, next) {
  try {
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
    // Tanzanian mobile prefixes (0 + national significant number):
    // - Halotel: 061, 062, 063
    // - Vodacom: 074, 075, 076, 079
    // - Mixx by Yas: 065, 071
    // - Airtel: 068, 069, 078
    // - Tigo: 067, 077 (0671…, 0679…, etc.)
    let normalizedPhone = data.phone.replace(/\s+/g, ''); // Remove spaces

    // Payments only go to Tanzania mobile money — reject any other international dialing form
    if (normalizedPhone.startsWith('+') && !normalizedPhone.startsWith('+255')) {
      return res.status(400).json({
        error:
          'Malipo yanatumwa kwa nambari za simu za Tanzania pekee (M-Pesa, Airtel, Tigo, Halopesa, Yas). Tumia 07…/06… au +255….',
      });
    }
    if (normalizedPhone.startsWith('00') && !normalizedPhone.startsWith('00255')) {
      return res.status(400).json({
        error:
          'Malipo yanatumwa kwa nambari za simu za Tanzania pekee. Tumia 07…/06… au +255….',
      });
    }

    // Convert Tanzania country code → local 0… (only format sent to ZenoPay)
    if (normalizedPhone.startsWith('+255')) {
      normalizedPhone = '0' + normalizedPhone.slice(4);
    } else if (normalizedPhone.startsWith('00255')) {
      normalizedPhone = '0' + normalizedPhone.slice(5);
    } else if (normalizedPhone.startsWith('255') && normalizedPhone.length >= 12) {
      normalizedPhone = '0' + normalizedPhone.slice(3);
    }

    if (!/^\d+$/.test(normalizedPhone)) {
      return res.status(400).json({
        error:
          'Nambari ya simu lazima iwe nambari ya Tanzania tu: tarakimu pekee baada ya kuweka muundo sahihi (mfano 0712345678 au +255712345678).',
      });
    }
    
    // Validate Tanzanian mobile number format
    // Must start with 0 and have valid prefix, then 7-8 more digits (total 9-10 digits after 0)
    const validPrefixes = [
      '061', '062', '063', // Halotel
      '065', '071', // Mixx by Yas
      '067', '077', // Tigo
      '068', '069', '078', // Airtel
      '074', '075', '076', '079', // Vodacom
    ];
    
    const isValidFormat = /^0[0-9]{8,9}$/.test(normalizedPhone);
    const hasValidPrefix = validPrefixes.some(prefix => normalizedPhone.startsWith(prefix));
    
    if (!isValidFormat || !hasValidPrefix) {
      return res.status(400).json({
        error:
          'Invalid Tanzanian phone number. Use format: 061–063 (Halotel), 065/071 (Yas), 067/077 (Tigo), 068–069/078 (Airtel), 074–076/079 (Vodacom); 9–10 digits after 0.',
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

    const selectedProvider = await getSelectedPaymentProvider();
    const provider = selectedProvider === PAYMENT_PROVIDERS.SONICPESA
      ? PAYMENT_PROVIDERS.SONICPESA
      : PAYMENT_PROVIDERS.ZENO;
    console.log('[Payment] /start using app_settings.payment_provider →', provider);

    const buyerPhoneLocal = normalizedPhone;
    let providerResponseMessage = 'Request in progress. You will receive a prompt on your phone.';

    if (provider === PAYMENT_PROVIDERS.SONICPESA) {
      ensureSonicPesaConfigured();
      const phoneForSonic = normalizePhoneForSonicPesa(normalizedPhone);
      const sonicPayload = {
        buyer_email: data.email || 'user@eamax.app',
        buyer_name: data.name || data.externalId,
        buyer_phone: phoneForSonic,
        amount: amountToSend,
        currency: 'TZS',
      };

      // eslint-disable-next-line no-console
      console.log('[SonicPesa] Sending payment request:', {
        orderId,
        phone: phoneForSonic,
        amount: amountToSend,
        bundle: data.bundle,
      });

      const response = await fetch(
        `${SONICPESA_API_BASE}/payment/create_order`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': SONICPESA_API_KEY,
          },
          body: JSON.stringify(sonicPayload),
        },
      );

      const sonicData = await response.json();
      // eslint-disable-next-line no-console
      console.log('[SonicPesa] Response:', { status: response.status, sonicData });

      if (!response.ok || sonicData.status !== 'success') {
        const errorMsg = sonicData.message || sonicData.error || 'Failed to start SonicPesa payment';
        return res.status(400).json({
          error: errorMsg,
          sonicResponse: sonicData,
        });
      }

      const sonicOrderId = sonicData.data?.order_id?.toString().trim();
      if (!sonicOrderId) {
        return res.status(400).json({
          error: 'SonicPesa did not return an order_id',
          sonicResponse: sonicData,
        });
      }

      providerResponseMessage = sonicData.message || providerResponseMessage;
      await query(
        `INSERT INTO subscription_payments (user_id, plan, amount_cents, currency, status, provider_ref, payment_provider, buyer_phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [userId, data.bundle, planInfo.amount, 'TZS', 'pending', sonicOrderId, provider, buyerPhoneLocal],
      );

      return res.json({
        status: 'pending',
        orderId: sonicOrderId,
        message: providerResponseMessage,
        provider: PAYMENT_PROVIDERS.SONICPESA,
      });
    }

    ensureZenoConfigured();

    const webhookUrl =
      process.env.ZENO_WEBHOOK_URL ||
      `${process.env.PUBLIC_BASE_URL || 'https://eamax-production.up.railway.app'}/api/payments/zeno/webhook`;
    console.log(`[Backend] Using webhook URL: ${webhookUrl}`);

    const isHalotel = normalizedPhone.startsWith('061') || normalizedPhone.startsWith('062') || normalizedPhone.startsWith('063');
    // ZenoPay mobile_money_tanzania: must receive local format 0XXXXXXXXX only (never foreign country codes)
    const phoneForZeno = normalizedPhone;

    const payload = {
      order_id: orderId,
      buyer_email: data.email || 'user@eamax.app',
      buyer_name: data.name || data.externalId,
      buyer_phone: phoneForZeno,
      amount: amountToSend,
      webhook_url: webhookUrl,
    };
    if (isHalotel) {
      payload.provider = 'HALOPESA';
    }

    // eslint-disable-next-line no-console
    console.log('[ZenoPay] Sending payment request (exact amount):', {
      orderId,
      phone: phoneForZeno,
      phonePrefix: normalizedPhone.slice(0, 3),
      amount: amountToSend,
      bundle: data.bundle,
      network: (normalizedPhone.startsWith('061') || normalizedPhone.startsWith('062') || normalizedPhone.startsWith('063'))
        ? 'Halotel'
        : normalizedPhone.startsWith('065') || normalizedPhone.startsWith('071')
        ? 'Mixx by Yas'
        : normalizedPhone.startsWith('067') || normalizedPhone.startsWith('077')
        ? 'Tigo'
        : normalizedPhone.startsWith('068') || normalizedPhone.startsWith('069') || normalizedPhone.startsWith('078')
        ? 'Airtel'
        : normalizedPhone.startsWith('074') || normalizedPhone.startsWith('075') || normalizedPhone.startsWith('076') || normalizedPhone.startsWith('079')
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
      `INSERT INTO subscription_payments (user_id, plan, amount_cents, currency, status, provider_ref, payment_provider, buyer_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId, data.bundle, planInfo.amount, 'TZS', 'pending', orderId, provider, phoneForZeno],
    );

    // Use `pending` — not `success` — so clients never confuse “prompt sent” with “money received”.
    return res.json({
      status: 'pending',
      orderId,
      message:
        zenoData.message ||
        'Request in progress. You will receive a prompt on your phone.',
      provider: PAYMENT_PROVIDERS.ZENO,
    });
  } catch (err) {
    console.error('[Payment] Start error:', err?.message || err);
    const errorMessage = err.message || 'Failed to process payment request';
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: errorMessage });
  }
}

router.post('/zeno/start', handlePaymentStart);
router.post('/start', handlePaymentStart);

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
      `UPDATE subscription_payments
          SET status = 'completed',
              completed_at = COALESCE(completed_at, NOW())
        WHERE id = $1
        RETURNING id, status, completed_at`,
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
             blocked = FALSE,
             premium_expires_at = GREATEST(COALESCE(premium_expires_at, now()), now()) + $2::interval
       WHERE id = $1
       RETURNING id, is_premium, premium_expires_at, blocked`,
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

    // Send push notification to user about successful payment
    try {
      const userResult = await query('SELECT fcm_token, external_id FROM users WHERE id = $1', [userId]);
      const fcmToken = userResult.rows[0]?.fcm_token;
      const externalId = userResult.rows[0]?.external_id;
      
      if (fcmToken) {
        await sendPushNotification(
          fcmToken,
          'Malipo Yamefaulu!',
          'Umebadilisha kuwa Premium. Sasa una access kwenye chaneli zote.',
          { type: 'payment_success', orderId }
        );
        console.log('[Payment] Push notification sent to user:', userId);
      }

      // Send real-time update via WebSocket if available
      if (global.realtimeServer && externalId) {
        try {
          const updatedUser = await query(
            'SELECT is_premium, premium_expires_at FROM users WHERE id = $1',
            [userId]
          );
          if (updatedUser.rows[0]) {
            global.realtimeServer.notifyPremiumUpdate(externalId, updatedUser.rows[0]);
          }
        } catch (err) {
          console.error('[Payment] Failed to send real-time update:', err.message);
        }
      }
    } catch (notifErr) {
      console.error('[Payment] Failed to send notifications:', notifErr.message);
    }
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

// Helper: Parse "order not found" from API responses
const parseOrderNotFound = (message, statusResp) => {
  const text = String(message || '').toLowerCase();
  return (!statusResp.ok && (
    text.includes('no order found') ||
    text.includes('order not found') ||
    (text.includes('order_id') && text.includes('not found')) ||
    statusResp.status === 404
  ));
};

/** Values some carriers (Halopesa/Halotel, Airtel) return instead of plain COMPLETED */
const ZENO_PAID_STATUSES = new Set([
  'COMPLETED', 'SUCCESS', 'PAID', 'COMPLETE', 'SUCCEEDED', 'APPROVED', 'SETTLED', 'CONFIRMED',
]);

const isZenoPaidRaw = (rawUpper) => {
  if (!rawUpper) return false;
  const u = String(rawUpper).toUpperCase().trim();
  if (ZENO_PAID_STATUSES.has(u)) return true;
  const lower = u.toLowerCase();
  return lower === 'successful' || lower === 'ok' || lower === 'true' || lower === '1';
};

const pickZenoStatusFromObject = (o) => {
  if (!o || typeof o !== 'object') return '';
  const keys = [
    'payment_status', 'paymentStatus', 'payment_state', 'paymentState',
    'status', 'state', 'transaction_status', 'transactionStatus', 'mpesa_status',
  ];
  for (const k of keys) {
    const v = o[k];
    if (v != null && typeof v !== 'object') {
      const s = String(v).toUpperCase().trim();
      if (s) return s;
    }
  }
  return '';
};

/**
 * Zeno order-status (and similar) payloads: `data` may be an array OR object; Halotel/Airtel
 * often nest status under `result` or a single object instead of data[0].
 */
const extractRawZenoPaymentStatus = (statusData) => {
  if (!statusData || typeof statusData !== 'object') return '';
  let s = pickZenoStatusFromObject(statusData);
  if (s) return s;
  const d = statusData.data;
  if (Array.isArray(d) && d.length) {
    for (const row of d) {
      s = pickZenoStatusFromObject(row) || (row && typeof row === 'object' ? pickZenoStatusFromObject(row.order) : '');
      if (s) return s;
    }
  } else if (d && typeof d === 'object') {
    s = pickZenoStatusFromObject(d) || pickZenoStatusFromObject(d.order) || pickZenoStatusFromObject(d.transaction);
    if (s) return s;
  }
  const r = statusData.result;
  if (typeof r === 'string') {
    s = String(r).toUpperCase().trim();
    if (s) return s;
  }
  if (r && typeof r === 'object') {
    s = pickZenoStatusFromObject(r);
    if (s) return s;
  }
  if (statusData.order && typeof statusData.order === 'object') {
    s = pickZenoStatusFromObject(statusData.order);
    if (s) return s;
  }
  return '';
};

const zenoOrderStatusFirstRecord = (statusData) => {
  if (!statusData?.data) return null;
  if (Array.isArray(statusData.data)) return statusData.data[0] || null;
  if (typeof statusData.data === 'object') return statusData.data;
  return null;
};

const evaluateZenoOrderStatusForApply = (statusData) => {
  const firstItem = zenoOrderStatusFirstRecord(statusData);
  const rawStatus = extractRawZenoPaymentStatus(statusData);
  const isCompleted = isZenoPaidRaw(rawStatus);
  return { isCompleted, rawStatus, firstItem };
};

/** Webhook bodies vary by MNO; merge nested `data` and common aliases. */
const extractZenoWebhookOrderAndPaid = (payload) => {
  const nested = payload.data;
  const first = Array.isArray(nested) ? nested[0] : (nested && typeof nested === 'object' ? nested : null);
  const orderId = String(
    payload.order_id ||
      payload.orderId ||
      first?.order_id ||
      first?.orderId ||
      payload.reference ||
      payload.metadata?.order_id ||
      payload.metadata?.orderId ||
      '',
  ).trim();
  const statusCandidates = [
    payload.payment_status,
    payload.paymentStatus,
    payload.status,
    first?.payment_status,
    first?.paymentStatus,
    first?.status,
    payload.result && typeof payload.result === 'object' ? payload.result.payment_status : null,
    payload.result && typeof payload.result === 'object' ? payload.result.status : null,
  ];
  let raw = '';
  for (const f of statusCandidates) {
    if (f != null && typeof f !== 'object') {
      raw = String(f).toUpperCase().trim();
      if (raw) break;
    }
  }
  if (!raw && typeof payload.result === 'string') {
    raw = String(payload.result).toUpperCase().trim();
  }
  const paid = isZenoPaidRaw(raw);
  return { orderId: orderId || null, paid, raw };
};

// Helper: Extract SonicPesa payment status from response
const getSonicPesaRawStatus = (statusData) => {
  return String(
    statusData.data?.payment_status ||
    statusData.data?.status ||
    statusData.payment_status ||
    statusData.paymentStatus ||
    statusData.status ||
    ''
  ).toUpperCase().trim();
};

// Check payment status (polling from app)
router.get('/zeno/status', async (req, res, next) => {
  try {
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

    const dbProvider = await getPaymentProviderForOrder(orderId);
    const selectedProvider = dbProvider || await getSelectedPaymentProvider();
    const provider = selectedProvider === PAYMENT_PROVIDERS.SONICPESA
      ? PAYMENT_PROVIDERS.SONICPESA
      : PAYMENT_PROVIDERS.ZENO;

    if (provider === PAYMENT_PROVIDERS.SONICPESA) {
      ensureSonicPesaConfigured();
      const statusResp = await fetch(
        `${SONICPESA_API_BASE}/payment/order_status`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': SONICPESA_API_KEY,
          },
          body: JSON.stringify({ order_id: orderId }),
        },
      );

      let statusData = {};
      try {
        const text = await statusResp.text();
        if (text && text.trim()) statusData = JSON.parse(text);
      } catch (_) {
        // SonicPesa should return JSON; fallback to empty object on parse failure.
      }
      console.log(`[Backend] SonicPesa status response for ${orderId}:`, {
        status: statusResp.status,
        data: statusData,
      });

      const sonicMessage = String(statusData.message || statusData.error || '').toLowerCase();
      const isOrderNotFound = !statusResp.ok && (
        sonicMessage.includes('no order found') ||
        sonicMessage.includes('order not found') ||
        statusResp.status === 404
      );
      if (isOrderNotFound) {
        console.log(`[Backend] SonicPesa has no order yet for ${orderId}, returning PENDING so app keeps polling`);
        return res.json({ status: 'PENDING', raw: statusData });
      }

      if (!statusResp.ok) {
        console.log(`[Backend] SonicPesa status check failed for ${orderId}:`, statusData);
        return res.status(400).json({ error: statusData.message || 'Failed to fetch order status' });
      }

      const rawStatus = String(
        statusData.data?.payment_status ||
        statusData.data?.status ||
        statusData.payment_status ||
        statusData.paymentStatus ||
        statusData.status ||
        '',
      ).toUpperCase().trim();
      const isCompleted = rawStatus === 'SUCCESS' || rawStatus === 'COMPLETED' || rawStatus === 'PAID';

      console.log(`[Backend] SonicPesa payment status for ${orderId}:`, { rawStatus, isCompleted, fullResponse: JSON.stringify(statusData).slice(0, 400) });

      if (isCompleted) {
        console.log(`[Backend] Payment completed via polling for ${orderId}, applying payment`);
        await applyCompletedPayment(orderId, statusData.data || statusData || {});
      }

      return res.json({
        status: isCompleted ? 'COMPLETED' : (rawStatus || 'PENDING'),
        raw: statusData,
      });
    }

    ensureZenoConfigured();
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

    const { isCompleted, rawStatus, firstItem } = evaluateZenoOrderStatusForApply(statusData);

    console.log(`[Backend] Payment status for ${orderId}:`, { rawStatus, isCompleted, fullResponse: JSON.stringify(statusData).slice(0, 400) });

    if (isCompleted) {
      console.log(`[Backend] Payment completed via polling for ${orderId}, applying payment`);
      await applyCompletedPayment(orderId, firstItem || statusData || {});
    }

    return res.json({
      status: isCompleted ? 'COMPLETED' : (rawStatus || String(statusData.result || '') || 'UNKNOWN'),
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
      status: z.string().optional(),
      reference: z.string().optional(),
      transid: z.string().optional(),
      metadata: z.any().optional(),
      data: z.any().optional(),
      result: z.any().optional(),
    }).passthrough();

    const payload = bodySchema.parse(req.body);
    const { orderId: webhookOrderId, paid, raw: webhookStatusRaw } = extractZenoWebhookOrderAndPaid(payload);
    console.log('[ZenoPay] Webhook payload parsed:', { orderId: webhookOrderId, webhookStatusRaw, paid });

    if (!webhookOrderId) {
      console.log('[ZenoPay] Webhook missing order_id/orderId/reference');
      return res.status(400).json({ error: 'Missing order_id' });
    }

    // If key is missing/invalid, only allow completion when we have a pending payment for this order (ZenoPay often doesn't send x-api-key on webhooks)
    if (!keyValid) {
      const pendingCheck = await query(
        'SELECT id FROM subscription_payments WHERE provider_ref = $1 AND status = $2 LIMIT 1',
        [webhookOrderId, 'pending'],
      );
      if (pendingCheck.rows.length === 0) {
        console.log('[ZenoPay] Webhook rejected: invalid API key and order not found or not pending');
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
      if (paid) {
        console.warn('[ZenoPay] Webhook accepted without API key (order exists as pending). Configure ZenoPay to send x-api-key if supported.');
      }
    }

    if (paid) {
      console.log('[ZenoPay] Processing completed payment:', webhookOrderId);
      await applyCompletedPayment(webhookOrderId, payload);
      console.log('[ZenoPay] Payment processing completed for:', webhookOrderId);
    } else {
      console.log('[ZenoPay] Ignoring non-completed payment status:', webhookStatusRaw || '(empty)');
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('[ZenoPay] Webhook error:', err);
    return next(err);
  }
});

// Webhook endpoint for SonicPesa
router.post('/sonicpesa/webhook', async (req, res, next) => {
  try {
    console.log('[SonicPesa] Webhook received:', req.body);
    ensureSonicPesaConfigured();

    const incomingSignature = req.headers['x-sonicpesa-signature'];
    const rawBody = req.rawBody || JSON.stringify(req.body);
    let signatureValid = false;
    if (typeof incomingSignature === 'string' && SONICPESA_WEBHOOK_SECRET) {
      const expected = crypto.createHmac('sha256', SONICPESA_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');
      signatureValid = expected === incomingSignature;
    }

    const bodySchema = z.object({
      event: z.string().optional(),
      order_id: z.string().optional(),
      amount: z.number().int().optional(),
      currency: z.string().optional(),
      status: z.string().optional(),
      transid: z.string().optional(),
      channel: z.string().optional(),
      reference: z.string().optional(),
      msisdn: z.string().optional(),
      timestamp: z.string().optional(),
    }).passthrough();

    const payload = bodySchema.parse(req.body);
    const orderId = (payload.order_id || payload.reference)?.toString().trim();
    const paymentStatus = (payload.status || '').toString().toUpperCase().trim();
    console.log('[SonicPesa] Webhook payload parsed:', { orderId, paymentStatus, signatureValid });

    if (!orderId) {
      console.log('[SonicPesa] Webhook missing order_id');
      return res.status(400).json({ error: 'Missing order_id' });
    }

    if (!signatureValid) {
      const pendingCheck = await query(
        'SELECT id FROM subscription_payments WHERE provider_ref = $1 AND status = $2 LIMIT 1',
        [orderId, 'pending'],
      );
      if (pendingCheck.rows.length === 0) {
        console.log('[SonicPesa] Webhook rejected: invalid signature and order not found or not pending');
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
      console.warn('[SonicPesa] Webhook accepted without valid signature (order exists as pending). Configure webhook signing secret if available.');
    }

    if (paymentStatus === 'SUCCESS' || paymentStatus === 'COMPLETED' || paymentStatus === 'PAID') {
      console.log('[SonicPesa] Processing completed payment:', orderId);
      await applyCompletedPayment(orderId, payload);
      console.log('[SonicPesa] Payment processing completed for:', orderId);
    } else {
      console.log('[SonicPesa] Ignoring non-completed payment status:', paymentStatus || '(empty)');
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('[SonicPesa] Webhook error:', err);
    return next(err);
  }
});

// Unified: Complete payment manually for testing (works for both providers)
router.post('/complete/:orderId', async (req, res, next) => {
  try {
    const { orderId } = req.params;
    console.log('[Payment] Manual completion requested for order:', orderId);
    
    const result = await applyCompletedPayment(orderId, { manual: true });
    
    if (result) {
      res.json({ success: true, message: 'Payment completed manually' });
    } else {
      res.status(404).json({ error: 'Payment not found' });
    }
  } catch (err) {
    console.error('[Payment] Manual completion error:', err);
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

// Unified payment status endpoint - routes to active provider
router.get('/status', async (req, res, next) => {
  try {
    const orderId = req.query.orderId;
    if (!orderId) {
      return res.status(400).json({ error: 'orderId parameter required' });
    }

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

    // Get payment record to determine which provider was used
    const dbProvider = await getPaymentProviderForOrder(orderId);
    const selectedProvider = dbProvider || await getSelectedPaymentProvider();
    const provider = selectedProvider === PAYMENT_PROVIDERS.SONICPESA
      ? PAYMENT_PROVIDERS.SONICPESA
      : PAYMENT_PROVIDERS.ZENO;

    if (provider === PAYMENT_PROVIDERS.SONICPESA) {
      ensureSonicPesaConfigured();
      const statusResp = await fetch(
        `${SONICPESA_API_BASE}/payment/order_status`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': SONICPESA_API_KEY,
          },
          body: JSON.stringify({ order_id: orderId }),
        },
      );

      let statusData = {};
      try {
        const text = await statusResp.text();
        if (text && text.trim()) statusData = JSON.parse(text);
      } catch (_) {
        // SonicPesa should return JSON; fallback to empty object on parse failure.
      }
      console.log(`[Backend] SonicPesa status response for ${orderId}:`, {
        status: statusResp.status,
        data: statusData,
      });

      const sonicMessage = String(statusData.message || statusData.error || '').toLowerCase();
      const isOrderNotFound = !statusResp.ok && (
        sonicMessage.includes('no order found') ||
        sonicMessage.includes('order not found') ||
        statusResp.status === 404
      );
      if (isOrderNotFound) {
        console.log(`[Backend] SonicPesa has no order yet for ${orderId}, returning PENDING so app keeps polling`);
        return res.json({ status: 'PENDING', raw: statusData });
      }

      if (!statusResp.ok) {
        console.log(`[Backend] SonicPesa status check failed for ${orderId}:`, statusData);
        return res.status(400).json({ error: statusData.message || 'Failed to fetch order status' });
      }

      const rawStatus = getSonicPesaRawStatus(statusData);
      const isCompleted = rawStatus === 'SUCCESS' || rawStatus === 'COMPLETED' || rawStatus === 'PAID';

      console.log(`[Backend] SonicPesa payment status for ${orderId}:`, { rawStatus, isCompleted, fullResponse: JSON.stringify(statusData).slice(0, 400) });

      if (isCompleted) {
        console.log(`[Backend] Payment completed via polling for ${orderId}, applying payment`);
        await applyCompletedPayment(orderId, statusData.data || statusData || {});
      }

      return res.json({
        status: isCompleted ? 'COMPLETED' : (rawStatus || 'PENDING'),
        raw: statusData,
      });
    }

    ensureZenoConfigured();
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

    const { isCompleted, rawStatus, firstItem } = evaluateZenoOrderStatusForApply(statusData);

    console.log(`[Backend] Payment status for ${orderId}:`, { rawStatus, isCompleted, fullResponse: JSON.stringify(statusData).slice(0, 400) });

    if (isCompleted) {
      console.log(`[Backend] Payment completed via polling for ${orderId}, applying payment`);
      await applyCompletedPayment(orderId, firstItem || statusData || {});
    }

    return res.json({
      status: isCompleted ? 'COMPLETED' : (rawStatus || String(statusData.result || '') || 'UNKNOWN'),
      raw: statusData,
    });
  } catch (err) {
    console.error('[Payment] Status error:', err?.message || err);
    return next(err);
  }
});

module.exports = router;

