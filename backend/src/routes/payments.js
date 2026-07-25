const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { query, pool } = require('../db');
const { sendPushNotification } = require('../services/firebase');
const {
  buildPremiumPayload,
} = require('../services/premiumStatus');
const {
  grantUserEntitlementsInTransaction,
  repairUserEntitlements,
  repairUserEntitlementsIfNeeded,
  fetchUserPremiumSnapshotByUserId,
} = require('../services/userEntitlements');
const {
  getPlanPaymentInfo,
  resolvePremiumInterval,
  getActivePlans,
  intervalForPlan,
} = require('../services/subscriptionPlansService');

const PAYMENT_PROVIDER_SETTING_KEY = 'payment_provider';
const PAYMENT_PROVIDERS = {
  AURAX: 'aurax',
  SONICPESA: 'sonicpesa',
};
const AURAXPAY_API_BASE = (process.env.AURAXPAY_BASE_URL || 'https://api.auraxpay.net/v1').replace(/\/$/, '');
const AURAXPAY_API_KEY = process.env.AURAXPAY_API_KEY;
const AURAXPAY_WEBHOOK_SECRET = process.env.AURAXPAY_WEBHOOK_SECRET;

const getAuraxPayRequestHeaders = () => ({
  'Content-Type': 'application/json',
  'x-api-key': AURAXPAY_API_KEY,
  Accept: 'application/json',
});

// NOTE: Do NOT include bare `SUCCESS` / `OK` — Aurax often returns those for
// “STK/query accepted” while paymentStatus is still PENDING. Real money uses
// COMPLETED / SUCCESSFUL / COLLECTED / payment.completed events.
const AURAX_WEBHOOK_PAID_STATUSES = new Set([
  'SUCCESSFUL', 'COMPLETED', 'PAID', 'PAID_OUT', 'COMPLETE', 'SUCCEEDED',
  'APPROVED', 'CONFIRMED', 'SETTLED', 'COLLECTED', 'PAYMENT_COMPLETED',
  'TRANSACTION_SUCCESS', 'PAYMENT_SUCCESS', 'CAPTURED', 'DONE', 'PAYMENT_SUCCESSFUL',
]);

const AURAX_EXPLICIT_UNPAID_STATUSES = new Set([
  'PENDING', 'PROCESSING', 'INITIATED', 'WAITING', 'QUEUED',
  'CREATED', 'OPEN', 'SENT', 'STK_SENT', 'PROMPT_SENT', 'IN_PROGRESS', 'UNKNOWN',
]);

const ensureAuraxPayConfigured = () => {
  if (!AURAXPAY_API_KEY) {
    throw new Error('Aurax Pay API key (AURAXPAY_API_KEY) is not configured on the server');
  }
};
const SONICPESA_API_BASE = 'https://api.sonicpesa.com/api/v1';
const SONICPESA_API_KEY = process.env.SONICPESA_API_KEY;
const SONICPESA_SECRET_KEY =
  process.env.SONICPESA_SECRET_KEY || process.env.SONICPESA_API_SECRET || process.env.SONICPESA_SECRETE_KEY;
const SONICPESA_WEBHOOK_SECRET = process.env.SONICPESA_WEBHOOK_SECRET;

const getSonicPesaRequestHeaders = () => {
  const headers = {
    'Content-Type': 'application/json',
    'X-API-KEY': SONICPESA_API_KEY,
    Accept: 'application/json',
  };
  if (SONICPESA_SECRET_KEY) {
    headers['X-SECRET-KEY'] = SONICPESA_SECRET_KEY;
  }
  return headers;
};

const SONIC_WEBHOOK_PAID_STATUSES = new Set([
  'SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID', 'PAID_OUT', 'COMPLETE', 'SUCCEEDED', 'APPROVED',
  'CONFIRMED', 'SETTLED', 'COLLECTED', 'PAYMENT_COMPLETED', 'TRANSACTION_SUCCESS', 'PAYMENT_SUCCESS',
]);

const SONIC_EXPLICIT_UNPAID_STATUSES = new Set([
  'PENDING', 'PROCESSING', 'INITIATED', 'WAITING', 'QUEUED',
  'CREATED', 'OPEN', 'SENT', 'STK_SENT', 'PROMPT_SENT', 'IN_PROGRESS', 'UNKNOWN',
]);

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

const normalizeStoredPaymentProvider = (raw) => {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const compact = raw.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  if (compact === 'sonicpesa') return PAYMENT_PROVIDERS.SONICPESA;
  if (compact === 'aurax' || compact === 'auraxpay') return PAYMENT_PROVIDERS.AURAX;
  // Legacy admin value — treat former Zeno selection as Aurax.
  if (compact === 'zeno' || compact === 'zenopay') return PAYMENT_PROVIDERS.AURAX;
  return null;
};

const getSelectedPaymentProvider = async () => {
  const envDefault =
    String(process.env.PAYMENT_PROVIDER || '').trim().toLowerCase() === 'sonicpesa'
      ? PAYMENT_PROVIDERS.SONICPESA
      : PAYMENT_PROVIDERS.AURAX;
  const rawValue = await getAppSettingValue(PAYMENT_PROVIDER_SETTING_KEY, envDefault);
  return normalizeStoredPaymentProvider(rawValue) || envDefault;
};

/** Opt out with DISABLE_SONIC_AURAX_FALLBACK=1. Otherwise fall back to Aurax when Sonic STK cannot be sent. */
const isSonicAuraxFallbackDisabled = () =>
  String(process.env.DISABLE_SONIC_AURAX_FALLBACK || '').trim() === '1';

const isSonicAuraxFallbackAllowed = () => {
  if (isSonicAuraxFallbackDisabled()) return false;
  if (
    String(process.env.ALLOW_SONIC_AURAX_FALLBACK || process.env.ALLOW_SONIC_ZENO_FALLBACK || '').trim() === '1'
  ) {
    return true;
  }
  return isActivePaymentProviderConfigured(PAYMENT_PROVIDERS.AURAX);
};

const paymentRefWhereSql = 'provider_ref = $1 OR gateway_ref = $1';

const getPaymentProviderForOrder = async (orderId) => {
  const result = await query(
    `SELECT payment_provider FROM subscription_payments WHERE ${paymentRefWhereSql} LIMIT 1`,
    [orderId],
  );
  if (result.rows.length === 0) return null;
  return result.rows[0].payment_provider || null;
};

/** Resolve a payment row by client ref, gateway ref, or webhook metadata ids. */
const findPaymentRowByRefs = async (refs) => {
  const unique = [...new Set(
    (refs || []).map((r) => String(r || '').trim()).filter(Boolean),
  )];
  if (!unique.length) return null;
  const result = await query(
    `SELECT id, user_id, plan, amount_cents, currency, status, payment_provider, provider_ref, gateway_ref
       FROM subscription_payments
      WHERE provider_ref = ANY($1::text[]) OR gateway_ref = ANY($1::text[])
      ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, id DESC
      LIMIT 1`,
    [unique],
  );
  return result.rows[0] || null;
};

const rollbackPendingPaymentByRef = async (providerRef, paymentProvider) => {
  if (!providerRef) return;
  await query(
    `DELETE FROM subscription_payments
      WHERE provider_ref = $1 AND status = 'pending' AND payment_provider = $2`,
    [providerRef, paymentProvider],
  );
};

/** Aurax refs: UUID v4 or AXP-XXXXXXXX. Legacy Zeno refs `${user_id}_${epochMs}` route to Aurax. */
const isLikelyAuraxOrderRef = (orderId) => {
  const s = String(orderId || '').trim();
  if (/^AXP-[A-Z0-9]+$/i.test(s)) return true;
  if (/^\d+_\d{10,}$/.test(s)) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
};

/**
 * Routing rules (EaAdmin → app_settings.payment_provider):
 * - New payments: handlePaymentStart() uses ONLY getSelectedPaymentProvider() — never the URL path name.
 * - Status polling: prefer the payment row's payment_provider (set at start) so an admin toggle mid-checkout
 *   does not move an in-flight order to the wrong gateway.
 */
const resolveGatewayForOrderId = async (orderId) => {
  const selected = await getSelectedPaymentProvider();
  const fromRow = normalizeStoredPaymentProvider(await getPaymentProviderForOrder(orderId));
  if (fromRow) return fromRow;
  if (selected === PAYMENT_PROVIDERS.SONICPESA) {
    return PAYMENT_PROVIDERS.SONICPESA;
  }
  if (isLikelyAuraxOrderRef(orderId)) {
    return PAYMENT_PROVIDERS.AURAX;
  }
  return selected;
};

const TZ_VALID_PREFIXES = [
  '061', '062', '063', '065', '067', '068', '069', '071', '074', '075', '076', '077', '078', '079',
];

/**
 * Normalize any accepted TZ input to canonical local 0… (9 digits after 0).
 * Rejects non-Tanzania international numbers.
 */
const normalizePhoneToLocal0 = (rawPhone) => {
  let normalizedPhone = String(rawPhone || '').replace(/[\s\-()]/g, '');
  if (normalizedPhone.startsWith('+') && !normalizedPhone.startsWith('+255')) {
    return {
      error:
        'Malipo yanatumwa kwa nambari za simu za Tanzania pekee. Tumia muundo wa ndani unaoanza na 0 (mfano 0712345678).',
    };
  }
  if (normalizedPhone.startsWith('00') && !normalizedPhone.startsWith('00255')) {
    return {
      error:
        'Malipo yanatumwa kwa nambari za simu za Tanzania pekee. Tumia muundo wa ndani unaoanza na 0 (mfano 0712345678).',
    };
  }
  if (normalizedPhone.startsWith('+255')) {
    normalizedPhone = `0${normalizedPhone.slice(4)}`;
  } else if (normalizedPhone.startsWith('00255')) {
    normalizedPhone = `0${normalizedPhone.slice(5)}`;
  } else if (normalizedPhone.startsWith('255') && normalizedPhone.length >= 12) {
    normalizedPhone = `0${normalizedPhone.slice(3)}`;
  }
  if (/^[1-9]\d{8}$/.test(normalizedPhone)) {
    normalizedPhone = `0${normalizedPhone}`;
  }
  if (!/^\d+$/.test(normalizedPhone)) {
    return {
      error:
        'Nambari ya simu lazima iwe nambari ya Tanzania tu: anza kwa 0 (mfano 0712345678).',
    };
  }
  const isValidFormat = /^0[0-9]{8,9}$/.test(normalizedPhone);
  const hasValidPrefix = TZ_VALID_PREFIXES.some((prefix) => normalizedPhone.startsWith(prefix));
  if (!isValidFormat || !hasValidPrefix) {
    return {
      error:
        'Invalid Tanzanian phone number. Use format: 061–063 (Halotel), 065/067/071/077 (Tigo), 068–069/078 (Airtel), 074–076/079 (Vodacom); 9–10 digits after 0.',
    };
  }
  return { local: normalizedPhone };
};

/** Canonical storage + user-facing + ZenoPay: local 0… (e.g. 0631234567). */
const formatBuyerPhoneLocal = (local0) => {
  const norm = normalizePhoneToLocal0(local0);
  if (norm.local) return norm.local;
  const p = String(local0 || '').trim();
  return p.startsWith('0') ? p : p;
};

/**
 * SonicPesa API requires country code 255… (docs); users still type 0… in the app.
 * DB `buyer_phone` stays local — only the create_order payload uses 255….
 */
const formatPhoneForSonicPesaApi = (local0) => {
  if (String(process.env.SONIC_SEND_LOCAL_PHONE || '').trim() === '1') {
    return formatBuyerPhoneLocal(local0);
  }
  const local = formatBuyerPhoneLocal(local0);
  let intl = local;
  if (local.startsWith('0')) intl = `255${local.slice(1)}`;
  else if (local.startsWith('+255')) intl = local.slice(1);
  // Sonic docs: 255 + 9 digits (12 chars total)
  if (intl.startsWith('255') && intl.length > 12) intl = intl.slice(0, 12);
  return intl;
};

const isAirtelLocalPhone = (local0) => {
  const p = String(local0 || '');
  return p.startsWith('068') || p.startsWith('069') || p.startsWith('078');
};

const sonicPhoneCandidatesForApi = (normalizedPhone) => {
  const api255 = formatPhoneForSonicPesaApi(normalizedPhone);
  const local = formatBuyerPhoneLocal(normalizedPhone);
  // Halopesa (061–063) and Airtel (068–069, 078) often reject 255… on Sonic; try local 0… first.
  if (isHalotelLocalPhone(normalizedPhone) || isAirtelLocalPhone(normalizedPhone)) {
    return [...new Set([local, api255].filter(Boolean))];
  }
  return [...new Set([api255, local].filter((p) => p && p.length > 0))];
};

const isSonicInitiateSuccess = (sonicData, httpResponse) => {
  if (!sonicData || typeof sonicData !== 'object') return false;
  const st = String(sonicData.status || '').toLowerCase().trim();
  if (st === 'success') return true;
  if (sonicData.success === true) return true;
  const orderId =
    sonicData.data?.order_id ?? sonicData.data?.orderId ?? sonicData.order_id ?? sonicData.orderId;
  if (orderId && (httpResponse?.ok || st !== 'error')) return true;
  return false;
};

/** Sonic result codes / messages where STK/USSD was not delivered — safe to try Aurax Pay next. */
const SONIC_STK_FAILURE_CODES = new Set([
  '9012', '999', '103', '9009', '90009', '500', '502', '503', '504', '408', '429',
]);

const isSonicPaymentSendFailure = (rawMessage, rawCode) => {
  const msg = String(rawMessage || '').trim();
  const code = String(rawCode ?? '').trim();
  const combined = `${msg} ${code}`.toLowerCase();
  if (code && SONIC_STK_FAILURE_CODES.has(code)) return true;
  if (/^general system error/i.test(msg)) return true;
  if (/\b9012\b|\b999\b/.test(combined)) return true;
  if (/\bambiguous\b|\bfail\b|\berror\b/.test(combined) && /upstream|system|ussd|push|send|reponse|response/i.test(combined)) {
    return true;
  }
  return (
    /hayajatumika|malipo hayajatumika|hayajaweza kutumika|malipo hayajaweza kutumika|hayajaweza kutuma/i.test(
      combined,
    ) ||
    /not sent|could not send|push failed|failed to send|unable to send|cannot send|was not sent/i.test(
      combined,
    ) ||
    /no reponse from upstream|no response from upstream|upstream system|upstream/i.test(combined) ||
    /rejecting.*ussd|ongoing ussd|ussd session/i.test(combined)
  );
};

const isHalotelLocalPhone = (local0) => {
  const p = String(local0 || '');
  return p.startsWith('061') || p.startsWith('062') || p.startsWith('063');
};

const mapSonicInitiateUserError = (localPhone, rawMessage, rawCode, options = {}) => {
  const code = String(rawCode ?? '').trim();
  const msg = String(rawMessage || '').trim();
  if (options.auraxAlsoFailed) {
    return (
      'Hatukuweza kutuma ombi la malipo kwenye simu yako (SonicPesa na Aurax Pay). Hakikisha nambari ni sahihi, mtandao wa pesa unafanya kazi, na una salio la kutosha, kisha jaribu tena.'
    );
  }
  if (code === '103' || /ongoing ussd/i.test(msg)) {
    return 'Simu yako ina USSD nyingine zinazoendelea. Funga dirisha la malipo/USSD kwenye simu, subiri sekunde 30, kisha jaribu tena.';
  }
  if (isSonicPaymentSendFailure(rawMessage, rawCode)) {
    if (isHalotelLocalPhone(localPhone)) {
      return (
        'Halopesa (061–063) haikupokea ombi kupitia SonicPesa. Jaribu tena — mfumo utajaribu Aurax Pay kiotomatiki.'
      );
    }
    if (isAirtelLocalPhone(localPhone)) {
      return (
        'Airtel Money haikupokea ombi kupitia SonicPesa. Jaribu tena — mfumo utajaribu Aurax Pay kiotomatiki.'
      );
    }
    return (
      'Hatukuweza kutuma ombi la malipo kwenye simu yako. Hakikisha nambari ni sahihi na mtandao wa pesa unafanya kazi, kisha jaribu tena.'
    );
  }
  return mapPaymentGatewayUserError(rawMessage, rawCode, { context: 'initiate' });
};

const router = express.Router();

const AURAX_HTTP_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.AURAX_HTTP_TIMEOUT_MS) || 22000, 8000),
  55000,
);

/**
 * Aurax Pay buyerPhone: E.164 `+255XXXXXXXXX` for every channel (MPESA, TIGO_PESA, AIRTEL_MONEY, HALOPESA).
 * Local `0…` and bare `255…` (no `+`) are rejected by the API.
 * DB `buyer_phone` stays local `0…`.
 */
const formatPhoneForAuraxPayApi = (local0) => {
  const local = formatBuyerPhoneLocal(local0);
  if (local.startsWith('+255')) {
    const national = local.slice(4).replace(/\D/g, '').slice(0, 9);
    return national ? `+255${national}` : local;
  }
  let national = local.replace(/\D/g, '');
  if (national.startsWith('255') && national.length >= 12) {
    national = national.slice(3);
  }
  if (national.startsWith('0')) {
    national = national.slice(1);
  }
  national = national.slice(0, 9);
  return national ? `+255${national}` : local;
};

/** Aurax accepts only +255…; keep a single canonical candidate per MSISDN. */
const auraxPhoneCandidatesForApi = (normalizedPhone) => {
  const e164 = formatPhoneForAuraxPayApi(normalizedPhone);
  return e164.startsWith('+255') && e164.length >= 13 ? [e164] : [];
};

/** Map Tanzanian MSISDN prefix to Aurax channel enum. */
const resolveAuraxChannelFromPhone = (local0) => {
  const p = String(local0 || '');
  if (p.startsWith('061') || p.startsWith('062') || p.startsWith('063')) return 'HALOPESA';
  if (p.startsWith('074') || p.startsWith('075') || p.startsWith('076') || p.startsWith('079')) return 'MPESA';
  if (p.startsWith('071') || p.startsWith('065') || p.startsWith('067') || p.startsWith('077')) return 'TIGO_PESA';
  if (p.startsWith('068') || p.startsWith('069') || p.startsWith('078')) return 'AIRTEL_MONEY';
  return 'MPESA';
};

const isAuraxInitiateSuccess = (auraxData, httpResponse) => {
  if (!auraxData || typeof auraxData !== 'object') return false;
  if (auraxData.success === true && auraxData.transaction) return true;
  const tx = auraxData.transaction;
  if (tx && (tx.id || tx.reference)) return httpResponse?.ok !== false;
  return false;
};

const isRetriableAuraxInitiateFailure = (httpOk, auraxData, httpStatus) => {
  if (httpOk && auraxData?.success === true) return false;
  if (httpStatus >= 500 || httpStatus === 408 || httpStatus === 429) return true;
  const combined = `${auraxData?.message || ''} ${auraxData?.error || ''}`.toLowerCase();
  return /timeout|temporarily|unavailable|network|upstream|try again/i.test(combined);
};

const initiateAuraxPayment = async ({
  normalizedPhone,
  amountToSend,
  data,
  externalId,
  callbackUrl,
  orderId,
}) => {
  const channel = resolveAuraxChannelFromPhone(normalizedPhone);
  const phoneCandidates = auraxPhoneCandidatesForApi(normalizedPhone);
  const candidates = phoneCandidates.length > 0 ? phoneCandidates : [formatPhoneForAuraxPayApi(normalizedPhone)];

  const maxAttempts = 2;
  let last = {
    response: { ok: false, status: 500 },
    auraxData: { success: false, message: 'Failed to start payment request' },
    phoneUsed: candidates[0],
  };

  for (const phoneForAurax of candidates) {
    const payload = {
      amount: amountToSend,
      currency: 'TZS',
      channel,
      buyerPhone: phoneForAurax,
      buyerName: data.name || externalId || 'EaMax User',
      buyerEmail: data.email || 'user@eamax.app',
      description: `EaMax ${data.bundle || 'subscription'}`,
      callbackUrl,
      metadata: {
        orderId,
        externalId,
        bundle: data.bundle || null,
      },
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { response, data: auraxData } = await gatewayFetchJson(
          `${AURAXPAY_API_BASE}/payments`,
          {
            method: 'POST',
            headers: getAuraxPayRequestHeaders(),
            body: JSON.stringify(payload),
          },
          AURAX_HTTP_TIMEOUT_MS,
        );
        last = { response, auraxData, phoneUsed: phoneForAurax };
        if (isAuraxInitiateSuccess(auraxData, response)) return last;
        if (
          attempt < maxAttempts &&
          isRetriableAuraxInitiateFailure(response.ok, auraxData, response.status)
        ) {
          console.warn('[AuraxPay] Retrying initiate', { attempt, phone: phoneForAurax, channel });
          continue;
        }
        break;
      } catch (fetchErr) {
        last = {
          response: { ok: false, status: 502 },
          auraxData: { success: false, message: String(fetchErr?.message || fetchErr || 'network') },
          phoneUsed: phoneForAurax,
        };
        if (attempt < maxAttempts) continue;
        break;
      }
    }

    if (isAuraxInitiateSuccess(last.auraxData, last.response)) return last;

    const errText = `${last.auraxData?.message || ''} ${last.auraxData?.error || ''}`.toLowerCase();
    const looksLikePhoneReject =
      /phone|msisdn|mobile|number|invalid.*buyer|buyerphone/i.test(errText) ||
      last.response?.status === 400 ||
      last.response?.status === 422;
    if (looksLikePhoneReject && candidates.length > 1) {
      console.warn('[AuraxPay] Phone format rejected — trying next candidate', {
        tried: phoneForAurax,
        channel,
      });
      continue;
    }
    break;
  }
  return last;
};

const pollAuraxOrderStatus = async (orderId) => {
  try {
    const { response, data: statusData } = await gatewayFetchJson(
      `${AURAXPAY_API_BASE}/payments/${encodeURIComponent(orderId)}`,
      {
        method: 'GET',
        headers: getAuraxPayRequestHeaders(),
      },
      AURAX_HTTP_TIMEOUT_MS,
    );
    return { statusResp: response, statusData };
  } catch (fetchErr) {
    return {
      statusResp: { ok: false, status: 502 },
      statusData: { success: false, message: String(fetchErr?.message || fetchErr || 'network') },
    };
  }
};

const extractAuraxPaymentStatus = (statusData) => {
  if (!statusData || typeof statusData !== 'object') return '';
  const tx = statusData.transaction;
  const nest = statusData.data && typeof statusData.data === 'object' ? statusData.data : null;
  const nestTx = nest?.transaction && typeof nest.transaction === 'object' ? nest.transaction : null;
  // Prefer wallet/payment fields over generic status (SUCCESS often means query OK).
  const paymentCandidates = [
    tx?.paymentStatus,
    tx?.payment_status,
    nestTx?.paymentStatus,
    nestTx?.payment_status,
    statusData.paymentStatus,
    statusData.payment_status,
    tx?.collectionStatus,
    tx?.collection_status,
    nestTx?.collectionStatus,
    nestTx?.collection_status,
  ];
  const genericCandidates = [
    tx?.status,
    tx?.state,
    nestTx?.status,
    nest?.status,
    statusData.status,
    statusData.state,
    tx?.result,
    nestTx?.result,
  ];
  const toUpperList = (list) => {
    const out = [];
    for (const c of list) {
      if (c != null && typeof c !== 'object') {
        const s = String(c).toUpperCase().trim();
        if (s) out.push(s);
      }
    }
    return out;
  };
  const paymentFound = toUpperList(paymentCandidates);
  for (const s of paymentFound) {
    if (isAuraxPaidRaw(s)) return s;
  }
  // Explicit unpaid paymentStatus wins over a generic SUCCESS on the envelope.
  if (paymentFound.some((s) => AURAX_EXPLICIT_UNPAID_STATUSES.has(s))) {
    return paymentFound.find((s) => AURAX_EXPLICIT_UNPAID_STATUSES.has(s)) || paymentFound[0] || '';
  }
  const genericFound = toUpperList(genericCandidates);
  for (const s of genericFound) {
    if (isAuraxPaidRaw(s)) return s;
  }
  return paymentFound[0] || genericFound[0] || '';
};

const isAuraxPaidRaw = (rawUpper) => {
  if (!rawUpper) return false;
  const u = String(rawUpper).toUpperCase().trim();
  if (AURAX_EXPLICIT_UNPAID_STATUSES.has(u)) return false;
  // Bare SUCCESS/OK = STK or HTTP ack, not wallet debit.
  if (u === 'SUCCESS' || u === 'OK') return false;
  if (AURAX_WEBHOOK_PAID_STATUSES.has(u)) return true;
  if (/^(SUCCESSFUL|COLLECTED|PAID_OUT|PAYMENT_COMPLETED|TRANSACTION_SUCCESS|PAYMENT_SUCCESS)/.test(u)) {
    return true;
  }
  const lower = u.toLowerCase();
  return lower === 'successful' || lower === 'true' || lower === '1';
};

/** Normalize poll/webhook payloads so transaction lives at a consistent path. */
const normalizeAuraxStatusPayload = (statusData) => {
  if (!statusData || typeof statusData !== 'object') return statusData;
  const dataObj =
    statusData.data && typeof statusData.data === 'object' && !Array.isArray(statusData.data)
      ? statusData.data
      : null;
  const tx =
    statusData.transaction ||
    dataObj?.transaction ||
    (dataObj && (dataObj.id || dataObj.reference || dataObj.status || dataObj.paymentStatus)
      ? dataObj
      : null);
  return tx ? { ...statusData, transaction: tx } : statusData;
};

const evaluateAuraxOrderStatusForApply = (statusData) => {
  const normalized = normalizeAuraxStatusPayload(statusData);
  const tx = normalized?.transaction;
  const rawStatus = extractAuraxPaymentStatus(normalized);
  let isCompleted = isAuraxPaidRaw(rawStatus);
  // Do not treat envelope success:true + status SUCCESS as paid — that is often
  // "request accepted". Only trust explicit payment fields / completion events.
  if (!isCompleted && normalized?.success === true) {
    const nested = extractAuraxPaymentStatus({ transaction: tx });
    if (isAuraxPaidRaw(nested)) isCompleted = true;
  }
  const ev = String(normalized?.event || normalized?.type || '').toLowerCase().trim();
  if (!isCompleted && ev) {
    isCompleted =
      ev === 'payment.completed' ||
      ev === 'payment.success' ||
      ev === 'payment_completed' ||
      ev === 'transaction.completed' ||
      ev === 'collection.completed';
  }
  return { isCompleted, rawStatus, transaction: tx || null };
};

const collectAuraxOrderRefs = (payload) => {
  const tx = payload?.transaction || payload?.data?.transaction || payload?.data;
  const nest = tx && typeof tx === 'object' ? tx : null;
  const meta = nest?.metadata || payload?.metadata || payload?.data?.metadata || {};
  const refs = new Set();
  for (const v of [
    meta?.orderId,
    meta?.order_id,
    nest?.orderId,
    nest?.order_id,
    payload?.orderId,
    payload?.order_id,
    nest?.id,
    nest?.reference,
    payload?.id,
    payload?.reference,
    payload?.transactionId,
    payload?.transaction_id,
    payload?.data?.id,
    payload?.data?.reference,
    meta?.reference,
  ]) {
    const s = String(v || '').trim();
    if (s) refs.add(s);
  }
  return [...refs];
};

/** Prefer client orderId (provider_ref) over gateway transaction id for completion. */
const pickPreferredAuraxOrderId = (allRefs, payload) => {
  const tx = payload?.transaction || payload?.data?.transaction || payload?.data;
  const meta = tx?.metadata || payload?.metadata || payload?.data?.metadata || {};
  const fromMeta = String(meta.orderId || meta.order_id || '').trim();
  if (fromMeta) return fromMeta;
  const fromPayload = String(payload?.orderId || payload?.order_id || '').trim();
  if (fromPayload) return fromPayload;
  const clientUuid = (allRefs || []).find((r) => isLikelyAuraxOrderRef(r) && !/^AXP-/i.test(r));
  if (clientUuid) return clientUuid;
  return (allRefs && allRefs[0]) || null;
};

const extractAuraxWebhookOrderAndPaid = (payload) => {
  const allRefs = collectAuraxOrderRefs(payload);
  const orderId = pickPreferredAuraxOrderId(allRefs, payload);
  const { isCompleted, rawStatus } = evaluateAuraxOrderStatusForApply(payload);
  return { orderId, allRefs, paid: isCompleted, raw: rawStatus };
};

/** Apply Aurax completion; poll gateway when webhook refs do not match DB yet (gateway_ref race). */
const tryApplyAuraxCompletedPayment = async (orderId, meta, { altRefs = [] } = {}) => {
  const refs = [...new Set([orderId, ...(altRefs || [])].map((r) => String(r || '').trim()).filter(Boolean))];
  let result = await applyCompletedPayment(orderId, meta, {
    expectedPaymentProvider: PAYMENT_PROVIDERS.AURAX,
    altRefs: refs,
  });
  if (result) return result;

  for (const ref of refs) {
    try {
      const { statusResp, statusData } = await pollAuraxOrderStatus(ref);
      if (!statusResp.ok) continue;
      const { isCompleted, transaction } = evaluateAuraxOrderStatusForApply(statusData);
      if (!isCompleted) continue;
      const pollRefs = collectAuraxOrderRefs(statusData);
      const pollOrderId = pickPreferredAuraxOrderId(pollRefs, statusData) || orderId || ref;
      const pollAltRefs = [...new Set([...refs, ...pollRefs, ref])];
      const gatewayId = String(transaction?.id || transaction?.reference || ref).trim();
      if (gatewayId) {
        await query(
          `UPDATE subscription_payments
              SET gateway_ref = $1
            WHERE provider_ref = $2
              AND status = 'pending'
              AND payment_provider = $3
              AND (gateway_ref IS NULL OR gateway_ref = '')`,
          [gatewayId, pollOrderId, PAYMENT_PROVIDERS.AURAX],
        ).catch(() => {});
      }
      result = await applyCompletedPayment(pollOrderId, transaction || statusData || meta, {
        expectedPaymentProvider: PAYMENT_PROVIDERS.AURAX,
        altRefs: pollAltRefs,
      });
      if (result) return result;
    } catch (pollErr) {
      console.warn('[AuraxPay] Gateway poll fallback failed for ref:', ref, pollErr?.message || pollErr);
    }
  }
  return null;
};

const SONIC_HTTP_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.SONIC_HTTP_TIMEOUT_MS) || 22000, 8000),
  55000,
);

const isSonicPaidRaw = (rawUpper) => {
  if (!rawUpper) return false;
  const u = String(rawUpper).toUpperCase().trim();
  if (SONIC_EXPLICIT_UNPAID_STATUSES.has(u)) return false;
  // `OK` is commonly the gateway's request acknowledgement, not proof that a
  // wallet debit completed. Only explicit completed/paid statuses may grant.
  if (u === 'OK') return false;
  if (SONIC_WEBHOOK_PAID_STATUSES.has(u)) return true;
  if (/^(SUCCESSFUL|COLLECTED|PAID_OUT|PAYMENT_COMPLETED|TRANSACTION_SUCCESS)/.test(u)) return true;
  const lower = u.toLowerCase();
  return lower === 'successful';
};

const extractSonicPaymentStatus = (statusData) => {
  if (!statusData || typeof statusData !== 'object') return '';
  const d = statusData.data;
  const nest = Array.isArray(d) ? d[0] : d && typeof d === 'object' ? d : null;
  const candidates = [
    nest?.payment_status,
    nest?.paymentStatus,
    nest?.status,
    statusData.payment_status,
    statusData.paymentStatus,
    statusData.status,
  ];
  const found = [];
  for (const c of candidates) {
    if (c != null && typeof c !== 'object') {
      const s = String(c).toUpperCase().trim();
      if (s) found.push(s);
    }
  }
  for (const s of found) {
    if (isSonicPaidRaw(s)) return s;
  }
  return found[0] || '';
};

const gatewayFetchJson = async (url, options = {}, timeoutMs = 18000) => {
  const ms = Math.min(Math.max(Number(timeoutMs) || 18000, 5000), 55000);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const response = await fetch(url, { ...options, signal: ac.signal });
    const text = await response.text();
    let data = {};
    try {
      if (text && text.trim()) data = JSON.parse(text);
    } catch (_) {
      data = { status: 'error', message: text ? text.slice(0, 500) : 'Invalid gateway response' };
    }
    return { response, data, text };
  } finally {
    clearTimeout(timer);
  }
};

const allowPaymentTestComplete = () =>
  String(process.env.PAYMENT_ALLOW_TEST_COMPLETE || '').trim() === '1';

const fetchUserPremiumSnapshotForOrder = async (orderId) => {
  const r = await query(
    `SELECT u.id AS user_id
       FROM subscription_payments sp
       JOIN users u ON u.id = sp.user_id
      WHERE sp.provider_ref = $1 OR sp.gateway_ref = $1
      LIMIT 1`,
    [orderId],
  );
  if (r.rows.length === 0) return null;
  return fetchUserPremiumSnapshotByUserId(r.rows[0].user_id);
};

const buildCompletedStatusPayload = async (orderId, rawPayload) => {
  const user = await fetchUserPremiumSnapshotForOrder(orderId);
  return {
    status: 'COMPLETED',
    raw: rawPayload || { data: [{ payment_status: 'COMPLETED' }] },
    ...(user ? { user } : {}),
  };
};

/**
 * Insufficient-balance mapping must stay strict: broad patterns like `salio.*hali` false-positive on
 * Halotel/Sonic messages such as “Salio la akaunti halipo…” (account/state), not low balance.
 * Sonic sometimes appends `90009` without a separator: `...payment90009`.
 */
const extractPoorBalanceCodes = (msg, code, combined) => {
  const bucket = `${String(code || '')} ${String(msg || '')} ${String(combined || '')}`;
  const hits = new Set();
  if (/\b90009\b|payment\s*90009/i.test(bucket)) hits.add('90009');
  if (/\b9009\b/.test(bucket) && !/\b90009\b|payment\s*90009/i.test(bucket)) hits.add('9009');
  if (String(code || '').trim() === '90009') hits.add('90009');
  if (String(code || '').trim() === '9009') hits.add('9009');
  return [...hits];
};

const looksLikeInsufficientBalance = (msg, code, combined) => {
  if (
    /\b(?:not enough|insufficient funds?|insufficient balance|low balance|balance of customer is not enough)\b/i.test(
      combined,
    )
  ) {
    return true;
  }
  if (/\bhaiatoshi\b|\bhalitoshi\b|\bhatoshi\b|\bhaatoshi\b/i.test(combined)) return true;
  if (/\bsalio\s+(?:dogo|chache)\b/i.test(combined)) return true;
  const poorCodes = extractPoorBalanceCodes(msg, code, combined);
  if (poorCodes.length === 0) return false;
  const m = String(msg || '').trim();
  const balanceHint =
    /\b(?:not enough|insufficient funds?|insufficient balance|low balance|balance of customer is not enough|haiatoshi|halitoshi|hatoshi)\b/i.test(
      combined,
    ) || /\b(?:salio|pesa)\b.*\b(?:dogo|chache|kidogo|haitoshi|halitoshi)\b/i.test(combined);
  if (balanceHint || m.length <= 2) return true;
  return false;
};

/** Gateway explicit “not enough balance” wording (initiate) — translate without sounding like a blind app guess. */
const isExplicitGatewayInsufficientReport = (msg, combined, code) => {
  if (/\bbalance of customer is not enough\b/i.test(combined)) return true;
  if (/\binsufficient (?:funds|balance)\b/i.test(combined)) return true;
  if (/\bnot enough (?:money|funds|balance)\b/i.test(combined)) return true;
  if (/\b90009\b|payment\s*90009/i.test(combined)) return true;
  const c = String(code || '').trim();
  if (c === '9009' || c === '90009') return true;
  return false;
};

const swahiliInitiateInsufficientFromProvider = (msg, code) => {
  const codes = extractPoorBalanceCodes(msg, code, `${msg} ${code}`.toLowerCase());
  const codeLabel = codes.includes('90009') ? '90009' : codes.includes('9009') ? '9009' : codes[0] || '';
  const tail = codeLabel ? ` (msimbo ${codeLabel})` : '';
  return (
    `Mtoa huduma wa malipo alikataa ombi kabla ya hatua ya PIN: alisema salio halitoshi kwa kiasi hicho${tail}. ` +
    'Ikiwa una salio la kutosha, jaribu tena baada ya dakika 1–2, au wasiliana na mtoa huduma wa malipo / kampuni ya simu yako.'
  );
};

/** User-facing Swahili text; keeps support logs in server console via raw gateway payloads.
 * @param {{ context?: 'initiate' | 'default' }} [options] — `initiate` = create/start STK (no PIN yet); never imply “salio” from heuristics alone.
 */
const mapPaymentGatewayUserError = (rawMessage, rawCode, options = {}) => {
  const context = options.context === 'initiate' ? 'initiate' : 'default';
  const msg = String(rawMessage || '').trim();
  const code = rawCode != null && rawCode !== '' ? String(rawCode).trim() : '';
  const combined = `${msg} ${code}`.toLowerCase();

  if (looksLikeInsufficientBalance(msg, code, combined)) {
    if (context === 'initiate') {
      if (isExplicitGatewayInsufficientReport(msg, combined, code)) {
        return swahiliInitiateInsufficientFromProvider(msg, code);
      }
      return (
        msg ||
        'Hatukuweza kutuma ombi la malipo kwenye mtandao wa simu. Hakikisha namba ni sahihi na mtandao unaendana na malipo, kisha jaribu tena.'
      );
    }
    return 'Salio la wallet yako si la kutosha kwa kiasi hiki. Ongeza pesa kwenye akaunti yako ya simu (M-Pesa, Halopesa, Tigopesa, Airtel Money, n.k.) kisha ujaribu tena.';
  }
  if (
    /upstream|no response from upstream|hayajatumika|malipo hayajatumika|timeout|timed out|could not reach|temporarily unavailable|service unavailable/.test(
      combined,
    ) ||
    /exception.*upstream/i.test(msg) ||
    /\babort(ed)?\b/i.test(msg)
  ) {
    return 'Mtandao wa pesa ulikawia kuthibitisha ombi. Hakikisha una mtandao mzuri wa simu na nambari sahihi ya malipo. Jaribu tena; ikiendelea subiri dakika 2–5 kisha ujaribu.';
  }
  if (/denied|declined|rejected|invalid pin|wrong pin|incorrect pin/i.test(msg)) {
    return 'Muamala haukuidhinishwa kwenye simu (PIN au hatua ya USSD). Jaribu tena ukiangalia maelekezo kwa makini.';
  }
  return msg || 'Malipo hayajaweza kuanza. Jaribu tena baada ya muda mfupi.';
};

/** Gateway ended without pay — stop app polling; only user cancel gets a soft message. */
const PAYMENT_TERMINAL_STATUSES = new Set([
  'FAILED', 'CANCELLED', 'CANCELED', 'REJECTED', 'DECLINED', 'EXPIRED', 'TIMEOUT', 'ERROR', 'VOID',
  'REVERSED', 'CANCEL',
]);

const isPaymentTerminalStatus = (raw) => {
  const u = String(raw || '').toUpperCase().trim();
  return Boolean(u && PAYMENT_TERMINAL_STATUSES.has(u));
};

const isPaymentCancelledStatus = (raw) => {
  const u = String(raw || '').toUpperCase().trim();
  return u === 'CANCELLED' || u === 'CANCELED' || u === 'CANCEL' || u === 'VOID';
};

const mapTerminalStatusUserMessage = (raw) => {
  if (isPaymentCancelledStatus(raw)) {
    return 'Ulighairi malipo kwenye simu. Unaweza kujaribu tena ukiwa tayari.';
  }
  const u = String(raw || '').toUpperCase().trim();
  if (u === 'EXPIRED' || u === 'TIMEOUT') {
    return 'Muda wa malipo umeisha. Tafadhali tuma ombi jipya na ukamilishe kwenye simu haraka.';
  }
  if (u === 'REJECTED' || u === 'DECLINED') {
    return 'Malipo hayakuidhinishwa kwenye simu. Hakikisha una salio la kutosha kisha ujaribu tena.';
  }
  return 'Malipo hayajakamilika. Jaribu tena baada ya muda mfupi.';
};

const markOrderTerminalIfPending = async (orderId, rawStatus) => {
  if (!isPaymentTerminalStatus(rawStatus)) return;
  await query(
    `UPDATE subscription_payments
        SET status = 'failed'
      WHERE (provider_ref = $1 OR gateway_ref = $1) AND status = 'pending'`,
    [orderId],
  );
};

const isActivePaymentProviderConfigured = (provider) => {
  if (provider === PAYMENT_PROVIDERS.SONICPESA) return Boolean(SONICPESA_API_KEY);
  return Boolean(AURAXPAY_API_KEY);
};

/** Optional legacy escape hatch — disabled unless ALLOW_SONIC_AURAX_FALLBACK=1 on Railway. */
const shouldFallbackSonicToAurax = (rawMessage, rawCode) =>
  isSonicAuraxFallbackAllowed() &&
  isSonicPaymentSendFailure(rawMessage, rawCode) &&
  isActivePaymentProviderConfigured(PAYMENT_PROVIDERS.AURAX);

const initiateSonicPayment = async ({ normalizedPhone, amountToSend, data, externalId }) => {
  const phoneLocal = formatBuyerPhoneLocal(normalizedPhone);
  const candidates = sonicPhoneCandidatesForApi(normalizedPhone);
  let last = {
    response: { ok: false, status: 500 },
    sonicData: { status: 'error', message: 'Failed to start SonicPesa payment' },
    phoneLocal,
    phoneForSonicApi: candidates[0] || phoneLocal,
  };

  for (const phoneForSonicApi of candidates) {
    const sonicPayload = {
      buyer_email: data.email || 'user@eamax.app',
      buyer_name: data.name || externalId,
      buyer_phone: phoneForSonicApi,
      amount: amountToSend,
      currency: 'TZS',
    };
    try {
      const { response, data: sonicData } = await gatewayFetchJson(
        `${SONICPESA_API_BASE}/payment/create_order`,
        {
          method: 'POST',
          headers: getSonicPesaRequestHeaders(),
          body: JSON.stringify(sonicPayload),
        },
        SONIC_HTTP_TIMEOUT_MS,
      );
      last = { response, sonicData, phoneLocal, phoneForSonicApi };
      if (isSonicInitiateSuccess(sonicData, response)) {
        return last;
      }
      console.warn('[SonicPesa] create_order attempt failed:', {
        phoneForSonicApi,
        httpStatus: response.status,
        sonicStatus: sonicData?.status,
        message: sonicData?.message || sonicData?.error,
      });
    } catch (fetchErr) {
      last = {
        response: { ok: false, status: 502 },
        sonicData: { status: 'error', message: String(fetchErr?.message || fetchErr || 'network') },
        phoneLocal,
        phoneForSonicApi,
      };
    }
  }
  return last;
};

const pollSonicOrderStatus = async (orderId) => {
  try {
    const { response, data: statusData } = await gatewayFetchJson(
      `${SONICPESA_API_BASE}/payment/order_status`,
      {
        method: 'POST',
        headers: getSonicPesaRequestHeaders(),
        body: JSON.stringify({ order_id: orderId }),
      },
      SONIC_HTTP_TIMEOUT_MS,
    );
    return { statusResp: response, statusData };
  } catch (fetchErr) {
    return {
      statusResp: { ok: false, status: 502 },
      statusData: { status: 'error', message: String(fetchErr?.message || fetchErr || 'network') },
    };
  }
};

// Mobile money start: `/start` and legacy `/aurax/start` share this handler.
// Active gateway for NEW payments is ONLY `app_settings.payment_provider` (never inferred from the URL path).
async function handlePaymentStart(req, res, next) {
  try {
    const bodySchema = z
      .object({
        externalId: z.string().min(1),
        bundle: z.string().min(1).max(32).optional(),
        promotionId: z.coerce.number().int().positive().optional(),
        amount: z.number().int().min(1).optional(),
        phone: z.string().min(9).max(15),
        email: z.string().email().optional(),
        name: z.string().optional(),
      })
      .refine((d) => d.promotionId != null || d.bundle != null, {
        message: 'bundle or promotionId required',
      });

    const data = bodySchema.parse(req.body);

    const phoneNorm = normalizePhoneToLocal0(data.phone);
    if (phoneNorm.error) {
      return res.status(400).json({ error: phoneNorm.error });
    }
    const normalizedPhone = phoneNorm.local;

    // Ensure user row exists (apps sometimes open Pay before /register finishes; Zeno STK can still fire).
    let userRes = await query('SELECT id FROM users WHERE external_id = $1', [data.externalId]);
    if (userRes.rows.length === 0) {
      await query(
        `INSERT INTO users (external_id) VALUES ($1)
         ON CONFLICT (external_id) DO NOTHING`,
        [data.externalId],
      );
      userRes = await query('SELECT id FROM users WHERE external_id = $1', [data.externalId]);
    }
    if (userRes.rows.length === 0) {
      return res.status(500).json({ error: 'Could not resolve user for payment' });
    }
    const userId = userRes.rows[0].id;

    let planKey;
    let amountToSend;

    if (data.promotionId) {
      const promoRes = await query(
        `SELECT id, type, is_active, offer_amount_tsh, offer_period_days,
                offer_countdown_minutes, target_audience
           FROM promotions WHERE id = $1 LIMIT 1`,
        [data.promotionId],
      );
      if (!promoRes.rows.length) {
        return res.status(404).json({ error: 'Ofa haipatikani' });
      }
      const promo = promoRes.rows[0];
      const promoType = String(promo.type || '').toLowerCase();
      if (promoType !== 'ofa' || promo.is_active !== true) {
        return res.status(400).json({ error: 'Hii si ofa halali' });
      }
      const countdownMinutes = Number(promo.offer_countdown_minutes) || 0;
      if (countdownMinutes > 0) {
        const viewRes = await query(
          `SELECT MIN(created_at) AS first_view
             FROM promotion_events
            WHERE promotion_id = $1
              AND external_id = $2
              AND event_type = 'view'`,
          [promo.id, data.externalId],
        );
        const firstView = viewRes.rows[0]?.first_view;
        if (!firstView) {
          return res.status(400).json({ error: 'Ofa imekwisha' });
        }
        const end = new Date(new Date(firstView).getTime() + countdownMinutes * 60 * 1000);
        if (!Number.isNaN(end.getTime()) && end < new Date()) {
          return res.status(400).json({ error: 'Ofa imekwisha' });
        }
      }
      const offerAmount = Number(promo.offer_amount_tsh);
      const offerDays = Number(promo.offer_period_days);
      if (!offerAmount || !offerDays) {
        return res.status(400).json({ error: 'Ofa haijasanidi vizuri' });
      }
      if (data.amount != null && data.amount !== offerAmount) {
        return res.status(400).json({
          error: `Kiasi cha ofa ni Tsh ${offerAmount}.`,
        });
      }
      planKey = `offer:${offerDays}`;
      amountToSend = offerAmount;
    } else {
      const planInfo = await getPlanPaymentInfo(data.bundle);
      if (!planInfo) {
        return res.status(400).json({ error: 'Invalid bundle plan' });
      }
      if (data.amount != null && data.amount !== planInfo.amount) {
        return res.status(400).json({
          error: `Amount for ${data.bundle} must be ${planInfo.amount} TZS.`,
        });
      }
      planKey = data.bundle;
      amountToSend = data.amount != null ? data.amount : planInfo.amount;
    }

    const orderId = crypto.randomUUID();
    console.log('[Backend] Generated payment orderId:', orderId);

    const selectedProvider = await getSelectedPaymentProvider();
    const provider = selectedProvider === PAYMENT_PROVIDERS.SONICPESA
      ? PAYMENT_PROVIDERS.SONICPESA
      : PAYMENT_PROVIDERS.AURAX;
    const rawSetting = await getAppSettingValue(PAYMENT_PROVIDER_SETTING_KEY, PAYMENT_PROVIDERS.AURAX);
    console.log('[Payment] /start app_settings.payment_provider raw:', rawSetting, '→ gateway:', provider);

    const buyerPhoneLocal = normalizedPhone;
    let providerResponseMessage = 'Request in progress. You will receive a prompt on your phone.';

    const auraxReady = isActivePaymentProviderConfigured(PAYMENT_PROVIDERS.AURAX);
    const sonicReady = isActivePaymentProviderConfigured(PAYMENT_PROVIDERS.SONICPESA);
    if (provider === PAYMENT_PROVIDERS.SONICPESA && !sonicReady && !auraxReady) {
      return res.status(503).json({
        error: 'SonicPesa na Aurax Pay hazijasanidi kwenye seva. Wasiliana na admin.',
        activeProvider: provider,
        configured: false,
      });
    }
    if (provider === PAYMENT_PROVIDERS.AURAX && !auraxReady) {
      return res.status(503).json({
        error: 'Aurax Pay haijasanidi kwenye seva. Wasiliana na admin au chagua SonicPesa kwenye EaAdmin.',
        activeProvider: provider,
        configured: false,
      });
    }
    let paymentProviderForRow = provider;
    let usedAuraxFallbackFromSonic = false;
    let sonicFailureForClient = null;

    if (provider === PAYMENT_PROVIDERS.SONICPESA && !sonicReady) {
      if (auraxReady && isSonicAuraxFallbackAllowed()) {
        console.warn('[Payment] SonicPesa not configured — using Aurax Pay (ALLOW_SONIC_AURAX_FALLBACK=1)');
        paymentProviderForRow = PAYMENT_PROVIDERS.AURAX;
      } else {
        return res.status(503).json({
          error:
            'SonicPesa imewashwa kwenye admin lakini SONICPESA_API_KEY haipo kwenye seva. Weka funguo kwenye Railway.',
          activeProvider: provider,
          configured: false,
        });
      }
    }

    const skipSonicForHalotel =
      paymentProviderForRow === PAYMENT_PROVIDERS.SONICPESA &&
      isHalotelLocalPhone(normalizedPhone) &&
      auraxReady;

    const skipSonicForAirtel =
      paymentProviderForRow === PAYMENT_PROVIDERS.SONICPESA &&
      isAirtelLocalPhone(normalizedPhone) &&
      auraxReady;

    if (skipSonicForHalotel || skipSonicForAirtel) {
      const carrier = skipSonicForHalotel ? 'Halopesa (061–063)' : 'Airtel Money (068–069, 078)';
      console.log(`[Payment] ${carrier} — routing to Aurax Pay (+255 E.164)`);
      paymentProviderForRow = PAYMENT_PROVIDERS.AURAX;
      usedAuraxFallbackFromSonic = true;
    } else if (paymentProviderForRow === PAYMENT_PROVIDERS.SONICPESA) {
      ensureSonicPesaConfigured();
      if (!SONICPESA_SECRET_KEY) {
        console.warn(
          '[SonicPesa] SONICPESA_SECRET_KEY not set — some accounts require X-SECRET-KEY (see SonicPesa dashboard).',
        );
      }

      // eslint-disable-next-line no-console
      console.log('[SonicPesa] Sending payment request:', {
        orderId,
        phoneLocal: normalizedPhone,
        phoneCandidates: sonicPhoneCandidatesForApi(normalizedPhone),
        amount: amountToSend,
        bundle: planKey,
        hasSecretKey: Boolean(SONICPESA_SECRET_KEY),
      });

      const { response, sonicData, phoneForSonicApi } = await initiateSonicPayment({
        normalizedPhone,
        amountToSend,
        data,
        externalId: data.externalId,
      });
      // eslint-disable-next-line no-console
      console.log('[SonicPesa] Response:', {
        status: response.status,
        sonicStatus: sonicData?.status,
        phoneForSonicApi,
        sonicData,
      });

      if (isSonicInitiateSuccess(sonicData, response)) {
        const sonicOrderId = String(
          sonicData.data?.order_id ?? sonicData.data?.orderId ?? sonicData.order_id ?? sonicData.orderId ?? '',
        ).trim();
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
          [userId, planKey, amountToSend, 'TZS', 'pending', sonicOrderId, PAYMENT_PROVIDERS.SONICPESA, buyerPhoneLocal],
        );

        return res.json({
          status: 'pending',
          orderId: sonicOrderId,
          message: providerResponseMessage,
          provider: PAYMENT_PROVIDERS.SONICPESA,
          activeProvider: provider,
        });
      }

      const rawErr = sonicData.message || sonicData.error || 'Failed to start SonicPesa payment';
      const rawCode = sonicData.resultcode || sonicData.code;
      console.warn('[SonicPesa] Initiate failed:', {
        phoneLocal: normalizedPhone,
        phoneForSonicApi,
        status: response.status,
        message: rawErr,
        resultcode: rawCode,
      });

      sonicFailureForClient = { message: rawErr, code: rawCode, sonicData };

      if (shouldFallbackSonicToAurax(rawErr, rawCode)) {
        console.warn('[Payment] SonicPesa STK not sent — falling back to Aurax Pay for this payment', {
          phonePrefix: normalizedPhone.slice(0, 3),
          resultcode: rawCode,
        });
        paymentProviderForRow = PAYMENT_PROVIDERS.AURAX;
        usedAuraxFallbackFromSonic = true;
      } else {
        return res.status(400).json({
          error: mapSonicInitiateUserError(normalizedPhone, rawErr, rawCode),
          sonicResponse: sonicData,
        });
      }
    }

    ensureAuraxPayConfigured();

    const callbackUrl =
      process.env.AURAXPAY_WEBHOOK_URL ||
      `${process.env.PUBLIC_BASE_URL || 'https://eamax-production.up.railway.app'}/api/payments/aurax/webhook`;
    console.log(`[Backend] Using Aurax webhook URL: ${callbackUrl}`);

    // Insert pending row BEFORE gateway call (Zeno pattern) — webhooks can arrive quickly.
    await query(
      `INSERT INTO subscription_payments (user_id, plan, amount_cents, currency, status, provider_ref, gateway_ref, payment_provider, buyer_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [userId, planKey, amountToSend, 'TZS', 'pending', orderId, null, paymentProviderForRow, buyerPhoneLocal],
    );

    const phoneForAurax = formatPhoneForAuraxPayApi(normalizedPhone);
    console.log('[AuraxPay] Sending payment request:', {
      orderId,
      phone: phoneForAurax,
      phoneCandidates: auraxPhoneCandidatesForApi(normalizedPhone),
      channel: resolveAuraxChannelFromPhone(normalizedPhone),
      amount: amountToSend,
      bundle: planKey,
    });

    const { response, auraxData, phoneUsed } = await initiateAuraxPayment({
      orderId,
      normalizedPhone,
      amountToSend,
      data: { ...data, bundle: planKey },
      externalId: data.externalId,
      callbackUrl,
    });

    console.log('[AuraxPay] Response:', {
      status: response.status,
      success: auraxData.success,
      message: auraxData.message,
      transactionId: auraxData.transaction?.id || null,
      transactionRef: auraxData.transaction?.reference || null,
      phoneUsed,
    });

    if (!isAuraxInitiateSuccess(auraxData, response)) {
      await rollbackPendingPaymentByRef(orderId, paymentProviderForRow);
      const rawError =
        auraxData.message ||
        auraxData.error ||
        (auraxData.details ? JSON.stringify(auraxData.details) : '') ||
        'Failed to start payment request';
      const auraxMapped = mapPaymentGatewayUserError(rawError, '', { context: 'initiate' });
      if (usedAuraxFallbackFromSonic && sonicFailureForClient) {
        return res.status(400).json({
          error: mapSonicInitiateUserError(
            normalizedPhone,
            sonicFailureForClient.message,
            sonicFailureForClient.code,
            { auraxAlsoFailed: true },
          ),
          detail: auraxMapped,
          sonicResponse: sonicFailureForClient.sonicData,
          auraxResponse: auraxData,
        });
      }
      return res.status(400).json({
        error: auraxMapped,
        auraxResponse: auraxData,
      });
    }

    const auraxTx = auraxData.transaction || {};
    const gatewayRef = String(auraxTx.id || auraxTx.reference || '').trim();
    if (!gatewayRef) {
      await rollbackPendingPaymentByRef(orderId, paymentProviderForRow);
      return res.status(400).json({
        error: 'Aurax Pay did not return a transaction id',
        auraxResponse: auraxData,
      });
    }

    await query(
      `UPDATE subscription_payments
          SET gateway_ref = $1
        WHERE provider_ref = $2 AND status = 'pending' AND payment_provider = $3`,
      [gatewayRef, orderId, paymentProviderForRow],
    );
    if (gatewayRef !== orderId) {
      console.log('[AuraxPay] gateway_ref linked', { clientOrderId: orderId, gatewayRef });
    }

    return res.json({
      status: 'pending',
      orderId,
      message:
        auraxData.message ||
        (usedAuraxFallbackFromSonic
          ? isHalotelLocalPhone(normalizedPhone)
            ? 'Ombi limetumwa kupitia Aurax Pay (Halopesa). Angalia simu yako na uingize PIN.'
            : isAirtelLocalPhone(normalizedPhone)
              ? 'Ombi limetumwa kupitia Aurax Pay (Airtel Money). Angalia simu yako na uingize PIN.'
              : 'Ombi limetumwa kupitia Aurax Pay. Angalia simu yako na uingize PIN ya malipo.'
          : providerResponseMessage),
      provider: PAYMENT_PROVIDERS.AURAX,
      activeProvider: provider,
      ...(usedAuraxFallbackFromSonic ? { fallbackFrom: PAYMENT_PROVIDERS.SONICPESA } : {}),
    });
  } catch (err) {
    console.error('[Payment] Start error:', err?.message || err);
    const errorMessage = err.message || 'Failed to process payment request';
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: errorMessage });
  }
}

router.post('/aurax/start', handlePaymentStart);
router.post('/start', handlePaymentStart);

const LEGACY_PLAN_INTERVALS = { week: '7 days', month: '30 days', year: '90 days' };

const resolvePlanIntervalForPayment = async (plan, amountCents) => {
  const planKey = String(plan || '').toLowerCase();
  const planInterval = await resolvePremiumInterval(plan);
  if (planInterval) return planInterval;

  if (planKey.startsWith('offer:')) {
    const days = parseInt(planKey.split(':')[1], 10);
    if (Number.isFinite(days) && days > 0 && days <= 366) return `${days} days`;
  }

  try {
    const plans = await getActivePlans();
    const amount = Number(amountCents);
    if (Number.isFinite(amount) && amount > 0) {
      const exact = plans.find((p) => Number(p.priceTzs) === amount);
      const exactInterval = intervalForPlan(exact);
      if (exactInterval) {
        console.warn('[Payment] Inferred plan interval from exact amount', { plan: planKey, amountCents, exactInterval });
        return exactInterval;
      }
      let closest = null;
      let closestDiff = Infinity;
      for (const p of plans) {
        const diff = Math.abs(Number(p.priceTzs) - amount);
        if (diff < closestDiff) {
          closestDiff = diff;
          closest = p;
        }
      }
      const closestInterval = intervalForPlan(closest);
      if (closestInterval) {
        console.warn('[Payment] Inferred plan interval from closest amount', {
          plan: planKey,
          amountCents,
          closestSlug: closest?.slug,
          closestInterval,
        });
        return closestInterval;
      }
    }
  } catch (err) {
    console.warn('[Payment] Plan inference failed:', err?.message || err);
  }

  if (LEGACY_PLAN_INTERVALS[planKey]) return LEGACY_PLAN_INTERVALS[planKey];

  console.error('[Payment] Using default 30-day interval for unknown plan:', planKey, amountCents);
  return '30 days';
};

// Internal helper: apply completed payment to user (uses single DB client so transaction works)
// On success: unlocks all channels, starts remaining time, marks payment completed (revenue + premium count in admin)
// [expectedPaymentProvider] when set (e.g. from webhooks), must match DB row payment_provider — prevents cross-gateway completion.
const applyCompletedPayment = async (orderId, meta, options = {}) => {
  const { expectedPaymentProvider = null, altRefs = [] } = options;
  const lookupRefs = [...new Set([orderId, ...(altRefs || [])].map((r) => String(r || '').trim()).filter(Boolean))];
  console.log('[Payment] Applying completed payment for refs:', lookupRefs, 'meta:', meta, 'expectedProvider:', expectedPaymentProvider || '(any)');
  const payment = await findPaymentRowByRefs(lookupRefs);
  if (!payment) {
    console.log('[Payment] No payment found for refs:', lookupRefs);
    return null;
  }

  const dbProvider = (payment.payment_provider || PAYMENT_PROVIDERS.AURAX).toLowerCase().trim();
  if (expectedPaymentProvider && dbProvider !== expectedPaymentProvider) {
    console.warn('[Payment] Skipping applyCompletedPayment: payment_provider mismatch', {
      orderId: payment.provider_ref,
      expected: expectedPaymentProvider,
      actual: dbProvider,
    });
    return null;
  }

  // Validate real data from DB
  const userId = Number(payment.user_id);
  const paymentId = Number(payment.id);
  const plan = payment.plan && String(payment.plan).toLowerCase();

  if (!userId || !paymentId || Number.isNaN(userId) || Number.isNaN(paymentId)) {
    console.error('[Payment] Invalid payment row:', { user_id: payment.user_id, id: payment.id });
    return null;
  }

  const planInterval = await resolvePlanIntervalForPayment(plan, payment.amount_cents);
  if (!planInterval) {
    console.error('[Payment] Invalid or missing plan:', plan);
    return null;
  }

  if (payment.status === 'completed') {
    console.log('[Payment] Payment already completed:', payment.provider_ref);
    await repairUserEntitlementsIfNeeded(userId, planInterval);
    const user = await fetchUserPremiumSnapshotByUserId(userId);
    return { ...payment, user };
  }

  console.log('[Payment] Found payment:', {
    id: paymentId,
    user_id: userId,
    plan,
    amount_cents: payment.amount_cents,
    interval: planInterval,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Mark payment completed (idempotent — only one worker wins pending → completed)
    const payUpdate = await client.query(
      `UPDATE subscription_payments
          SET status = 'completed',
              completed_at = COALESCE(completed_at, NOW())
        WHERE id = $1 AND status = 'pending'
        RETURNING id, status, completed_at`,
      [paymentId],
    );
    if (payUpdate.rowCount !== 1) {
      const cur = await client.query('SELECT status FROM subscription_payments WHERE id = $1', [paymentId]);
      if (cur.rows[0]?.status === 'completed') {
        await client.query('COMMIT');
        await repairUserEntitlementsIfNeeded(userId, planInterval);
        const user = await fetchUserPremiumSnapshotByUserId(userId);
        return { ...payment, user };
      }
      throw new Error(`Failed to update payment id=${paymentId} (rowCount=${payUpdate.rowCount})`);
    }
    console.log('[Payment] Payment status set to completed, id:', paymentId);

    await grantUserEntitlementsInTransaction(client, userId, { planInterval });

    await client.query('COMMIT');
    console.log('[Payment] Transaction committed for order:', payment.provider_ref, '- revenue and premium users will reflect in admin.');

    // Send push notification to user about successful payment
    try {
      const userResult = await query('SELECT fcm_token, external_id FROM users WHERE id = $1', [userId]);
      const fcmToken = userResult.rows[0]?.fcm_token;
      const externalId = userResult.rows[0]?.external_id;
      
      if (fcmToken) {
        const updatedUser = await query(
          'SELECT is_premium, premium_expires_at, blocked FROM users WHERE id = $1',
          [userId],
        );
        const premium = updatedUser.rows[0]
          ? buildPremiumPayload(updatedUser.rows[0])
          : { isPremium: true, is_premium: true, premiumExpiresAt: '', subscriptionEndDate: '' };
        await sendPushNotification(
          fcmToken,
          'Malipo Yamefaulu!',
          'Umebadilisha kuwa Premium. Sasa una access kwenye chaneli zote.',
          {
            type: 'payment_success',
            orderId: String(payment.provider_ref || orderId || ''),
            isPremium: String(!!premium.isPremium),
            is_premium: String(!!premium.is_premium),
            premiumExpiresAt: premium.premiumExpiresAt || '',
            subscriptionEndDate: premium.subscriptionEndDate || '',
            externalId: externalId || '',
          },
        );
        console.log('[Payment] Push notification sent to user:', userId);
      }

      // Send real-time update via WebSocket if available
      if (global.realtimeServer && externalId) {
        try {
          const updatedUser = await query(
            'SELECT is_premium, premium_expires_at, blocked FROM users WHERE id = $1',
            [userId]
          );
          if (updatedUser.rows[0]) {
            const premiumPayload = buildPremiumPayload(updatedUser.rows[0]);
            global.realtimeServer.notifyPremiumUpdate(externalId, premiumPayload);
            if (typeof global.realtimeServer.notifyPaymentReceived === 'function') {
              global.realtimeServer.notifyPaymentReceived(externalId, {
                provider_ref: payment.provider_ref,
                amount_cents: payment.amount_cents,
                status: 'completed',
              });
            }
          }
        } catch (err) {
          console.error('[Payment] Failed to send real-time update:', err.message);
        }
      }
    } catch (notifErr) {
      console.error('[Payment] Failed to send notifications:', notifErr.message);
    }

    // Return success result immediately after commit - MUST be inside try block
    const user = await fetchUserPremiumSnapshotByUserId(userId);
    return { ...payment, user };
  } catch (err) {
    console.error('[Payment] Transaction failed, rolling back:', err);
    await client.query('ROLLBACK').catch((rollbackErr) => {
      console.error('[Payment] Rollback error:', rollbackErr);
    });
    throw err;
  } finally {
    client.release();
  }
};

/** Only tell the app COMPLETED once premium is actually active on the user row. */
const respondPaymentCompletion = async (orderId, rawPayload, res) => {
  const payRowRes = await query(
    `SELECT status, user_id, plan, amount_cents
       FROM subscription_payments
      WHERE provider_ref = $1 OR gateway_ref = $1
      LIMIT 1`,
    [orderId],
  );
  const payRow = payRowRes.rows[0] || null;

  if (payRow?.status === 'completed' && payRow.user_id) {
    const planInterval = await resolvePlanIntervalForPayment(payRow.plan, payRow.amount_cents);
    await repairUserEntitlementsIfNeeded(Number(payRow.user_id), planInterval || '30 days');
  }

  let user = await fetchUserPremiumSnapshotForOrder(orderId);
  let premiumActive = user && (
    user.isPremium === true ||
    user.is_premium === true ||
    user.isPremium === 1 ||
    user.is_premium === 1 ||
    String(user.isPremium).toLowerCase() === 'true' ||
    String(user.is_premium).toLowerCase() === 'true'
  );

  // Last-resort grant: payment row is completed but premium still inactive.
  if (!premiumActive && payRow?.status === 'completed' && payRow.user_id) {
    const planInterval = await resolvePlanIntervalForPayment(payRow.plan, payRow.amount_cents);
    console.warn('[Payment] Force-granting premium after completed payment without active entitlements', {
      orderId,
      userId: payRow.user_id,
      plan: payRow.plan,
      planInterval,
    });
    await repairUserEntitlements(Number(payRow.user_id), planInterval || '30 days');
    user = await fetchUserPremiumSnapshotForOrder(orderId);
    premiumActive = user && (
      user.isPremium === true ||
      user.is_premium === true ||
      user.isPremium === 1 ||
      user.is_premium === 1 ||
      String(user.isPremium).toLowerCase() === 'true' ||
      String(user.is_premium).toLowerCase() === 'true'
    );
  }

  if (!premiumActive) {
    return res.json({
      status: 'PENDING',
      applying: true,
      premiumGranted: false,
      message: 'Malipo yamethibitishwa — tunasasisha akaunti yako…',
      raw: rawPayload || { data: [{ payment_status: 'COMPLETED' }] },
      ...(user ? { user } : {}),
    });
  }
  return res.json({
    status: 'COMPLETED',
    premiumGranted: true,
    raw: rawPayload || { data: [{ payment_status: 'COMPLETED' }] },
    ...(user ? { user } : {}),
  });
};

/** Shared GET /status and GET /aurax/status handler. */
const handlePaymentStatusPoll = async (orderId, res, next) => {
  try {
    const dbCheck = await query(
      `SELECT status, gateway_ref, user_id, plan, amount_cents
         FROM subscription_payments
        WHERE provider_ref = $1 OR gateway_ref = $1
        LIMIT 1`,
      [orderId],
    );

    if (dbCheck.rows.length > 0 && dbCheck.rows[0].status === 'completed') {
      const payRow = dbCheck.rows[0];
      const planKey = String(payRow.plan || '').toLowerCase();
      const planInterval = await resolvePlanIntervalForPayment(planKey, payRow.amount_cents);
      await repairUserEntitlementsIfNeeded(Number(payRow.user_id), planInterval);
      return respondPaymentCompletion(orderId, { data: [{ payment_status: 'COMPLETED' }] }, res);
    }

    const gateway = await resolveGatewayForOrderId(orderId);
    const expectedProvider =
      gateway === PAYMENT_PROVIDERS.SONICPESA ? PAYMENT_PROVIDERS.SONICPESA : PAYMENT_PROVIDERS.AURAX;

    if (gateway === PAYMENT_PROVIDERS.SONICPESA) {
      ensureSonicPesaConfigured();
      const { statusResp, statusData } = await pollSonicOrderStatus(orderId);

      const sonicMessage = String(statusData.message || statusData.error || '').toLowerCase();
      const isOrderNotFound =
        !statusResp.ok &&
        (sonicMessage.includes('no order found') ||
          sonicMessage.includes('order not found') ||
          statusResp.status === 404);
      if (isOrderNotFound) {
        return res.json({ status: 'PENDING', raw: statusData });
      }

      if (!statusResp.ok) {
        return res.status(400).json({
          error: mapPaymentGatewayUserError(
            statusData.message || statusData.error || 'Failed to fetch order status',
            statusData.resultcode || statusData.code,
          ),
        });
      }

      const rawStatus = extractSonicPaymentStatus(statusData);
      const isCompleted = isSonicPaidRaw(rawStatus);

      if (isCompleted) {
        try {
          await applyCompletedPayment(orderId, statusData.data || statusData || {}, {
            expectedPaymentProvider: expectedProvider,
          });
        } catch (applyErr) {
          console.error('[Payment] Sonic applyCompletedPayment failed during poll:', applyErr?.message || applyErr);
          return res.json({ status: 'PENDING', applying: true, raw: statusData });
        }
        return respondPaymentCompletion(orderId, statusData, res);
      }

      if (isPaymentTerminalStatus(rawStatus)) {
        await markOrderTerminalIfPending(orderId, rawStatus);
        const clientStatus = isPaymentCancelledStatus(rawStatus) ? 'CANCELLED' : rawStatus;
        return res.json({
          status: clientStatus,
          terminal: true,
          userMessage: mapTerminalStatusUserMessage(rawStatus),
          raw: statusData,
        });
      }

      return res.json({
        status: rawStatus || 'PENDING',
        raw: statusData,
      });
    }

    ensureAuraxPayConfigured();
    const auraxPollId = String(dbCheck.rows[0]?.gateway_ref || orderId).trim();
    const { statusResp, statusData } = await pollAuraxOrderStatus(auraxPollId);

    const auraxMessage = String(statusData.message || statusData.error || '').toLowerCase();
    const isOrderNotFound =
      !statusResp.ok &&
      (auraxMessage.includes('not found') ||
        auraxMessage.includes('transaction not found') ||
        statusResp.status === 404);
    if (isOrderNotFound) {
      return res.json({ status: 'PENDING', raw: statusData });
    }

    if (!statusResp.ok) {
      return res.status(400).json({
        error: mapPaymentGatewayUserError(
          statusData.message || statusData.error || 'Failed to fetch order status',
          '',
        ),
      });
    }

    const { isCompleted, rawStatus, transaction } = evaluateAuraxOrderStatusForApply(statusData);
    const gatewayRef = String(dbCheck.rows[0]?.gateway_ref || '').trim();
    const auraxAltRefs = [...new Set([gatewayRef, auraxPollId].filter((r) => r && r !== orderId))];

    if (isCompleted) {
      try {
        await applyCompletedPayment(orderId, transaction || statusData || {}, {
          expectedPaymentProvider: expectedProvider,
          altRefs: auraxAltRefs,
        });
      } catch (applyErr) {
        console.error('[Payment] Aurax applyCompletedPayment failed during poll:', applyErr?.message || applyErr);
        return res.json({ status: 'PENDING', applying: true, raw: statusData });
      }
      return respondPaymentCompletion(orderId, statusData, res);
    }

    let clientStatus = rawStatus || 'PENDING';
    if (!isCompleted && (clientStatus === 'SUCCESS' || clientStatus === 'OK')) {
      clientStatus = 'PENDING';
    }
    if (isPaymentTerminalStatus(clientStatus) || isPaymentTerminalStatus(rawStatus)) {
      const term = isPaymentTerminalStatus(rawStatus) ? rawStatus : clientStatus;
      await markOrderTerminalIfPending(orderId, term);
      return res.json({
        status: isPaymentCancelledStatus(term) ? 'CANCELLED' : term,
        terminal: true,
        userMessage: mapTerminalStatusUserMessage(term),
        raw: statusData,
      });
    }

    return res.json({
      status: clientStatus,
      raw: statusData,
    });
  } catch (err) {
    return next(err);
  }
};

router.get('/aurax/status', async (req, res, next) => {
  try {
    const paramsSchema = z.object({ orderId: z.string().min(1) });
    const { orderId } = paramsSchema.parse(req.query);
    console.log(`[Backend] Checking status for orderId: ${orderId}`);
    return handlePaymentStatusPoll(orderId, res, next);
  } catch (err) {
    return next(err);
  }
});

// Aurax Pay and SonicPesa each have their own webhook path — tied to payment_provider rows.

const timingSafeEqualHexOrString = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  const xa = x.includes('=') ? x.split('=').pop().trim() : x;
  const yb = y.includes('=') ? y.split('=').pop().trim() : y;
  if (xa.length !== yb.length) return false;
  try {
    const bx = Buffer.from(xa, 'hex');
    const by = Buffer.from(yb, 'hex');
    if (bx.length > 0 && bx.length === by.length && bx.length === xa.length / 2) {
      return crypto.timingSafeEqual(bx, by);
    }
  } catch (_) {
    /* fall through */
  }
  const bufA = Buffer.from(xa, 'utf8');
  const bufB = Buffer.from(yb, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

const verifySonicPesaWebhookHmac = (rawBodyString, headerValue) => {
  if (!SONICPESA_WEBHOOK_SECRET || typeof headerValue !== 'string' || !headerValue.trim()) return false;
  if (typeof rawBodyString !== 'string' || !rawBodyString.length) return false;
  const expected = crypto.createHmac('sha256', SONICPESA_WEBHOOK_SECRET).update(rawBodyString, 'utf8').digest('hex');
  return (
    timingSafeEqualHexOrString(headerValue, expected) ||
    timingSafeEqualHexOrString(headerValue, `sha256=${expected}`)
  );
};

const verifyAuraxPayWebhookHmac = (rawBodyString, headerValue) => {
  if (!AURAXPAY_WEBHOOK_SECRET || typeof headerValue !== 'string' || !headerValue.trim()) return false;
  if (typeof rawBodyString !== 'string' || !rawBodyString.length) return false;
  const secret = AURAXPAY_WEBHOOK_SECRET.startsWith('whsec_')
    ? AURAXPAY_WEBHOOK_SECRET.slice(6)
    : AURAXPAY_WEBHOOK_SECRET;
  const expected = crypto.createHmac('sha256', secret).update(rawBodyString, 'utf8').digest('hex');
  const expectedFull = crypto.createHmac('sha256', AURAXPAY_WEBHOOK_SECRET).update(rawBodyString, 'utf8').digest('hex');
  return (
    timingSafeEqualHexOrString(headerValue, expected) ||
    timingSafeEqualHexOrString(headerValue, expectedFull) ||
    timingSafeEqualHexOrString(headerValue, `sha256=${expected}`) ||
    timingSafeEqualHexOrString(headerValue, `sha256=${expectedFull}`)
  );
};

const extractSonicWebhookOrderAndPaid = (payload) => {
  const d = payload.data;
  const nest =
    d && typeof d === 'object' && !Array.isArray(d)
      ? d
      : Array.isArray(d) && d.length
        ? d[0]
        : null;
  const orderId = String(
    payload.order_id ??
      payload.orderId ??
      nest?.order_id ??
      nest?.orderId ??
      payload.reference ??
      payload.reference_id ??
      payload.invoice_id ??
      nest?.reference ??
      '',
  ).trim();

  const rawStatus = extractSonicPaymentStatus(payload);
  const ev = String(payload.event || payload.type || '').toLowerCase().trim();
  let paid = isSonicPaidRaw(rawStatus);
  if (!paid && ev) {
    paid =
      ev === 'payment.success' ||
      ev === 'payment.completed' ||
      ev === 'payment_completed' ||
      ev === 'invoice.paid' ||
      ev === 'charge.succeeded';
  }
  return { orderId: orderId || null, paid, raw: rawStatus || ev };
};

// Webhook endpoint for Aurax Pay (configure in Aurax dashboard: /api/payments/aurax/webhook)
router.post('/aurax/webhook', async (req, res, next) => {
  try {
    ensureAuraxPayConfigured();

    const rawBodyString =
      typeof req.rawBody === 'string' && req.rawBody.length > 0
        ? req.rawBody
        : JSON.stringify(req.body || {});

    const sigHeader =
      req.headers['x-aurax-signature'] ||
      req.headers['x-webhook-signature'] ||
      req.headers['x-signature'];

    const signatureValid = verifyAuraxPayWebhookHmac(rawBodyString, sigHeader);

    const bodySchema = z.object({
      event: z.string().optional(),
      type: z.string().optional(),
      status: z.string().optional(),
      id: z.string().optional(),
      reference: z.string().optional(),
      transaction: z.any().optional(),
      data: z.any().optional(),
      metadata: z.any().optional(),
    }).passthrough();

    let payload;
    try {
      payload = bodySchema.parse(req.body || {});
    } catch (e) {
      console.error('[AuraxPay] Webhook payload validation failed:', e?.errors || e.message);
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const { orderId, allRefs, paid, raw } = extractAuraxWebhookOrderAndPaid(payload);
    console.log('[AuraxPay] Webhook:', {
      orderId,
      allRefs,
      paid,
      raw,
      signatureValid,
      secretConfigured: Boolean(AURAXPAY_WEBHOOK_SECRET),
    });

    if (!orderId && (!allRefs || !allRefs.length)) {
      return res.status(400).json({ error: 'Missing transaction reference' });
    }

    if (AURAXPAY_WEBHOOK_SECRET) {
      if (!signatureValid) {
        console.warn('[AuraxPay] Webhook rejected: invalid HMAC (AURAXPAY_WEBHOOK_SECRET is set).');
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    } else {
      // A reference alone is public/client-visible and cannot prove a debit.
      // Do not let an unsigned caller turn a pending order into Premium.
      console.warn('[AuraxPay] Webhook rejected: AURAXPAY_WEBHOOK_SECRET is required to verify payment completion.');
      return res.status(503).json({ error: 'Webhook verification is not configured' });
    }

    if (!paid) {
      return res.status(200).json({ received: true, processed: false });
    }

    try {
      const result = await tryApplyAuraxCompletedPayment(orderId, payload, { altRefs: allRefs });
      if (!result) {
        console.warn('[AuraxPay] Payment processing returned null for:', orderId);
        return res.status(200).json({ received: true, processed: false, reason: 'payment_not_found_or_already_processed' });
      }
      console.log('[AuraxPay] Payment processing completed for:', orderId, 'user:', result.user?.external_id);
      return res.status(200).json({ received: true, processed: true, userId: result.user?.external_id });
    } catch (e) {
      console.error('[AuraxPay] Webhook applyCompletedPayment failed:', e?.message || e);
      return res.status(500).json({ error: 'Processing failed' });
    }
  } catch (err) {
    console.error('[AuraxPay] Webhook error:', err);
    return next(err);
  }
});

// Webhook endpoint for SonicPesa
router.post('/sonicpesa/webhook', async (req, res, next) => {
  try {
    ensureSonicPesaConfigured();

    const rawBodyString =
      typeof req.rawBody === 'string' && req.rawBody.length > 0
        ? req.rawBody
        : JSON.stringify(req.body || {});

    const sigHeader =
      req.headers['x-sonicpesa-signature'] ||
      req.headers['x-webhook-signature'] ||
      req.headers['x-signature'];

    const signatureValid = verifySonicPesaWebhookHmac(rawBodyString, sigHeader);

    const bodySchema = z.object({
      event: z.string().optional(),
      type: z.string().optional(),
      order_id: z.union([z.string(), z.number()]).optional(),
      orderId: z.union([z.string(), z.number()]).optional(),
      amount: z.number().optional(),
      currency: z.string().optional(),
      status: z.string().optional(),
      transid: z.string().optional(),
      channel: z.string().optional(),
      reference: z.string().optional(),
      reference_id: z.string().optional(),
      invoice_id: z.string().optional(),
      msisdn: z.string().optional(),
      timestamp: z.string().optional(),
      data: z.any().optional(),
    }).passthrough();

    let payload;
    try {
      payload = bodySchema.parse(req.body || {});
    } catch (e) {
      console.error('[SonicPesa] Webhook payload validation failed:', e?.errors || e.message);
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const { orderId, paid, raw } = extractSonicWebhookOrderAndPaid(payload);
    console.log('[SonicPesa] Webhook:', {
      orderId,
      paid,
      raw,
      signatureValid,
      secretConfigured: Boolean(SONICPESA_WEBHOOK_SECRET),
    });

    if (!orderId) {
      return res.status(400).json({ error: 'Missing order reference' });
    }

    if (SONICPESA_WEBHOOK_SECRET) {
      if (!signatureValid) {
        console.warn('[SonicPesa] Webhook rejected: invalid HMAC (SONICPESA_WEBHOOK_SECRET is set).');
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    } else {
      // A reference alone is public/client-visible and cannot prove a debit.
      // Do not let an unsigned caller turn a pending order into Premium.
      console.warn('[SonicPesa] Webhook rejected: SONICPESA_WEBHOOK_SECRET is required to verify payment completion.');
      return res.status(503).json({ error: 'Webhook verification is not configured' });
    }

    if (!paid) {
      return res.status(200).json({ received: true, processed: false });
    }

    try {
      const result = await applyCompletedPayment(orderId, payload, {
        expectedPaymentProvider: PAYMENT_PROVIDERS.SONICPESA,
        altRefs: [
          payload.reference,
          payload.reference_id,
          payload.invoice_id,
          payload.transid,
          payload.data?.order_id,
          payload.data?.orderId,
          payload.data?.reference,
        ].filter(Boolean),
      });
      if (!result) {
        console.warn('[SonicPesa] Payment processing returned null for:', orderId);
        return res.status(200).json({ received: true, processed: false, reason: 'payment_not_found_or_already_processed' });
      }
      console.log('[SonicPesa] Payment processing completed for:', orderId, 'user:', result.user?.external_id);
      return res.status(200).json({ received: true, processed: true, userId: result.user?.external_id });
    } catch (e) {
      console.error('[SonicPesa] Webhook applyCompletedPayment failed:', e?.message || e);
      return res.status(500).json({ error: 'Processing failed' });
    }
  } catch (err) {
    console.error('[SonicPesa] Webhook error:', err);
    return next(err);
  }
});

// Manual completion is intentionally disabled unless explicitly enabled. It is
// only for a local/test gateway and must never become a production backdoor.
const manualCompleteHandler = async (req, res, next) => {
  try {
    if (!allowPaymentTestComplete()) {
      return res.status(403).json({ error: 'Manual payment completion is disabled in production.' });
    }
    const { orderId } = req.params;
    console.log('[Payment] Manual completion requested for order:', orderId);
    const result = await applyCompletedPayment(orderId, { manual: true });
    if (!result) return res.status(404).json({ error: 'Payment not found' });
    return res.json({ success: true, message: 'Payment completed manually', user: result.user || null });
  } catch (err) {
    console.error('[Payment] Manual completion error:', err);
    return next(err);
  }
};
router.post('/complete/:orderId', manualCompleteHandler);
router.post('/aurax/complete/:orderId', manualCompleteHandler);

// Unified payment status endpoint - routes to active provider
router.get('/status', async (req, res, next) => {
  const orderId = req.query.orderId;
  if (!orderId) return res.status(400).json({ error: 'orderId parameter required' });
  console.log(`[Backend] Checking status for orderId: ${orderId}`);
  return handlePaymentStatusPoll(orderId, res, next);
});

/** Poll gateways for stale pending rows — catches paid orders when app/webhook missed completion. */
const tryCompletePendingPaymentFromGateway = async (payRow) => {
  const orderId = String(payRow.provider_ref || '').trim();
  if (!orderId) return false;

  const gateway = normalizeStoredPaymentProvider(payRow.payment_provider) || PAYMENT_PROVIDERS.AURAX;
  const expectedProvider =
    gateway === PAYMENT_PROVIDERS.SONICPESA ? PAYMENT_PROVIDERS.SONICPESA : PAYMENT_PROVIDERS.AURAX;

  if (gateway === PAYMENT_PROVIDERS.SONICPESA) {
    if (!SONICPESA_API_KEY) return false;
    const { statusResp, statusData } = await pollSonicOrderStatus(orderId);
    if (!statusResp.ok) return false;
    const rawStatus = extractSonicPaymentStatus(statusData);
    if (!isSonicPaidRaw(rawStatus)) return false;
    const result = await applyCompletedPayment(orderId, statusData.data || statusData || {}, {
      expectedPaymentProvider: expectedProvider,
    });
    return Boolean(result);
  }

  if (!AURAXPAY_API_KEY) return false;
  const auraxPollId = String(payRow.gateway_ref || orderId).trim();
  const { statusResp, statusData } = await pollAuraxOrderStatus(auraxPollId);
  if (!statusResp.ok) return false;
  const { isCompleted, transaction } = evaluateAuraxOrderStatusForApply(statusData);
  if (!isCompleted) return false;
  const altRefs = [...new Set([auraxPollId, String(payRow.gateway_ref || '').trim()].filter((r) => r && r !== orderId))];
  const result = await applyCompletedPayment(orderId, transaction || statusData || {}, {
    expectedPaymentProvider: expectedProvider,
    altRefs,
  });
  return Boolean(result);
};

const reconcilePendingSubscriptionPayments = async () => {
  const result = await query(
    `SELECT provider_ref, gateway_ref, payment_provider, plan, amount_cents, user_id
       FROM subscription_payments
      WHERE status = 'pending'
        AND created_at < NOW() - INTERVAL '90 seconds'
      ORDER BY created_at ASC
      LIMIT 50`,
  );
  if (!result.rows.length) return 0;

  let upgraded = 0;
  for (const row of result.rows) {
    try {
      const ok = await tryCompletePendingPaymentFromGateway(row);
      if (ok) upgraded += 1;
    } catch (err) {
      console.warn('[Payment] Reconcile failed for', row.provider_ref, err?.message || err);
    }
  }
  if (upgraded > 0) {
    console.log(`[Payment] Background reconcile completed ${upgraded} pending payment(s)`);
  }

  try {
    const { repairCompletedPaymentsMissingPremium } = require('../services/userEntitlements');
    await repairCompletedPaymentsMissingPremium();
  } catch (repairErr) {
    console.warn('[Payment] Post-reconcile entitlement repair failed:', repairErr?.message || repairErr);
  }

  return upgraded;
};

module.exports = router;
module.exports.reconcilePendingSubscriptionPayments = reconcilePendingSubscriptionPayments;
module.exports.__paymentTestHelpers = {
  normalizeAuraxStatusPayload,
  evaluateAuraxOrderStatusForApply,
  extractAuraxWebhookOrderAndPaid,
  extractAuraxPaymentStatus,
  extractSonicWebhookOrderAndPaid,
  extractSonicPaymentStatus,
  isAuraxPaidRaw,
  isSonicPaidRaw,
  pickPreferredAuraxOrderId,
  collectAuraxOrderRefs,
};
