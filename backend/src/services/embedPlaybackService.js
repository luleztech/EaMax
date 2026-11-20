const crypto = require('crypto');
const { URL } = require('url');

const { query } = require('../db');

const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

const SUCCESS_TTL_MS = 45 * 1000;
const FAILURE_TTL_MS = 15 * 1000;
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
  let drmType = 'NONE';
  if (licenseUrl) drmType = /playready/i.test(licenseUrl) ? 'PLAYREADY' : 'WIDEVINE';
  else if (clearKeyRaw) drmType = 'CLEARKEY';
  return {
    streamUrl,
    kind: kindForUrl(streamUrl),
    referer: page.referer,
    origin: page.origin,
    authorization,
    licenseUrl: isPublicHttpUrl(licenseUrl) ? licenseUrl : '',
    clearKeyRaw,
    drmType,
  };
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
    const headers = upstreamHeaders(raw, pageContext(raw));
    headers.Accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    if (/\.php(\?|#|\/|$)/i.test(raw)) headers['X-Requested-With'] = 'com.eamax';
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

async function rewritePlayerUrl({ channelId, rawUrl, baseUrl, priority = null }) {
  const raw = String(rawUrl || '').trim();
  const id = Number(channelId);
  if (!raw || !Number.isFinite(id) || id <= 0 || !isEmbedPlaybackUrl(raw)) {
    return { url: raw, resolved: null };
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

function applyResolvedDrm(target, resolved) {
  if (!resolved) return target;
  const next = { ...target };
  if (resolved.clearKeyRaw && !next.drmClearKey && !next.drm_clear_key) {
    next.drmType = 'CLEARKEY';
    next.drm_type = 'CLEARKEY';
    next.drmClearKey = resolved.clearKeyRaw;
    next.drm_clear_key = resolved.clearKeyRaw;
    next.drm_protected = true;
    next.drmProtected = true;
  } else if (resolved.licenseUrl && !next.licenseUrl && !next.license_url && (next.drmType === 'NONE' || next.drm_type === 'NONE' || !next.drmType)) {
    next.licenseUrl = resolved.licenseUrl;
    next.license_url = resolved.licenseUrl;
    next.drmType = resolved.drmType;
    next.drm_type = resolved.drmType;
    next.drm_protected = true;
    next.drmProtected = true;
  }
  if (resolved.kind !== 'hls') {
    const headers = {};
    if (resolved.referer) headers.Referer = resolved.referer;
    if (resolved.origin) headers.Origin = resolved.origin;
    if (resolved.authorization) {
      headers.Authorization = /^bearer\s+/i.test(resolved.authorization)
        ? resolved.authorization
        : `Bearer ${resolved.authorization}`;
    }
    if (Object.keys(headers).length && (!next.headers || !Object.keys(next.headers).length)) {
      next.headers = headers;
    }
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
    let resolved = peekCachedEmbed(raw);
    if (resolved === undefined) {
      const remaining = deadline == null ? 8000 : deadline - Date.now();
      if (remaining < 200) {
        resolveEmbedPlayback(raw).catch(() => {});
        return row;
      }
      resolved = await Promise.race([
        resolveEmbedPlayback(raw),
        new Promise((resolve) => setTimeout(() => resolve(undefined), remaining)),
      ]);
      if (resolved === undefined) {
        resolveEmbedPlayback(raw).catch(() => {});
        return row;
      }
    }
    if (!resolved?.streamUrl) return row;
    let next = {
      ...row,
      stream_url: playerUrlFor(baseUrl, row.id, resolved),
      streamUrl: playerUrlFor(baseUrl, row.id, resolved),
    };
    next = applyResolvedDrm(next, resolved);
    return next;
  });
}

async function presentPlaybackForPlayer(playback, baseUrl) {
  if (!playback || !Array.isArray(playback.streams)) return playback;
  const streams = [];
  for (const stream of playback.streams) {
    const rewritten = await rewritePlayerUrl({
      channelId: playback.channelId,
      rawUrl: stream.url,
      baseUrl,
      priority: stream.priority,
    });
    let next = { ...stream, url: rewritten.url };
    if (rewritten.resolved) next = applyResolvedDrm(next, rewritten.resolved);
    streams.push(next);
  }
  return { ...playback, streams };
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
  });
  return `${baseUrl}/api/playback/relay?e=${encodeURIComponent(token)}`;
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
  };
  const headers = upstreamHeaders(payload.u, ctx);
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
  if (looksLikePlaylist(finalUrl, contentType, '')) {
    const text = await readLimitedText(response, PLAYLIST_MAX_BYTES);
    if (text.replace(/^\uFEFF/, '').trim().startsWith('#EXTM3U')) {
      const body = rewritePlaylist(text, finalUrl, publicBaseUrl(req), ctx);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(body);
    }
    return res.status(502).json({ error: 'Upstream playback failed' });
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

module.exports = {
  publicBaseUrl,
  isDirectMediaUrl,
  isEmbedPlaybackUrl,
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
  handleChannelPlay,
  handleRelay,
  xorDecrypt,
};
