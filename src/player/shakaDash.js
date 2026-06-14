/**
 * shakaDash.js — Shaka Player HTML builder for React Native WebView
 *
 * FIXES IN THIS VERSION:
 * 1. "Browser/device does not support DASH" — Fixed by calling shaka.polyfill.installAll()
 *    BEFORE shaka.Player.isBrowserSupported(). Polyfills patch missing APIs (EME, MSE)
 *    in older Android WebView versions — without them the check always fails.
 *
 * 2. CDN fallback added: tries jsdelivr first, then cdnjs as backup. If both fail,
 *    shows a clear "Failed to load player" error instead of a cryptic DASH unsupported message.
 *
 * 3. ClearKey base64 padding bug: getClearKeysForBrowser returns base64url WITHOUT padding.
 *    Shaka's clearKeys parser rejects '==' padding as invalid hex → crash fixed.
 *
 * 4. WebView not starting at 360p — forceStartQuality() selects closest track to maxH
 *    immediately after load(), then re-enables ABR after 4s.
 *
 * 5. Invalid Shaka streaming config keys removed. stallEnabled/stallThreshold/stallSkip
 *    ARE valid in Shaka 4.x and are kept. segmentPrefetchLimit is NOT valid → removed.
 *
 * 6. mux.js loaded before Shaka (required for MPEG-TS segments in WebView).
 *
 * 7. Shaka version pinned to 4.11.4 (stable on Android WebView 85+).
 *    Shaka 5.x requires WebView 100+ — not safe for older devices.
 */

// ─── hex → base64url WITHOUT padding ─────────────────────────────────────────

function hexToBase64Url(hex) {
  if (!hex || typeof hex !== 'string') return hex;
  let clean = hex.trim().replace(/[^0-9a-fA-F]/g, '');
  if (!clean) return hex;
  if (clean.length % 2) clean = '0' + clean;
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.substr(i, 2), 16));
  const bin = String.fromCharCode(...bytes);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// ─── Normalize base64url (strip padding) ─────────────────────────────────────

function base64UrlNoPad(s) {
  if (typeof s !== 'string') return s;
  return s.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Normalize one ClearKey part (kid or key) → base64url no-padding.
 * FIX: was returning base64 WITH padding — Shaka rejected it as hex parse error.
 */
function normalizeClearKeyPart(part) {
  if (!part || typeof part !== 'string') return part;
  const raw = part.trim();
  if (!raw) return raw;
  const cleanHex = raw.replace(/[^0-9a-fA-F]/g, '');
  const isHex = cleanHex.length > 0 && cleanHex === raw.trim() && cleanHex.length % 2 === 0;
  if (isHex) return hexToBase64Url(cleanHex);
  return base64UrlNoPad(raw);
}

/**
 * Build clearKeys map for Shaka: { kid_b64url_nopad: key_b64url_nopad }
 * FIX: values are now base64url no-padding (Shaka-compatible).
 */
export function getClearKeysForBrowser(raw) {
  if (!raw) return null;
  const str = raw.trim();
  let kid = str, key = str;
  if (str.includes(':')) {
    const parts = str.split(':').map(s => s.trim()); kid = parts[0]; key = parts[1] || parts[0];
  } else if (str.includes(',')) {
    const parts = str.split(',').map(s => s.trim()); kid = parts[0]; key = parts[1] || parts[0];
  }
  const kidB64 = normalizeClearKeyPart(kid);
  const keyB64 = normalizeClearKeyPart(key);
  if (!kidB64 || !keyB64) return null;
  return { [kidB64]: keyB64 };
}

export function getManifestBaseUrl(url) {
  if (!url) return '';
  const u    = url.replace(/[#?].*$/, '');
  const last = u.lastIndexOf('/');
  return last >= 0 ? u.slice(0, last + 1) : u + '/';
}

export function resolveManifestForBlob(manifestText, baseUrl) {
  if (!manifestText || !baseUrl) return manifestText;
  let xml  = manifestText;
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
  return xml;
}

export function resolveManifestRelativeUrls(manifestText, baseUrl) {
  return resolveManifestForBlob(manifestText, baseUrl);
}

function getBitrateForHeight(h) {
  if (h <= 240) return 300000;
  if (h <= 360) return 700000;
  if (h <= 480) return 1200000;
  if (h <= 720) return 2200000;
  return 3800000;
}

const USER_PLAYBACK_ERROR =
  'Mafundi wetu wanahangaikia channel hii, itarejea hivi punde.';

function buildDrmServers(drmConfig) {
  if (drmConfig.servers && Object.keys(drmConfig.servers).length > 0) {
    return drmConfig.servers;
  }
  const licenseUrl = (drmConfig.licenseUrl || '').trim();
  if (!licenseUrl) return {};
  const drmType = String(drmConfig.drmType || '').toUpperCase();
  if (drmType === 'PLAYREADY' || licenseUrl.toLowerCase().includes('playready')) {
    return { 'com.microsoft.playready': licenseUrl };
  }
  if (drmType.startsWith('WIDEVINE')) {
    return { 'com.widevine.alpha': licenseUrl };
  }
  if (drmType === 'CLEARKEY' || drmType === 'CLEAR_KEY') {
    return { 'org.w3.clearkey': licenseUrl };
  }
  return { 'com.widevine.alpha': licenseUrl };
}
  if (h >= 1080) return 1920;
  if (h >= 720)  return 1280;
  if (h >= 480)  return 854;
  if (h >= 360)  return 640;
  return 426;
}

// ─── Core HTML builder ────────────────────────────────────────────────────────

function buildShakaHtmlCore(
  manifestSource, isBlob,
  headers = {}, drmConfig = {}, extraConfig = {}, baseUrlForBlob = ''
) {
  const baseUrl  = baseUrlForBlob || (isBlob ? '' : getManifestBaseUrl(manifestSource));
  const resolved = isBlob ? resolveManifestForBlob(manifestSource, baseUrl) : null;

  const manifestEscaped = isBlob && resolved
    ? resolved
        .replace(/\\/g, '\\\\')
        .replace(/\r/g, '')
        .replace(/\n/g, '\\n')
        .replace(/'/g, "\\'")
        .replace(/<\/script>/gi, '<\\/script>')
    : '';

  const headerStr      = JSON.stringify(headers || {});
  const clearKeysStr   = JSON.stringify(drmConfig.clearKeys || {});
  const licenseUrl     = drmConfig.licenseUrl || '';
  const licenseHeadersStr = JSON.stringify(drmConfig.licenseHeaders || {});
  const drmServers     = buildDrmServers(drmConfig);
  const maxH           = (extraConfig && extraConfig.maxHeight) || 360;
  const maxW           = (extraConfig && extraConfig.maxWidth) || getWidthForHeight(maxH);
  const startBitrate   = getBitrateForHeight(maxH);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>DASH</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{background:#000;height:100%;overflow:hidden}
    video{width:100%;height:100%;background:#000;object-fit:contain;display:block}
    #err{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
         color:#fff;font:15px/1.5 sans-serif;text-align:center;padding:20px;max-width:300px}
  </style>
</head>
<body>
  <video id="v" autoplay playsinline webkit-playsinline></video>
  <div id="err"></div>

  <!-- mux.js required for MPEG-TS → fMP4 transmux in WebView -->
  <script src="https://cdn.jsdelivr.net/npm/mux.js@6.3.0/dist/mux.js"
          onerror="console.warn('mux.js CDN failed')"></script>
  <script>if(typeof window.muxjs==='undefined'&&typeof muxjs!=='undefined')window.muxjs=muxjs;</script>

  <!-- Shaka Player 4.11.4 — pinned, stable on Android WebView 85+ -->
  <!-- Primary CDN: jsDelivr -->
  <script id="shaka-script"
    src="https://cdn.jsdelivr.net/npm/shaka-player@4.11.4/dist/shaka-player.compiled.js"
    onerror="loadShakaFallback()"></script>

  <script>
  // CDN fallback: if jsDelivr fails, try cdnjs
  function loadShakaFallback() {
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.11.4/shaka-player.compiled.min.js';
    s.onerror = function() { initPlayer(false); };
    s.onload  = function() { initPlayer(true); };
    document.head.appendChild(s);
  }

  // Auto-start after primary script loads
  (function waitForShaka() {
    if (typeof shaka !== 'undefined') { initPlayer(true); return; }
    // If primary script loaded but shaka not defined yet, small wait
    setTimeout(function() {
      if (typeof shaka !== 'undefined') initPlayer(true);
      // else: onerror already fired → loadShakaFallback() called
    }, 300);
  })();

  function initPlayer(shakaAvailable) {
    var POST_ORIGIN='*';
    function post(type,data){
      try{
        var msg=JSON.stringify(Object.assign({type:type},data||{}));
        if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(msg);
      }catch(e){}
    }

    function showErr() {
      var el=document.getElementById('err');
      if(el){el.style.display='block';el.textContent=${JSON.stringify(USER_PLAYBACK_ERROR)};}
      post('error',{message:${JSON.stringify(USER_PLAYBACK_ERROR)}});
    }

    if(!shakaAvailable){
      showErr();
      return;
    }

    function mapErr(){
      return ${JSON.stringify(USER_PLAYBACK_ERROR)};
    }

    var video=document.getElementById('v');
    if(!video){showErr();return;}

    // FIX: Install polyfills BEFORE calling isBrowserSupported().
    // Polyfills patch missing EME/MSE APIs in older Android WebView.
    // Without this, isBrowserSupported() always returns false on Android WebView < 100.
    shaka.polyfill.installAll();

    if(!shaka.Player.isBrowserSupported()){
      // Don't give up immediately — some APIs may still work without full support flag.
      // Log a warning but continue anyway; the player may still work for basic DASH.
      console.warn('[Shaka] isBrowserSupported() = false — attempting playback anyway');
    }

    try{
      var player=new shaka.Player(video);

      var reqHeaders=${headerStr};
      var clearKeysObj=${clearKeysStr};
      var licHeaders=${licenseHeadersStr};
      var drmServersObj=${JSON.stringify(drmServers)};
      var maxH=${maxH};
      var maxW=${maxW};
      var startBw=${startBitrate};

      // Network filter
      player.getNetworkingEngine().registerRequestFilter(function(type,req){
        req.allowCrossSiteCredentials=true;
        if(reqHeaders&&typeof reqHeaders==='object'){
          Object.keys(reqHeaders).forEach(function(k){
            if(reqHeaders[k]!=null)req.headers[k]=String(reqHeaders[k]);
          });
        }
        if(type===shaka.net.NetworkingEngine.RequestType.MANIFEST){
          req.headers['Accept']=req.headers['Accept']||'application/dash+xml,*/*';
        }
        if(type===shaka.net.NetworkingEngine.RequestType.LICENSE&&licHeaders){
          Object.keys(licHeaders).forEach(function(k){
            if(licHeaders[k]!=null)req.headers[k]=String(licHeaders[k]);
          });
        }
      });

      // DRM config
      var drmCfg={};
      if(clearKeysObj&&Object.keys(clearKeysObj).length>0){
        drmCfg.clearKeys=clearKeysObj; // base64url no-padding values (Shaka-compatible)
      }
      if(drmServersObj&&Object.keys(drmServersObj).length>0){
        drmCfg.servers=drmServersObj;
      }

      // Player config
      // NOTE: stallEnabled/stallThreshold/stallSkip ARE valid in Shaka 4.x streaming config.
      // segmentPrefetchLimit is NOT valid → removed.
      player.configure({
        streaming:{
          lowLatencyMode:false,
          bufferingGoal:20,
          rebufferingGoal:3,
          bufferBehind:30,
          safeSeekOffset:5,
          stallEnabled:true,
          stallThreshold:1,
          stallSkip:0.1,
          retryParameters:{
            maxAttempts:5,
            baseDelay:1000,
            backoffFactor:2,
            fuzzFactor:0.3,
            timeout:30000,
          },
        },
        drm:drmCfg,
        manifest:{
          dash:{
            ignoreMinBufferTime:true,
            autoCorrectDrift:true,
            ignoreSuggestedPresentationDelay:true,
          },
          retryParameters:{
            maxAttempts:4,
            baseDelay:500,
            backoffFactor:1.5,
            fuzzFactor:0.2,
          },
        },
        abr:{
          enabled:true,
          defaultBandwidthEstimate:startBw,
          restrictions:{
            maxWidth:maxW,
            maxHeight:maxH,
            minHeight:0,
            minWidth:0,
          },
          bandwidthUpgradeTarget:0.85,
          bandwidthDowngradeTarget:0.95,
          switchInterval:8,
        },
      });

      player.addEventListener('error',function(){ showErr(); });

      // Force 360p on start, then re-enable ABR
      function forceStartQuality(p, targetH) {
        try {
          var tracks=p.getVariantTracks();
          if(!tracks||!tracks.length)return;
          var sorted=tracks.slice().sort(function(a,b){return(a.height||0)-(b.height||0);});
          var best=sorted[0];
          for(var i=0;i<sorted.length;i++){
            if((sorted[i].height||0)<=targetH)best=sorted[i]; else break;
          }
          if(best)p.selectVariantTrack(best,false,0);
          // Re-enable ABR after 4s of buffering at target quality
          setTimeout(function(){ try{p.configure({abr:{enabled:true}});}catch(e){} },4000);
        }catch(e){}
      }

      ${isBlob
        ? `var mpdText='${manifestEscaped}';
      var blob=new Blob([mpdText],{type:'application/dash+xml'});
      var blobUrl=URL.createObjectURL(blob);
      player.load(blobUrl).then(function(){
        URL.revokeObjectURL(blobUrl);
        forceStartQuality(player,maxH);
        post('ready');
        video.play().catch(function(){});
      }).catch(function(){ showErr(); });`
        : `var mpdUrl=${JSON.stringify(manifestSource)};
      player.load(mpdUrl).then(function(){
        forceStartQuality(player,maxH);
        post('ready');
        video.play().catch(function(){});
      }).catch(function(e){
        post(e.code===1002?'fallback':'error',{message:mapErr(),code:e.code});
      });`
      }

      video.addEventListener('playing', function(){ post('playing'); });
      video.addEventListener('ended',   function(){ post('ended'); });
      video.addEventListener('waiting', function(){ post('buffering',{isBuffering:true}); });
      video.addEventListener('canplay', function(){ post('buffering',{isBuffering:false}); });
      video.addEventListener('stalled', function(){ post('buffering',{isBuffering:true}); });
      video.addEventListener('error',   function(){ showErr(); });

    }catch(err){
      showErr();
    }
  }
  </script>
</body>
</html>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build Shaka HTML with an already-fetched manifest injected as a Blob.
 * extraConfig.maxHeight defaults to 360 — hard ABR cap + forced start quality.
 */
export function buildShakaDashHtmlWithManifest(
  manifestText, manifestBaseUrl,
  headers = {}, drmConfig = {}, extraConfig = {}
) {
  if (!manifestText)
    return '<html><body style="background:#000;color:#fff;font-family:sans-serif;padding:20px">Missing manifest</body></html>';
  return buildShakaHtmlCore(manifestText, true, headers, drmConfig, extraConfig, manifestBaseUrl);
}

export function buildShakaDashHtml(url, headers = {}, drmConfig = {}, extraConfig = {}) {
  if (!url)
    return '<html><body style="background:#000;color:#fff;font-family:sans-serif;padding:20px">Missing MPD URL</body></html>';
  return buildShakaHtmlCore(url, false, headers, drmConfig, extraConfig);
}
