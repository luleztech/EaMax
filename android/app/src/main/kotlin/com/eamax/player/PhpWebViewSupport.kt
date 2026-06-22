package com.eamax.player

/**
 * WebView helpers for PHP / gateway pages (EaMax phpStreamSupport.js).
 */
object PhpWebViewSupport {

    const val BROWSER_PLAYBACK_USER_AGENT =
        "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36"

    /** [androidInterfaceName] must match [WebView.addJavascriptInterface] name (e.g. ShakaPlayerBridge). */
    fun gatewayPageRecoveryScript(androidInterfaceName: String = "ShakaPlayerBridge"): String {
        val postPlaying = """
          try {
            if (typeof $androidInterfaceName !== 'undefined' && $androidInterfaceName.onPlaybackStarted) {
              $androidInterfaceName.onPlaybackStarted();
            }
          } catch (e) {}
        """.trimIndent()

        return """
            (function () {
              if (window.__eaMaxRecoveryInstalled) return true;
              window.__eaMaxRecoveryInstalled = true;

              var lastProgressAt = Date.now();
              var lastNudgeAt = 0;

              function getVideo() {
                return document.querySelector('video');
              }

              function tryPlay(video) {
                if (!video || window.__eaMaxPlaybackLocked) return;
                if (!video.paused || video.ended) return;
                try {
                  var p = video.play && video.play();
                  if (p && typeof p.catch === 'function') p.catch(function(){});
                } catch (e) {}
              }

              function bindVideo(video) {
                if (!video || video.__nixBound) return;
                video.__nixBound = true;
                video.setAttribute('playsinline', 'true');
                video.setAttribute('webkit-playsinline', 'true');
                try { video.muted = false; } catch (e) {}
                video.controls = true;

                video.addEventListener('timeupdate', function () {
                  lastProgressAt = Date.now();
                });

                video.addEventListener('playing', function () {
                  lastProgressAt = Date.now();
                  window.__eaMaxPlaybackLocked = true;
                  $postPlaying
                });

                if (!window.__eaMaxPlaybackLocked) tryPlay(video);
              }

              function startMonitor() {
                setInterval(function () {
                  if (window.__eaMaxPlaybackLocked) return;
                  var video = getVideo();
                  if (!video || video.ended) return;
                  if (!video.paused) return;
                  bindVideo(video);
                  var now = Date.now();
                  if (now - lastNudgeAt > 8000) {
                    tryPlay(video);
                    lastNudgeAt = now;
                  }
                }, 5000);
              }

              try {
                var observer = new MutationObserver(function () {
                  if (window.__eaMaxPlaybackLocked) return;
                  var v = getVideo();
                  if (v) bindVideo(v);
                });
                observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
              } catch (e) {}

              bindVideo(getVideo());
              startMonitor();
              true;
            })();
        """.trimIndent()
    }

    /**
     * Hides gateway page chrome, security banners, HLS/package error text — video surface only.
     * Does not report playback errors; the native watchdog handles timeouts.
     */
    fun playerOnlyUiScript(): String {
        return """
            (function () {
              if (document.getElementById('__eaMaxPlayerOnly')) return true;
              var root = document.head || document.documentElement || document.body;
              if (!root) return false;
              var s = document.createElement('style');
              s.id = '__eaMaxPlayerOnly';
              s.textContent =
                'html,body{background:#000!important;margin:0!important;padding:0!important;overflow:hidden!important}' +
                'video,.shaka-video-container,.shaka-video,.video-js,#player,#player *{' +
                'position:fixed!important;inset:0!important;width:100%!important;height:100%!important;' +
                'max-width:100%!important;max-height:100%!important;object-fit:contain!important;' +
                'z-index:2147483646!important;opacity:1!important;visibility:visible!important;display:block!important}';
              root.appendChild(s);
              return true;
            })();
        """.trimIndent()
    }

    /**
     * Defines [window.__eaMaxOkoaSetQuality] for hls.js / Shaka-style players inside gateway pages.
     * mode: `"auto"` or height as string e.g. `"360"`.
     */
    /**
     * Reads XOR-encrypted constants from the loaded gateway page and posts decrypted
     * stream + DRM fields to [androidInterfaceName].onGatewayStreamExtracted(json).
     */
    fun gatewayStreamExtractScript(androidInterfaceName: String = "ShakaPlayerBridge"): String {
        return """
            (function () {
              try {
                if (window.__eaMaxExtractSent) return true;
                var html = '';
                if (document.documentElement) html = document.documentElement.innerHTML || '';
                var scripts = document.getElementsByTagName('script');
                for (var si = 0; si < scripts.length; si++) {
                  var sc = scripts[si];
                  if (sc && sc.textContent) html += '\n' + sc.textContent;
                }
                if (!html) return false;
                function pick(name) {
                  var dq = new RegExp(name + '[\\s=]+"([^"]+)"', 'i');
                  var sq = new RegExp(name + "[\\s=]+'([^']+)'", 'i');
                  var m = html.match(dq);
                  if (m && m[1]) return m[1];
                  m = html.match(sq);
                  return (m && m[1]) ? m[1] : '';
                }
                function xorDecrypt(enc, key) {
                  try {
                    var raw = atob(enc);
                    var out = '';
                    for (var i = 0; i < raw.length; i++) {
                      out += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt(i % key.length));
                    }
                    return out;
                  } catch (e) { return ''; }
                }
                var keyPart = pick('keyPart') || pick('key') || pick('xorKey');
                var encMpd = pick('encryptedMpd') || pick('encryptedStream') || pick('encryptedUrl') ||
                             pick('encryptedHls') || pick('encryptedDash') || pick('encryptedManifest');
                var streamUrl = '';
                var licenseUrl = '';
                if (keyPart && encMpd) {
                  streamUrl = xorDecrypt(encMpd, keyPart);
                }
                if (!streamUrl || streamUrl.indexOf('http') !== 0) {
                  streamUrl = window.__eaMaxCapturedManifest || '';
                }
                if (!streamUrl || streamUrl.indexOf('http') !== 0) return false;
                if (keyPart) {
                  var licEnc = pick('encryptedLicense') || pick('encryptedLicence') ||
                               pick('encryptedDrm') || pick('encryptedWidevine');
                  if (licEnc) licenseUrl = xorDecrypt(licEnc, keyPart);
                }
                if (!licenseUrl) {
                  licenseUrl = window.__eaMaxCapturedLicense || '';
                }
                if (!licenseUrl) {
                  try {
                    var lm = html.match(/com\.widevine\.alpha[^'"]*["'](https[^'"]+)/i);
                    if (lm && lm[1]) {
                      licenseUrl = lm[1].indexOf('://') >= 0 ? lm[1] : ('https:' + lm[1]);
                    }
                  } catch (e) {}
                }
                var authToken = pick('encryptedToken') ? xorDecrypt(pick('encryptedToken'), keyPart) : '';
                var clearKeyRaw = pick('encryptedClearKey') ? xorDecrypt(pick('encryptedClearKey'), keyPart) : '';
                window.__eaMaxExtractSent = true;
                var payload = {
                  streamUrl: streamUrl,
                  isHls: streamUrl.indexOf('.m3u8') >= 0,
                  licenseUrl: licenseUrl || '',
                  authToken: authToken || '',
                  clearKeyRaw: clearKeyRaw || ''
                };
                if (typeof $androidInterfaceName !== 'undefined' &&
                    $androidInterfaceName.onGatewayStreamExtracted) {
                  $androidInterfaceName.onGatewayStreamExtracted(JSON.stringify(payload));
                }
                return true;
              } catch (e) {
                return false;
              }
            })();
        """.trimIndent()
    }

    /**
     * Hooks Shaka Player.configure()/load() before EME runs — captures manifest + license URL
     * on gateways where Huawei WebView Widevine fails after load().
     */
    fun gatewayShakaConfigureHookScript(androidInterfaceName: String = "ShakaPlayerBridge"): String {
        return """
            (function () {
              if (window.__eaMaxConfigureHook) return true;
              window.__eaMaxConfigureHook = true;
              function readLicense(cfg) {
                if (!cfg || !cfg.drm || !cfg.drm.servers) return '';
                var s = cfg.drm.servers;
                return s['com.widevine.alpha'] || s['com.widevine'] ||
                       s['org.w3.clearkey'] || s['com.microsoft.playready'] || '';
              }
              function notify(uri, licenseUrl, authToken, licenseHeaders) {
                if (!uri && !licenseUrl) return;
                var payload = {
                  streamUrl: uri || window.__eaMaxCapturedManifest || '',
                  isHls: (uri || '').indexOf('.m3u8') >= 0,
                  licenseUrl: licenseUrl || '',
                  authToken: authToken || '',
                  clearKeyRaw: '',
                  licenseHeaders: licenseHeaders || window.__eaMaxLicenseHeaders || {}
                };
                if (!payload.streamUrl || payload.streamUrl.indexOf('http') !== 0) return;
                try {
                  if (typeof $androidInterfaceName !== 'undefined' &&
                      $androidInterfaceName.onGatewayStreamExtracted) {
                    $androidInterfaceName.onGatewayStreamExtracted(JSON.stringify(payload));
                  }
                } catch (e) {}
              }
              function reportLicenseHeaders(hdrs) {
                if (!hdrs) return;
                var out = {};
                try {
                  Object.keys(hdrs).forEach(function(k){ out[k] = String(hdrs[k]); });
                } catch (e) {}
                if (Object.keys(out).length === 0) return;
                window.__eaMaxLicenseHeaders = out;
                notify(window.__eaMaxCapturedManifest, window.__eaMaxCapturedLicense, '', out);
              }
              function readAuthToken(cfg) {
                if (!cfg || !cfg.drm || !cfg.drm.advanced) return '';
                var adv = cfg.drm.advanced['com.widevine.alpha'];
                if (adv && adv.serverCertificateUri) return '';
                return '';
              }
              function captureCfg(cfg) {
                if (!cfg) return;
                try {
                  if (cfg.drm && (cfg.drm.servers || cfg.drm.clearKeys)) {
                    window.__eaMaxShakaDrmSignaled = true;
                  }
                  var uri = (cfg.manifest && cfg.manifest.uri) ? String(cfg.manifest.uri) : '';
                  if (uri.indexOf('http') === 0) window.__eaMaxCapturedManifest = uri;
                  var lic = readLicense(cfg);
                  if (lic) window.__eaMaxCapturedLicense = lic;
                  notify(uri || window.__eaMaxCapturedManifest, lic || window.__eaMaxCapturedLicense, '', window.__eaMaxLicenseHeaders);
                } catch (e) {}
              }
              function wrapPlayer(Orig) {
                var Wrapped = function (video) {
                  var p = new Orig(video);
                  try {
                    var oc = p.configure;
                    if (typeof oc === 'function') {
                      p.configure = function (cfg, clear) {
                        captureCfg(cfg);
                        if (!window.__eaMaxOkoaUserInitiated && !p.__eaMaxStartup360Injected) {
                          try {
                            cfg = cfg || {};
                            cfg.abr = cfg.abr || {};
                            cfg.abr.enabled = false;
                            cfg.abr.restrictions = cfg.abr.restrictions || {};
                            cfg.abr.restrictions.maxHeight = 360;
                            cfg.abr.restrictions.maxBandwidth = 800000;
                            p.__eaMaxStartup360Injected = true;
                          } catch (e6) {}
                        }
                        var ret = oc.call(this, cfg, clear);
                        try {
                          if (!p.__eaMaxLicFilter && typeof p.getNetworkingEngine === 'function') {
                            var eng = p.getNetworkingEngine();
                            if (eng && typeof eng.registerRequestFilter === 'function' &&
                                typeof shaka !== 'undefined' && shaka.net &&
                                shaka.net.NetworkingEngine) {
                              p.__eaMaxLicFilter = true;
                              var RT = shaka.net.NetworkingEngine.RequestType;
                              eng.registerRequestFilter(function (type, req) {
                                if (type === RT.LICENSE && req && req.headers) {
                                  reportLicenseHeaders(req.headers);
                                }
                              });
                            }
                          }
                        } catch (e5) {}
                        return ret;
                      };
                    }
                    var ol = p.load;
                    if (typeof ol === 'function') {
                      p.load = function (uri) {
                        if (uri) {
                          window.__eaMaxCapturedManifest = String(uri);
                          notify(String(uri), window.__eaMaxCapturedLicense || '', '', window.__eaMaxLicenseHeaders);
                        }
                        return ol.apply(this, arguments);
                      };
                    }
                  } catch (e2) {}
                  return p;
                };
                Wrapped.prototype = Orig.prototype;
                try {
                  Object.getOwnPropertyNames(Orig).forEach(function (k) {
                    try { Wrapped[k] = Orig[k]; } catch (e3) {}
                  });
                } catch (e4) {}
                return Wrapped;
              }
              function tryHook() {
                if (typeof shaka === 'undefined' || !shaka.Player) return;
                if (shaka.Player.__eaMaxHooked) return;
                shaka.Player = wrapPlayer(shaka.Player);
                shaka.Player.__eaMaxHooked = true;
              }
              setInterval(tryHook, 40);
              return true;
            })();
        """.trimIndent()
    }

    /** Fetch/XHR/Shaka network hooks — injected at document start before gateway scripts run. */
    fun gatewayNetworkCaptureScript(androidInterfaceName: String = "ShakaPlayerBridge"): String {
        return """
            (function () {
              if (window.__eaMaxNetHook) return true;
              window.__eaMaxNetHook = true;
              function isLicenseUrl(u) {
                if (!u) return false;
                u = String(u).toLowerCase();
                return u.indexOf('license') >= 0 || u.indexOf('widevine') >= 0 ||
                       u.indexOf('rightsManager') >= 0 || u.indexOf('acquirelicense') >= 0 ||
                       u.indexOf('/drm') >= 0 || u.indexOf('/wv/') >= 0 ||
                       u.indexOf('getkey') >= 0 || u.indexOf('azamtvltd') >= 0;
              }
              function captureLicense(u) {
                if (!isLicenseUrl(u)) return;
                window.__eaMaxCapturedLicense = String(u);
                window.__eaMaxShakaDrmSignaled = true;
              }
              function postLicenseHeaders(hdrs) {
                if (!hdrs) return;
                var out = {};
                try {
                  Object.keys(hdrs).forEach(function(k){ out[k] = String(hdrs[k]); });
                } catch (e) {}
                if (Object.keys(out).length === 0) return;
                window.__eaMaxLicenseHeaders = out;
                try {
                  if (typeof $androidInterfaceName !== 'undefined' &&
                      $androidInterfaceName.onGatewayStreamExtracted) {
                    $androidInterfaceName.onGatewayStreamExtracted(JSON.stringify({
                      streamUrl: window.__eaMaxCapturedManifest || '',
                      isHls: false,
                      licenseUrl: window.__eaMaxCapturedLicense || '',
                      authToken: '',
                      clearKeyRaw: '',
                      licenseHeaders: out
                    }));
                  }
                } catch (e) {}
              }
              function captureManifest(u) {
                u = String(u || '');
                if (u.indexOf('http') === 0 &&
                    (u.indexOf('.mpd') >= 0 || u.indexOf('.m3u8') >= 0)) {
                  window.__eaMaxCapturedManifest = u;
                }
              }
              if (typeof shaka !== 'undefined' && shaka.net && shaka.net.NetworkingEngine) {
                try {
                  var RequestType = shaka.net.NetworkingEngine.RequestType;
                  var orig = shaka.net.NetworkingEngine.prototype.request;
                  shaka.net.NetworkingEngine.prototype.request = function(type, request) {
                    try {
                      if (request && request.uris && request.uris[0]) {
                        var u = String(request.uris[0]);
                        if (type === RequestType.LICENSE || isLicenseUrl(u)) captureLicense(u);
                        if (type === RequestType.MANIFEST || type === RequestType.SEGMENT) captureManifest(u);
                      }
                      if (type === RequestType.LICENSE && request && request.headers) {
                        postLicenseHeaders(request.headers);
                      }
                    } catch (e) {}
                    return orig.call(this, type, request);
                  };
                } catch (e) {}
              }
              if (!window.__eaMaxFetchHook) {
                window.__eaMaxFetchHook = true;
                try {
                  var origFetch = window.fetch;
                  if (origFetch) {
                    window.fetch = function(input) {
                      try {
                        var u = (typeof input === 'string') ? input : (input && input.url ? input.url : '');
                        captureLicense(u);
                        captureManifest(u);
                      } catch (e) {}
                      return origFetch.apply(this, arguments);
                    };
                  }
                } catch (e) {}
                try {
                  var origOpen = XMLHttpRequest.prototype.open;
                  XMLHttpRequest.prototype.open = function(method, url) {
                    try {
                      captureLicense(url);
                      captureManifest(url);
                    } catch (e) {}
                    return origOpen.apply(this, arguments);
                  };
                } catch (e) {}
              }
              return true;
            })();
        """.trimIndent()
    }

    /** Combined early injection: configure hook + network capture (document-start). */
    fun gatewayDocumentStartScript(androidInterfaceName: String = "ShakaPlayerBridge"): String =
        gatewayShakaConfigureHookScript(androidInterfaceName) +
            "\n" +
            gatewayNetworkCaptureScript(androidInterfaceName)

    /** Exo Widevine license POST via WebView fetch (Nagra/Azam — uses page cookies + origin). */
    fun webViewLicenseFetchScript(
        bridgeName: String = WebViewLicenseBridge.JS_INTERFACE_NAME,
    ): String {
        return """
            (function () {
              if (window.__eaMaxLicenseFetch) return true;
              window.__eaMaxLicenseFetch = true;
              window.__eaMaxFetchWidevineLicense = function (id, url, bodyB64, headers) {
                try {
                  var raw = atob(bodyB64);
                  var bytes = new Uint8Array(raw.length);
                  for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
                  var hdrs = (headers && typeof headers === 'object') ? headers : {};
                  if (!hdrs['Content-Type']) hdrs['Content-Type'] = 'application/octet-stream';
                  var xhr = new XMLHttpRequest();
                  xhr.open('POST', url, true);
                  xhr.withCredentials = true;
                  xhr.responseType = 'arraybuffer';
                  Object.keys(hdrs).forEach(function (k) {
                    try { xhr.setRequestHeader(k, hdrs[k]); } catch (e) {}
                  });
                  xhr.onload = function () {
                    if (xhr.status < 200 || xhr.status >= 300) {
                      $bridgeName.onLicenseError(id, 'HTTP ' + xhr.status);
                      return;
                    }
                    var ab = xhr.response;
                    var b = new Uint8Array(ab);
                    var s = '';
                    for (var j = 0; j < b.length; j++) s += String.fromCharCode(b[j]);
                    $bridgeName.onLicenseSuccess(id, btoa(s));
                  };
                  xhr.onerror = function () {
                    $bridgeName.onLicenseError(id, 'XHR network error');
                  };
                  xhr.send(bytes);
                } catch (e) {
                  $bridgeName.onLicenseError(id, String(e.message || e));
                }
              };
              return true;
            })();
        """.trimIndent()
    }

    /**
     * Reads live Shaka player config from the gateway page (license URL + manifest URI).
     */
    fun gatewayShakaHookScript(androidInterfaceName: String = "ShakaPlayerBridge"): String {
        return """
            (function () {
              if (window.__eaMaxShakaHook) return true;
              window.__eaMaxShakaHook = true;
              function post(uri, licenseUrl, authToken) {
                if (!uri || uri.indexOf('http') !== 0) return;
                var prevLicense = window.__eaMaxLastLicense || '';
                if (licenseUrl) window.__eaMaxLastLicense = licenseUrl;
                if (window.__eaMaxExtractSent && !licenseUrl) return;
                if (window.__eaMaxExtractSent && licenseUrl && licenseUrl === prevLicense) return;
                if (licenseUrl || !window.__eaMaxExtractSent) window.__eaMaxExtractSent = true;
                var payload = {
                  streamUrl: uri,
                  isHls: uri.indexOf('.m3u8') >= 0,
                  licenseUrl: licenseUrl || '',
                  authToken: authToken || '',
                  clearKeyRaw: ''
                };
                try {
                  if (typeof $androidInterfaceName !== 'undefined' &&
                      $androidInterfaceName.onGatewayStreamExtracted) {
                    $androidInterfaceName.onGatewayStreamExtracted(JSON.stringify(payload));
                  }
                } catch (e) {}
              }
              function readLicense(cfg) {
                if (!cfg || !cfg.drm || !cfg.drm.servers) return '';
                var s = cfg.drm.servers;
                return s['com.widevine.alpha'] || s['com.widevine'] || s['org.w3.clearkey'] || '';
              }
              function tryShaka() {
                if (window.__eaMaxExtractSent || typeof shaka === 'undefined') return;
                var videos = document.querySelectorAll('video');
                for (var i = 0; i < videos.length; i++) {
                  var p = null;
                  try {
                    if (shaka.Player && shaka.Player.getPlayerInstance) {
                      p = shaka.Player.getPlayerInstance(videos[i]);
                    }
                  } catch (e1) {}
                  if (!p) continue;
                  var uri = '';
                  try { uri = p.getAssetUri ? p.getAssetUri() : ''; } catch (e2) {}
                  if (!uri) continue;
                  var cfg = null;
                  try { cfg = p.getConfiguration ? p.getConfiguration() : null; } catch (e3) {}
                  post(uri, readLicense(cfg), '');
                  return;
                }
              }
              if (typeof shaka !== 'undefined' && shaka.net && shaka.net.NetworkingEngine) {
                try {
                  var RequestType = shaka.net.NetworkingEngine.RequestType;
                  var orig = shaka.net.NetworkingEngine.prototype.request;
                  shaka.net.NetworkingEngine.prototype.request = function(type, request) {
                    try {
                      if (request && request.uris && request.uris[0]) {
                        var u = String(request.uris[0]);
                        if (type === RequestType.LICENSE ||
                            u.indexOf('license') >= 0 ||
                            u.indexOf('widevine') >= 0 ||
                            u.indexOf('RightsManager') >= 0 ||
                            u.indexOf('AcquireLicense') >= 0 ||
                            u.indexOf('/drm') >= 0) {
                          window.__eaMaxCapturedLicense = u;
                          window.__eaMaxShakaDrmSignaled = true;
                        }
                        if ((type === RequestType.MANIFEST || type === RequestType.SEGMENT) &&
                            (u.indexOf('.mpd') >= 0 || u.indexOf('.m3u8') >= 0) &&
                            u.indexOf('http') === 0) {
                          window.__eaMaxCapturedManifest = u;
                        }
                      }
                    } catch (e4) {}
                    return orig.call(this, type, request);
                  };
                } catch (e5) {}
              }
              if (!window.__eaMaxFetchHook) {
                window.__eaMaxFetchHook = true;
                try {
                  var origFetch = window.fetch;
                  if (origFetch) {
                    window.fetch = function(input, init) {
                      try {
                        var u = (typeof input === 'string') ? input : (input && input.url ? input.url : '');
                        if (u && (u.indexOf('license') >= 0 || u.indexOf('widevine') >= 0 ||
                            u.indexOf('RightsManager') >= 0 || u.indexOf('AcquireLicense') >= 0)) {
                          window.__eaMaxCapturedLicense = u;
                          window.__eaMaxShakaDrmSignaled = true;
                        }
                      } catch (e6) {}
                      return origFetch.apply(this, arguments);
                    };
                  }
                } catch (e7) {}
                try {
                  var origOpen = XMLHttpRequest.prototype.open;
                  XMLHttpRequest.prototype.open = function(method, url) {
                    try {
                      var u = String(url || '');
                      if (u.indexOf('license') >= 0 || u.indexOf('widevine') >= 0 ||
                          u.indexOf('RightsManager') >= 0) {
                        window.__eaMaxCapturedLicense = u;
                        window.__eaMaxShakaDrmSignaled = true;
                      }
                    } catch (e8) {}
                    return origOpen.apply(this, arguments);
                  };
                } catch (e9) {}
              }
              setInterval(function () {
                if (window.__eaMaxPlaybackLocked) return;
                tryShaka();
                if (window.__eaMaxCapturedManifest && !window.__eaMaxExtractSent) {
                  post(window.__eaMaxCapturedManifest,
                       window.__eaMaxCapturedLicense || '',
                       '');
                }
              }, 800);
              return true;
            })();
        """.trimIndent()
    }

    /** Sends page HTML to Kotlin for [PhpGatewayExtractor] (license + stream fields). */
    fun gatewayHtmlProbeScript(androidInterfaceName: String = "ShakaPlayerBridge"): String {
        return """
            (function () {
              try {
                var html = document.documentElement ? (document.documentElement.innerHTML || '') : '';
                var scripts = document.getElementsByTagName('script');
                for (var i = 0; i < scripts.length; i++) {
                  var sc = scripts[i];
                  if (sc && sc.textContent) html += '\n' + sc.textContent;
                }
                if (!html || html.length < 200) return false;
                if (typeof $androidInterfaceName !== 'undefined' &&
                    $androidInterfaceName.onGatewayHtmlProbe) {
                  $androidInterfaceName.onGatewayHtmlProbe(html);
                }
                return true;
              } catch (e) { return false; }
            })();
        """.trimIndent()
    }

    fun eaMaxOkoaQualityApiScript(): String {
        return """
            (function() {
              function parseTarget(mode) {
                if (!mode || mode === 'auto') return 0;
                var n = parseInt(mode, 10);
                return (isFinite(n) && n > 0) ? n : 0;
              }
              function maxBitrateForHeight(h) {
                if (h <= 240) return 400000;
                if (h <= 360) return 800000;
                if (h <= 480) return 1400000;
                if (h <= 720) return 2500000;
                if (h <= 1080) return 4000000;
                return 8000000;
              }
              function pickLevel(levels, maxH) {
                if (!levels || !levels.length) return -1;
                if (maxH <= 0) return -1;
                var best = -1, bestHeight = 0;
                for (var i = 0; i < levels.length; i++) {
                  var L = levels[i];
                  var h = L.height || (L.resolution && L.resolution.height) || 0;
                  if (h > 0 && h <= maxH && h > bestHeight) { best = i; bestHeight = h; }
                }
                if (best >= 0) return best;
                var minI = 0, minH = (levels[0].height || 99999);
                for (var j = 1; j < levels.length; j++) {
                  var hj = levels[j].height || 99999;
                  if (hj < minH) { minH = hj; minI = j; }
                }
                return minI;
              }
              function collectShakaPlayers() {
                var out = [];
                var seen = [];
                function add(p) {
                  if (!p || typeof p.getVariantTracks !== 'function' ||
                      typeof p.selectVariantTrack !== 'function') return;
                  for (var s = 0; s < seen.length; s++) { if (seen[s] === p) return; }
                  seen.push(p);
                  out.push(p);
                }
                try {
                  [window.shakaPlayer, window.player, window.shaka_player].forEach(add);
                } catch (e0) {}
                try {
                  var vids = document.querySelectorAll('video');
                  for (var i = 0; i < vids.length; i++) {
                    var v = vids[i];
                    if (window.shaka && shaka.Player &&
                        typeof shaka.Player.getPlayerInstance === 'function') {
                      add(shaka.Player.getPlayerInstance(v));
                    }
                    try {
                      if (v['ui'] && v['ui'].getControls &&
                          typeof v['ui'].getControls === 'function') {
                        var controls = v['ui'].getControls();
                        if (controls && typeof controls.getPlayer === 'function') {
                          add(controls.getPlayer());
                        }
                      }
                    } catch (uiErr) {}
                    try {
                      var container = v.closest('.shaka-video-container') || v.parentElement;
                      if (container && container['ui'] &&
                          typeof container['ui'].getPlayer === 'function') {
                        add(container['ui'].getPlayer());
                      }
                    } catch (cErr) {}
                  }
                } catch (e1) {}
                try {
                  for (var k in window) {
                    if (k === 'parent' || k === 'top' || k === 'frameElement') continue;
                    try {
                      var o = window[k];
                      if (o && typeof o === 'object' &&
                          typeof o.getVariantTracks === 'function' &&
                          typeof o.selectVariantTrack === 'function') add(o);
                    } catch (xe) {}
                  }
                } catch (e2) {}
                return out;
              }
              function tryHls(maxH) {
                var found = false;
                var tryOne = function(hls) {
                  if (!hls || !hls.levels || !hls.levels.length) return;
                  found = true;
                  if (maxH <= 0) {
                    if (hls.currentLevel === -1) return;
                    hls.currentLevel = -1;
                    if (typeof hls.loadLevel === 'function') hls.loadLevel(-1);
                    if (typeof hls.autoLevelEnabled !== 'undefined') hls.autoLevelEnabled = true;
                    return;
                  }
                  if (typeof hls.autoLevelEnabled !== 'undefined') hls.autoLevelEnabled = false;
                  var idx = pickLevel(hls.levels, maxH);
                  if (idx >= 0) {
                    if (hls.currentLevel === idx) return;
                    hls.currentLevel = idx;
                    if (typeof hls.loadLevel === 'function') hls.loadLevel(idx);
                  }
                };
                try { if (window.hls) tryOne(window.hls); } catch (e0) {}
                try {
                  var vids = document.querySelectorAll('video');
                  for (var i = 0; i < vids.length; i++) {
                    var v = vids[i];
                    if (v.hls) tryOne(v.hls);
                    if (v._hls) tryOne(v._hls);
                  }
                } catch (e1) {}
                return found;
              }
              function tryShaka(maxH) {
                var candidates = collectShakaPlayers();
                if (!candidates.length) return false;
                for (var i = 0; i < candidates.length; i++) {
                  var pl = candidates[i];
                  try {
                    if (maxH <= 0) {
                      if (pl.__eaMaxOkoaMaxH === 0) continue;
                      pl.__eaMaxOkoaMaxH = 0;
                      pl.configure({
                        abr: { enabled: true },
                        restrictions: {
                          minHeight: 0, maxHeight: Infinity,
                          minBandwidth: 0, maxBandwidth: Infinity
                        }
                      });
                      continue;
                    }
                    if (pl.__eaMaxOkoaMaxH === maxH) {
                      var active = pl.getVariantTracks().filter(function(tr) {
                        return tr.active && tr.height > 0 && tr.height <= maxH;
                      });
                      if (active.length) continue;
                    }
                    var cap = maxBitrateForHeight(maxH);
                    pl.__eaMaxOkoaMaxH = maxH;
                    pl.configure({
                      abr: { enabled: false },
                      restrictions: { maxHeight: maxH, maxBandwidth: cap }
                    });
                    var tracks = pl.getVariantTracks();
                    var best = null, bestH = 0;
                    for (var t = 0; t < tracks.length; t++) {
                      var tr = tracks[t];
                      if (tr.type && tr.type !== 'variant' && tr.type !== 'video') continue;
                      var h = tr.height || 0;
                      if (h > 0 && h <= maxH && h > bestH) { best = tr; bestH = h; }
                    }
                    if (best) {
                      if (!best.active) pl.selectVariantTrack(best, false);
                    } else if (tracks.length) {
                      var minTr = tracks[0], minHt = tracks[0].height || 99999;
                      for (var u = 1; u < tracks.length; u++) {
                        var hh = tracks[u].height || 99999;
                        if (hh > 0 && hh < minHt) { minHt = hh; minTr = tracks[u]; }
                      }
                      if (!minTr.active) pl.selectVariantTrack(minTr, false);
                    }
                  } catch (e3) {}
                }
                return true;
              }
              function applyOkoaQuality(mode) {
                var maxH = parseTarget(String(mode));
                // After playback starts, only allow default 360p cap until user picks a quality.
                if (window.__eaMaxPlaybackLocked && !window.__eaMaxOkoaUserInitiated && maxH !== 360) {
                  return false;
                }
                var hlsOk = tryHls(maxH);
                var shakaOk = tryShaka(maxH);
                return hlsOk || shakaOk;
              }
              window.__eaMaxOkoaApplyStartup360 = function() {
                if (window.__eaMaxOkoaUserInitiated || window.__eaMaxOkoaLastApplied === '360') return true;
                if (window.__eaMaxStartup360Active) return false;
                window.__eaMaxStartup360Active = true;
                var tries = 0;
                function attempt() {
                  if (window.__eaMaxOkoaUserInitiated) {
                    window.__eaMaxStartup360Active = false;
                    return;
                  }
                  if (applyOkoaQuality('360')) {
                    window.__eaMaxOkoaLastApplied = '360';
                    window.__eaMaxStartup360Active = false;
                    return;
                  }
                  if (++tries < 12) {
                    setTimeout(attempt, 600);
                  } else {
                    window.__eaMaxStartup360Active = false;
                  }
                }
                attempt();
                return true;
              };
              window.__eaMaxOkoaSetQuality = function(mode, userInitiated) {
                userInitiated = !!userInitiated;
                if (!userInitiated) {
                  window.__eaMaxOkoaLastMode = String(mode);
                  return window.__eaMaxOkoaApplyStartup360();
                }
                window.__eaMaxOkoaUserInitiated = true;
                var modeStr = String(mode);
                if (window.__eaMaxOkoaLastApplied === modeStr) return true;
                window.__eaMaxOkoaLastMode = modeStr;
                if (applyOkoaQuality(modeStr)) {
                  window.__eaMaxOkoaLastApplied = modeStr;
                  window.__eaMaxOkoaUserInitiated = false;
                  return true;
                }
                if (window.__eaMaxOkoaRetryId) {
                  try { clearInterval(window.__eaMaxOkoaRetryId); } catch (e) {}
                }
                var tries = 0;
                window.__eaMaxOkoaRetryId = setInterval(function() {
                  if (applyOkoaQuality(window.__eaMaxOkoaLastMode)) {
                    window.__eaMaxOkoaLastApplied = window.__eaMaxOkoaLastMode;
                    window.__eaMaxOkoaUserInitiated = false;
                    clearInterval(window.__eaMaxOkoaRetryId);
                    window.__eaMaxOkoaRetryId = null;
                  } else if (++tries >= 8) {
                    clearInterval(window.__eaMaxOkoaRetryId);
                    window.__eaMaxOkoaRetryId = null;
                    window.__eaMaxOkoaUserInitiated = false;
                  }
                }, 800);
                return true;
              };
              true;
            })();
        """.trimIndent()
    }

    /** Defines [window.__eaMaxSetAudioLanguage] for Shaka / hls.js players inside gateway pages. */
    fun eaMaxAudioLanguageApiScript(): String {
        return """
            (function(){
              if (window.__eaMaxAudioLangInstalled) return true;
              window.__eaMaxAudioLangInstalled = true;
              function normalizeLang(raw) {
                var r = String(raw || 'sw').toLowerCase();
                if (r.indexOf('en') === 0 || r === 'english' || r === 'eng') return 'en';
                return 'sw';
              }
              function matchLang(trackLang, preferred) {
                var t = String(trackLang || '').toLowerCase();
                if (!t) return false;
                if (preferred === 'en') return t === 'en' || t.indexOf('en-') === 0 || t === 'eng';
                if (preferred === 'sw') return t === 'sw' || t.indexOf('sw-') === 0 || t === 'swa';
                return t === preferred || t.indexOf(preferred + '-') === 0;
              }
              function collectShakaPlayers() {
                var out = [], seen = [];
                function add(p) {
                  if (!p || typeof p.selectAudioLanguage !== 'function') return;
                  for (var s = 0; s < seen.length; s++) { if (seen[s] === p) return; }
                  seen.push(p); out.push(p);
                }
                try {
                  [window.shakaPlayer, window.player, window.shaka_player].forEach(add);
                  var vids = document.querySelectorAll('video');
                  for (var i = 0; i < vids.length; i++) {
                    var v = vids[i];
                    if (window.shaka && shaka.Player &&
                        typeof shaka.Player.getPlayerInstance === 'function') {
                      add(shaka.Player.getPlayerInstance(v));
                    }
                  }
                } catch (e0) {}
                return out;
              }
              function tryShaka(lang) {
                var players = collectShakaPlayers(), applied = false;
                for (var i = 0; i < players.length; i++) {
                  var pl = players[i];
                  try {
                    var langs = typeof pl.getAudioLanguages === 'function' ? pl.getAudioLanguages() : [];
                    if (langs && langs.length) {
                      for (var j = 0; j < langs.length; j++) {
                        if (matchLang(langs[j], lang)) {
                          pl.selectAudioLanguage(langs[j]);
                          applied = true;
                          break;
                        }
                      }
                    } else {
                      pl.selectAudioLanguage(lang);
                      applied = true;
                    }
                  } catch (e1) {}
                }
                return applied;
              }
              function tryHls(lang) {
                var found = false;
                function tryOne(hls) {
                  if (!hls || !hls.audioTracks || !hls.audioTracks.length) return;
                  for (var i = 0; i < hls.audioTracks.length; i++) {
                    var tr = hls.audioTracks[i];
                    if (matchLang(tr.lang || tr.name, lang)) {
                      hls.audioTrack = i;
                      found = true;
                      return;
                    }
                  }
                }
                try { if (window.hls) tryOne(window.hls); } catch (e0) {}
                try {
                  var vids = document.querySelectorAll('video');
                  for (var i = 0; i < vids.length; i++) {
                    var v = vids[i];
                    if (v.hls) tryOne(v.hls);
                    if (v._hls) tryOne(v._hls);
                  }
                } catch (e1) {}
                return found;
              }
              function applyAudioLanguage(raw) {
                var lang = normalizeLang(raw);
                window.__eaMaxPreferredAudioLang = lang;
                return tryShaka(lang) || tryHls(lang);
              }
              window.__eaMaxSetAudioLanguage = function(lang) {
                if (applyAudioLanguage(lang)) return true;
                if (window.__eaMaxAudioLangRetryId) {
                  try { clearInterval(window.__eaMaxAudioLangRetryId); } catch (e) {}
                }
                var tries = 0;
                window.__eaMaxAudioLangRetryId = setInterval(function() {
                  if (applyAudioLanguage(window.__eaMaxPreferredAudioLang || lang)) {
                    clearInterval(window.__eaMaxAudioLangRetryId);
                    window.__eaMaxAudioLangRetryId = null;
                  } else if (++tries >= 8) {
                    clearInterval(window.__eaMaxAudioLangRetryId);
                    window.__eaMaxAudioLangRetryId = null;
                  }
                }, 800);
                return true;
              };
              if (window.__eaMaxPreferredAudioLang) {
                try { window.__eaMaxSetAudioLanguage(window.__eaMaxPreferredAudioLang); } catch (e2) {}
              }
              true;
            })();
        """.trimIndent()
    }

    /**
     * Embedded Shaka Player 4.11.4 — HLS (.m3u8) and DASH (.mpd) in WebView (no raw gateway page).
     * Posts playback events to [androidInterfaceName] (ShakaPlayerBridge).
     */
    fun buildShakaPlayerHtml(
        streamUrl: String,
        headers: Map<String, String> = emptyMap(),
        clearKeys: Map<String, String> = emptyMap(),
        licenseUrl: String = "",
        maxHeight: Int = 360,
        preferredAudioLanguage: String = AudioLanguageSupport.DEFAULT,
        androidInterfaceName: String = "ShakaPlayerBridge",
    ): String {
        val headerJson = org.json.JSONObject(headers as Map<*, *>).toString()
        val clearKeysJson = org.json.JSONObject(clearKeys as Map<*, *>).toString()
        val urlJson = org.json.JSONObject.quote(streamUrl)
        val licenseJson = org.json.JSONObject.quote(licenseUrl)
        val audioLangJson = org.json.JSONObject.quote(AudioLanguageSupport.normalize(preferredAudioLanguage))
        val maxW = when {
            maxHeight >= 1080 -> 1920
            maxHeight >= 720 -> 1280
            maxHeight >= 480 -> 854
            maxHeight >= 360 -> 640
            else -> 426
        }

        return """
<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#000;height:100%;width:100%;overflow:hidden}
video{width:100%;height:100%;background:#000;object-fit:contain;display:block}
</style>
<script src="https://cdn.jsdelivr.net/npm/mux.js@6.3.0/dist/mux.js"></script>
<script src="https://cdn.jsdelivr.net/npm/shaka-player@4.11.4/dist/shaka-player.compiled.js"
  onerror="(function(){var s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.11.4/shaka-player.compiled.min.js';document.head.appendChild(s);})();"></script>
</head><body>
<video id="v" autoplay playsinline webkit-playsinline controls></video>
<script>
(function(){
  var BR='$androidInterfaceName';
  var url=$urlJson, headers=$headerJson, clearKeys=$clearKeysJson;
  var licenseUrl=$licenseJson, maxH=$maxHeight, maxW=$maxW, audioLang=$audioLangJson;
  function postPlaying(){ try{ window[BR]&&window[BR].onPlaybackStarted&&window[BR].onPlaybackStarted(); }catch(e){} }
  function postError(){ try{ window[BR]&&window[BR].onPlaybackError&&window[BR].onPlaybackError('unavailable'); }catch(e){} }
  function waitShaka(cb){ var n=0;(function t(){ if(typeof shaka!=='undefined'){ cb(true); return; } if(++n>40){ cb(false); return; } setTimeout(t,150); })(); }
  waitShaka(function(ok){
    if(!ok){ postError(); return; }
    var v=document.getElementById('v');
    shaka.polyfill.installAll();
    var player=new shaka.Player(v);
    player.getNetworkingEngine().registerRequestFilter(function(type,req){
      req.allowCrossSiteCredentials=true;
      Object.keys(headers||{}).forEach(function(k){ if(headers[k]!=null) req.headers[k]=String(headers[k]); });
      if(type===shaka.net.NetworkingEngine.RequestType.MANIFEST){
        req.headers['Accept']=req.headers['Accept']||'application/dash+xml,application/vnd.apple.mpegurl,*/*';
      }
    });
    var drmCfg={};
    if(clearKeys&&Object.keys(clearKeys).length) drmCfg.clearKeys=clearKeys;
    if(licenseUrl) drmCfg.servers={'com.widevine.alpha':licenseUrl,'org.w3.clearkey':licenseUrl};
    player.configure({
      streaming:{bufferingGoal:12,rebufferingGoal:2,retryParameters:{maxAttempts:4,baseDelay:800,timeout:20000}},
      drm:drmCfg,
      abr:{enabled:true,restrictions:{maxHeight:maxH,maxWidth:maxW}}
    });
    player.addEventListener('error',function(){ postError(); });
    v.addEventListener('playing', postPlaying);
    player.load(url).then(function(){
      try{
        var langs=typeof player.getAudioLanguages==='function'?player.getAudioLanguages():[];
        var pick=audioLang;
        if(langs&&langs.length){
          for(var i=0;i<langs.length;i++){
            var l=String(langs[i]||'').toLowerCase();
            if(pick==='en'&&(l==='en'||l.indexOf('en-')===0||l==='eng')){ pick=langs[i]; break; }
            if(pick==='sw'&&(l==='sw'||l.indexOf('sw-')===0||l==='swa')){ pick=langs[i]; break; }
          }
        }
        if(typeof player.selectAudioLanguage==='function') player.selectAudioLanguage(pick);
        var tracks=player.getVariantTracks();
        if(tracks&&tracks.length){
          var best=tracks[0], bestH=tracks[0].height||0;
          for(var i=0;i<tracks.length;i++){
            var h=tracks[i].height||0;
            if(h>0&&h<=maxH&&h>=bestH){ best=tracks[i]; bestH=h; }
          }
          if(best) player.selectVariantTrack(best,false,0);
        }
      }catch(e){}
      postPlaying();
      v.play().catch(function(){});
    }).catch(function(){ postError(); });
  });
})();
</script></body></html>
        """.trimIndent()
    }
}
