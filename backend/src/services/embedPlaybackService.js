const crypto = require('crypto');
const { URL } = require('url');

const { query } = require('../db');

const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

/** SokaMax setup: cache resolved embeds (upstream rate-limits player.php). */
const SUCCESS_TTL_MS = 120 * 1000;
const FAILURE_TTL_MS = 12 * 1000;
/** Same authorized package marker Washa sends (host accepts com.washatv). */
const EMBED_PACKAGE_NAME = process.env.EMBED_PACKAGE_NAME || 'com.washatv';
const RELAY_TTL_MS = 4 * 60 * 60 * 1000;
const HTML_MAX_BYTES = 512 * 1024;
const PLAYLIST_MAX_BYTES = 2 * 1024 * 1024;

const STREAM_FIELDS = [
  'encryptedMpd',
  'encryptedStream',
  'encryptedUrl',
  'encryptedHls',
  'encryptedDash',
  'encryptedManifest',
];
const LICENSE_FIELDS = [
  'encryptedLicense',
  'encryptedLicence',
  'encryptedDrm',
  'encryptedWidevine',
  'encryptedLicenseUrl',
];
const TOKEN_FIELDS = ['encryptedToken', 'encryptedAuth', 'encryptedAuthToken'];
const KEY_FIELDS = ['keyPart', 'key', 'xorKey', 'decryptKey'];
const CLEAR_KEY_FIELDS = ['encryptedClearKey', 'encryptedClearKeys', 'encryptedKeys'];

const cache = new Map();
const inflight = new Map();

function proxySecret() {
  return (
    process.env.PLAYBACK_PROXY_SECRET
    || process.env.ADMIN_API_KEY
    || process.env.DATABASE_URL
    || 'eamax-embed-playback'
  );
}

function publicBaseUrl(req) {
  const fromEnv = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (req) {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
      .split(',')[0]
      .trim();
    const host = String(req.headers['x-forwarded-host'] || req.get?.('host') || '')
      .split(',')[0]
      .trim();
    if (host) return `${proto}://${host}`;
  }
  return 'https://eamax-production.up.railway.app';
}

function isDirectMediaUrl(url) {
  const raw = String(url || '');
  // mpilali / similar: manifest.php serves application/dash+xml
  if (/\/manifest\.php(\?|#|$)/i.test(raw)) return true;
  return /\.(m3u8|m3u|mpd|mp4|m4v|webm|mkv|mov|ts)(\?|#|$)/i.test(raw);
}

function isEmbedPlaybackUrl(url) {
  const raw = String(url || '').trim();
  if (!raw || isDirectMediaUrl(raw)) return false;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const u = raw.toLowerCase();
  if (/\.(php|asp|aspx|cgi|jsp|html?)(\?|#|\/|$)/i.test(raw)) return true;
  if (u.includes('/embed/') || u.includes('/embed?') || u.includes('/gateway/')) return true;
  if (u.includes('/player/') || u.includes('/play/')) return true;
  if (/youtube\.com\/embed|youtube-nocookie\.com\/embed|player\.vimeo\.com|dailymotion\.com\/embed|facebook\.com\/plugins\/video/.test(u)) {
    return true;
  }
  return false;
}

function isPublicHttpUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || '').trim());
  } catch (_) {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  if (host === '0.0.0.0' || host === '::1' || host === 'metadata.google.internal') return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const n = ipv4.slice(1).map((part) => Number(part));
    if (n.some((part) => part > 255)) return false;
    const [a, b] = n;
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

function decodeStreamUrl(raw) {
  return String(raw || '')
    .trim()
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/gi, '&')
    .replace(/&#0*38;/g, '&')
    .replace(/\\\//g, '/');
}

function resolveAgainst(baseUrl, ref) {
  const s = decodeStreamUrl(ref);
  if (!s || s.startsWith('data:') || s.startsWith('javascript:')) return '';
  try {
    if (s.startsWith('//')) return `https:${s}`;
    return new URL(s, baseUrl).toString();
  } catch (_) {
    return '';
  }
}

function kindForUrl(url) {
  if (/\.mpd(\?|#|$)/i.test(url) || /\/manifest\.php(\?|#|$)/i.test(url)) return 'dash';
  if (/\.(mp4|m4v|webm|mkv|mov)(\?|#|$)/i.test(url)) return 'progressive';
  return 'hls';
}

function extensionForKind(kind) {
  if (kind === 'dash') return 'mpd';
  if (kind === 'progressive') return 'mp4';
  return 'm3u8';
}

function pageContext(pageUrl) {
  const page = new URL(pageUrl);
  return {
    referer: pageUrl,
    origin: `${page.protocol}//${page.host}`,
  };
}

function tokenReferer(rawUrl) {
  const match = String(rawUrl || '').match(/\/tok_([^.]+)\.([^.]+)\.([^/]+)\//);
  if (!match) return null;
  try {
    const payload = JSON.parse(Buffer.from(match[2], 'base64url').toString('utf8'));
    const allowed = String(payload.url || payload.referer || payload.origin || '').trim();
    if (!allowed) return null;
    const uri = new URL(allowed);
    const origin = `${uri.protocol}//${uri.host}`;
    return { referer: origin.endsWith('/') ? origin : `${origin}/`, origin };
  } catch (_) {
    return null;
  }
}

function upstreamHeaders(targetUrl, ctx = {}) {
  const headers = {
    'User-Agent': BROWSER_UA,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9,sw;q=0.8',
  };
  const token = tokenReferer(targetUrl);
  const referer = token?.referer || ctx.referer;
  const origin = token?.origin || ctx.origin;
  if (referer) headers.Referer = referer;
  if (origin) headers.Origin = origin;
  if (ctx.authorization) {
    const tokenValue = String(ctx.authorization).trim();
    headers.Authorization = /^bearer\s+/i.test(tokenValue) ? tokenValue : `Bearer ${tokenValue}`;
  }
  return headers;
}

function xorDecrypt(enc, key) {
  if (!enc || !key) return '';
  try {
    const raw = Buffer.from(String(enc).trim(), 'base64');
    const out = Buffer.alloc(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      out[i] = raw[i] ^ key.charCodeAt(i % key.length);
    }
    const text = out.toString('utf8').trim();
    if (text.includes('\u0000')) return '';
    return text;
  } catch (_) {
    return '';
  }
}

function pickQuoted(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`${escaped}[\\s=:]+"([^"]+)"`, 'i'),
      new RegExp(`${escaped}[\\s=:]+'([^']+)'`, 'i'),
      new RegExp(`["']${escaped}["']\\s*:\\s*"([^"]+)"`, 'i'),
      new RegExp(`["']${escaped}["']\\s*:\\s*'([^']+)'`, 'i'),
      new RegExp(`${escaped}\\s*=\\s*\`([^\`]+)\``, 'i'),
    ];
    for (const re of patterns) {
      const value = re.exec(html)?.[1]?.trim();
      if (value) return value;
    }
  }
  return '';
}

function extractManifestUrl(html, baseUrl) {
  const slice = html.length > HTML_MAX_BYTES ? html.slice(0, HTML_MAX_BYTES) : html;
  const found = [];
  const push = (raw) => {
    const abs = resolveAgainst(baseUrl, raw);
    if (abs && isPublicHttpUrl(abs)) found.push(abs);
  };
  for (const match of slice.matchAll(/["'`](https?:\/\/[^"'`\s<>]+)["'`]/gi)) push(match[1]);
  for (const match of slice.matchAll(/https?:\/\/[^\s"'<>()]+?\.(?:m3u8|mpd)(?:[?#][^\s"'<>()]*)?/gi)) {
    push(match[0]);
  }
  for (const match of slice.matchAll(/(?:src|href|file|url|source|streamUrl|playlistUrl|manifestUrl|hlsUrl|dashUrl)\s*[:=]\s*["']([^"']+)["']/gi)) {
    push(match[1]);
  }
  for (const match of slice.matchAll(/["'](\/?[\w\-./%]+\.(?:m3u8|mpd)(?:\?[^"'<>\s]*)?)["']/gi)) {
    push(match[1]);
  }
  const hls = found.find((url) => /\.m3u8(\?|#|$)/i.test(url));
  if (hls) return hls;
  return found.find((url) => /\.mpd(\?|#|$)/i.test(url)) || '';
}

function extractIframeSrc(html, baseUrl) {
  const match = html.match(/<iframe\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  if (!match) return '';
  const abs = resolveAgainst(baseUrl, match[1]);
  return abs && isPublicHttpUrl(abs) ? abs : '';
}

function buildResolved(streamUrl, pageUrl, extra = {}) {
  if (!streamUrl || !isPublicHttpUrl(streamUrl) || !isDirectMediaUrl(streamUrl)) return null;
  const page = pageContext(pageUrl);
  const licenseUrl = String(extra.licenseUrl || '').trim();
  const clearKeyRaw = String(extra.clearKeyRaw || '').trim();
  const authorization = String(extra.authorization || '').trim();
  const nvAuthorizations = String(extra.nvAuthorizations || '').trim();
  let drmType = 'NONE';
  if (licenseUrl) drmType = /playready/i.test(licenseUrl) ? 'PLAYREADY' : 'WIDEVINE';
  else if (clearKeyRaw) drmType = 'CLEARKEY';
  return {
    streamUrl,
    kind: kindForUrl(streamUrl),
    referer: extra.referer || page.referer,
    origin: page.origin,
    authorization,
    /** Nagra / SokaMax: must be sent as HTTP header nv-authorizations on license POST. */
    nvAuthorizations,
    licenseUrl: isPublicHttpUrl(licenseUrl) ? licenseUrl : '',
    clearKeyRaw,
    drmType: extra.drmType || drmType,
  };
}

/** SokaMax: embed.php?app=&key= → player.php?app=&key=&api=1 (sokamax_setup.pdf). */
function isEmbedApiPlayer(parsed) {
  try {
    const path = String(parsed.pathname || '').toLowerCase();
    const isEmbed = path.endsWith('/embed.php') || path.endsWith('embed.php');
    const isPlayer = path.endsWith('/player.php') || path.endsWith('player.php');
    const app = parsed.searchParams.get('app');
    const key = parsed.searchParams.get('key');
    return (isEmbed || isPlayer) && !!app && !!key;
  } catch (_) {
    return false;
  }
}

/** mpilali / similar: player.php?channel=N (or watch.php) → JSON with stream_url + clear_key. */
function isChannelJsonPlayer(parsed) {
  try {
    const path = String(parsed.pathname || '').toLowerCase();
    const isPlayer = path.endsWith('/player.php') || path.endsWith('player.php')
      || path.endsWith('/watch.php') || path.endsWith('watch.php');
    if (!isPlayer) return false;
    if (parsed.searchParams.get('app') && parsed.searchParams.get('key')) return false;
    return !!(
      parsed.searchParams.get('channel')
      || parsed.searchParams.get('ch')
      || parsed.searchParams.get('id')
    );
  } catch (_) {
    return false;
  }
}

function parseChannelPlayerJson(text, pageUrl) {
  let data = null;
  try {
    const trimmed = String(text || '').trim();
    if (!trimmed.startsWith('{')) return null;
    data = JSON.parse(trimmed);
  } catch (_) {
    return null;
  }
  if (!data || data.success === false) return null;
  const streamRaw = String(
    data.stream_url || data.streamUrl || data.mpdPath || data.manifestUrl || data.url || '',
  ).trim();
  if (!streamRaw) return null;
  let streamUrl = streamRaw;
  try {
    streamUrl = new URL(streamRaw, pageUrl).toString();
  } catch (_) {
    return null;
  }
  const clearKeyRaw = String(data.clear_key || data.clearKey || data.clearkey || '').trim();
  const licenseUrl = String(data.license_url || data.licenseUrl || '').trim();
  const nvAuthorizations = String(
    data.authXmlToken || data.auth_xml_token || data.nv_authorizations || '',
  ).trim();
  const drmHint = String(data.drm_type || data.drmType || '').trim().toUpperCase();
  let drmType = 'NONE';
  if (clearKeyRaw || drmHint.includes('CLEAR')) drmType = 'CLEARKEY';
  else if (licenseUrl || drmHint.includes('WIDEVINE')) drmType = 'WIDEVINE';
  else if (drmHint.includes('PLAYREADY')) drmType = 'PLAYREADY';
  return buildResolved(streamUrl, pageUrl, {
    clearKeyRaw,
    licenseUrl,
    nvAuthorizations,
    drmType,
  });
}

async function resolveChannelJsonPlayer(playerUrl, parsed) {
  const origin = `${parsed.protocol}//${parsed.host}`;
  const headers = {
    'User-Agent': BROWSER_UA,
    Accept: 'application/json,text/plain,*/*',
    'X-Requested-With': EMBED_PACKAGE_NAME,
    Referer: `${origin}/`,
    Origin: origin,
  };
  const { response } = await fetchPublic(playerUrl, { headers, timeoutMs: 12000 });
  if (response.status < 200 || response.status >= 300) {
    console.warn(`[embed] channel JSON player HTTP ${response.status}`);
    return null;
  }
  const text = await readLimitedText(response, HTML_MAX_BYTES);
  const resolved = parseChannelPlayerJson(text, playerUrl);
  if (resolved) {
    console.info(`[embed] ✅ channel JSON player → ${resolved.streamUrl.slice(0, 96)}`);
  }
  return resolved;
}

function collectResponseCookies(response) {
  try {
    if (typeof response.headers.getSetCookie === 'function') {
      const list = response.headers.getSetCookie();
      if (Array.isArray(list) && list.length) {
        return list.map((c) => String(c).split(';')[0].trim()).filter(Boolean).join('; ');
      }
    }
  } catch (_) { /* ignore */ }
  const raw = response.headers.get('set-cookie');
  if (!raw) return '';
  return String(raw)
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function resolveEmbedApi(playerUrl, parsed) {
  const app = parsed.searchParams.get('app');
  const key = parsed.searchParams.get('key');
  if (!app || !key) return null;
  const origin = `${parsed.protocol}//${parsed.host}`;
  const embedUrl = `${origin}/embed.php?app=${encodeURIComponent(app)}&key=${encodeURIComponent(key)}`;
  const apiUrl =
    `${origin}/player.php?app=${encodeURIComponent(app)}&key=${encodeURIComponent(key)}`
    + `&api=1&t=${Date.now()}`;

  // Same as Washa: warm embed.php first so cookies / app gate accept player.php.
  let cookieHeader = '';
  try {
    const warmHeaders = {
      ...washaEmbedRequestHeaders(embedUrl),
      Accept: 'text/html,application/xhtml+xml,*/*',
    };
    const warm = await fetchPublic(embedUrl, { headers: warmHeaders, timeoutMs: 10000 });
    cookieHeader = collectResponseCookies(warm.response);
    const warmHtml = await readLimitedText(warm.response, HTML_MAX_BYTES);
    if (/App Haijatambuliwa/i.test(warmHtml)) {
      console.warn('[embed] Embed warm blocked (App Haijatambuliwa)');
      return null;
    }
  } catch (err) {
    console.warn('[embed] Embed warm failed (continuing):', err.message || err);
  }

  const hdrs = {
    'User-Agent': BROWSER_UA,
    Accept: 'application/json',
    'X-Requested-With': EMBED_PACKAGE_NAME,
    Referer: `${origin}/embed.php?app=${encodeURIComponent(app)}&key=${encodeURIComponent(key)}`,
    Origin: origin,
  };
  if (cookieHeader) hdrs.Cookie = cookieHeader;

  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { response } = await fetchPublic(apiUrl, { headers: hdrs, timeoutMs: 15000 });
      const text = await readLimitedText(response, HTML_MAX_BYTES);
      let data = null;
      try {
        data = text.trim().startsWith('{') ? JSON.parse(text) : null;
      } catch (_) {
        data = null;
      }
      if (response.status !== 200 || !data || !data.success || !data.mpdPath) {
        lastErr = String((data && (data.error || data.message)) || `HTTP ${response.status}`).slice(0, 120);
        const retryable =
          /429|502|rate|limekataliwa/i.test(lastErr) || response.status === 429 || response.status === 502;
        if (retryable && attempt < 2) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        console.error(
          `[embed] Embed API resolver: no stream in response (HTTP ${response.status}, error=${lastErr})`,
        );
        return null;
      }
      const streamUrl = String(data.mpdPath).trim();
      const licenseUrl = String(data.licenseUrl || '').trim();
      const authXmlToken = String(data.authXmlToken || '').trim();
      const resolved = buildResolved(streamUrl, playerUrl, {
        licenseUrl,
        nvAuthorizations: authXmlToken,
        drmType: licenseUrl ? 'WIDEVINE' : 'NONE',
        referer: `${origin}/`,
      });
      if (resolved) {
        console.info(`[embed] ✅ Embed API resolved: ${streamUrl}`);
      }
      return resolved;
    } catch (e) {
      lastErr = `${e.name || 'Error'}: ${e.message || e}`;
      console.error(`[embed] Embed API resolver failed: ${lastErr}`);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return null;
}

function extractEmbeddedStream(html, baseUrl) {
  if (!html) return null;
  const trimmed = html.trim();
  if (trimmed.toLowerCase() === 'blocked' || (html.length < 200 && html.toLowerCase().includes('blocked'))) {
    return null;
  }
  const keyPart = pickQuoted(html, KEY_FIELDS);
  if (keyPart) {
    let streamUrl = '';
    for (const name of STREAM_FIELDS) {
      const enc = pickQuoted(html, [name]);
      if (!enc) continue;
      const decoded = xorDecrypt(enc, keyPart);
      if (decoded.toLowerCase().startsWith('http')) {
        streamUrl = decoded;
        break;
      }
    }
    if (streamUrl) {
      let licenseUrl = '';
      for (const name of LICENSE_FIELDS) {
        const enc = pickQuoted(html, [name]);
        if (!enc) continue;
        licenseUrl = xorDecrypt(enc, keyPart);
        if (licenseUrl) break;
      }
      let authorization = '';
      for (const name of TOKEN_FIELDS) {
        const enc = pickQuoted(html, [name]);
        if (!enc) continue;
        authorization = xorDecrypt(enc, keyPart);
        if (authorization) break;
      }
      let clearKeyRaw = '';
      for (const name of CLEAR_KEY_FIELDS) {
        const enc = pickQuoted(html, [name]);
        if (!enc) continue;
        clearKeyRaw = xorDecrypt(enc, keyPart);
        if (clearKeyRaw) break;
      }
      const resolved = buildResolved(streamUrl, baseUrl, { licenseUrl, authorization, clearKeyRaw });
      if (resolved) return resolved;
    }
  }
  const manifest = extractManifestUrl(html, baseUrl);
  if (manifest) return buildResolved(manifest, baseUrl);
  return null;
}

async function fetchPublic(url, { headers, maxBytes, timeoutMs = 8000 } = {}) {
  if (!isPublicHttpUrl(url)) {
    throw new Error('blocked playback url');
  }
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    if (!isPublicHttpUrl(current)) throw new Error('blocked playback url');
    const response = await fetch(current, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('redirect without location');
      current = new URL(location, current).toString();
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new Error('too many redirects');
}

async function readLimitedText(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    chunks.push(Buffer.from(value));
    if (total >= maxBytes) break;
  }
  try { await reader.cancel(); } catch (_) { /* already closed */ }
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}

function peekCachedEmbed(raw) {
  const cached = cache.get(raw);
  if (!cached || cached.expiresAt <= Date.now()) return undefined;
  return cached.value;
}

async function resolveEmbedPlayback(pageUrl, depth = 0) {
  const raw = String(pageUrl || '').trim();
  if (!isEmbedPlaybackUrl(raw) || !isPublicHttpUrl(raw)) return null;
  const cached = peekCachedEmbed(raw);
  if (cached !== undefined) return cached;
  if (depth === 0) {
    const pending = inflight.get(raw);
    if (pending) return pending;
    const job = resolveEmbedPlaybackUncached(raw, 0).finally(() => inflight.delete(raw));
    inflight.set(raw, job);
    return job;
  }
  return resolveEmbedPlaybackUncached(raw, depth);
}

async function resolveEmbedPlaybackUncached(raw, depth) {
  let value = null;
  try {
    // SokaMax / embed.php?app=&key= → player.php?api=1 (before HTML scrape).
    let parsed;
    try {
      parsed = new URL(raw);
    } catch (_) {
      parsed = null;
    }
    if (parsed && isEmbedApiPlayer(parsed)) {
      console.info(`[embed] Resolving PHP player: ${raw}`);
      value = await resolveEmbedApi(raw, parsed);
      if (value) {
        cache.set(raw, { value, expiresAt: Date.now() + SUCCESS_TTL_MS });
        return value;
      }
    }
    if (parsed && isChannelJsonPlayer(parsed)) {
      console.info(`[embed] Resolving channel JSON player: ${raw}`);
      value = await resolveChannelJsonPlayer(raw, parsed);
      if (value) {
        cache.set(raw, { value, expiresAt: Date.now() + SUCCESS_TTL_MS });
        return value;
      }
    }

    const headers = upstreamHeaders(raw, pageContext(raw));
    headers.Accept = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8';
    if (/\.php(\?|#|\/|$)/i.test(raw)) headers['X-Requested-With'] = EMBED_PACKAGE_NAME;
    const { response, finalUrl } = await fetchPublic(raw, { headers, timeoutMs: 8000 });
    if (response.status < 200 || response.status >= 300) {
      value = null;
    } else {
      const html = await readLimitedText(response, HTML_MAX_BYTES);
      value = parseChannelPlayerJson(html, finalUrl || raw)
        || extractEmbeddedStream(html, finalUrl || raw);
      if (!value && depth < 1) {
        const iframe = extractIframeSrc(html, finalUrl || raw);
        if (iframe && iframe !== raw) {
          if (isDirectMediaUrl(iframe)) value = buildResolved(iframe, raw);
          else if (isEmbedPlaybackUrl(iframe)) value = await resolveEmbedPlayback(iframe, depth + 1);
        }
      }
    }
  } catch (err) {
    console.warn('[embed] resolve failed:', err.message || err);
    value = null;
  }
  cache.set(raw, {
    value,
    expiresAt: Date.now() + (value ? SUCCESS_TTL_MS : FAILURE_TTL_MS),
  });
  return value;
}

function playExtension(resolved) {
  return extensionForKind(resolved?.kind);
}

function isOnDeviceEmbedApiUrl(url) {
  // SokaMax embed.php?app=&key= — CDN tokens are IP-bound to whoever called
  // player.php. We resolve on the server and proxy MPD/segments through
  // /api/playback/relay so phones never hit the slow gateway→white-screen path.
  try {
    const parsed = new URL(String(url || '').trim());
    const path = String(parsed.pathname || '').toLowerCase();
    const app = String(parsed.searchParams.get('app') || '').trim();
    const key = String(parsed.searchParams.get('key') || '').trim();
    if (!app || !key) return false;
    return path.endsWith('/embed.php') || path.endsWith('embed.php')
      || path.endsWith('/player.php') || path.endsWith('player.php');
  } catch (_) {
    return false;
  }
}

/** Directory of an MPD URL — relative SegmentTemplate paths resolve against this. */
function mpdDirectoryUrl(mpdUrl) {
  try {
    const u = new URL(String(mpdUrl || '').trim());
    u.hash = '';
    u.search = '';
    const path = u.pathname || '/';
    u.pathname = path.endsWith('/') ? path : path.replace(/[^/]+$/, '');
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    return u.toString();
  } catch (_) {
    return '';
  }
}

/**
 * BaseURL Exo resolves relative $Time$ / $Number$ segments against.
 * Path form: /api/playback/dash/<token>/AzamSport1-…-init.mp4
 * (query-token relays cannot append relative paths).
 */
function dashBaseRelayUrl(apiBase, mpdUrl, ctx) {
  const dir = mpdDirectoryUrl(mpdUrl);
  if (!dir || !isPublicHttpUrl(dir)) return '';
  const httpsBase = String(apiBase || '').replace(/^http:\/\//i, 'https://').replace(/\/$/, '');
  const token = sealRelay({
    u: dir,
    exp: Date.now() + RELAY_TTL_MS,
    r: ctx.referer || '',
    o: ctx.origin || '',
    a: ctx.authorization || '',
    n: ctx.nvAuthorizations || '',
    kind: 'dashbase',
  });
  return `${httpsBase}/api/playback/dash/${encodeURIComponent(token)}/`;
}

/** Rewrite DASH MPD so BaseURL / segment refs go through our IP-matched relay. */
function rewriteMpdXml(text, mpdUrl, baseUrl, ctx) {
  const rewriteAbs = (abs) => {
    if (!abs || !isPublicHttpUrl(abs)) return abs;
    if (/\/api\/playback\/(relay|dash)\//i.test(abs)) return abs;
    if (/\/api\/channels\/\d+\/play\./i.test(abs)) return abs;
    return relayTargetUrl(baseUrl, abs, ctx);
  };
  let out = String(text || '');
  const injectedBase = dashBaseRelayUrl(baseUrl, mpdUrl, ctx);

  // Always force our BaseURL so relative SegmentTemplate ($Time$) hits the relay,
  // not /api/channels/:id/… (that path is version-gated → 426).
  out = out.replace(/<BaseURL>[^<]*<\/BaseURL>/gi, '');
  if (injectedBase) {
    if (/<Period\b[^>]*>/i.test(out)) {
      out = out.replace(/<Period\b[^>]*>/i, (m) => `${m}<BaseURL>${injectedBase}</BaseURL>`);
    } else if (/<MPD\b[^>]*>/i.test(out)) {
      out = out.replace(/<MPD\b[^>]*>/i, (m) => `${m}<BaseURL>${injectedBase}</BaseURL>`);
    }
  }

  out = out.replace(/\b(media|initialization|sourceURL|url)="([^"]+)"/gi, (all, attr, ref) => {
    const raw = String(ref || '').trim();
    // Keep template placeholders relative — they resolve against injected BaseURL.
    if (!raw || raw.includes('$')) return all;
    if (/^https?:\/\//i.test(raw)) return `${attr}="${rewriteAbs(raw)}"`;
    const abs = resolveAgainst(mpdUrl, raw);
    if (!abs || !isPublicHttpUrl(abs)) return all;
    return `${attr}="${rewriteAbs(abs)}"`;
  });
  return out;
}

function looksLikeMpd(url, contentType, bodyPreview) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('dash+xml') || ct.includes('mpd-xml') || ct.includes('application/mpd')) return true;
  if (/\.mpd(\?|#|$)/i.test(String(url || ''))) return true;
  const preview = String(bodyPreview || '').trim();
  return (
    (preview.startsWith('<?xml') && /<MPD[\s>]/i.test(preview))
    || preview.startsWith('<MPD')
  );
}

/** Headers installed apps must send so the host accepts the request (same as Washa). */
function washaEmbedRequestHeaders(rawUrl) {
  let origin = '';
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    origin = `${parsed.protocol}//${parsed.host}`;
  } catch (_) {
    origin = '';
  }
  return {
    'X-Requested-With': EMBED_PACKAGE_NAME,
    'User-Agent': BROWSER_UA,
    ...(origin
      ? {
          Referer: `${origin}/`,
          Origin: origin,
        }
      : {}),
  };
}

function withWashaEmbedHeaders(target, rawUrl) {
  const next = { ...target };
  const headers = {
    ...(next.headers && typeof next.headers === 'object' ? next.headers : {}),
    ...washaEmbedRequestHeaders(rawUrl),
  };
  next.headers = headers;
  next.stream_headers = headers;
  next.streamHeaders = headers;
  return next;
}

/** Installed apps honor channel playbackEngine=webview / webplayer. */
function forceEmbedWebViewEngine(target) {
  const next = { ...target };
  next.playbackEngine = 'webplayer';
  next.playback_engine = 'webplayer';
  next.effectiveEngine = 'webplayer';
  next.effective_engine = 'webplayer';
  next.preferredEngine = 'webplayer';
  if (next.playerConfig && typeof next.playerConfig === 'object') {
    next.playerConfig = {
      ...next.playerConfig,
      preferredEngine: 'webplayer',
      effectiveEngine: 'webplayer',
      playbackEngine: 'webplayer',
      failoverToWebview: true,
    };
  }
  if (next.playbackPolicy && typeof next.playbackPolicy === 'object') {
    next.playbackPolicy = {
      ...next.playbackPolicy,
      preferredEngine: 'webplayer',
      effectiveEngine: 'webplayer',
      playbackEngine: 'webplayer',
      failoverToWebview: true,
    };
  }
  return next;
}

/**
 * Gateway-shaped URL so installed WebViewEngine loads it (needs `.php` / `/embed/`).
 * `/api/playback/watch` previously caused about:blank white screens.
 */
function watchPageUrl(baseUrl, resolved) {
  const httpsBase = String(baseUrl || '').replace(/^http:\/\//i, 'https://').replace(/\/$/, '');
  const token = sealRelay({
    u: resolved.streamUrl,
    exp: Date.now() + RELAY_TTL_MS,
    r: resolved.referer || '',
    o: resolved.origin || '',
    a: resolved.authorization || '',
    n: resolved.nvAuthorizations || '',
    license: resolved.licenseUrl || '',
    clearKey: resolved.clearKeyRaw || '',
    drm: resolved.drmType || 'NONE',
    kind: 'watch',
  });
  return `${httpsBase}/api/playback/embed/player.php?e=${encodeURIComponent(token)}`;
}

/** Hosted WebView player only when Exo cannot take a direct proxied media URL. */
function needsHostedWebPlayer(resolved) {
  if (!resolved?.streamUrl) return false;
  // DASH/HLS go through play.mpd / play.m3u8 → native Exo (avoids Shaka 6001).
  if (resolved.kind === 'dash' || resolved.kind === 'hls') return false;
  return resolved.kind === 'progressive' && !!(resolved.licenseUrl || resolved.clearKeyRaw);
}

function buildWatchPlayerHtml({ manifestUrl, licenseUrl, clearKey, drm }) {
  const manifest = JSON.stringify(String(manifestUrl || ''));
  const license = JSON.stringify(String(licenseUrl || ''));
  const ck = JSON.stringify(String(clearKey || ''));
  const drmType = JSON.stringify(String(drm || 'NONE').toUpperCase());
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<title>EaMax</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{margin:0;height:100%;width:100%;background:#000;overflow:hidden}
video{width:100%;height:100%;object-fit:contain;background:#000;display:block}
@media (orientation:landscape){video{object-fit:cover}}
#spin{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
  background:#000;color:#666;font:14px system-ui,sans-serif;z-index:2}
#err{display:none;position:fixed;inset:0;align-items:center;justify-content:center;
  color:#fff;font:15px/1.5 system-ui,sans-serif;text-align:center;padding:24px;z-index:3}
#err.show{display:flex}
</style>
<script src="https://cdn.jsdelivr.net/npm/mux.js@6.3.0/dist/mux.js"></script>
<script id="shaka-script" src="https://cdn.jsdelivr.net/npm/shaka-player@4.11.4/dist/shaka-player.compiled.js"
  onerror="(function(){var s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.11.4/shaka-player.compiled.min.js';document.head.appendChild(s);})();"></script>
</head><body>
<div id="spin">Connecting…</div>
<video id="v" playsinline webkit-playsinline autoplay muted></video>
<div id="err"></div>
<script>
(function(){
  var manifest=${manifest};
  var license=${license};
  var clearKey=${ck};
  var drmType=${drmType};
  var video=document.getElementById('v');
  var spin=document.getElementById('spin');
  var err=document.getElementById('err');
  var retriedDrm=false;
  function hideSpin(){ spin.style.display='none'; }
  function fail(msg){
    hideSpin();
    err.textContent=msg||'';
    err.className='show';
    try{ parent.postMessage(JSON.stringify({type:'eamax-player-error',fatal:true}),'*'); }catch(e){}
  }
  function ready(){
    hideSpin();
    err.className='';
    var p=video.play();
    if(p&&p.catch) p.catch(function(){});
    setTimeout(function(){ try{ video.muted=false; }catch(e){} }, 300);
  }
  function parseClearKeys(raw){
    raw=String(raw||'').trim();
    if(!raw) return null;
    try{
      var j=JSON.parse(raw);
      if(j&&typeof j==='object'){
        if(j.keys&&Array.isArray(j.keys)){
          var map={};
          j.keys.forEach(function(k){
            if(k&&k.kid&&k.k) map[String(k.kid)]=String(k.k);
          });
          return map;
        }
        return j;
      }
    }catch(e){}
    var map={};
    raw.split(/[,;\\s]+/).forEach(function(pair){
      var p=pair.split(':');
      if(p.length>=2) map[p[0].trim()]=p.slice(1).join(':').trim();
    });
    return Object.keys(map).length?map:null;
  }
  function waitShaka(cb){
    var n=0;
    (function t(){
      if(typeof shaka!=='undefined'){ cb(true); return; }
      if(++n>60){ cb(false); return; }
      setTimeout(t,80);
    })();
  }
  function drmConfig(mode){
    // Android WebView: empty robustness first avoids Shaka 6001; L3 for HDCP-restricted keys.
    var rob = mode==='l3'
      ? ['SW_SECURE_CRYPTO','']
      : ['','SW_SECURE_CRYPTO'];
    var cfg={
      preferredKeySystems:['com.widevine.alpha'],
      defaultAudioRobustnessForWidevine: rob[0],
      defaultVideoRobustnessForWidevine: rob[0],
      advanced:{'com.widevine.alpha':{
        videoRobustness:rob,
        audioRobustness:rob,
        distinctiveIdentifierRequired:false,
        persistentStateRequired:false
      }},
      retryParameters:{maxAttempts:4,baseDelay:400,backoffFactor:2,fuzzFactor:0.5,timeout:12000}
    };
    if(drmType.indexOf('WIDEVINE')>=0 && license){
      cfg.servers={'com.widevine.alpha':license};
    } else if(drmType.indexOf('CLEARKEY')>=0 || clearKey){
      var ckMap=parseClearKeys(clearKey);
      if(ckMap) cfg.clearKeys=ckMap;
    }
    return cfg;
  }
  function start(mode){
    var player=new shaka.Player(video);
    player.configure({
      streaming:{
        bufferingGoal:8,
        rebufferingGoal:1.5,
        bufferBehind:16,
        retryParameters:{maxAttempts:5,baseDelay:400,timeout:15000}
      },
      abr:{enabled:true,restrictions:{maxHeight:720,maxWidth:1280}},
      drm:drmConfig(mode)
    });
    player.addEventListener('error', function(ev){
      var code=ev&&ev.detail&&ev.detail.code;
      // 6001 = key-system config unavailable → flip robustness and retry once.
      if(!retriedDrm && (code===6001 || code===4012)){
        retriedDrm=true;
        try{ player.destroy(); }catch(e){}
        start(mode==='l3'?'soft':'l3');
        return;
      }
      fail(code?('Error '+code):'');
    });
    video.addEventListener('playing', ready);
    player.load(manifest).then(function(){
      try{
        var tracks=player.getVariantTracks()||[];
        var best=null,bestH=-1;
        for(var i=0;i<tracks.length;i++){
          var h=tracks[i].height||0;
          if(h>0&&h<=720&&h>=bestH){ best=tracks[i]; bestH=h; }
        }
        if(best) player.selectVariantTrack(best,true);
      }catch(e){}
      ready();
    }).catch(function(e){
      var code=e&&e.code;
      if(!retriedDrm && (code===6001 || code===4012)){
        retriedDrm=true;
        try{ player.destroy(); }catch(err){}
        start(mode==='l3'?'soft':'l3');
        return;
      }
      fail(code?('Error '+code):'');
    });
  }
  if(!manifest){ fail(); return; }
  waitShaka(function(ok){
    if(!ok){ fail(); return; }
    try{ shaka.polyfill.installAll(); }catch(e){}
    if(!shaka.Player.isBrowserSupported()){ fail(); return; }
    start('soft');
  });
})();
</script></body></html>`;
}

/**
 * Prefer proxied play.mpd / play.m3u8 for Exo (native Widevine).
 * Hosted Shaka page only when there is no direct media kind.
 */
async function presentResolvedEmbed(target, rawUrl, baseUrl, options = {}) {
  const remaining = options.deadlineMs == null ? 8000 : options.deadlineMs;
  let resolved = peekCachedEmbed(rawUrl);
  if (resolved === undefined) {
    if (remaining < 200) {
      resolveEmbedPlayback(rawUrl).catch(() => {});
      return withWashaEmbedHeaders(target, rawUrl);
    }
    resolved = await Promise.race([
      resolveEmbedPlayback(rawUrl),
      new Promise((resolve) => setTimeout(() => resolve(undefined), remaining)),
    ]);
    if (resolved === undefined) {
      resolveEmbedPlayback(rawUrl).catch(() => {});
      return withWashaEmbedHeaders(target, rawUrl);
    }
  }
  if (!resolved?.streamUrl) {
    return withWashaEmbedHeaders(target, rawUrl);
  }
  const httpsBase = String(baseUrl || '').replace(/^http:\/\//i, 'https://').replace(/\/$/, '');
  if (needsHostedWebPlayer(resolved)) {
    const pageUrl = watchPageUrl(httpsBase, resolved);
    let next = {
      ...target,
      stream_url: pageUrl,
      streamUrl: pageUrl,
      drm_type: resolved.drmType || 'NONE',
      drmType: resolved.drmType || 'NONE',
      drm_protected: !!(resolved.licenseUrl || resolved.clearKeyRaw),
      drmProtected: !!(resolved.licenseUrl || resolved.clearKeyRaw),
    };
    next = applyResolvedDrm(next, resolved, httpsBase);
    next = forceEmbedWebViewEngine(withWashaEmbedHeaders(next, rawUrl));
    console.info(`[embed] 📺 hosted webplayer → ${pageUrl.slice(0, 110)}`);
    return next;
  }
  let next = {
    ...target,
    stream_url: playerUrlFor(httpsBase, target.id, resolved),
    streamUrl: playerUrlFor(httpsBase, target.id, resolved),
  };
  next = applyResolvedDrm(next, resolved, httpsBase);
  // Keep auto/exo — native Widevine avoids WebView Shaka 6001.
  console.info(`[embed] 🎬 proxied ${playExtension(resolved)} → ch=${target.id}`);
  return withWashaEmbedHeaders(next, rawUrl);
}

async function rewritePlayerUrl({ channelId, rawUrl, baseUrl, priority = null }) {
  const raw = String(rawUrl || '').trim();
  const id = Number(channelId);
  if (!raw || !Number.isFinite(id) || id <= 0 || !isEmbedPlaybackUrl(raw)) {
    return { url: raw, resolved: null };
  }
  // Resolve → proxied play.mpd for Exo (fast). Hosted page only if needed.
  if (isOnDeviceEmbedApiUrl(raw)) {
    const resolved = await resolveEmbedPlayback(raw);
    if (resolved?.streamUrl) {
      if (needsHostedWebPlayer(resolved)) {
        return {
          url: watchPageUrl(baseUrl, resolved),
          resolved,
          forceWebView: true,
          attachWashaHeaders: true,
          originalEmbedUrl: raw,
        };
      }
      const ext = playExtension(resolved);
      const params = new URLSearchParams();
      if (priority != null && Number.isFinite(Number(priority))) params.set('p', String(Number(priority)));
      const query = params.toString();
      return {
        url: `${baseUrl}/api/channels/${id}/play.${ext}${query ? `?${query}` : ''}`,
        resolved,
        attachWashaHeaders: true,
        originalEmbedUrl: raw,
      };
    }
    return { url: raw, resolved: null, attachWashaHeaders: true, forceWebView: true };
  }
  const resolved = await resolveEmbedPlayback(raw);
  if (!resolved?.streamUrl) return { url: raw, resolved: null };
  if (needsHostedWebPlayer(resolved)) {
    return {
      url: watchPageUrl(baseUrl, resolved),
      resolved,
      forceWebView: true,
      attachWashaHeaders: true,
      originalEmbedUrl: raw,
    };
  }
  const ext = playExtension(resolved);
  const params = new URLSearchParams();
  if (priority != null && Number.isFinite(Number(priority))) params.set('p', String(Number(priority)));
  const query = params.toString();
  return {
    url: `${baseUrl}/api/channels/${id}/play.${ext}${query ? `?${query}` : ''}`,
    resolved,
  };
}

function applyResolvedDrm(target, resolved, baseUrl) {
  if (!resolved) return target;
  const next = { ...target };
  // Always prefer resolved ClearKey over stale admin WIDEVINE/empty license.
  if (resolved.clearKeyRaw) {
    next.drmType = 'CLEARKEY';
    next.drm_type = 'CLEARKEY';
    next.drmClearKey = resolved.clearKeyRaw;
    next.drm_clear_key = resolved.clearKeyRaw;
    next.drm_protected = true;
    next.drmProtected = true;
    next.licenseUrl = null;
    next.license_url = null;
  } else if (resolved.drmType && resolved.licenseUrl) {
    // PDF: do NOT gate on `and not channel.drm_type` — model often defaults WIDEVINE.
    next.licenseUrl = resolved.licenseUrl;
    next.license_url = resolved.licenseUrl;
    next.drmType = resolved.drmType;
    next.drm_type = resolved.drmType;
    next.drm_protected = true;
    next.drmProtected = true;
  }
  // Keep nv-authorizations (SokaMax/Nagra) — without it Widevine license spins forever.
  const headers = { ...(next.headers || {}) };
  if (resolved.referer) headers.Referer = resolved.referer;
  if (resolved.origin && !headers.Origin) headers.Origin = resolved.origin;
  headers['User-Agent'] = headers['User-Agent'] || 'ExoPlayer';
  if (resolved.nvAuthorizations) {
    headers['nv-authorizations'] = resolved.nvAuthorizations;
  }
  if (resolved.authorization && !resolved.nvAuthorizations) {
    headers.Authorization = /^bearer\s+/i.test(resolved.authorization)
      ? resolved.authorization
      : `Bearer ${resolved.authorization}`;
  }
  // Widevine: Exo + WebView both use the license relay. Direct Nagra POSTs from
  // the app often 400 when Origin/Referer/X-Requested-With leak onto the license
  // request; the relay sends only Content-Type + nv-authorizations.
  if (resolved.licenseUrl && (resolved.drmType || '').toUpperCase().includes('WIDEVINE')) {
    const relay = licenseRelayUrl(
      baseUrl || publicBaseUrl(),
      resolved.licenseUrl,
      resolved.nvAuthorizations || '',
    );
    if (relay) {
      next.licenseUrl = relay;
      next.license_url = relay;
      next.licenseRelayUrl = relay;
      next.license_relay_url = relay;
      next.drm_headers = {
        ...(next.drm_headers || {}),
        'nv-authorizations': resolved.nvAuthorizations || '',
      };
    }
  }
  if (Object.keys(headers).length) {
    next.headers = headers;
    console.info(
      `[embed] 🧩 Applied resolved stream headers: ${Object.keys(headers).sort().join(', ')}`,
    );
  }
  return next;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Math.min(Math.max(limit, 1), items.length || 1);
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: items.length ? workers : 0 }, () => worker()));
  return out;
}

function playerUrlFor(baseUrl, channelId, resolved) {
  return `${baseUrl}/api/channels/${channelId}/play.${playExtension(resolved)}`;
}

async function presentChannelRows(rows, baseUrl, options = {}) {
  const deadline = options.deadlineMs ? Date.now() + options.deadlineMs : null;
  return mapLimit(rows, 8, async (row) => {
    const raw = String(row.streamUrl || row.stream_url || '').trim();
    if (!isEmbedPlaybackUrl(raw)) return row;
    const remaining = deadline == null ? 8000 : Math.max(0, deadline - Date.now());
    // SokaMax / embeds → proxied play.mpd for Exo (native Widevine, no Shaka 6001).
    if (isOnDeviceEmbedApiUrl(raw)) {
      return presentResolvedEmbed(row, raw, baseUrl, { deadlineMs: remaining });
    }
    let resolved = peekCachedEmbed(raw);
    if (resolved === undefined) {
      if (remaining < 200) {
        resolveEmbedPlayback(raw).catch(() => {});
        return withWashaEmbedHeaders(row, raw);
      }
      resolved = await Promise.race([
        resolveEmbedPlayback(raw),
        new Promise((resolve) => setTimeout(() => resolve(undefined), remaining)),
      ]);
      if (resolved === undefined) {
        resolveEmbedPlayback(raw).catch(() => {});
        return withWashaEmbedHeaders(row, raw);
      }
    }
    if (!resolved?.streamUrl) return withWashaEmbedHeaders(row, raw);
    // Already resolved — present immediately (do not re-race with a 50ms deadline).
    return presentResolvedEmbed(row, raw, baseUrl, { deadlineMs: Math.max(remaining, 5000) });
  });
}

async function presentPlaybackForPlayer(playback, baseUrl) {
  if (!playback || !Array.isArray(playback.streams)) return playback;
  const streams = [];
  let forceWeb = false;
  for (const stream of playback.streams) {
    const rewritten = await rewritePlayerUrl({
      channelId: playback.channelId,
      rawUrl: stream.url,
      baseUrl,
      priority: stream.priority,
    });
    let next = { ...stream, url: rewritten.url };
    const headerSrc = rewritten.originalEmbedUrl || stream.url;
    if (rewritten.attachWashaHeaders) next = withWashaEmbedHeaders(next, headerSrc);
    if (rewritten.resolved) next = applyResolvedDrm(next, rewritten.resolved, baseUrl);
    if (rewritten.forceWebView) {
      next = forceEmbedWebViewEngine(next);
      forceWeb = true;
    }
    streams.push(next);
  }
  let out = { ...playback, streams };
  if (forceWeb) out = forceEmbedWebViewEngine(out);
  return out;
}

async function resolveStreamAlias(row) {
  if (row.stream_url && String(row.stream_url).trim()) return String(row.stream_url).trim();
  if (!row.stream_alias) return '';
  const alias = await query(
    `SELECT COALESCE(c.stream_url, t.stream_url) AS url
       FROM stream_aliases a
       LEFT JOIN channels c ON c.id = a.channel_id
       LEFT JOIN channels t ON t.stream_alias = a.alias
      WHERE a.alias = $1 AND a.is_active = TRUE
      LIMIT 1`,
    [row.stream_alias],
  );
  return alias.rows[0]?.url ? String(alias.rows[0].url).trim() : '';
}

async function loadPublicStreamUrl(channelId, priority) {
  if (priority != null && Number.isFinite(Number(priority))) {
    try {
      const streams = await query(
        `SELECT stream_url, stream_alias
           FROM channel_streams
          WHERE channel_id = $1 AND priority = $2 AND is_active = TRUE
          LIMIT 1`,
        [channelId, Number(priority)],
      );
      if (streams.rows[0]) {
        const url = await resolveStreamAlias(streams.rows[0]);
        if (url) return url;
      }
    } catch (_) {
      // channel_streams may not exist on older deployments
    }
  }
  const result = await query(
    `SELECT COALESCE(c.stream_url, t.stream_url) AS stream_url
       FROM channels c
       LEFT JOIN stream_aliases a ON a.alias = c.stream_alias AND a.is_active = TRUE
       LEFT JOIN channels t ON t.id = a.channel_id AND t.is_active = TRUE
      WHERE c.id = $1 AND c.is_active = TRUE
      LIMIT 1`,
    [channelId],
  );
  return result.rows[0]?.stream_url ? String(result.rows[0].stream_url).trim() : '';
}

function sealRelay(payload) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(proxySecret()).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

function openRelay(token) {
  const buf = Buffer.from(String(token || ''), 'base64url');
  if (buf.length < 29) return null;
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const key = crypto.createHash('sha256').update(proxySecret()).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  const payload = JSON.parse(json);
  if (!payload || !payload.u || !payload.exp || Number(payload.exp) < Date.now()) return null;
  if (!isPublicHttpUrl(payload.u)) return null;
  return payload;
}

function relayTargetUrl(baseUrl, targetUrl, ctx) {
  const token = sealRelay({
    u: targetUrl,
    exp: Date.now() + RELAY_TTL_MS,
    r: ctx.referer || '',
    o: ctx.origin || '',
    a: ctx.authorization || '',
    n: ctx.nvAuthorizations || '',
  });
  return `${baseUrl}/api/playback/relay?e=${encodeURIComponent(token)}`;
}

/** PDF piece 4: WebView cannot send nv-authorizations cross-origin — relay adds it. */
function licenseRelayUrl(baseUrl, licenseUrl, nvAuthorizations) {
  if (!licenseUrl || !isPublicHttpUrl(licenseUrl)) return '';
  const httpsBase = String(baseUrl || '').replace(/^http:\/\//i, 'https://').replace(/\/$/, '');
  const token = sealRelay({
    u: licenseUrl,
    exp: Date.now() + RELAY_TTL_MS,
    n: nvAuthorizations || '',
    kind: 'license',
  });
  return `${httpsBase}/api/playback/relay/license?e=${encodeURIComponent(token)}`;
}

function rewritePlaylist(text, playlistUrl, baseUrl, ctx) {
  const rewriteRef = (ref) => {
    const abs = resolveAgainst(playlistUrl, decodeStreamUrl(ref));
    if (!abs || !isPublicHttpUrl(abs)) return ref;
    return relayTargetUrl(baseUrl, abs, ctx);
  };
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/gi, (_all, uri) => `URI="${rewriteRef(uri)}"`);
    }
    return rewriteRef(trimmed);
  }).join('\n');
}

function looksLikePlaylist(url, contentType, bodyPreview) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('mpegurl') || ct.includes('m3u8') || ct.includes('audio/mpegurl')) return true;
  if (/\.m3u8?(\?|#|$)/i.test(String(url || ''))) return true;
  return String(bodyPreview || '').trim().startsWith('#EXTM3U');
}

async function sendProxiedPlaylist(res, resolved, baseUrl) {
  const headers = upstreamHeaders(resolved.streamUrl, resolved);
  const { response, finalUrl } = await fetchPublic(resolved.streamUrl, {
    headers,
    timeoutMs: 10000,
  });
  if (response.status < 200 || response.status >= 300) {
    return res.redirect(302, resolved.streamUrl);
  }
  const text = await readLimitedText(response, PLAYLIST_MAX_BYTES);
  if (!text.replace(/^\uFEFF/, '').trim().startsWith('#EXTM3U')) {
    return res.redirect(302, resolved.streamUrl);
  }
  const body = rewritePlaylist(text, finalUrl || resolved.streamUrl, baseUrl, resolved);
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(body);
}

async function sendProxiedMpd(res, resolved, baseUrl) {
  // Media UA like Washa/Exo — browser UA + nv-auth on the MPD GET often 403s CDNs.
  const headers = {
    ...upstreamHeaders(resolved.streamUrl, resolved),
    'User-Agent': 'ExoPlayer',
    Accept: 'application/dash+xml,application/xml,*/*',
  };
  const { response, finalUrl } = await fetchPublic(resolved.streamUrl, {
    headers,
    timeoutMs: 12000,
  });
  if (response.status < 200 || response.status >= 300) {
    console.warn(
      `[embed] mpd upstream HTTP ${response.status} for ${String(resolved.streamUrl).slice(0, 96)}`,
    );
    return res.status(502).json({ error: 'mpd_upstream_failed' });
  }
  const text = await readLimitedText(response, PLAYLIST_MAX_BYTES);
  if (!looksLikeMpd(finalUrl || resolved.streamUrl, response.headers.get('content-type'), text)) {
    return res.status(502).json({ error: 'mpd_invalid' });
  }
  const body = rewriteMpdXml(text, finalUrl || resolved.streamUrl, baseUrl, resolved);
  res.setHeader('Content-Type', 'application/dash+xml');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).send(body);
}

async function handleChannelPlay(req, res) {
  const channelId = Number(req.params.id);
  const ext = String(req.params.ext || '').toLowerCase();
  if (!Number.isFinite(channelId) || channelId <= 0 || !['m3u8', 'mpd', 'mp4'].includes(ext)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const hasPriority = req.query.p != null && String(req.query.p).trim() !== '';
  const priority = hasPriority ? Number(req.query.p) : null;
  if (hasPriority && !Number.isFinite(priority)) {
    return res.status(400).json({ error: 'Invalid stream priority' });
  }
  const source = await loadPublicStreamUrl(channelId, priority);
  if (!source) return res.status(404).json({ error: 'Channel not found' });
  if (!isEmbedPlaybackUrl(source)) {
    if (isDirectMediaUrl(source) && isPublicHttpUrl(source)) return res.redirect(302, source);
    return res.status(404).json({ error: 'No playable stream' });
  }
  const base = publicBaseUrl(req);
  // Legacy play.mpd bookmarks: resolve + proxy when possible; otherwise send
  // clients to the hosted webplayer instead of a broken 302→embed HTML body.
  if (isOnDeviceEmbedApiUrl(source)) {
    const resolvedOnDevice = await resolveEmbedPlayback(source);
    if (resolvedOnDevice?.streamUrl) {
      if (ext === 'mpd' || resolvedOnDevice.kind === 'dash') {
        try {
          return await sendProxiedMpd(res, resolvedOnDevice, base);
        } catch (err) {
          console.warn('[embed] on-device mpd proxy failed, falling back to webplayer:', err.message || err);
        }
      }
      return res.redirect(302, watchPageUrl(base, resolvedOnDevice));
    }
    return res.redirect(302, source);
  }
  const resolved = await resolveEmbedPlayback(source);
  if (!resolved?.streamUrl) {
    return res.status(503).json({ error: 'embed_unresolved', message: 'Stream haipatikani kwa sasa.' });
  }
  if ((resolved.kind === 'hls' || ext === 'm3u8') && ext === 'm3u8') {
    try {
      return await sendProxiedPlaylist(res, resolved, base);
    } catch (err) {
      console.warn('[embed] playlist proxy failed:', err.message || err);
      return res.status(502).json({ error: 'playlist_proxy_failed' });
    }
  }
  if (ext === 'mpd' || resolved.kind === 'dash') {
    try {
      return await sendProxiedMpd(res, resolved, base);
    } catch (err) {
      console.warn('[embed] mpd proxy failed:', err.message || err);
      if (needsHostedWebPlayer(resolved)) {
        return res.redirect(302, watchPageUrl(base, resolved));
      }
      return res.status(502).json({ error: 'mpd_proxy_failed' });
    }
  }
  if (ext === 'mp4' && resolved.kind === 'progressive') {
    return res.redirect(302, relayTargetUrl(base, resolved.streamUrl, resolved));
  }
  try {
    return await sendProxiedMpd(res, resolved, base);
  } catch (err) {
    console.warn('[embed] media proxy failed:', err.message || err);
    return res.status(502).json({ error: 'media_proxy_failed' });
  }
}

async function pipeUpstreamMedia(req, res, targetUrl, ctx) {
  // nv-authorizations is license-only (Nagra). Sending it on MPD/segments often 403s CDNs.
  const headers = {
    ...upstreamHeaders(targetUrl, ctx),
    'User-Agent': 'ExoPlayer',
  };
  if (req.headers.range) headers.Range = req.headers.range;
  let fetched;
  try {
    fetched = await fetchPublic(targetUrl, { headers, timeoutMs: 15000 });
  } catch (err) {
    console.warn('[embed] relay failed:', err.message || err);
    return res.status(502).json({ error: 'Upstream playback failed' });
  }
  const { response, finalUrl } = fetched;
  if (response.status >= 400 || !response.body) {
    return res.status(502).json({ error: 'Upstream playback failed' });
  }
  const contentType = response.headers.get('content-type') || '';
  const base = publicBaseUrl(req);
  if (looksLikePlaylist(finalUrl, contentType, '')) {
    const text = await readLimitedText(response, PLAYLIST_MAX_BYTES);
    if (text.replace(/^\uFEFF/, '').trim().startsWith('#EXTM3U')) {
      const body = rewritePlaylist(text, finalUrl, base, ctx);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(body);
    }
    return res.status(502).json({ error: 'Upstream playback failed' });
  }
  if (looksLikeMpd(finalUrl || targetUrl, contentType, '')) {
    const text = await readLimitedText(response, PLAYLIST_MAX_BYTES);
    if (looksLikeMpd(finalUrl || targetUrl, contentType, text)) {
      const body = rewriteMpdXml(text, finalUrl || targetUrl, base, ctx);
      res.setHeader('Content-Type', 'application/dash+xml');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).send(body);
    }
  }
  res.status(response.status);
  if (contentType) res.setHeader('Content-Type', contentType);
  const contentRange = response.headers.get('content-range');
  if (contentRange) res.setHeader('Content-Range', contentRange);
  const contentLength = response.headers.get('content-length');
  if (contentLength) res.setHeader('Content-Length', contentLength);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { Readable } = require('stream');
  return Readable.fromWeb(response.body).pipe(res);
}

async function handleRelay(req, res) {
  let payload;
  try {
    payload = openRelay(req.query.e);
  } catch (_) {
    payload = null;
  }
  if (!payload) return res.status(403).json({ error: 'Invalid playback token' });
  const ctx = {
    referer: payload.r || '',
    origin: payload.o || '',
    authorization: payload.a || '',
    nvAuthorizations: payload.n || '',
  };
  return pipeUpstreamMedia(req, res, payload.u, ctx);
}

/**
 * Relative DASH segments: /api/playback/dash/<token>/AzamSport1-…-init.mp4
 * Token seals the CDN directory from the original MPD.
 */
async function handleDashSegment(req, res) {
  let payload;
  try {
    payload = openRelay(decodeURIComponent(String(req.params.token || '')));
  } catch (_) {
    payload = null;
  }
  if (!payload || (payload.kind && payload.kind !== 'dashbase') || !payload.u) {
    return res.status(403).json({ error: 'Invalid dash token' });
  }
  const rel = String(req.params[0] || req.params.file || '')
    .replace(/^\/+/, '')
    .trim();
  if (!rel || rel.includes('..')) {
    return res.status(400).json({ error: 'Invalid segment path' });
  }
  let target;
  try {
    target = new URL(rel, payload.u).toString();
  } catch (_) {
    return res.status(400).json({ error: 'Invalid segment path' });
  }
  if (!isPublicHttpUrl(target)) {
    return res.status(403).json({ error: 'Blocked segment url' });
  }
  const ctx = {
    referer: payload.r || '',
    origin: payload.o || '',
    authorization: payload.a || '',
    nvAuthorizations: payload.n || '',
  };
  return pipeUpstreamMedia(req, res, target, ctx);
}

async function handleWatchPage(req, res) {
  let payload;
  try {
    payload = openRelay(req.query.e);
  } catch (_) {
    payload = null;
  }
  if (!payload || payload.kind !== 'watch' || !payload.u || !isPublicHttpUrl(payload.u)) {
    res.status(403);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(
      '<!DOCTYPE html><html><body style="margin:0;background:#000;color:#fff;font:14px system-ui;display:flex;align-items:center;justify-content:center;height:100vh">Stream unavailable</body></html>',
    );
  }
  const base = publicBaseUrl(req);
  const ctx = {
    referer: payload.r || '',
    origin: payload.o || '',
    authorization: payload.a || '',
    nvAuthorizations: payload.n || '',
  };
  // Manifest goes through relay so CDN tokens match this server's IP.
  const manifestUrl = relayTargetUrl(base, payload.u, ctx);
  const licenseUrl = payload.license
    ? licenseRelayUrl(base, payload.license, payload.n || '')
    : '';
  const html = buildWatchPlayerHtml({
    manifestUrl,
    licenseUrl,
    clearKey: payload.clearKey || '',
    drm: payload.drm || 'NONE',
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  // Allow embedding in the app WebView.
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  return res.status(200).send(html);
}

/**
 * PDF 4b: POST license body to Nagra with nv-authorizations server-side.
 * CORS: Access-Control-Allow-Origin * so WebView Shaka can call it.
 */
async function handleLicenseRelay(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (String(req.method || '').toUpperCase() === 'OPTIONS') {
    return res.status(204).end();
  }

  let payload;
  try {
    payload = openRelay(req.query.e);
  } catch (_) {
    payload = null;
  }
  if (!payload || payload.kind !== 'license') {
    return res.status(403).json({ error: 'Invalid license token' });
  }
  const licenseUrl = payload.u;
  if (!licenseUrl || !isPublicHttpUrl(licenseUrl)) {
    return res.status(400).json({ error: 'No license URL for this session' });
  }

  const headers = { 'Content-Type': 'application/octet-stream' };
  if (payload.n) headers['nv-authorizations'] = payload.n;
  console.info(`[embed] RELAY LICENSE | drm=widevine url=${String(licenseUrl).slice(0, 80)}`);

  try {
    let body = Buffer.alloc(0);
    if (Buffer.isBuffer(req.body)) {
      body = req.body;
    } else if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
      body = req.rawBody;
    } else if (typeof req.body === 'string') {
      body = Buffer.from(req.body);
    } else if (req.body && typeof req.body === 'object') {
      body = Buffer.from(JSON.stringify(req.body));
    }
    const upstream = await fetch(licenseUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');
    return res.send(buf);
  } catch (err) {
    console.warn('[embed] license relay failed:', err.message || err);
    return res.status(502).json({ error: 'License upstream failed' });
  }
}

module.exports = {
  publicBaseUrl,
  isDirectMediaUrl,
  isEmbedPlaybackUrl,
  isOnDeviceEmbedApiUrl,
  isPublicHttpUrl,
  extractEmbeddedStream,
  resolveEmbedPlayback,
  rewritePlayerUrl,
  applyResolvedDrm,
  presentChannelRows,
  presentPlaybackForPlayer,
  loadPublicStreamUrl,
  rewritePlaylist,
  sealRelay,
  openRelay,
  licenseRelayUrl,
  watchPageUrl,
  needsHostedWebPlayer,
  rewriteMpdXml,
  handleChannelPlay,
  handleRelay,
  handleDashSegment,
  handleWatchPage,
  handleLicenseRelay,
  xorDecrypt,
};
