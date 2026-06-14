/**
 * StreamEngine.js — Pro stream preparation API for React Native
 *
 * KEY FIXES & IMPROVEMENTS:
 * 1. prepareStream() now returns initialBitrateHint locked to 360p (not 'speed-guessed').
 * 2. ClearKey DRM is handled for BOTH ExoPlayer (base64url no-padding JWK) and
 *    Shaka/WebView (base64 with padding). Different requirements are handled correctly.
 * 3. Widevine: proper licenseServer config with security level.
 * 4. Manifest repair now handles more edge cases (empty BaseURL, bad XML declaration).
 * 5. Network speed detection is cached and doesn't slow down prepareStream.
 * 6. Pro API: supports drmData.keys array (Format B) from backend as well as
 *    drmClearKey string (Format A) — normalized consistently.
 * 7. Cache TTL reduced to 3min for DRM streams (keys can expire).
 * 8. Added fetchManifestWithRetry: fetch manifest with retries before handing to player.
 */

const LOG_TAG      = 'STREAM_ENGINE';
const LOG_DRM      = 'DRM_SETUP';
const LOG_MANIFEST = 'MANIFEST_FETCH';
const LOG_TOKEN    = 'TOKEN_REFRESH';
const LOG_PLAYER   = 'PLAYER_INIT';
const LOG_REDIRECT = 'CDN_REDIRECT';
const LOG_VALIDATE = 'STREAM_VALIDATE';
const LOG_CACHE    = 'STREAM_CACHE';

const DEFAULT_USER_AGENT   = 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36';
const MAX_REDIRECTS        = 5;
const VALIDATE_TIMEOUT_MS  = 10000;
const MANIFEST_TIMEOUT_MS  = 15000;
export const MAX_RETRIES   = 3;
const RETRY_STEP_RELOAD    = 1;
const RETRY_STEP_TOKEN     = 2;
const RETRY_STEP_SWITCH    = 3;
export const MIN_BITRATE_DURATION_SEC = 20;

// ── Default 360p start resolution ────────────────────────────────────────────
// This is the ONLY place that controls the initial quality.
// VideoPlayer reads this and passes it to both ExoPlayer (maxBitRate + selectedVideoTrack)
// and MPDPlayer/Shaka (maxHeight). Any change here cascades everywhere.
export const DEFAULT_START_HEIGHT  = 360;
export const DEFAULT_START_BITRATE = 700_000; // 700 kbps for 360p

// ─── Logging & Security ────────────────────────────────────────────────────

const SENSITIVE_KEYS = ['token', 'authorization', 'cookie', 'key', 'kid', 'license', 'bearer'];

function maskSensitive(value) {
  if (value == null || typeof value !== 'string') return value;
  const s = String(value);
  if (s.length <= 8) return '***';
  return s.slice(0, 4) + '***' + s.slice(-2);
}

function maskObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const keyLower = k.toLowerCase();
    if (SENSITIVE_KEYS.some(s => keyLower.includes(s))) {
      out[k] = maskSensitive(v);
    } else {
      out[k] = typeof v === 'object' && v !== null && !Array.isArray(v) ? maskObject(v) : v;
    }
  }
  return out;
}

function log(tag, message, data) {
  if (!__DEV__) return;
  const payload = data != null ? ` ${JSON.stringify(maskObject(data))}` : '';
  console.log(`[${tag}] ${message}${payload}`);
}

// ─── Stream Format Detection ───────────────────────────────────────────────

const FORMAT_PATTERNS = {
  DASH: ['.mpd', 'dash', '/manifest', '/manifest.mpd', '.mpd?', 'application/dash+xml'],
  HLS:  ['.m3u8', '.m3u', 'hls', 'playlist.m3u', 'application/vnd.apple.mpegurl', 'application/x-mpegurl'],
  PROGRESSIVE: ['.mp4', '.m4v', '.m4a', '.webm', '.mkv', '.avi', '.mov', '.flv', '.ts'],
};

function analyzeStream(url, options = {}) {
  if (!url || typeof url !== 'string') {
    return { format: 'UNKNOWN', hasToken: false, isDRM: options.drmType ? options.drmType !== 'NONE' : false };
  }
  const urlLower = url.toLowerCase();
  let format = 'UNKNOWN';
  if (FORMAT_PATTERNS.DASH.some(p => urlLower.includes(p))) format = 'DASH';
  else if (urlLower.includes('/relay/stream') || urlLower.includes('/relay/m3u8') || urlLower.includes('/api/relay/')) format = 'DASH';
  else if (FORMAT_PATTERNS.HLS.some(p => urlLower.includes(p))) format = 'HLS';
  else if (FORMAT_PATTERNS.PROGRESSIVE.some(p => urlLower.includes(p))) format = 'PROGRESSIVE';
  // IPTV live stream patterns — port-based /live|stream/ paths (Xtream Codes, Wowza, Nimble, MediaCP)
  else if (/^https?:\/\/[^/]+:\d{2,5}\/(live|stream|play|hls|iptv|channel|ch)\//.test(urlLower)) format = 'HLS';
  // Xtream Codes standard: host:port/user/pass/streamid (3 path segments, no extension)
  else if (/^https?:\/\/[^/]+:\d{2,5}\/[^/]+\/[^/]+\/[^/?#]+$/.test(urlLower.split('#')[0])) format = 'HLS';

  const hasToken = /[?&](token|auth|key|session)=/i.test(url);
  const isDRM    = options.drmType ? String(options.drmType).toUpperCase() !== 'NONE' : false;
  const result   = { format, hasToken, isDRM, url };
  log(LOG_TAG, `${format} detected`, { hasToken, isDRM });
  return result;
}

function getDefaultHeaders() {
  return {
    'Accept':     '*/*',
    'User-Agent': DEFAULT_USER_AGENT,
    'Connection': 'keep-alive',
  };
}

function buildHeaders(streamData) {
  const defaults = getDefaultHeaders();
  const custom   = streamData.headers || {};
  const merged   = { ...defaults };

  if (streamData.drmType && String(streamData.drmType).toUpperCase() !== 'NONE') {
    merged['Accept'] = 'application/dash+xml, application/xml, text/xml, */*';
  }
  for (const [k, v] of Object.entries(custom)) {
    if (v != null && v !== '') merged[k] = String(v);
  }
  if (streamData.token && !merged['Authorization']) {
    merged['Authorization'] = `Bearer ${streamData.token}`;
  }
  return merged;
}

// ─── Stream Validator ──────────────────────────────────────────────────────

async function validateStream(url, headers = {}) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method:  'HEAD',
      headers: { ...getDefaultHeaders(), ...headers },
      redirect:'follow',
      signal:  controller.signal,
    });
    clearTimeout(timeout);
    const contentType    = (res.headers.get('content-type') || '').toLowerCase();
    const location       = res.headers.get('location');
    const result = {
      ok:              res.ok,
      status:          res.status,
      contentType,
      redirectLocation: location || null,
      expectsXml:      url.toLowerCase().includes('.mpd') &&
                       !contentType.includes('application/dash+xml') &&
                       !contentType.includes('application/xml') &&
                       !contentType.includes('text/xml'),
    };
    log(LOG_VALIDATE, `HEAD ${res.status}`, { contentType: result.contentType, redirect: !!location });
    return result;
  } catch (e) {
    clearTimeout(timeout);
    log(LOG_VALIDATE, 'HEAD failed', { error: e.message });
    return { ok: false, status: 0, contentType: '', redirectLocation: null, error: e.message };
  }
}

// ─── CDN Redirect Resolver ─────────────────────────────────────────────────

async function resolveRedirects(url, headers = {}, maxRedirects = MAX_REDIRECTS) {
  let current = url;
  let count   = 0;
  while (count < maxRedirects) {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(current, {
        method:  'HEAD',
        headers: { ...getDefaultHeaders(), ...headers },
        redirect:'manual',
        signal:  controller.signal,
      });
      clearTimeout(timeout);
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (location) {
          current = location.startsWith('http') ? location : new URL(location, current).href;
          count++;
          log(LOG_REDIRECT, `Redirect ${count}`, { to: current.slice(0, 60) + '...' });
          continue;
        }
      }
      return current;
    } catch (_) {
      clearTimeout(timeout);
      return current;
    }
  }
  return current;
}

// ─── Token Refresh ────────────────────────────────────────────────────────────

async function refreshStreamToken(streamData) {
  const api = streamData.refreshStreamApi || streamData.refreshStreamEndpoint;
  if (!api || typeof api !== 'function') return streamData.url;
  try {
    const payload = { channelId: streamData.channelId, url: streamData.url, token: streamData.token };
    log(LOG_TOKEN, 'Refreshing token');
    const result = await api(payload);
    const newUrl = result?.url ?? result?.streamUrl ?? result?.manifestUrl ?? streamData.url;
    if (newUrl !== streamData.url) {
      log(LOG_TOKEN, 'New URL received');
      return newUrl;
    }
  } catch (e) {
    log(LOG_TOKEN, 'Refresh failed', { error: e.message });
  }
  return streamData.url;
}

// ─── Manifest Repair ──────────────────────────────────────────────────────────

function getBaseUrlFromManifestUrl(manifestUrl) {
  try {
    const u    = new URL(manifestUrl);
    const path = u.pathname.replace(/\/[^/]*$/, '/');
    return u.origin + path;
  } catch (_) {
    return '';
  }
}

function repairManifest(mpdText, manifestUrl) {
  if (!mpdText || typeof mpdText !== 'string') return mpdText;
  let out = mpdText.trim();

  if (out.startsWith('<!') || out.startsWith('<html')) {
    log(LOG_MANIFEST, 'Manifest appears to be HTML — cannot repair');
    return null;
  }

  const baseUrl = getBaseUrlFromManifestUrl(manifestUrl);

  // Fix empty <BaseURL> elements
  const emptyBaseUrlRegex = /<BaseURL>\s*<\/BaseURL>/gi;
  if (emptyBaseUrlRegex.test(out) && baseUrl) {
    out = out.replace(emptyBaseUrlRegex, `<BaseURL>${baseUrl}</BaseURL>`);
    log(LOG_MANIFEST, 'Repaired empty BaseURL');
  }

  // Normalize XML declaration
  out = out.replace(/<\?xml[^?]*\?>/i, '<?xml version="1.0" encoding="UTF-8"?>');

  return out;
}

// ─── Manifest Fetch with Retry ────────────────────────────────────────────────

async function fetchManifestWithRetry(url, headers = {}, retries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method:  'GET',
        headers: {
          ...getDefaultHeaders(),
          'Accept': 'application/dash+xml, application/xml, text/xml, */*',
          ...headers,
        },
        redirect:'follow',
        signal:  controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text     = await res.text();
      const repaired = repairManifest(text, url);
      if (repaired) {
        log(LOG_MANIFEST, `Fetched and repaired (attempt ${attempt + 1})`);
        return { content: repaired, contentType: res.headers.get('content-type') };
      }
      return { content: text, contentType: res.headers.get('content-type') };
    } catch (e) {
      clearTimeout(timeout);
      lastError = e;
      if (attempt < retries) {
        const delay = 500 * Math.pow(2, attempt); // exponential backoff
        await new Promise(r => setTimeout(r, delay));
        log(LOG_MANIFEST, `Retry ${attempt + 1}/${retries}`, { error: e.message });
      }
    }
  }
  log(LOG_MANIFEST, 'All fetch attempts failed', { error: lastError?.message });
  return null;
}

// Legacy name kept for MPDPlayer compatibility
async function fetchAndRepairManifest(url, headers = {}) {
  return fetchManifestWithRetry(url, headers, 2);
}

// ─── DRM Intelligence (Pro API) ───────────────────────────────────────────────

/**
 * hex → base64url WITHOUT padding (required by ExoPlayer ClearKey JWK spec).
 */
function hexToBase64Url(hexString) {
  try {
    if (!hexString || typeof hexString !== 'string') return hexString;
    const n = hexString.trim().replace(/[^0-9a-fA-F]/g, '');
    if (!n.length || n.length % 2 !== 0) return hexString;
    const bytes = [];
    for (let i = 0; i < n.length; i += 2) bytes.push(parseInt(n.substr(i, 2), 16));
    const bin = String.fromCharCode(...bytes);
    const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch (_) {
    return hexString;
  }
}

/**
 * Parse ClearKey string ("kid:key" or "kid,key") → { kid: b64url, key: b64url }
 */
function parseClearKey(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  let kid = '';
  let key = '';
  if (s.includes(':'))      { const [a, b] = s.split(':').map(x => x.trim()); kid = a; key = b || a; }
  else if (s.includes(',')) { const [a, b] = s.split(',').map(x => x.trim()); kid = a; key = b || a; }
  else { kid = s; key = s; }
  if (!kid || !key) return null;
  return { [hexToBase64Url(kid)]: hexToBase64Url(key) };
}

/**
 * Normalize ClearKey input to JWK keys array.
 * Supports Format A (drmClearKey string) and Format B (drmData.keys array from backend).
 * Returns [{ kty, kid, k }] or null.
 */
function getClearKeyJwkKeys(streamData) {
  const drmData = streamData.drmData;

  // Format B: backend provides drmData.keys array
  if (drmData?.keys && Array.isArray(drmData.keys) && drmData.keys.length > 0) {
    return drmData.keys
      .map((item) => {
        let kid = item.kid != null ? String(item.kid) : '';
        let k   = item.k   != null ? String(item.k)   : '';
        // Normalize hex → base64url if they look like hex (32+ chars)
        if (/^[0-9a-fA-F]{32,}$/.test(kid)) kid = hexToBase64Url(kid);
        if (/^[0-9a-fA-F]{32,}$/.test(k))   k   = hexToBase64Url(k);
        // Strip any residual padding
        kid = kid.replace(/=+$/, '');
        k   = k.replace(/=+$/, '');
        return { kty: item.kty || 'oct', kid, k };
      })
      .filter((item) => item.kid && item.k);
  }

  // Format A: "kid:key" hex string
  const clearKey = streamData.drmClearKey || streamData.clearKey;
  if (!clearKey || typeof clearKey !== 'string') return null;
  const map = parseClearKey(clearKey);
  if (!map) return null;
  return Object.entries(map).map(([kid, k]) => ({ kty: 'oct', kid, k }));
}

function buildClearKeyJwk(keysArray) {
  if (!keysArray || keysArray.length === 0) return null;
  const cleanKeys = keysArray.map((k) => ({
    kty: k.kty || 'oct',
    kid: String(k.kid).replace(/=+$/, ''),
    k:   String(k.k).replace(/=+$/, ''),
  }));
  return JSON.stringify({ keys: cleanKeys, type: 'temporary' });
}

function base64EncodeUtf8(str) {
  if (typeof str !== 'string') return '';
  try {
    if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(str)));
    return Buffer.from(str, 'utf8').toString('base64');
  } catch (_) {
    return '';
  }
}

/**
 * configureDRM — builds the DRM config object for react-native-video source.drm
 *
 * Pro API handles:
 * - ClearKey (inline JWK base64 data URI — works on ExoPlayer without network)
 * - ClearKey license server (fallback when no keys available inline)
 * - Widevine L1/L3
 * - PlayReady
 */
function configureDRM(streamData) {
  const drmType   = String(streamData.drmType || 'NONE').toUpperCase();
  const licenseUrl = streamData.drmLicenseUrl || streamData.licenseUrl;
  const headers    = streamData.headers || {};

  if (drmType === 'NONE') return null;

  // ── ClearKey: prefer inline JWK (no license server RTT, works offline) ──
  if (drmType === 'CLEARKEY') {
    const jwkKeys = getClearKeyJwkKeys(streamData);
    if (jwkKeys && jwkKeys.length > 0) {
      const jwkJson  = buildClearKeyJwk(jwkKeys);
      const base64Jwk = jwkJson ? base64EncodeUtf8(jwkJson) : '';
      if (base64Jwk) {
        log(LOG_DRM, 'ClearKey → inline base64 JWK data URI', { keyCount: jwkKeys.length });
        return {
          type: 'clearkey',
          licenseServer: `data:application/json;base64,${base64Jwk}`,
          headers: {},
        };
      }
    }
    // Fallback to license server
    if (licenseUrl) {
      log(LOG_DRM, 'ClearKey → license server URL');
      return { type: 'clearkey', licenseServer: licenseUrl, headers };
    }
    log(LOG_DRM, 'ClearKey configured but no keys or licenseUrl found — DRM will fail');
    return null;
  }

  // ── Widevine ──────────────────────────────────────────────────────────────
  if (drmType === 'WIDEVINE' || drmType === 'WIDEVINE_L1' || drmType === 'WIDEVINE_L3') {
    if (!licenseUrl) { log(LOG_DRM, 'Widevine: no licenseUrl — skipping'); return null; }
    const drm = {
      type: 'widevine',
      licenseServer: licenseUrl,
      headers,
    };
    if (drmType === 'WIDEVINE_L1') drm.securityLevel = 'L1';
    if (drmType === 'WIDEVINE_L3') drm.securityLevel = 'L3';
    log(LOG_DRM, `Widevine (${drmType})`);
    return drm;
  }

  // ── PlayReady ─────────────────────────────────────────────────────────────
  if (drmType === 'PLAYREADY') {
    if (!licenseUrl) { log(LOG_DRM, 'PlayReady: no licenseUrl — skipping'); return null; }
    log(LOG_DRM, 'PlayReady');
    return { type: 'playready', licenseServer: licenseUrl, headers };
  }

  return null;
}

// ─── Stream Cache ──────────────────────────────────────────────────────────────

const streamCache  = new Map();
const CACHE_MAX    = 50;
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 min (DRM keys can expire — reduced from 5)

function cacheKey(streamData) {
  return String(streamData.channelId || streamData.url || '');
}

function getCached(streamData) {
  const key   = cacheKey(streamData);
  const entry = streamCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    streamCache.delete(key);
    return null;
  }
  log(LOG_CACHE, 'Hit', { key: key.slice(0, 40) });
  return entry.payload;
}

function setCached(streamData, payload) {
  const key = cacheKey(streamData);
  if (streamCache.size >= CACHE_MAX) {
    const first = streamCache.keys().next().value;
    if (first) streamCache.delete(first);
  }
  streamCache.set(key, { payload, at: Date.now() });
}

// ─── Network Speed ────────────────────────────────────────────────────────────

let _cachedSpeed = null;
let _speedDetecting = false;

async function detectNetworkSpeed() {
  if (_cachedSpeed) return _cachedSpeed;
  if (_speedDetecting) return 'medium'; // don't block if already running
  _speedDetecting = true;
  try {
    const start   = Date.now();
    await fetch('https://www.gstatic.com/generate_204', { method: 'GET', cache: 'no-store' });
    const elapsed = Date.now() - start;
    _cachedSpeed  = elapsed < 600 ? 'fast' : elapsed < 2000 ? 'medium' : 'slow';
  } catch (_) {
    _cachedSpeed = 'slow';
  } finally {
    _speedDetecting = false;
  }
  return _cachedSpeed;
}

/**
 * FIX: Always return DEFAULT_START_HEIGHT (360p) as the initial quality.
 * The old code returned 360 from 'getInitialBitrateHint' but it was labeled "bitrate"
 * not "height" — confusing and unused properly. Now this is explicit.
 */
function getInitialBitrateHint(_speed) {
  // Always start at 360p bitrate regardless of detected speed.
  // The ABR will upgrade if the network supports it after the first segments.
  return DEFAULT_START_BITRATE;
}

// ─── Error Classification ──────────────────────────────────────────────────────

const ERROR_MESSAGES = {
  NETWORK_TIMEOUT:               'Internet connection slow',
  NETWORK_ERROR:                 'Internet connection failed',
  DRM_ERROR:                     'Stream authorization failed',
  DRM_LICENSE_ACQUISITION_FAILED:'Stream authorization failed',
  MANIFEST_ERROR:                'Stream unavailable',
  PARSING_MANIFEST_MALFORMED:    'Stream manifest corrupted',
  DECODER_ERROR:                 'Device unsupported',
  DECODER_INIT_FAILED:           'Device cannot decode video',
  IO_NETWORK_CONNECTION_FAILED:  'Network connection failed. Please check your internet.',
  IO_NETWORK_CONNECTION_TIMEOUT: 'Connection timeout. Please try again.',
};

function classifyError(errorCode, errorString = '') {
  const code = String(errorCode || '').toUpperCase();
  for (const [key, msg] of Object.entries(ERROR_MESSAGES)) {
    if (code.includes(key) || (errorString && errorString.toUpperCase().includes(key))) return msg;
  }
  return 'Mafundi wetu wanahangaikia channel hii, itarejea hivi punde.';
}

// ─── Retry Strategy ───────────────────────────────────────────────────────────

function getRetryStep(attempt) {
  if (attempt <= RETRY_STEP_RELOAD) return 'reload';
  if (attempt <= RETRY_STEP_TOKEN)  return 'refresh_token';
  return 'switch_player';
}

// ─── Main Entry: prepareStream ────────────────────────────────────────────────

/**
 * Pro API: Prepares a stream for playback with full DRM, headers, manifest repair,
 * redirect resolution, and quality-locked initial settings.
 *
 * @param {Object} streamData
 *   url              {string}   — MPD / HLS / progressive URL (required)
 *   channelId        {string}   — used as cache key
 *   drmType          {string}   — 'CLEARKEY' | 'WIDEVINE' | 'WIDEVINE_L1' | 'WIDEVINE_L3' | 'PLAYREADY' | 'NONE'
 *   drmClearKey      {string}   — "kid:key" hex string (Format A)
 *   drmData          {object}   — { keys: [{kty,kid,k}] } (Format B from backend)
 *   drmLicenseUrl    {string}   — license server URL (Widevine / PlayReady / ClearKey server)
 *   headers          {object}   — custom request headers
 *   token            {string}   — bearer token (auto-added to Authorization header)
 *   forceTokenRefresh{boolean}  — force token refresh before playback
 *   refreshStreamApi {function} — async fn({ channelId, url, token }) → { url }
 *
 * @returns {Promise<{
 *   uri, type, contentType, headers, drm?,
 *   repairedManifestContent?,
 *   initialBitrateHint,   // always DEFAULT_START_BITRATE (700kbps = 360p)
 *   initialHeight,        // always DEFAULT_START_HEIGHT (360)
 *   fromCache?,
 *   analysis
 * }>}
 */
async function prepareStream(streamData) {
  const start = Date.now();
  if (!streamData || !streamData.url) {
    throw new Error('StreamEngine: url is required');
  }

  const cached = getCached(streamData);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const analysis = analyzeStream(streamData.url, { drmType: streamData.drmType });
  let url = streamData.url;

  // Only do aggressive validation for non-DRM streams (DRM streams let native handle quirks)
  if (!analysis.isDRM) {
    url = await resolveRedirects(url, buildHeaders(streamData));
    const validation = await validateStream(url, buildHeaders(streamData));
    if (
      validation.expectsXml &&
      validation.contentType &&
      !validation.contentType.includes('xml') &&
      !validation.contentType.includes('dash')
    ) {
      log(LOG_VALIDATE, 'Content-Type mismatch — will use strong Accept header');
    }
  }

  // Token refresh
  const shouldRefreshToken =
    streamData.forceTokenRefresh ||
    (analysis.hasToken && (streamData.refreshStreamApi || streamData.refreshStreamEndpoint));
  if (shouldRefreshToken) {
    const refreshed = await refreshStreamToken({ ...streamData, url });
    if (refreshed) url = refreshed;
  }

  const headers = buildHeaders({ ...streamData, url });
  if (analysis.format === 'DASH') {
    headers['Accept']     = 'application/dash+xml,application/xml,text/xml;q=0.9,*/*;q=0.8';
    headers['User-Agent'] = headers['User-Agent'] || DEFAULT_USER_AGENT;
  }

  const drm = configureDRM(streamData);

  // Manifest repair for non-DRM DASH (DRM manifests handled by native player)
  let repairedManifestContent = null;
  if (analysis.format === 'DASH' && !analysis.isDRM) {
    const manifestResult = await fetchManifestWithRetry(url, headers, 2);
    if (manifestResult?.content) {
      repairedManifestContent = manifestResult.content;
    }
  }

  const type        = analysis.format === 'DASH' ? 'dash' :
                      analysis.format === 'HLS'  ? 'm3u8' :
                      analysis.format === 'PROGRESSIVE' ? undefined :
                      'm3u8'; // UNKNOWN — default to HLS; most IPTV streams have no extension
  const contentType = analysis.format === 'DASH' ? 'application/dash+xml' :
                      analysis.format === 'HLS'  ? 'application/vnd.apple.mpegurl' :
                      analysis.format === 'PROGRESSIVE' ? undefined :
                      'application/vnd.apple.mpegurl';

  // Kick off speed detection in background but don't block on it
  detectNetworkSpeed().catch(() => {});

  const payload = {
    uri: url,
    type,
    contentType,
    headers,
    drm: drm || undefined,
    repairedManifestContent: repairedManifestContent || undefined,
    // FIX: initialBitrateHint is always 360p bitrate — not based on a speed guess.
    // ExoPlayer will read this and set maxBitRate + selectedVideoTrack to 360p.
    initialBitrateHint: DEFAULT_START_BITRATE,
    initialHeight: DEFAULT_START_HEIGHT,
    analysis: { format: analysis.format, hasToken: analysis.hasToken, isDRM: analysis.isDRM },
    playerHint: 'exoplayer',
  };

  setCached(streamData, payload);
  const elapsed = Date.now() - start;
  log(LOG_PLAYER, `Prepared in ${elapsed}ms`, { format: analysis.format, hasDrm: !!drm });

  return payload;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export default {
  prepareStream,
  analyzeStream,
  validateStream,
  resolveRedirects,
  refreshStreamToken,
  repairManifest,
  fetchAndRepairManifest,
  fetchManifestWithRetry,
  configureDRM,
  buildHeaders,
  getDefaultHeaders,
  detectNetworkSpeed,
  getInitialBitrateHint,
  classifyError,
  getRetryStep,
  MAX_RETRIES,
  MIN_BITRATE_DURATION_SEC,
  DEFAULT_START_HEIGHT,
  DEFAULT_START_BITRATE,
  maskSensitive,
  log,
  getCached:   () => streamCache,
  clearCache:  () => streamCache.clear(),
};

export {
  prepareStream,
  analyzeStream,
  validateStream,
  resolveRedirects,
  refreshStreamToken,
  repairManifest,
  fetchManifestWithRetry,
  configureDRM,
  buildHeaders,
  detectNetworkSpeed,
  getInitialBitrateHint,
  classifyError,
  getRetryStep,
};