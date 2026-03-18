/**
 * StreamEngine - Stream Intelligence Layer
 * Single entry point to prepare and repair streams before playback.
 * Architecture: Analyzer → Header Injector → Token Manager → Manifest Repair → DRM Configurator → Player
 */

const LOG_TAG = 'STREAM_ENGINE';
const LOG_DRM = 'DRM_SETUP';
const LOG_MANIFEST = 'MANIFEST_FETCH';
const LOG_TOKEN = 'TOKEN_REFRESH';
const LOG_PLAYER = 'PLAYER_INIT';
const LOG_REDIRECT = 'CDN_REDIRECT';
const LOG_VALIDATE = 'STREAM_VALIDATE';
const LOG_CACHE = 'STREAM_CACHE';

const DEFAULT_USER_AGENT = 'ExoPlayerLib/2.18 (Linux; Android 11)';
const MAX_REDIRECTS = 5;
const VALIDATE_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const RETRY_STEP_RELOAD = 1;
const RETRY_STEP_TOKEN = 2;
const RETRY_STEP_SWITCH_PLAYER = 3;
const MIN_BITRATE_DURATION_SEC = 20;

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

// ─── Stream Analyzer ───────────────────────────────────────────────────────

const FORMAT_PATTERNS = {
  DASH: ['.mpd', 'dash', '/manifest', '/manifest.mpd', '.mpd?', 'application/dash+xml'],
  HLS: ['.m3u8', '.m3u', 'hls', 'playlist.m3u', 'application/vnd.apple.mpegurl', 'application/x-mpegurl'],
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

  const hasToken = /[?&](token|auth|key|session)=/i.test(url);
  const isDRM = options.drmType ? String(options.drmType).toUpperCase() !== 'NONE' : false;

  const result = { format, hasToken, isDRM, url };
  log(LOG_TAG, `${format} detected`, { hasToken, isDRM });
  return result;
}

// ─── Header Injector ───────────────────────────────────────────────────────

function getDefaultHeaders() {
  return {
    'Accept': '*/*',
    'User-Agent': DEFAULT_USER_AGENT,
    'Connection': 'keep-alive',
  };
}

function buildHeaders(streamData) {
  const defaults = getDefaultHeaders();
  const custom = streamData.headers || {};
  const merged = { ...defaults };

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

// ─── Stream Validator (HEAD) ────────────────────────────────────────────────

async function validateStream(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { ...getDefaultHeaders(), ...headers },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const location = res.headers.get('location');
    const result = {
      ok: res.ok,
      status: res.status,
      contentType,
      redirectLocation: location || null,
      expectsXml: url.toLowerCase().includes('.mpd') && !contentType.includes('application/dash+xml') && !contentType.includes('application/xml') && !contentType.includes('text/xml'),
    };
    log(LOG_VALIDATE, `HEAD ${res.status}`, { contentType: result.contentType, redirect: !!location });
    return result;
  } catch (e) {
    clearTimeout(timeout);
    log(LOG_VALIDATE, 'HEAD failed', { error: e.message });
    return { ok: false, status: 0, contentType: '', redirectLocation: null, error: e.message };
  }
}

// ─── CDN Redirect Resolver ──────────────────────────────────────────────────

async function resolveRedirects(url, headers = {}, maxRedirects = MAX_REDIRECTS) {
  let current = url;
  let count = 0;
  while (count < maxRedirects) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(current, {
        method: 'HEAD',
        headers: { ...getDefaultHeaders(), ...headers },
        redirect: 'manual',
        signal: controller.signal,
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

// ─── Token Refresh ───────────────────────────────────────────────────────────

async function refreshStreamToken(streamData) {
  const api = streamData.refreshStreamApi || streamData.refreshStreamEndpoint;
  if (!api || typeof api !== 'function') return streamData.url;

  try {
    const payload = {
      channelId: streamData.channelId,
      url: streamData.url,
      token: streamData.token,
    };
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

// ─── Manifest Repair ───────────────────────────────────────────────────────

function getBaseUrlFromManifestUrl(manifestUrl) {
  try {
    const u = new URL(manifestUrl);
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
    log(LOG_MANIFEST, 'Manifest appears to be HTML, cannot repair');
    return null;
  }

  const baseUrl = getBaseUrlFromManifestUrl(manifestUrl);
  const emptyBaseUrlRegex = /<BaseURL>\s*<\/BaseURL>/gi;
  if (emptyBaseUrlRegex.test(out) && baseUrl) {
    out = out.replace(emptyBaseUrlRegex, `<BaseURL>${baseUrl}</BaseURL>`);
    log(LOG_MANIFEST, 'Repaired empty BaseURL');
  }

  const wrongMimeMatch = out.match(/<\?xml[^?]*encoding="[^"]*"\?>/i);
  if (wrongMimeMatch) {
    out = out.replace(/<\?xml[^?]*\?>/i, '<?xml version="1.0" encoding="UTF-8"?>');
  }

  return out;
}

async function fetchAndRepairManifest(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { ...getDefaultHeaders(), 'Accept': 'application/dash+xml, application/xml, text/xml, */*', ...headers },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text();
    const repaired = repairManifest(text, url);
    if (repaired) {
      log(LOG_MANIFEST, 'Manifest fetched and repaired');
      return { content: repaired, contentType: res.headers.get('content-type') };
    }
    return { content: text, contentType: res.headers.get('content-type') };
  } catch (e) {
    clearTimeout(timeout);
    log(LOG_MANIFEST, 'Fetch failed', { error: e.message });
    return null;
  }
}

// ─── DRM Intelligence ───────────────────────────────────────────────────────

function hexToBase64Url(hexString) {
  try {
    if (!hexString || typeof hexString !== 'string') return hexString;
    const n = hexString.trim();
    if (!/^[0-9a-fA-F]+$/.test(n) || n.length % 2 !== 0) return hexString;
    const bytes = [];
    for (let i = 0; i < n.length; i += 2) bytes.push(parseInt(n.substr(i, 2), 16));
    const bin = String.fromCharCode(...bytes);
    const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch (_) {
    return hexString;
  }
}

function parseClearKey(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  let kid = '';
  let key = '';
  if (s.includes(':')) {
    const [a, b] = s.split(':').map(x => x.trim());
    kid = a;
    key = b || a;
  } else if (s.includes(',')) {
    const [a, b] = s.split(',').map(x => x.trim());
    kid = a;
    key = b || a;
  } else {
    kid = s;
    key = s;
  }
  if (!kid || !key) return null;
  return { [hexToBase64Url(kid)]: hexToBase64Url(key) };
}

/** Normalize to JWK keys array: Format A (drmClearKey string) or Format B (drmData.keys). */
function getClearKeyJwkKeys(streamData) {
  const drmData = streamData.drmData;
  if (drmData?.keys && Array.isArray(drmData.keys) && drmData.keys.length > 0) {
    return drmData.keys.map((item) => ({
      kty: item.kty || 'oct',
      kid: item.kid != null ? String(item.kid) : '',
      k: item.k != null ? String(item.k) : '',
    })).filter((item) => item.kid && item.k);
  }
  const clearKey = streamData.drmClearKey || streamData.clearKey;
  if (!clearKey || typeof clearKey !== 'string') return null;
  const map = parseClearKey(clearKey);
  if (!map) return null;
  return Object.entries(map).map(([kid, k]) => ({ kty: 'oct', kid, k }));
}

function buildClearKeyJwk(clearKeysMapOrKeysArray) {
  let keys;
  if (Array.isArray(clearKeysMapOrKeysArray)) {
    keys = clearKeysMapOrKeysArray.filter((k) => k && k.kid != null && k.k != null);
  } else if (clearKeysMapOrKeysArray && typeof clearKeysMapOrKeysArray === 'object') {
    keys = Object.entries(clearKeysMapOrKeysArray).map(([kid, k]) => ({ kty: 'oct', kid, k }));
  } else {
    return null;
  }
  if (!keys || keys.length === 0) return null;
  return JSON.stringify({ keys, type: 'temporary' });
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

function configureDRM(streamData) {
  const drmType = String(streamData.drmType || 'NONE').toUpperCase();
  const licenseUrl = streamData.drmLicenseUrl || streamData.licenseUrl;
  const headers = streamData.headers || {};

  if (drmType === 'NONE') return null;

  if (drmType === 'CLEARKEY') {
    const jwkKeys = getClearKeyJwkKeys(streamData);
    if (jwkKeys && jwkKeys.length > 0) {
      const jwkJson = buildClearKeyJwk(jwkKeys);
      const base64Jwk = jwkJson ? base64EncodeUtf8(jwkJson) : '';
      if (base64Jwk) {
        log(LOG_DRM, 'ClearKey configured (inline base64 JWK)', { keyCount: jwkKeys.length });
        return { type: 'clearkey', licenseServer: `data:application/json;base64,${base64Jwk}` };
      }
    }
    if (licenseUrl) {
      log(LOG_DRM, 'ClearKey license server');
      return { type: 'clearkey', licenseServer: licenseUrl, headers };
    }
  }

  if ((drmType === 'WIDEVINE' || drmType === 'WIDEVINE_L1' || drmType === 'WIDEVINE_L3') && licenseUrl) {
    log(LOG_DRM, 'Widevine configured');
    return {
      type: 'widevine',
      licenseServer: licenseUrl,
      headers,
      ...(drmType === 'WIDEVINE_L1' && { securityLevel: 'L1' }),
      ...(drmType === 'WIDEVINE_L3' && { securityLevel: 'L3' }),
    };
  }

  if (drmType === 'PLAYREADY' && licenseUrl) {
    log(LOG_DRM, 'PlayReady configured');
    return { type: 'playready', licenseServer: licenseUrl, headers };
  }

  return null;
}

// ─── Stream Cache ────────────────────────────────────────────────────────────

const streamCache = new Map();
const CACHE_MAX = 50;
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(streamData) {
  const id = streamData.channelId || streamData.url || '';
  return String(id);
}

function getCached(streamData) {
  const key = cacheKey(streamData);
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

// ─── Network Speed (adaptive bitrate hint) ───────────────────────────────────

let _cachedSpeed = null;

async function detectNetworkSpeed() {
  if (_cachedSpeed) return _cachedSpeed;
  try {
    const start = Date.now();
    await fetch('https://www.gstatic.com/generate_204', { method: 'GET', cache: 'no-store' });
    const elapsed = Date.now() - start;
    if (elapsed < 800) _cachedSpeed = 'fast';
    else if (elapsed < 2500) _cachedSpeed = 'medium';
    else _cachedSpeed = 'slow';
  } catch (_) {
    _cachedSpeed = 'slow';
  }
  return _cachedSpeed;
}

function getInitialBitrateHint(speed) {
  switch (speed) {
    case 'fast': return 1080;
    case 'medium': return 720;
    default: return 360;
  }
}

// ─── Error Classification ───────────────────────────────────────────────────

const ERROR_MESSAGES = {
  NETWORK_TIMEOUT: 'Internet connection slow',
  NETWORK_ERROR: 'Internet connection failed',
  DRM_ERROR: 'Stream authorization failed',
  DRM_LICENSE_ACQUISITION_FAILED: 'Stream authorization failed',
  MANIFEST_ERROR: 'Stream unavailable',
  PARSING_MANIFEST_MALFORMED: 'Stream manifest corrupted',
  DECODER_ERROR: 'Device unsupported',
  DECODER_INIT_FAILED: 'Device cannot decode video',
  IO_NETWORK_CONNECTION_FAILED: 'Network connection failed. Please check your internet.',
  IO_NETWORK_CONNECTION_TIMEOUT: 'Connection timeout. Please try again.',
};

function classifyError(errorCode, errorString = '') {
  const code = String(errorCode || '').toUpperCase();
  for (const [key, msg] of Object.entries(ERROR_MESSAGES)) {
    if (code.includes(key) || (errorString && errorString.toUpperCase().includes(key))) return msg;
  }
  return errorString || 'Playback error';
}

// ─── Retry Strategy ─────────────────────────────────────────────────────────

function getRetryStep(attempt) {
  if (attempt <= RETRY_STEP_RELOAD) return 'reload';
  if (attempt <= RETRY_STEP_TOKEN) return 'refresh_token';
  return 'switch_player';
}

// ─── Main Entry: prepareStream ──────────────────────────────────────────────

/**
 * Prepares a stream for playback. Single entry point before player.
 * @param {Object} streamData - { url, channelId?, drmType?, drmClearKey?, drmLicenseUrl?, headers?, token?, refreshStreamApi?, fetchClearKey? }
 * @returns {Promise<{ uri, type, headers, drm?, repairedManifestContent?, initialBitrateHint?, fromCache?, analysis? }>}
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

  // For non-DRM streams we can be more aggressive with HEAD/manifest repair.
  // For DRM streams, keep things simple and let ExoPlayer handle most quirks.
  if (!analysis.isDRM) {
    url = await resolveRedirects(url, buildHeaders(streamData));
    const validation = await validateStream(url, buildHeaders(streamData));
    if (validation.expectsXml && validation.contentType && !validation.contentType.includes('xml') && !validation.contentType.includes('dash')) {
      log(LOG_VALIDATE, 'Content-Type may be wrong, using strong Accept header');
    }
  }

  const shouldRefreshToken =
    streamData.forceTokenRefresh || (analysis.hasToken && (streamData.refreshStreamApi || streamData.refreshStreamEndpoint));
  if (shouldRefreshToken) {
    const refreshed = await refreshStreamToken({ ...streamData, url });
    if (refreshed) url = refreshed;
  }

  const headers = buildHeaders({ ...streamData, url });
  if (analysis.format === 'DASH') {
    headers['Accept'] = 'application/dash+xml,application/xml,text/xml;q=0.9,*/*;q=0.8';
    headers['User-Agent'] = headers['User-Agent'] || DEFAULT_USER_AGENT;
  }

  const drm = configureDRM(streamData);
  let repairedManifestContent = null;
  // Only attempt manifest repair for non-DRM DASH streams; DRM manifests should be left to the native player.
  if (analysis.format === 'DASH' && !analysis.isDRM) {
    const manifestResult = await fetchAndRepairManifest(url, headers);
    if (manifestResult && manifestResult.content) {
      repairedManifestContent = manifestResult.content;
    }
  }

  // ExoPlayer expects type + contentType so it uses the correct extractor (avoids ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED)
  const type = analysis.format === 'DASH' ? 'dash' : analysis.format === 'HLS' ? 'm3u8' : undefined;
  const contentType = analysis.format === 'DASH' ? 'application/dash+xml' : analysis.format === 'HLS' ? 'application/vnd.apple.mpegurl' : undefined;
  const speed = await detectNetworkSpeed();
  const initialBitrateHint = getInitialBitrateHint(speed);

  const payload = {
    uri: url,
    type,
    contentType,
    headers,
    drm: drm || undefined,
    repairedManifestContent: repairedManifestContent || undefined,
    initialBitrateHint,
    analysis: { format: analysis.format, hasToken: analysis.hasToken, isDRM: analysis.isDRM },
    playerHint: 'exoplayer',
  };

  setCached(streamData, payload);
  const elapsed = Date.now() - start;
  log(LOG_PLAYER, `Prepared in ${elapsed}ms`, { format: analysis.format, hasDrm: !!drm });

  return payload;
}

// ─── Exports ───────────────────────────────────────────────────────────────

export default {
  prepareStream,
  analyzeStream,
  validateStream,
  resolveRedirects,
  refreshStreamToken,
  repairManifest,
  fetchAndRepairManifest,
  configureDRM,
  buildHeaders,
  getDefaultHeaders,
  detectNetworkSpeed,
  getInitialBitrateHint,
  classifyError,
  getRetryStep,
  MAX_RETRIES,
  MIN_BITRATE_DURATION_SEC,
  maskSensitive,
  log,
  getCached: () => streamCache,
  clearCache: () => streamCache.clear(),
};

export {
  prepareStream,
  analyzeStream,
  validateStream,
  resolveRedirects,
  refreshStreamToken,
  repairManifest,
  configureDRM,
  buildHeaders,
  detectNetworkSpeed,
  getInitialBitrateHint,
  classifyError,
  getRetryStep,
  MAX_RETRIES,
  MIN_BITRATE_DURATION_SEC,
};
