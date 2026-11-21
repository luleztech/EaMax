const crypto = require('crypto');
const { URL } = require('url');

const { query } = require('../db');

const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

/** SokaMax setup: cache resolved embeds ~60s (upstream rate-limits player.php). */
const SUCCESS_TTL_MS = 60 * 1000;
const FAILURE_TTL_MS = 15 * 1000;
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
  return /\.(m3u8|m3u|mpd|mp4|m4v|webm|mkv|mov|ts)(\?|#|$)/i.test(String(url || ''));
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
  if (/\.mpd(\?|#|$)/i.test(url)) return 'dash';
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

async function resolveEmbedApi(playerUrl, parsed) {
  const app = parsed.searchParams.get('app');
  const key = parsed.searchParams.get('key');
  if (!app || !key) return null;
  const origin = `${parsed.protocol}//${parsed.host}`;
  const apiUrl = `${origin}/player.php?app=${encodeURIComponent(app)}&key=${encodeURIComponent(key)}&api=1`;
  const hdrs = {
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36',
    Accept: 'application/json',
    'X-Requested-With': EMBED_PACKAGE_NAME,
    Referer: `${origin}/`,
  };

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

    const headers = upstreamHeaders(raw, pageContext(raw));
    headers.Accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    if (/\.php(\?|#|\/|$)/i.test(raw)) headers['X-Requested-With'] = EMBED_PACKAGE_NAME;
    const { response, finalUrl } = await fetchPublic(raw, { headers, timeoutMs: 8000 });
    if (response.status < 200 || response.status >= 300) {
      value = null;
    } else {
      const html = await readLimitedText(response, HTML_MAX_BYTES);
      value = extractEmbeddedStream(html, finalUrl || raw);
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
  // Same as Washa: embed.php?app=&key= must resolve on the phone so the CDN
  // token is issued for the viewer's IP. Server-side rewrite breaks Widevine.
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

/** Installed apps already honor channel playbackEngine=webview — force it for embeds. */
function forceEmbedWebViewEngine(target) {
  const next = { ...target };
  next.playbackEngine = 'webview';
  next.playback_engine = 'webview';
  next.effectiveEngine = 'webview';
  next.effective_engine = 'webview';
  next.preferredEngine = 'webview';
  if (next.playerConfig && typeof next.playerConfig === 'object') {
    next.playerConfig = {
      ...next.playerConfig,
      preferredEngine: 'webview',
      effectiveEngine: 'webview',
      playbackEngine: 'webview',
      failoverToWebview: true,
    };
  }
  if (next.playbackPolicy && typeof next.playbackPolicy === 'object') {
    next.playbackPolicy = {
      ...next.playbackPolicy,
      preferredEngine: 'webview',
      effectiveEngine: 'webview',
      playbackEngine: 'webview',
      failoverToWebview: true,
    };
  }
  return next;
}

/**
 * CDN tokens from embed.php are IP-bound to whoever called player.php.
 * Resolve on the server, then serve a non-gateway /api/playback/watch page that
 * plays via our media + license relays so phones never hit Exo's blank DRM path.
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
  return `${httpsBase}/api/playback/watch?e=${encodeURIComponent(token)}`;
}

function rewriteMpdXml(text, mpdUrl, baseUrl, ctx) {
  const rewriteAbs = (abs) => {
    if (!abs || !isPublicHttpUrl(abs)) return abs;
    // Keep our own relays as-is (avoid double-wrapping).
    if (/\/api\/playback\/relay/i.test(abs)) return abs;
    return relayTargetUrl(baseUrl, abs, ctx);
  };
  let out = String(text || '');
  out = out.replace(/<BaseURL>([^<]*)<\/BaseURL>/gi, (_all, ref) => {
    const abs = resolveAgainst(mpdUrl, String(ref || '').trim());
    if (!abs || !isPublicHttpUrl(abs)) return _all;
    return `<BaseURL>${rewriteAbs(abs)}</BaseURL>`;
  });
  out = out.replace(/\b(media|initialization|sourceURL|url)="([^"]+)"/gi, (all, attr, ref) => {
    if (/^https?:\/\//i.test(ref)) {
      return `${attr}="${rewriteAbs(ref)}"`;
    }
    const abs = resolveAgainst(mpdUrl, ref);
    if (!abs || !isPublicHttpUrl(abs)) return all;
    return `${attr}="${rewriteAbs(abs)}"`;
  });
  out = out.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
    const clean = url.replace(/[),.;]+$/g, '');
    const trailing = url.slice(clean.length);
    if (!isPublicHttpUrl(clean) || /\/api\/playback\/relay/i.test(clean)) return url;
    // Do not rewrite XML namespace-looking or license scheme URNs (already non-http).
    return `${rewriteAbs(clean)}${trailing}`;
  });
  return out;
}

function buildWatchPlayerHtml({ manifestUrl, licenseUrl, clearKey, drm }) {
  const manifest = JSON.stringify(String(manifestUrl || ''));
  const license = JSON.stringify(String(licenseUrl || ''));
  const ck = JSON.stringify(String(clearKey || ''));
  const drmType = JSON.stringify(String(drm || 'NONE').toUpperCase());
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<title>EaMax</title>
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden}
video{width:100%;height:100%;object-fit:contain;background:#000}
#err{display:none;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:24px;text-align:center}
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/shaka-player.compiled.min.js"></script>
</head>
<body>
<video id="v" playsinline webkit-playsinline autoplay muted></video>
<div id="err">Stream haipatikani kwa sasa.</div>
<script>
(function(){
  var manifest=${manifest};
  var license=${license};
  var clearKey=${ck};
  var drmType=${drmType};
  var video=document.getElementById('v');
  var err=document.getElementById('err');
  function fail(msg){
    try{console.error(msg);}catch(e){}
    err.style.display='block';
    err.textContent=msg||'Stream haipatikani kwa sasa.';
  }
  function parseClearKeys(raw){
    raw=String(raw||'').trim();
    if(!raw) return null;
    try{
      var j=JSON.parse(raw);
      if(j&&j.keys) return j;
    }catch(e){}
    var map={};
    raw.split(/[,;\\s]+/).forEach(function(pair){
      var p=pair.split(':');
      if(p.length>=2){ map[p[0].trim()]=p.slice(1).join(':').trim(); }
    });
    var keys=Object.keys(map).map(function(kid){
      return {kid:kid,k:map[kid]};
    }).filter(function(x){return x.kid&&x.k;});
    return keys.length?{keys:keys}:null;
  }
  if(!manifest||typeof shaka==='undefined'){ fail(); return; }
  shaka.polyfill.installAll();
  if(!shaka.Player.isBrowserSupported()){ fail('Kifaa hakitumii player hii.'); return; }
  var player=new shaka.Player();
  player.attach(video).then(function(){
    var cfg={
      streaming:{ bufferingGoal:30, rebufferingGoal:2, bufferBehind:30 },
      abr:{ enabled:true }
    };
    if(drmType.indexOf('WIDEVINE')>=0 && license){
      cfg.drm={
        servers:{ 'com.widevine.alpha': license },
        advanced:{ 'com.widevine.alpha':{ videoRobustness:'SW_SECURE_CRYPTO', audioRobustness:'SW_SECURE_CRYPTO' } }
      };
    } else if(drmType.indexOf('CLEARKEY')>=0 || clearKey){
      var ckObj=parseClearKeys(clearKey);
      cfg.drm={ clearKeys:{} };
      if(ckObj&&ckObj.keys){
        ckObj.keys.forEach(function(k){ cfg.drm.clearKeys[k.kid]=k.k; });
      }
    }
    player.configure(cfg);
    player.addEventListener('error', function(ev){
      var code=ev&&ev.detail&&ev.detail.code;
      fail(code?('Hitilafu '+code):'Stream haipatikani kwa sasa.');
    });
    return player.load(manifest);
  }).then(function(){
    var p=video.play();
    if(p&&p.catch) p.catch(function(){});
  }).catch(function(e){
    fail((e&&e.message)||'Stream haipatikani kwa sasa.');
  });
})();
</script>
</body>
</html>`;
}

async function presentProxiedOnDeviceEmbed(target, rawUrl, baseUrl, options = {}) {
  const remaining = options.deadlineMs == null ? 8000 : options.deadlineMs;
  let resolved = peekCachedEmbed(rawUrl);
  if (resolved === undefined) {
    if (remaining < 200) {
      resolveEmbedPlayback(rawUrl).catch(() => {});
      return forceEmbedWebViewEngine(withWashaEmbedHeaders(target, rawUrl));
    }
    resolved = await Promise.race([
      resolveEmbedPlayback(rawUrl),
      new Promise((resolve) => setTimeout(() => resolve(undefined), remaining)),
    ]);
    if (resolved === undefined) {
      resolveEmbedPlayback(rawUrl).catch(() => {});
      return forceEmbedWebViewEngine(withWashaEmbedHeaders(target, rawUrl));
    }
  }
  if (!resolved?.streamUrl) {
    return forceEmbedWebViewEngine(withWashaEmbedHeaders(target, rawUrl));
  }
  const httpsBase = String(baseUrl || '').replace(/^http:\/\//i, 'https://').replace(/\/$/, '');
  const watchUrl = watchPageUrl(httpsBase, resolved);
  let next = {
    ...target,
    stream_url: watchUrl,
    streamUrl: watchUrl,
    // Watch page is our HTML player — not a gateway.php for on-device resolve.
    drm_type: resolved.drmType || 'NONE',
    drmType: resolved.drmType || 'NONE',
    drm_protected: !!(resolved.licenseUrl || resolved.clearKeyRaw),
    drmProtected: !!(resolved.licenseUrl || resolved.clearKeyRaw),
  };
  next = applyResolvedDrm(next, resolved, httpsBase);
  next = forceEmbedWebViewEngine(withWashaEmbedHeaders(next, rawUrl));
  console.info(`[embed] 📺 watch-page for on-device embed → ${watchUrl.slice(0, 96)}`);
  return next;
}

async function rewritePlayerUrl({ channelId, rawUrl, baseUrl, priority = null }) {
  const raw = String(rawUrl || '').trim();
  const id = Number(channelId);
  if (!raw || !Number.isFinite(id) || id <= 0 || !isEmbedPlaybackUrl(raw)) {
    return { url: raw, resolved: null };
  }
  // Resolve on server + watch page (media/license relay). Avoids Exo blank screens.
  if (isOnDeviceEmbedApiUrl(raw)) {
    const resolved = await resolveEmbedPlayback(raw);
    if (resolved?.streamUrl) {
      return {
        url: watchPageUrl(baseUrl, resolved),
        resolved,
        forceWebView: true,
        attachWashaHeaders: true,
        originalEmbedUrl: raw,
      };
    }
    return { url: raw, resolved: null, attachWashaHeaders: true, forceWebView: true };
  }
  const resolved = await resolveEmbedPlayback(raw);
  if (!resolved?.streamUrl) return { url: raw, resolved: null };
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
  if (resolved.clearKeyRaw && !next.drmClearKey && !next.drm_clear_key) {
    next.drmType = 'CLEARKEY';
    next.drm_type = 'CLEARKEY';
    next.drmClearKey = resolved.clearKeyRaw;
    next.drm_clear_key = resolved.clearKeyRaw;
    next.drm_protected = true;
    next.drmProtected = true;
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
  // PDF piece 4: WebView/Shaka license relay (server injects nv-authorizations).
  if (resolved.licenseUrl && (resolved.drmType || '').toUpperCase().includes('WIDEVINE')) {
    const relay = licenseRelayUrl(
      baseUrl || publicBaseUrl(),
      resolved.licenseUrl,
      resolved.nvAuthorizations || '',
    );
    if (relay) {
      next.licenseRelayUrl = relay;
      next.license_relay_url = relay;
      // Pop nv-authorizations into drm_headers for relay; Exo still gets it in headers.
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
    // SokaMax embed.php: server watch page + relays (no app update, no Exo blank).
    if (isOnDeviceEmbedApiUrl(raw)) {
      const remaining = deadline == null ? 8000 : Math.max(0, deadline - Date.now());
      return presentProxiedOnDeviceEmbed(row, raw, baseUrl, { deadlineMs: remaining });
    }
    let resolved = peekCachedEmbed(raw);
    if (resolved === undefined) {
      const remaining = deadline == null ? 8000 : deadline - Date.now();
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
    let next = {
      ...row,
      stream_url: playerUrlFor(baseUrl, row.id, resolved),
      streamUrl: playerUrlFor(baseUrl, row.id, resolved),
    };
    next = applyResolvedDrm(next, resolved, baseUrl);
    return next;
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
  const resolved = await resolveEmbedPlayback(source);
  if (!resolved?.streamUrl) {
    return res.status(503).json({ error: 'embed_unresolved', message: 'Stream haipatikani kwa sasa.' });
  }
  if (resolved.kind === 'hls' && ext === 'm3u8') {
    try {
      return await sendProxiedPlaylist(res, resolved, publicBaseUrl(req));
    } catch (err) {
      console.warn('[embed] playlist proxy failed:', err.message || err);
      return res.redirect(302, resolved.streamUrl);
    }
  }
  return res.redirect(302, resolved.streamUrl);
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
  const headers = upstreamHeaders(payload.u, ctx);
  if (payload.n) headers['nv-authorizations'] = payload.n;
  if (req.headers.range) headers.Range = req.headers.range;
  let fetched;
  try {
    fetched = await fetchPublic(payload.u, { headers, timeoutMs: 15000 });
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
  // Rewrite DASH MPD so segment URLs stay on our relay (CDN tokens are IP-bound).
  if (looksLikeMpd(finalUrl || payload.u, contentType, '')) {
    const text = await readLimitedText(response, PLAYLIST_MAX_BYTES);
    if (looksLikeMpd(finalUrl || payload.u, contentType, text)) {
      const body = rewriteMpdXml(text, finalUrl || payload.u, base, ctx);
      res.setHeader('Content-Type', 'application/dash+xml');
      res.setHeader('Cache-Control', 'no-store');
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
  const { Readable } = require('stream');
  return Readable.fromWeb(response.body).pipe(res);
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
    return res.send('<!DOCTYPE html><html><body style="margin:0;background:#000;color:#fff;font:14px system-ui;display:flex;align-items:center;justify-content:center;height:100vh">Stream unavailable</body></html>');
  }
  const base = publicBaseUrl(req);
  const ctx = {
    referer: payload.r || '',
    origin: payload.o || '',
    authorization: payload.a || '',
    nvAuthorizations: payload.n || '',
  };
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
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
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
  handleChannelPlay,
  handleRelay,
  handleWatchPage,
  handleLicenseRelay,
  xorDecrypt,
};
