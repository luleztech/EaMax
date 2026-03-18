/**
 * SHAKA PLAYER PRO — DASH/MPD for WebView
 * Shaka 5.0.5, super resolver for relative URLs, ClearKey DRM.
 * Used by MPDPlayer and VideoPlayer.
 */

function hexToBase64(hex) {
  if (!hex || typeof hex !== 'string') return hex;
  const clean = hex.trim().replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2) return hex;
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.substr(i, 2), 16));
  const bin = String.fromCharCode(...bytes);
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

export function getClearKeysForBrowser(raw) {
  if (!raw) return null;
  const str = raw.trim();
  let kid = str;
  let key = str;
  if (str.includes(':')) [kid, key] = str.split(':').map((s) => s.trim());
  else if (str.includes(',')) [kid, key] = str.split(',').map((s) => s.trim());
  return { [hexToBase64(kid)]: hexToBase64(key) };
}

export function getManifestBaseUrl(url) {
  if (!url) return '';
  const u = url.replace(/[#?].*$/, '');
  const last = u.lastIndexOf('/');
  return last >= 0 ? u.slice(0, last + 1) : u + '/';
}

/** Super resolver — BaseURL, SegmentTemplate/SegmentURL/SegmentBase attributes, and other relative URLs. */
export function resolveManifestForBlob(manifestText, baseUrl) {
  if (!manifestText || !baseUrl) return manifestText;
  let xml = manifestText;
  const base = baseUrl.replace(/\/$/, '') + '/';

  const makeAbs = (p) => {
    if (!p || /^https?:\/\//i.test(p) || p.startsWith('//') || /^urn:/i.test(p)) return p;
    return p.startsWith('/') ? base.replace(/\/$/, '') + p : base + p;
  };

  xml = xml.replace(/<BaseURL>([^<]+?)<\/BaseURL>/gi, (_, c) => `<BaseURL>${makeAbs(c.trim())}</BaseURL>`);

  ['media', 'initialization', 'index'].forEach((attr) => {
    const re = new RegExp(`(\\s${attr}\\s*=\\s*["'])([^"']+?)(["'])`, 'gi');
    xml = xml.replace(re, (_, pre, val, post) => pre + makeAbs(val) + post);
  });

  xml = xml.replace(
    /(\s+(?:sourceURL|url|media|initialization)\s*=\s*["'])([^"']+?)(["'])/gi,
    (_, pre, val, post) => `${pre}${makeAbs(val)}${post}`
  );

  return xml;
}

/** Alias for backward compatibility (e.g. MPDPlayer can use either). */
export function resolveManifestRelativeUrls(manifestText, baseUrl) {
  return resolveManifestForBlob(manifestText, baseUrl);
}

// ====================== COMMON HTML BUILDER ======================
function buildShakaHtmlCore(manifestSource, isBlob, headers = {}, drmConfig = {}, extraConfig = {}, baseUrlForBlob = '') {
  const baseUrl = baseUrlForBlob || (isBlob ? '' : getManifestBaseUrl(manifestSource));
  const resolved = isBlob ? resolveManifestForBlob(manifestSource, baseUrl) : null;
  const manifestEscaped =
    isBlob && resolved
      ? resolved
          .replace(/\\/g, '\\\\')
          .replace(/\r/g, '')
          .replace(/\n/g, '\\n')
          .replace(/'/g, "\\'")
          .replace(/<\/script>/gi, '<\\/script>')
      : '';

  const headerStr = JSON.stringify(headers || {});
  const clearKeysStr = JSON.stringify(drmConfig.clearKeys || {});
  const licenseUrl = drmConfig.licenseUrl || '';
  const licenseHeadersStr = JSON.stringify(drmConfig.licenseHeaders || {});
  const drmServers = drmConfig.servers || (licenseUrl ? { 'org.w3.clearkey': licenseUrl } : {});

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>DASH PRO</title>
  <script src="https://cdn.jsdelivr.net/npm/mux.js@6.3.0/dist/mux.js"></script>
  <script>if (typeof window.muxjs === 'undefined' && typeof muxjs !== 'undefined') window.muxjs = muxjs;</script>
  <script src="https://cdn.jsdelivr.net/npm/shaka-player@5.0.5/dist/shaka-player.compiled.js"></script>
  <style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}#videoPlayer{width:100%;height:100%;background:#000}</style>
</head>
<body>
  <video id="videoPlayer" controls autoplay playsinline></video>
  <script>
    (function() {
      function post(type, data) {
        try {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, ...(data || {}) }));
        } catch(e){}
      }

      function mapError(code, msg) {
        var l = (msg || '').toLowerCase();
        if (code === 2 || l.indexOf('network') !== -1) return 'Internet failed';
        if (code === 3 || l.indexOf('manifest') !== -1) return 'Manifest corrupted';
        if (code === 4001 || l.indexOf('xml') !== -1) return 'Invalid MPD';
        if (code === 4 || l.indexOf('drm') !== -1 || l.indexOf('license') !== -1) return 'Authorization failed';
        if (code === 5 || l.indexOf('decode') !== -1) return 'Device decode error';
        if (code >= 6000 && code < 7000) return 'Segment load failed (CORS/auth/URL)';
        return msg || 'Playback failed';
      }

      var video = document.getElementById('videoPlayer');
      if (!video) { post('error', { message: 'No video element' }); return; }

      if (typeof shaka === 'undefined') { post('error', { message: 'Shaka not loaded' }); return; }

      if (!shaka.Player.isBrowserSupported()) {
        post('error', { message: 'Device does not support DASH' });
        return;
      }

      try {
        shaka.polyfill.installAll();
        var player = new shaka.Player(video);

        var requestHeaders = ${headerStr};
        var clearKeysObj = ${clearKeysStr};
        var licenseHeaders = ${licenseHeadersStr};
        var drmServersObj = ${JSON.stringify(drmServers)};

        var net = player.getNetworkingEngine();
        net.registerRequestFilter(function(type, req) {
          req.allowCrossSiteCredentials = true;
          if (requestHeaders && typeof requestHeaders === 'object') {
            Object.keys(requestHeaders).forEach(function(k) {
              if (requestHeaders[k] != null) req.headers[k] = String(requestHeaders[k]);
            });
          }
          if (type === shaka.net.NetworkingEngine.RequestType.MANIFEST) {
            req.headers['Accept'] = req.headers['Accept'] || 'application/dash+xml,*/*';
          }
          if (type === shaka.net.NetworkingEngine.RequestType.SEGMENT) {
            req.headers['Accept'] = req.headers['Accept'] || '*/*';
          }
          if (type === shaka.net.NetworkingEngine.RequestType.LICENSE && licenseHeaders && typeof licenseHeaders === 'object') {
            Object.keys(licenseHeaders).forEach(function(k) {
              if (licenseHeaders[k] != null) req.headers[k] = String(licenseHeaders[k]);
            });
          }
        });

        var drm = {};
        if (clearKeysObj && Object.keys(clearKeysObj).length) drm.clearKeys = clearKeysObj;
        if (drmServersObj && Object.keys(drmServersObj).length) drm.servers = drmServersObj;

        var extraConfigRef = ${JSON.stringify(extraConfig || {})};
        var maxH = (extraConfigRef && extraConfigRef.maxHeight) || 1080;
        var maxW = (extraConfigRef && extraConfigRef.maxWidth) || (maxH >= 1080 ? 1920 : maxH >= 720 ? 1280 : maxH >= 480 ? 854 : maxH >= 360 ? 640 : 426);

        player.configure({
          streaming: {
            bufferingGoal: 90,
            rebufferingGoal: 8,
            bufferBehind: 90,
            lowLatencyMode: true,
            retryParameters: { maxAttempts: 8, baseDelay: 500, backoffFactor: 1.5, fuzzFactor: 0.3 }
          },
          drm: drm,
          manifest: { dash: { ignoreMinBufferTime: true, autoCorrectDrift: true } },
          abr: { enabled: true, restrictions: { maxWidth: maxW, maxHeight: maxH } }
        });

        ${isBlob ? `var blob = new Blob(['${manifestEscaped}'], { type: 'application/dash+xml' });
        var blobUrl = URL.createObjectURL(blob);
        player.load(blobUrl).then(function() {
          URL.revokeObjectURL(blobUrl);
          post('ready');
          video.play().catch(function(){});
        }).catch(function(e) {
          URL.revokeObjectURL(blobUrl);
          post('error', { message: mapError(e.code, e.message), code: e.code });
        });` : `var mpdUrl = ${JSON.stringify(manifestSource)};
        player.load(mpdUrl).then(function() {
          post('ready');
          video.play().catch(function(){});
        }).catch(function(e) {
          post(e.code === 1002 ? 'fallback' : 'error', { message: mapError(e.code, e.message), code: e.code });
        });`}

        video.addEventListener('playing', function() { post('playing'); });
        video.addEventListener('ended', function() { post('ended'); });
        video.addEventListener('error', function() { post('error', { message: 'Video element error' }); });
      } catch (err) {
        post('error', { message: 'Init failed: ' + (err && err.message ? err.message : String(err)) });
      }
    })();
  </script>
</body>
</html>`;
}

// ====================== PUBLIC API ======================
// extraConfig: { maxHeight?: number, maxWidth?: number } for Okoa Bando quality cap
export function buildShakaDashHtmlWithManifest(manifestText, manifestBaseUrl, headers = {}, drmConfig = {}, extraConfig = {}) {
  if (!manifestText) return '<html><body style="background:#000;color:#fff">Missing manifest text</body></html>';
  return buildShakaHtmlCore(manifestText, true, headers, drmConfig, extraConfig, manifestBaseUrl);
}

export function buildShakaDashHtml(url, headers = {}, drmConfig = {}, extraConfig = {}) {
  if (!url) return '<html><body style="background:#000;color:#fff">Missing MPD URL</body></html>';
  return buildShakaHtmlCore(url, false, headers, drmConfig, extraConfig);
}
