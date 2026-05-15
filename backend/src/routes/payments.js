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
  'SUCCESS', 'COMPLETED', 'PAID', 'COMPLETE', 'SUCCEEDED', 'APPROVED', 'CONFIRMED', 'SETTLED',
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

/** Legacy Zeno refs `${user_id}_${epochMs}` or UUID v4 (current). */
const isLikelyInternalZenoOrderRef = (orderId) => {
  const s = String(orderId || '').trim();
  if (/^\d+_\d{10,}$/.test(s)) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
};

/**
 * Routing rules (EaAdmin → app_settings.payment_provider):
 * - New payments: handlePaymentStart() uses ONLY getSelectedPaymentProvider() — never the URL path name.
 * - Status polling: prefer the payment row's payment_provider (set at start) so an admin toggle mid-checkout
 *   does not move an in-flight order to the wrong gateway. If the row is missing briefly, infer Zeno from ref
 *   shape; otherwise fall back to the current admin default.
 */
const resolveGatewayForOrderId = async (orderId) => {
  const raw = await getPaymentProviderForOrder(orderId);
  if (typeof raw === 'string') {
    const compact = raw.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    if (compact === 'sonicpesa') return PAYMENT_PROVIDERS.SONICPESA;
    if (compact === 'zeno' || compact === 'zenopay') return PAYMENT_PROVIDERS.ZENO;
    if (compact.length > 0) {
      console.warn('[Payment] Unknown payment_provider on row; treating as zeno', { orderId, raw });
      return PAYMENT_PROVIDERS.ZENO;
    }
  }
  if (isLikelyInternalZenoOrderRef(orderId)) {
    return PAYMENT_PROVIDERS.ZENO;
  }
  return getSelectedPaymentProvider();
};

const TZ_VALID_PREFIXES = [
  '061', '062', '063', '065', '067', '068', '069', '071', '074', '075', '076', '077', '078', '079',
];

/**
 * Normalize any accepted TZ input to canonical local 0… (9 digits after 0).
 * Rejects non-Tanzania international numbers.
 */
const normalizePhoneToLocal0 = (rawPhone) => {
  let normalizedPhone = String(rawPhone || '').replace(/\s+/g, '');
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
        'Invalid Tanzanian phone number. Use format: 061–063 (Halotel), 065/071 (Yas), 067/077 (Tigo), 068–069/078 (Airtel), 074–076/079 (Vodacom); 9–10 digits after 0.',
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

const sonicPhoneCandidatesForApi = (normalizedPhone) => {
  const candidates = [];
  const api255 = formatPhoneForSonicPesaApi(normalizedPhone);
  const local = formatBuyerPhoneLocal(normalizedPhone);
  if (api255) candidates.push(api255);
  if (local && local !== api255) candidates.push(local);
  return [...new Set(candidates)];
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

const isSonicPaymentSendFailure = (rawMessage, rawCode) => {
  const combined = `${rawMessage || ''} ${rawCode || ''}`.toLowerCase();
  return (
    /hayajatumika|malipo hayajatumika|hayajaweza kutumika|malipo hayajaweza kutumika|hayajaweza kutuma|hayajaweza kutumika/i.test(
      combined,
    ) ||
    /not sent|could not send|push failed|failed to send|unable to send|cannot send|was not sent/i.test(combined) ||
    /no response from upstream|upstream/i.test(combined)
  );
};

const isHalotelLocalPhone = (local0) => {
  const p = String(local0 || '');
  return p.startsWith('061') || p.startsWith('062') || p.startsWith('063');
};

const mapSonicInitiateUserError = (localPhone, rawMessage, rawCode) => {
  if (isSonicPaymentSendFailure(rawMessage, rawCode)) {
    if (isHalotelLocalPhone(localPhone)) {
      return (
        'SonicPesa haikutuma ombi kwa Halopesa (061–063). Tumia ZenoPay kwenye admin, au hakikisha Halopesa iko active na nambari sahihi, kisha jaribu tena.'
      );
    }
    return (
      'Hatukuweza kutuma ombi la malipo kwenye simu yako. Hakikisha nambari ni sahihi na mtandao wa pesa unafanya kazi, kisha jaribu tena.'
    );
  }
  return mapPaymentGatewayUserError(rawMessage, rawCode, { context: 'initiate' });
};

const router = express.Router();

const ZENO_API_KEY =
  process.env.ZENO_API_KEY || process.env.ZENOPAY_API_KEY || process.env.ZENOURI_API_KEY;
const ZENO_API_BASE = 'https://zenoapi.com/api';

const ensureZenoConfigured = () => {
  if (!ZENO_API_KEY) {
    throw new Error(
      'ZenoPay API key missing: set ZENO_API_KEY (or ZENOPAY_API_KEY / ZENOURI_API_KEY) on the server',
    );
  }
};

/** ZenoPay: local 0… per official samples. */
const formatBuyerPhoneForZeno = (local0) => formatBuyerPhoneLocal(local0);

const isRetriableZenoInitiateFailure = (httpOk, zenoData, httpStatus) => {
  if (httpOk && zenoData?.status === 'success') return false;
  const combined = `${zenoData?.message || ''} ${zenoData?.resultcode || ''}`.toLowerCase();
  if (
    /timeout|timed out|upstream|temporarily|unavailable|network|econnreset|abort|could not reach|try again|busy/i.test(
      combined,
    )
  ) {
    return true;
  }
  return httpStatus >= 502 || httpStatus === 408 || httpStatus === 429;
};

const isPhoneFormatZenoError = (zenoData, httpStatus) => {
  const combined = `${zenoData?.message || ''} ${zenoData?.resultcode || ''}`.toLowerCase();
  if (/invalid.*phone|phone.*invalid|msisdn|buyer_phone|nambari|number format|malformed/i.test(combined)) {
    return true;
  }
  return httpStatus === 400 && /phone|msisdn/i.test(combined);
};

const SONIC_HTTP_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.SONIC_HTTP_TIMEOUT_MS) || 22000, 8000),
  55000,
);

const isSonicPaidRaw = (rawUpper) => {
  if (!rawUpper) return false;
  const u = String(rawUpper).toUpperCase().trim();
  if (SONIC_WEBHOOK_PAID_STATUSES.has(u)) return true;
  const lower = u.toLowerCase();
  return lower === 'successful' || lower === 'ok' || lower === 'true' || lower === '1';
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
  for (const c of candidates) {
    if (c != null && typeof c !== 'object') {
      const s = String(c).toUpperCase().trim();
      if (s) return s;
    }
  }
  return '';
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
  process.env.NODE_ENV !== 'production' || String(process.env.PAYMENT_ALLOW_TEST_COMPLETE || '').trim() === '1';

const computeIsPremiumActive = (row) => {
  if (!row || row.is_premium !== true) return false;
  if (!row.premium_expires_at) return true;
  const exp = new Date(row.premium_expires_at);
  return !Number.isNaN(exp.getTime()) && exp > new Date();
};

const fetchUserPremiumSnapshotByUserId = async (userId) => {
  const r = await query(
    'SELECT is_premium, premium_expires_at, external_id FROM users WHERE id = $1 LIMIT 1',
    [userId],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  const expiresAt = row.premium_expires_at ? new Date(row.premium_expires_at).toISOString() : null;
  const isPremium = computeIsPremiumActive(row);
  return {
    isPremium,
    is_premium: isPremium,
    premiumExpiresAt: expiresAt,
    premium_expires_at: expiresAt,
    subscriptionEndDate: expiresAt,
    externalId: row.external_id,
  };
};

const fetchUserPremiumSnapshotForOrder = async (orderId) => {
  const r = await query(
    `SELECT u.id AS user_id
       FROM subscription_payments sp
       JOIN users u ON u.id = sp.user_id
      WHERE sp.provider_ref = $1
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
 * ZenoPay SDK-style wallet names: M-PESA, TIGOPESA, HALOPESA, AIRTEL MONEY.
 * Set `ZENO_SEND_PROVIDER=0` to omit `provider` (pure auto-detect — not recommended for all MNOs).
 * Per-MNO overrides: ZENO_VODACOM_WALLET_PROVIDER, ZENO_HALOTEL_WALLET_PROVIDER, ZENO_TIGO_WALLET_PROVIDER, ZENO_AIRTEL_WALLET_PROVIDER.
 */
const applyZenoWalletProviderForPayload = (payload, normalizedPhoneLocal0) => {
  if (String(process.env.ZENO_SEND_PROVIDER || '1').trim() === '0') return;
  const p = String(normalizedPhoneLocal0 || '');
  if (p.startsWith('061') || p.startsWith('062') || p.startsWith('063')) {
    const v = process.env.ZENO_HALOTEL_WALLET_PROVIDER;
    payload.provider = typeof v === 'string' && v.trim() ? v.trim() : 'HALOPESA';
    return;
  }
  if (p.startsWith('074') || p.startsWith('075') || p.startsWith('076') || p.startsWith('079')) {
    if (String(process.env.ZENO_VODACOM_SEND_PROVIDER || '1').trim() === '1') {
      const v = process.env.ZENO_VODACOM_WALLET_PROVIDER;
      payload.provider = typeof v === 'string' && v.trim() ? v.trim() : 'M-PESA';
    }
    return;
  }
  if (p.startsWith('065') || p.startsWith('067') || p.startsWith('071') || p.startsWith('077')) {
    const v = process.env.ZENO_TIGO_WALLET_PROVIDER;
    payload.provider = typeof v === 'string' && v.trim() ? v.trim() : 'TIGOPESA';
    return;
  }
  if (p.startsWith('068') || p.startsWith('069') || p.startsWith('078')) {
    const v = process.env.ZENO_AIRTEL_WALLET_PROVIDER;
    payload.provider = typeof v === 'string' && v.trim() ? v.trim() : 'AIRTEL MONEY';
    return;
  }
};

/**
 * Hint only (logging / support). ZenoPay’s published samples omit `provider` for most networks.
 */
const resolveZenoMobileWalletProviderHint = (localPhone0) => {
  const p = String(localPhone0 || '');
  if (p.startsWith('061') || p.startsWith('062') || p.startsWith('063')) return 'HALOPESA';
  if (p.startsWith('074') || p.startsWith('075') || p.startsWith('076') || p.startsWith('079')) {
    return 'M-PESA';
  }
  if (p.startsWith('065') || p.startsWith('071')) return 'TIGOPESA';
  if (p.startsWith('067') || p.startsWith('077')) return 'TIGOPESA';
  if (p.startsWith('068') || p.startsWith('069') || p.startsWith('078')) return 'AIRTEL MONEY';
  return null;
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

/** Sonic/Zeno explicit “not enough balance” wording (initiate) — translate without sounding like a blind app guess. */
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

const zenoTerminalStartStatuses = new Set([
  'FAILED', 'CANCELLED', 'REJECTED', 'DECLINED', 'EXPIRED', 'TIMEOUT', 'ERROR', 'VOID', 'REVERSED',
]);

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
      WHERE provider_ref = $1 AND status = 'pending'`,
    [orderId],
  );
};

const isActivePaymentProviderConfigured = (provider) => {
  if (provider === PAYMENT_PROVIDERS.SONICPESA) return Boolean(SONICPESA_API_KEY);
  return Boolean(ZENO_API_KEY);
};

/** Second GET right after create; off by default — Zeno responses vary and can false-fail. Set ZENO_POST_VERIFY=1 to enable. */
const zenoQuickPostCreateVerify = async (orderRef) => {
  if (String(process.env.ZENO_POST_VERIFY || '').trim() !== '1') return { ok: true };
  if (String(process.env.ZENO_SKIP_POST_VERIFY || '').trim() === '1') return { ok: true };
  const ref = String(orderRef || '').trim();
  if (!ref || !ZENO_API_KEY) return { ok: true };

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), Math.min(Math.max(Number(process.env.ZENO_VERIFY_TIMEOUT_MS) || 6000, 2000), 12000));
  try {
    const statusResp = await fetch(
      `${ZENO_API_BASE}/payments/order-status?order_id=${encodeURIComponent(ref)}`,
      {
        method: 'GET',
        headers: { 'x-api-key': ZENO_API_KEY },
        signal: ac.signal,
      },
    );
    const text = await statusResp.text();
    let statusData = {};
    try {
      if (text && text.trim()) statusData = JSON.parse(text);
    } catch (_) {
      return { ok: true };
    }
    const d = statusData.data;
    const row0 = Array.isArray(d) ? d[0] : d && typeof d === 'object' ? d : null;
    const raw = String(
      row0?.payment_status ||
        row0?.paymentStatus ||
        row0?.status ||
        statusData.payment_status ||
        statusData.paymentStatus ||
        statusData.status ||
        '',
    )
      .toUpperCase()
      .trim();
    if (raw && zenoTerminalStartStatuses.has(raw)) {
      const reason =
        statusData.message ||
        statusData.error ||
        row0?.message ||
        `Malipo yamesitishwa (${raw})`;
      return { ok: false, reason: String(reason) };
    }
    return { ok: true };
  } catch (_) {
    return { ok: true };
  } finally {
    clearTimeout(t);
  }
};

// Map bundle to amount and duration
const PLAN_CONFIG = {
  week: { amount: 2000, interval: '7 days' },
  month: { amount: 5000, interval: '30 days' },
  // id stays "year" for existing API/clients; duration is 3 months (miezi 3)
  year: { amount: 12000, interval: '90 days' },
};

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

const initiateZenoPayment = async ({
  orderId,
  normalizedPhone,
  amountToSend,
  data,
  externalId,
  webhookUrl,
}) => {
  const phoneForZeno = formatBuyerPhoneForZeno(normalizedPhone);
  const zenoHttpMs = Math.min(Math.max(Number(process.env.ZENO_HTTP_TIMEOUT_MS) || 22000, 8000), 55000);
  const payload = {
    order_id: orderId,
    buyer_email: data.email || 'user@eamax.app',
    buyer_name: data.name || externalId,
    buyer_phone: phoneForZeno,
    amount: amountToSend,
    webhook_url: webhookUrl,
  };
  applyZenoWalletProviderForPayload(payload, normalizedPhone);

  const maxAttempts = 2;
  let last = {
    response: { ok: false, status: 500 },
    zenoData: { status: 'error', message: 'Failed to start payment request' },
    phoneUsed: phoneForZeno,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { response, data: zenoData } = await gatewayFetchJson(
        `${ZENO_API_BASE}/payments/mobile_money_tanzania`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ZENO_API_KEY,
          },
          body: JSON.stringify(payload),
        },
        zenoHttpMs,
      );
      last = { response, zenoData, phoneUsed: phoneForZeno };
      if (response.ok && zenoData?.status === 'success') return last;
      if (
        attempt < maxAttempts &&
        isRetriableZenoInitiateFailure(response.ok, zenoData, response.status)
      ) {
        console.warn('[ZenoPay] Retrying initiate (same local MSISDN)', { attempt, phone: phoneForZeno });
        continue;
      }
      break;
    } catch (fetchErr) {
      last = {
        response: { ok: false, status: 502 },
        zenoData: { status: 'error', message: String(fetchErr?.message || fetchErr || 'network') },
        phoneUsed: phoneForZeno,
      };
      if (attempt < maxAttempts) continue;
      break;
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

const pollZenoOrderStatus = async (orderId) => {
  const zenoHttpMs = Math.min(Math.max(Number(process.env.ZENO_HTTP_TIMEOUT_MS) || 22000, 8000), 55000);
  try {
    const { response, data: statusData } = await gatewayFetchJson(
      `${ZENO_API_BASE}/payments/order-status?order_id=${encodeURIComponent(orderId)}`,
      {
        method: 'GET',
        headers: { 'x-api-key': ZENO_API_KEY },
      },
      zenoHttpMs,
    );
    return { statusResp: response, statusData };
  } catch (fetchErr) {
    return {
      statusResp: { ok: false, status: 502 },
      statusData: { status: 'error', message: String(fetchErr?.message || fetchErr || 'network') },
    };
  }
};

// Mobile money start: `/start` and legacy `/zeno/start` share this handler.
// Active gateway for NEW payments is ONLY `app_settings.payment_provider` (never inferred from the URL path).
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

    const orderId = crypto.randomUUID();
    console.log('[Backend] Generated payment orderId:', orderId);

    const selectedProvider = await getSelectedPaymentProvider();
    const provider = selectedProvider === PAYMENT_PROVIDERS.SONICPESA
      ? PAYMENT_PROVIDERS.SONICPESA
      : PAYMENT_PROVIDERS.ZENO;
    const rawSetting = await getAppSettingValue(PAYMENT_PROVIDER_SETTING_KEY, PAYMENT_PROVIDERS.ZENO);
    console.log('[Payment] /start app_settings.payment_provider raw:', rawSetting, '→ gateway:', provider);

    const buyerPhoneLocal = normalizedPhone;
    let providerResponseMessage = 'Request in progress. You will receive a prompt on your phone.';

    if (!isActivePaymentProviderConfigured(provider)) {
      const label = provider === PAYMENT_PROVIDERS.SONICPESA ? 'SonicPesa' : 'ZenoPay';
      return res.status(503).json({
        error: `${label} haijasanidi kwenye seva. Wasiliana na admin au chagua mtoa huduma mwingine kwenye EaAdmin.`,
        activeProvider: provider,
        configured: false,
      });
    }

    let paymentProviderForRow = provider;
    let usedZenoFallbackForHalotel = false;

    if (provider === PAYMENT_PROVIDERS.SONICPESA) {
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
        bundle: data.bundle,
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
          [userId, data.bundle, planInfo.amount, 'TZS', 'pending', sonicOrderId, PAYMENT_PROVIDERS.SONICPESA, buyerPhoneLocal],
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
      console.warn('[SonicPesa] Initiate failed:', {
        phoneLocal: normalizedPhone,
        phoneForSonicApi,
        status: response.status,
        message: rawErr,
        resultcode: sonicData.resultcode || sonicData.code,
      });

      if (
        isHalotelLocalPhone(normalizedPhone) &&
        isSonicPaymentSendFailure(rawErr, sonicData.resultcode || sonicData.code) &&
        isActivePaymentProviderConfigured(PAYMENT_PROVIDERS.ZENO)
      ) {
        console.warn('[Payment] Halotel + SonicPesa send failure — falling back to ZenoPay for this payment');
        paymentProviderForRow = PAYMENT_PROVIDERS.ZENO;
        usedZenoFallbackForHalotel = true;
      } else {
        return res.status(400).json({
          error: mapSonicInitiateUserError(
            normalizedPhone,
            rawErr,
            sonicData.resultcode || sonicData.code,
          ),
          sonicResponse: sonicData,
        });
      }
    }

    ensureZenoConfigured();

    const webhookUrl =
      process.env.ZENO_WEBHOOK_URL ||
      `${process.env.PUBLIC_BASE_URL || 'https://eamax-production.up.railway.app'}/api/payments/zeno/webhook`;
    console.log(`[Backend] Using webhook URL: ${webhookUrl}`);

    // Insert BEFORE calling Zeno so /status always sees payment_provider=zeno (avoids races with fast polling
    // or admin switching gateway while the HTTP round-trip is in flight).
    await query(
      `INSERT INTO subscription_payments (user_id, plan, amount_cents, currency, status, provider_ref, payment_provider, buyer_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId, data.bundle, planInfo.amount, 'TZS', 'pending', orderId, paymentProviderForRow, buyerPhoneLocal],
    );

    const rollbackPendingZenoByRef = async (ref) => {
      await query(
        `DELETE FROM subscription_payments WHERE provider_ref = $1 AND status = 'pending' AND payment_provider = $2`,
        [ref, paymentProviderForRow],
      );
    };
    const rollbackPendingZenoRow = async () => {
      await rollbackPendingZenoByRef(orderId);
    };

    const phoneForZeno = formatBuyerPhoneForZeno(normalizedPhone);
    // eslint-disable-next-line no-console
    console.log('[ZenoPay] Sending payment request (exact amount):', {
      orderId,
      phone: phoneForZeno,
      phonePrefix: normalizedPhone.slice(0, 3),
      walletHint: resolveZenoMobileWalletProviderHint(normalizedPhone),
      amount: amountToSend,
      bundle: data.bundle,
    });

    const { response, zenoData, phoneUsed } = await initiateZenoPayment({
      orderId,
      normalizedPhone,
      amountToSend,
      data,
      externalId: data.externalId,
      webhookUrl,
    });

    // eslint-disable-next-line no-console
    console.log('[ZenoPay] Response:', {
      status: response.status,
      zenoStatus: zenoData.status,
      message: zenoData.message,
      resultcode: zenoData.resultcode,
      phoneUsed,
      responseOrderId: zenoData.order_id || zenoData.orderId || null,
    });

    if (!response.ok || !String(zenoData.status || '').toLowerCase().includes('success')) {
      await rollbackPendingZenoRow();
      const rawError =
        zenoData.message ||
        (zenoData.resultcode ? `ZenoPay (${zenoData.resultcode})` : '') ||
        'Failed to start payment request';
      return res.status(400).json({
        error: mapPaymentGatewayUserError(rawError, zenoData.resultcode, { context: 'initiate' }),
        zenoResponse: zenoData,
      });
    }

    let clientFacingOrderId = orderId;
    const zenoCanon = String(zenoData.order_id ?? zenoData.orderId ?? '').trim();
    if (zenoCanon && zenoCanon !== orderId) {
      const upd = await query(
        `UPDATE subscription_payments SET provider_ref = $1 WHERE provider_ref = $2 AND status = 'pending' AND payment_provider = $3`,
        [zenoCanon, orderId, paymentProviderForRow],
      );
      const n = upd.rowCount != null ? upd.rowCount : (upd.rows?.length ?? 0);
      if (n < 1) {
        console.warn('[ZenoPay] Could not remap provider_ref to gateway order_id', { orderId, zenoCanon });
      } else {
        console.log('[ZenoPay] provider_ref remapped to gateway order_id', { was: orderId, now: zenoCanon });
        clientFacingOrderId = zenoCanon;
      }
    }

    const postVerify = await zenoQuickPostCreateVerify(clientFacingOrderId);
    if (!postVerify.ok) {
      console.warn('[ZenoPay] Post-create verify failed; rolling back pending row', {
        orderId: clientFacingOrderId,
        reason: postVerify.reason,
      });
      await rollbackPendingZenoByRef(clientFacingOrderId);
      return res.status(400).json({
        error: mapPaymentGatewayUserError(postVerify.reason, '', { context: 'initiate' }),
        zenoPostVerifyFailed: true,
      });
    }

    // Use `pending` — not `success` — so clients never confuse “prompt sent” with “money received”.
    return res.json({
      status: 'pending',
      orderId: clientFacingOrderId,
      message:
        zenoData.message ||
        (usedZenoFallbackForHalotel
          ? 'Ombi limetumwa kupitia ZenoPay (Halopesa). Fuata maelekezo kwenye simu yako.'
          : 'Request in progress. You will receive a prompt on your phone.'),
      provider: PAYMENT_PROVIDERS.ZENO,
      activeProvider: provider,
      ...(usedZenoFallbackForHalotel ? { fallbackFrom: PAYMENT_PROVIDERS.SONICPESA } : {}),
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

/** Premium + unlock all channels for the plan interval (must run inside an open transaction). */
const grantUserEntitlementsInTransaction = async (client, userId, planInterval) => {
  const userUpdate = await client.query(
    `UPDATE users
        SET is_premium = TRUE,
            blocked = FALSE,
            premium_expires_at = GREATEST(COALESCE(premium_expires_at, now()), now()) + $2::interval
      WHERE id = $1
      RETURNING id, is_premium, premium_expires_at, blocked`,
    [userId, planInterval],
  );
  if (userUpdate.rowCount !== 1) {
    throw new Error(`Failed to update user id=${userId} (rowCount=${userUpdate.rowCount})`);
  }
  const unlockResult = await client.query(
    `INSERT INTO user_unlocked_channels (user_id, channel_id)
     SELECT $1, id FROM channels
     ON CONFLICT (user_id, channel_id) DO NOTHING`,
    [userId],
  );
  console.log('[Payment] User premium + channels:', {
    userId,
    premium_expires_at: userUpdate.rows[0].premium_expires_at,
    channelsUnlocked: unlockResult.rowCount,
  });
  return userUpdate.rows[0];
};

/** Idempotent repair if payment row is completed but premium/unlocks were missed. */
const repairUserEntitlements = async (userId, planInterval) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await grantUserEntitlementsInTransaction(client, userId, planInterval);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Payment] repairUserEntitlements failed:', err?.message || err);
  } finally {
    client.release();
  }
};

// Internal helper: apply completed payment to user (uses single DB client so transaction works)
// On success: unlocks all channels, starts remaining time, marks payment completed (revenue + premium count in admin)
// [expectedPaymentProvider] when set (e.g. from webhooks), must match DB row payment_provider — prevents Zeno callbacks from completing Sonic orders and vice versa.
const applyCompletedPayment = async (orderId, meta, options = {}) => {
  const { expectedPaymentProvider = null } = options;
  console.log('[Payment] Applying completed payment for order:', orderId, 'meta:', meta, 'expectedProvider:', expectedPaymentProvider || '(any)');
  const payRes = await query(
    'SELECT id, user_id, plan, amount_cents, currency, status, payment_provider FROM subscription_payments WHERE provider_ref = $1 LIMIT 1',
    [orderId],
  );
  if (payRes.rows.length === 0) {
    console.log('[Payment] No payment found for order:', orderId);
    return null;
  }
  const payment = payRes.rows[0];

  const dbProvider = (payment.payment_provider || PAYMENT_PROVIDERS.ZENO).toLowerCase().trim();
  if (expectedPaymentProvider && dbProvider !== expectedPaymentProvider) {
    console.warn('[Payment] Skipping applyCompletedPayment: payment_provider mismatch', {
      orderId,
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

  const planInfo = PLAN_CONFIG[plan];
  if (!planInfo || !planInfo.interval) {
    console.error('[Payment] Invalid or missing plan:', plan);
    return null;
  }

  if (payment.status === 'completed') {
    console.log('[Payment] Payment already completed:', orderId);
    await repairUserEntitlements(userId, planInfo.interval);
    const user = await fetchUserPremiumSnapshotByUserId(userId);
    return { ...payment, user };
  }

  console.log('[Payment] Found payment:', { id: paymentId, user_id: userId, plan, amount_cents: payment.amount_cents, interval: planInfo.interval });

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
        await repairUserEntitlements(userId, planInfo.interval);
        const user = await fetchUserPremiumSnapshotByUserId(userId);
        return { ...payment, user };
      }
      throw new Error(`Failed to update payment id=${paymentId} (rowCount=${payUpdate.rowCount})`);
    }
    console.log('[Payment] Payment status set to completed, id:', paymentId);

    await grantUserEntitlementsInTransaction(client, userId, planInfo.interval);

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

  const user = await fetchUserPremiumSnapshotByUserId(userId);
  return { ...payment, user };
};

/** Shared GET /status and GET /zeno/status handler. */
const handlePaymentStatusPoll = async (orderId, res, next) => {
  try {
    const dbCheck = await query(
      'SELECT status FROM subscription_payments WHERE provider_ref = $1 LIMIT 1',
      [orderId],
    );

    if (dbCheck.rows.length > 0 && dbCheck.rows[0].status === 'completed') {
      const payRow = await query(
        'SELECT user_id, plan FROM subscription_payments WHERE provider_ref = $1 LIMIT 1',
        [orderId],
      );
      if (payRow.rows.length > 0) {
        const plan = String(payRow.rows[0].plan || '').toLowerCase();
        const planInfo = PLAN_CONFIG[plan];
        if (planInfo?.interval) {
          await repairUserEntitlements(Number(payRow.rows[0].user_id), planInfo.interval);
        }
      }
      return res.json(await buildCompletedStatusPayload(orderId, { data: [{ payment_status: 'COMPLETED' }] }));
    }

    const gateway = await resolveGatewayForOrderId(orderId);
    const expectedProvider =
      gateway === PAYMENT_PROVIDERS.SONICPESA ? PAYMENT_PROVIDERS.SONICPESA : PAYMENT_PROVIDERS.ZENO;

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
        await applyCompletedPayment(orderId, statusData.data || statusData || {}, {
          expectedPaymentProvider: expectedProvider,
        });
        return res.json(await buildCompletedStatusPayload(orderId, statusData));
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

    ensureZenoConfigured();
    const { statusResp, statusData } = await pollZenoOrderStatus(orderId);

    const zenoMessage = String(statusData.message || statusData.error || '').toLowerCase();
    const isOrderNotFound =
      !statusResp.ok &&
      (zenoMessage.includes('no order found') ||
        zenoMessage.includes('order not found') ||
        (zenoMessage.includes('order_id') && zenoMessage.includes('not found')) ||
        statusResp.status === 404);
    if (isOrderNotFound) {
      return res.json({ status: 'PENDING', raw: statusData });
    }

    if (!statusResp.ok) {
      return res.status(400).json({
        error: mapPaymentGatewayUserError(
          statusData.message || statusData.error || 'Failed to fetch order status',
          statusData.resultcode,
        ),
      });
    }

    const { isCompleted, rawStatus, firstItem } = evaluateZenoOrderStatusForApply(statusData);

    if (isCompleted) {
      await applyCompletedPayment(orderId, firstItem || statusData || {}, {
        expectedPaymentProvider: expectedProvider,
      });
      return res.json(await buildCompletedStatusPayload(orderId, statusData));
    }

    const clientStatus = zenoClientStatusFromPoll(isCompleted, rawStatus, statusData);
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

/** Zeno `result: "SUCCESS"` is API-level success, not wallet paid — never leak that to clients as payment status. */
const zenoClientStatusFromPoll = (isCompleted, rawStatus, statusData) => {
  let clientStatus = isCompleted
    ? 'COMPLETED'
    : (rawStatus || (typeof statusData.result === 'string' ? statusData.result : '') || 'PENDING');
  clientStatus = String(clientStatus).toUpperCase().trim() || 'PENDING';
  if (!isCompleted) {
    if (clientStatus === 'SUCCESS' || clientStatus === '000' || clientStatus === 'OK') {
      clientStatus = 'PENDING';
    }
    if (clientStatus === 'UNKNOWN' || clientStatus === '') {
      clientStatus = 'PENDING';
    }
  }
  return clientStatus;
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

// Check payment status (polling from app)
router.get('/zeno/status', async (req, res, next) => {
  try {
    const paramsSchema = z.object({ orderId: z.string().min(1) });
    const { orderId } = paramsSchema.parse(req.query);
    console.log(`[Backend] Checking status for orderId: ${orderId}`);
    return handlePaymentStatusPoll(orderId, res, next);
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
        `SELECT id FROM subscription_payments
           WHERE provider_ref = $1 AND status = $2 AND payment_provider = $3
           LIMIT 1`,
        [webhookOrderId, 'pending', PAYMENT_PROVIDERS.ZENO],
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
      await applyCompletedPayment(webhookOrderId, payload, { expectedPaymentProvider: PAYMENT_PROVIDERS.ZENO });
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

// SonicPesa: production callbacks must hit this URL only (configure in SonicPesa dashboard).
// ZenoPay uses /zeno/webhook separately — each path applies only to its own payment_provider rows.

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

  const st = String(
    payload.status || nest?.status || nest?.payment_status || nest?.paymentStatus || '',
  ).toUpperCase().trim();
  const ev = String(payload.event || payload.type || '').toLowerCase().trim();
  let paid = SONIC_WEBHOOK_PAID_STATUSES.has(st);
  if (!paid && ev) {
    paid =
      ev === 'payment.success' ||
      ev === 'payment.completed' ||
      ev === 'payment_completed' ||
      ev === 'invoice.paid' ||
      ev === 'charge.succeeded';
  }
  return { orderId: orderId || null, paid, raw: st || ev };
};

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

    const pendingSonic = await query(
      `SELECT id FROM subscription_payments
         WHERE provider_ref = $1 AND status = $2 AND payment_provider = $3
         LIMIT 1`,
      [orderId, 'pending', PAYMENT_PROVIDERS.SONICPESA],
    );
    const hasPendingSonic = pendingSonic.rows.length > 0;

    if (SONICPESA_WEBHOOK_SECRET) {
      if (!signatureValid) {
        console.warn('[SonicPesa] Webhook rejected: invalid HMAC (SONICPESA_WEBHOOK_SECRET is set).');
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    } else if (!hasPendingSonic) {
      console.warn('[SonicPesa] Webhook rejected: set SONICPESA_WEBHOOK_SECRET in production, or no pending SonicPesa order for this reference.');
      return res.status(401).json({ error: 'Webhook not verified' });
    } else {
      console.warn('[SonicPesa] Webhook accepted without HMAC (pending SonicPesa order only). Set SONICPESA_WEBHOOK_SECRET for production.');
    }

    if (!paid) {
      return res.status(200).json({ received: true, processed: false });
    }

    try {
      const result = await applyCompletedPayment(orderId, payload, {
        expectedPaymentProvider: PAYMENT_PROVIDERS.SONICPESA,
      });
      if (!result) {
        return res.status(200).json({ received: true, processed: false });
      }
    } catch (e) {
      console.error('[SonicPesa] Webhook applyCompletedPayment failed:', e?.message || e);
      return res.status(500).json({ error: 'Processing failed' });
    }

    return res.status(200).json({ received: true, processed: true });
  } catch (err) {
    console.error('[SonicPesa] Webhook error:', err);
    return next(err);
  }
});

// Manual test-complete — only allowed when PAYMENT_ALLOW_TEST_COMPLETE=1 (never in production without explicit opt-in).
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
router.post('/zeno/complete/:orderId', manualCompleteHandler);

// Unified payment status endpoint - routes to active provider
router.get('/status', async (req, res, next) => {
  const orderId = req.query.orderId;
  if (!orderId) return res.status(400).json({ error: 'orderId parameter required' });
  console.log(`[Backend] Checking status for orderId: ${orderId}`);
  return handlePaymentStatusPoll(orderId, res, next);
});

module.exports = router;

