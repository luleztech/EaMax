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
            if (!window.__eaMaxPlayingPosted) {
              window.__eaMaxPlayingPosted = true;
              if (typeof $androidInterfaceName !== 'undefined' && $androidInterfaceName.onPlaybackStarted) {
                $androidInterfaceName.onPlaybackStarted();
              }
            }
          } catch (e) {}
        """.trimIndent()

        return """
            (function () {
              if (window.__eaMaxGatewayRecoveryStarted) return true;
              window.__eaMaxGatewayRecoveryStarted = true;

              var lastProgressAt = Date.now();
              var lastRecoveryAt = 0;
              var stallSince = 0;

              function getVideo() {
                return document.querySelector('video');
              }

              function tryPlay(video) {
                try {
                  if (!video || video.ended) return;
                  var p = video.play && video.play();
                  if (p && typeof p.catch === 'function') p.catch(function(){});
                } catch (e) {}
              }

              function bindVideo(video) {
                if (!video || video.__eaMaxBound) return;
                video.__eaMaxBound = true;
                video.setAttribute('playsinline', 'true');
                video.setAttribute('webkit-playsinline', 'true');
                video.setAttribute('autoplay', '');
                try { video.muted = false; } catch (e) {}
                video.controls = false;
                video.removeAttribute('controls');

                video.addEventListener('timeupdate', function () {
                  lastProgressAt = Date.now();
                  stallSince = 0;
                });

                video.addEventListener('playing', function () {
                  lastProgressAt = Date.now();
                  stallSince = 0;
                  $postPlaying
                });

                video.addEventListener('waiting', function () {
                  if (!stallSince) stallSince = Date.now();
                });

                video.addEventListener('canplay', function () {
                  stallSince = 0;
                });

                tryPlay(video);
              }

              function gentleRecovery(video) {
                var now = Date.now();
                if (now - lastRecoveryAt < 15000) return;
                lastRecoveryAt = now;
                tryPlay(video);
              }

              function startMonitor() {
                setInterval(function () {
                  var video = getVideo();
                  if (!video) return;
                  bindVideo(video);

                  var now = Date.now();
                  var noProgressMs = now - lastProgressAt;

                  if (video.paused && !video.ended && noProgressMs > 20000) {
                    gentleRecovery(video);
                    return;
                  }

                  if (stallSince > 0 && noProgressMs > 20000) {
                    gentleRecovery(video);
                    stallSince = 0;
                  }
                }, 5000);
              }

              try {
                var observer = new MutationObserver(function () {
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
                'video::-webkit-media-controls-enclosure,video::-webkit-media-controls,' +
                'video::-webkit-media-controls-panel,video::-webkit-media-controls-current-time-display,' +
                'video::-webkit-media-controls-time-remaining-display,video::-webkit-media-controls-duration-display,' +
                'video::-webkit-media-controls-timeline{display:none!important;visibility:hidden!important;opacity:0!important}' +
                '.vjs-time-control,.vjs-duration,.vjs-current-time,.vjs-remaining-time,' +
                '.shaka-current-time,.shaka-time-container,.shaka-seek-bar-container{display:none!important}' +
                '.shaka-overflow-menu-button,.shaka-settings-menu,.vjs-settings-button,' +
                '[class*="settings-button"],[class*="gear"],[aria-label*="Settings"],[title*="Settings"]' +
                '{display:none!important;pointer-events:none!important;opacity:0!important;visibility:hidden!important}' +
                'video,.shaka-video-container,.shaka-video,.video-js,#player,#player *{' +
                'position:fixed!important;inset:0!important;width:100%!important;height:100%!important;' +
                'max-width:100%!important;max-height:100%!important;object-fit:contain!important;' +
                'z-index:2147483646!important;opacity:1!important;visibility:visible!important;display:block!important}' +
                '@media (orientation:landscape){video,.shaka-video-container,.shaka-video,.video-js,#player,#player *{object-fit:cover!important}}';
              root.appendChild(s);
              return true;
            })();
        """.trimIndent()
    }

    /** Pause and tear down in-page players so native Exo does not double-audio with WebView. */
    fun suspendWebViewPlaybackScript(): String {
        return """
            (function(){
              try {
                if (window.__eaMaxOkoaRetryInterval) {
                  clearInterval(window.__eaMaxOkoaRetryInterval);
                  window.__eaMaxOkoaRetryInterval = null;
                }
                document.querySelectorAll('video').forEach(function(v){
                  try { v.pause(); v.muted = true; v.removeAttribute('src'); v.load(); } catch(e){}
                });
                if (window.shaka && shaka.Player && typeof shaka.Player.getPlayerInstance === 'function') {
                  document.querySelectorAll('video').forEach(function(v){
                    try {
                      var p = shaka.Player.getPlayerInstance(v);
                      if (p && typeof p.destroy === 'function') p.destroy();
                    } catch(e){}
                  });
                }
                [window.shakaPlayer, window.player, window.hls].forEach(function(obj){
                  try {
                    if (obj && typeof obj.destroy === 'function') obj.destroy();
                    else if (obj && typeof obj.stopLoad === 'function') obj.stopLoad();
                  } catch(e){}
                });
              } catch(e){}
              true;
            })();
        """.trimIndent()
    }

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
                var needsLicense = streamUrl.indexOf('azamtvltd') >= 0 ||
                  streamUrl.indexOf('widevine') >= 0 || streamUrl.indexOf('cdntoken=') >= 0;
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
                var notifyKey = payload.streamUrl + '|' + payload.licenseUrl + '|' +
                  JSON.stringify(payload.licenseHeaders || {});
                if (window.__eaMaxNotifyKey === notifyKey) return;
                window.__eaMaxNotifyKey = notifyKey;
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
              function capQualityCfg(cfg) {
                if (window.__eaMaxUserPickedQuality || !cfg) return cfg;
                var maxH = window.__eaMaxDefaultMaxH || 360;
                if (!cfg.abr) cfg.abr = {};
                if (!cfg.abr.restrictions) cfg.abr.restrictions = {};
                var r = cfg.abr.restrictions;
                if (!r.maxHeight || r.maxHeight > maxH) r.maxHeight = maxH;
                var bw = maxH <= 240 ? 400000 : maxH <= 360 ? 800000 :
                  maxH <= 480 ? 1400000 : maxH <= 720 ? 2500000 : 4000000;
                if (!r.maxBandwidth || r.maxBandwidth > bw) r.maxBandwidth = bw;
                if (cfg.abr.enabled === undefined) cfg.abr.enabled = true;
                return cfg;
              }
              function applyStartupCap(player) {
                if (window.__eaMaxUserPickedQuality || !player) return;
                if (window.__eaMaxStartupCapApplied) return;
                try {
                  var maxH = window.__eaMaxDefaultMaxH || 360;
                  var tracks = player.getVariantTracks();
                  if (!tracks || !tracks.length) return;
                  var best = null, bestH = 0;
                  for (var i = 0; i < tracks.length; i++) {
                    var h = tracks[i].height || 0;
                    if (h > 0 && h <= maxH && h >= bestH) { best = tracks[i]; bestH = h; }
                  }
                  if (!best) return;
                  var active = null;
                  for (var j = 0; j < tracks.length; j++) {
                    if (tracks[j].active) { active = tracks[j]; break; }
                  }
                  if (active && best &&
                      ((active.id != null && best.id != null && active.id === best.id) ||
                       (active.height === best.height))) {
                    window.__eaMaxStartupCapApplied = true;
                    window.__eaMaxOkoaActiveMode = String(maxH);
                    return;
                  }
                  player.configure({
                    abr: { enabled: true, restrictions: { maxHeight: maxH, maxBandwidth: maxH <= 360 ? 800000 : 1400000 } }
                  });
                  player.selectVariantTrack(best, false);
                  window.__eaMaxStartupCapApplied = true;
                  window.__eaMaxOkoaActiveMode = String(maxH);
                } catch (e) {}
              }
              function wrapPlayer(Orig) {
                var Wrapped = function (video) {
                  var p = new Orig(video);
                  try { window.__eaMaxActiveShakaPlayer = p; } catch (eStore) {}
                  try {
                    var oc = p.configure;
                    if (typeof oc === 'function') {
                      p.configure = function (cfg, clear) {
                        captureCfg(cfg);
                        if (!window.__eaMaxUserPickedQuality && cfg) cfg = capQualityCfg(cfg);
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
                        var self = this;
                        var ret = ol.apply(this, arguments);
                        if (ret && typeof ret.then === 'function') {
                          return ret.then(function (v) {
                            applyStartupCap(self);
                            return v;
                          });
                        }
                        applyStartupCap(self);
                        return ret;
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
                if (typeof shaka.Player.isBrowserSupported !== 'function') {
                  shaka.Player.isBrowserSupported = function () {
                    try { return Promise.resolve(true); } catch (e) { return true; }
                  };
                }
                if (shaka.Player.__eaMaxHooked) return;
                shaka.Player = wrapPlayer(shaka.Player);
                shaka.Player.__eaMaxHooked = true;
              }
              setInterval(tryHook, 15);
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
                if (u.indexOf('/tok_') >= 0 || u.indexOf('tok_eyj') >= 0) return false;
                if (u.indexOf('.mpd') >= 0 || u.indexOf('.m3u8') >= 0) return false;
                if (u.indexOf('cdntoken=') >= 0) return false;
                return u.indexOf('license') >= 0 || u.indexOf('widevine') >= 0 ||
                       u.indexOf('rightsManager') >= 0 || u.indexOf('acquirelicense') >= 0 ||
                       u.indexOf('/drm') >= 0 || u.indexOf('/wv/') >= 0 ||
                       u.indexOf('getkey') >= 0;
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

    /** Polyfill Shaka on third-party gateway pages before their init scripts run. */
    fun gatewayShakaPolyfillScript(): String {
        return """
            (function () {
              if (window.__eaMaxShakaPolyfill) return true;
              window.__eaMaxShakaPolyfill = true;

              function browserSupported() {
                try { return Promise.resolve(true); } catch (e) { return true; }
              }

              function ensurePlayer(P) {
                if (!P) return false;
                try {
                  if (typeof P.isBrowserSupported !== 'function') {
                    P.isBrowserSupported = browserSupported;
                  }
                } catch (e) {}
                return typeof P.isBrowserSupported === 'function';
              }

              function watchShakaObject(obj) {
                if (!obj || typeof obj !== 'object' || obj.__eaMaxWatched) return;
                obj.__eaMaxWatched = true;
                ensurePlayer(obj.Player);
                try {
                  var _Player = obj.Player;
                  Object.defineProperty(obj, 'Player', {
                    configurable: true,
                    enumerable: true,
                    get: function () { return _Player; },
                    set: function (v) {
                      _Player = v;
                      ensurePlayer(v);
                    }
                  });
                } catch (e) {}
                try {
                  if (obj.polyfill && typeof obj.polyfill.installAll === 'function') {
                    obj.polyfill.installAll();
                  }
                } catch (e) {}
              }

              function retryGatewayInit() {
                ['initPlayer', 'startPlayer', 'initShaka', 'loadStream', 'playChannel', 'startStream']
                  .forEach(function (fn) {
                    try {
                      if (typeof window[fn] === 'function') window[fn]();
                    } catch (e) {}
                  });
              }

              try {
                var stub = function () {};
                stub.isBrowserSupported = browserSupported;
                if (!window.shaka) {
                  window.shaka = { Player: stub, polyfill: { installAll: function () {} } };
                } else {
                  watchShakaObject(window.shaka);
                }
              } catch (e) {}

              try {
                var stored = window.shaka;
                watchShakaObject(stored);
                Object.defineProperty(window, 'shaka', {
                  configurable: true,
                  enumerable: true,
                  get: function () { return stored; },
                  set: function (val) {
                    stored = val;
                    watchShakaObject(val);
                  }
                });
              } catch (e) {}

              var n = 0;
              var fast = setInterval(function () {
                try {
                  if (window.shaka) watchShakaObject(window.shaka);
                  ensurePlayer(window.shaka && window.shaka.Player);
                } catch (e) {}
                if (++n > 400) clearInterval(fast);
              }, 5);

              window.addEventListener('error', function (ev) {
                var msg = (ev && ev.message) ? String(ev.message) : '';
                if (msg.indexOf('isBrowserSupported') >= 0) {
                  if (window.shaka) ensurePlayer(window.shaka.Player);
                  setTimeout(retryGatewayInit, 0);
                }
              });

              return true;
            })();
        """.trimIndent()
    }

    /** Combined early injection: configure hook + network capture + CDN referer fix (document-start). */
    fun gatewayDocumentStartScript(
        androidInterfaceName: String = "ShakaPlayerBridge",
        gatewayUrl: String = "",
        defaultMaxHeight: Int = 360,
    ): String =
        """
            (function(){
              window.__eaMaxDefaultMaxH=$defaultMaxHeight;
              window.__eaMaxUserPickedQuality=false;
              window.__eaMaxPlayingPosted=false;
              return true;
            })();
        """.trimIndent() +
            "\n" +
            gatewayShakaPolyfillScript() +
            "\n" +
            gatewayShakaConfigureHookScript(androidInterfaceName) +
            "\n" +
            gatewayNetworkCaptureScript(androidInterfaceName) +
            "\n" +
            gatewayCdnRefererFixScript(gatewayUrl)

    /**
     * Adds Referer/Origin on Azam/tokenized CDN requests from the gateway page context.
     * Fixes HTTP 403 when the embedded Shaka player loads azamtvltd manifests.
     */
    fun gatewayCdnRefererFixScript(gatewayUrl: String): String {
        val gatewayJson = org.json.JSONObject.quote(gatewayUrl.trim())
        return """
            (function () {
              if (window.__eaMaxCdnRefererFix) return true;
              window.__eaMaxCdnRefererFix = true;
              var gateway = $gatewayJson;
              if (!gateway || gateway.indexOf('http') !== 0) return true;
              var origin = '';
              try {
                var a = document.createElement('a');
                a.href = gateway;
                origin = a.protocol + '//' + a.host;
              } catch (e) {}
              function needsFix(u) {
                u = String(u || '').toLowerCase();
                return u.indexOf('azamtvltd') >= 0 || u.indexOf('mpilalivetv') >= 0 ||
                       u.indexOf('cdntoken=') >= 0 || u.indexOf('cdnblncr') >= 0;
              }
              function applyHeaders(hdrs) {
                if (!hdrs) hdrs = {};
                if (!hdrs['Referer'] && !hdrs['referer']) hdrs['Referer'] = gateway;
                if (!hdrs['Origin'] && !hdrs['origin'] && origin) hdrs['Origin'] = origin;
                return hdrs;
              }
              function refererForUrl(u) {
                u = String(u || '');
                if (u.indexOf('.mpd') >= 0 || u.indexOf('.m3u8') >= 0) {
                  var q = u.indexOf('?');
                  return q >= 0 ? u.substring(0, q) : u;
                }
                return gateway;
              }
              function patchRequestHeaders(request, type) {
                if (!request || !request.uris) return;
                var RT = null;
                try {
                  if (typeof shaka !== 'undefined' && shaka.net && shaka.net.NetworkingEngine) {
                    RT = shaka.net.NetworkingEngine.RequestType;
                  }
                } catch (e) {}
                var isLicense = RT && type === RT.LICENSE;
                for (var i = 0; i < request.uris.length; i++) {
                  var u = String(request.uris[i] || '');
                  if (!needsFix(u)) continue;
                  request.headers = request.headers || {};
                  var ref = refererForUrl(u);
                  if (!request.headers['Referer'] && !request.headers['referer']) {
                    request.headers['Referer'] = ref;
                  }
                  if (origin && !request.headers['Origin'] && !request.headers['origin']) {
                    request.headers['Origin'] = origin;
                  }
                  // Manifest/segment: omit credentials — Azam CDN returns ACAO:* which breaks credentialed fetch.
                  request.allowCrossSiteCredentials = isLicense === true;
                }
              }
              function hookShakaNetworking() {
                if (window.__eaMaxShakaNetReferer) return;
                if (typeof shaka === 'undefined' || !shaka.net || !shaka.net.NetworkingEngine) return;
                window.__eaMaxShakaNetReferer = true;
                try {
                  var RT = shaka.net.NetworkingEngine.RequestType;
                  var origReq = shaka.net.NetworkingEngine.prototype.request;
                  shaka.net.NetworkingEngine.prototype.request = function(type, request) {
                    try { patchRequestHeaders(request, type); } catch (e) {}
                    return origReq.call(this, type, request);
                  };
                } catch (e) {}
                try {
                  if (typeof shaka.Player === 'undefined' || shaka.Player.__eaMaxRefererWrapped) return;
                  var Orig = shaka.Player;
                  var Wrapped = function(video) {
                    var p = new Orig(video);
                    try {
                      var eng = p.getNetworkingEngine && p.getNetworkingEngine();
                      if (eng && eng.registerRequestFilter) {
                        eng.registerRequestFilter(function(type, request) {
                          patchRequestHeaders(request, type);
                        });
                      }
                    } catch (e2) {}
                    return p;
                  };
                  Wrapped.prototype = Orig.prototype;
                  shaka.Player = Wrapped;
                  shaka.Player.__eaMaxRefererWrapped = true;
                } catch (e3) {}
              }
              function patchFetch() {
                if (window.__eaMaxCdnFetchFix) return;
                window.__eaMaxCdnFetchFix = true;
                try {
                  var orig = window.fetch;
                  if (!orig) return;
                  window.fetch = function(input, init) {
                    try {
                      var u = (typeof input === 'string') ? input : (input && input.url ? input.url : '');
                      if (needsFix(u)) {
                        init = init || {};
                        init.credentials = 'omit';
                        var h = new Headers(init.headers || {});
                        if (!h.has('Referer')) h.set('Referer', refererForUrl(u));
                        if (origin && !h.has('Origin')) h.set('Origin', origin);
                        init.headers = h;
                      }
                    } catch (e) {}
                    return orig.apply(this, arguments);
                  };
                } catch (e) {}
              }
              function patchXhr() {
                if (window.__eaMaxCdnXhrFix) return;
                window.__eaMaxCdnXhrFix = true;
                try {
                  var origSet = XMLHttpRequest.prototype.setRequestHeader;
                  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
                    try {
                      if (this.__eaMaxCdnUrl && needsFix(this.__eaMaxCdnUrl)) {
                        if (String(name).toLowerCase() === 'referer') this.__eaMaxHasReferer = true;
                        if (String(name).toLowerCase() === 'origin') this.__eaMaxHasOrigin = true;
                      }
                    } catch (e) {}
                    return origSet.apply(this, arguments);
                  };
                  var origOpen = XMLHttpRequest.prototype.open;
                  XMLHttpRequest.prototype.open = function(method, url) {
                    this.__eaMaxCdnUrl = String(url || '');
                    this.__eaMaxHasReferer = false;
                    this.__eaMaxHasOrigin = false;
                    var r = origOpen.apply(this, arguments);
                    try {
                      if (needsFix(this.__eaMaxCdnUrl)) {
                        this.withCredentials = false;
                        if (!this.__eaMaxHasReferer) origSet.call(this, 'Referer', refererForUrl(this.__eaMaxCdnUrl));
                        if (origin && !this.__eaMaxHasOrigin) origSet.call(this, 'Origin', origin);
                      }
                    } catch (e) {}
                    return r;
                  };
                } catch (e) {}
              }
              patchFetch();
              patchXhr();
              setInterval(hookShakaNetworking, 40);
              hookShakaNetworking();
              return true;
            })();
        """.trimIndent()
    }

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

    /** Reads live Shaka DRM config from the gateway page (returns JSON string). */
    fun readGatewayShakaDrmScript(): String {
        return """
            (function () {
              var out = { streamUrl: '', licenseUrl: '', authToken: '' };
              try {
                out.streamUrl = window.__eaMaxCapturedManifest || '';
                out.licenseUrl = window.__eaMaxCapturedLicense || '';
                if (typeof shaka !== 'undefined' && shaka.Player) {
                  var videos = document.querySelectorAll('video');
                  for (var i = 0; i < videos.length; i++) {
                    var p = null;
                    try {
                      if (shaka.Player.getPlayerInstance) {
                        p = shaka.Player.getPlayerInstance(videos[i]);
                      }
                    } catch (e1) {}
                    if (!p) continue;
                    try {
                      if (p.getAssetUri) out.streamUrl = p.getAssetUri() || out.streamUrl;
                    } catch (e2) {}
                    try {
                      var cfg = p.getConfiguration ? p.getConfiguration() : null;
                      if (cfg && cfg.drm && cfg.drm.servers) {
                        var s = cfg.drm.servers;
                        out.licenseUrl = s['com.widevine.alpha'] || s['com.widevine'] ||
                          s['org.w3.clearkey'] || out.licenseUrl;
                      }
                    } catch (e3) {}
                    break;
                  }
                }
              } catch (e) {}
              return JSON.stringify(out);
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
                tryShaka();
                if (window.__eaMaxCapturedManifest) {
                  post(window.__eaMaxCapturedManifest,
                       window.__eaMaxCapturedLicense || '',
                       '');
                }
              }, 500);
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
              window.__eaMaxDefaultMaxH = window.__eaMaxDefaultMaxH || 360;
              window.__eaMaxUserPickedQuality = window.__eaMaxUserPickedQuality || false;
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
              function getActiveShakaPlayer() {
                function ok(p) {
                  return p && typeof p.getVariantTracks === 'function' &&
                         typeof p.selectVariantTrack === 'function';
                }
                try {
                  if (ok(window.__eaMaxActiveShakaPlayer)) {
                    return window.__eaMaxActiveShakaPlayer;
                  }
                } catch (e0) {}
                try {
                  if (window.shaka && shaka.Player &&
                      typeof shaka.Player.getPlayerInstance === 'function') {
                    var vids = document.querySelectorAll('video');
                    var fallback = null;
                    for (var i = 0; i < vids.length; i++) {
                      var v = vids[i];
                      var p = shaka.Player.getPlayerInstance(v);
                      if (!ok(p)) {
                        if (ok(v.shakaPlayer)) p = v.shakaPlayer;
                        else if (ok(v.player)) p = v.player;
                        else p = null;
                      }
                      if (!ok(p)) continue;
                      window.__eaMaxActiveShakaPlayer = p;
                      if (!v.paused && v.readyState >= 2) return p;
                      if (v.currentTime > 0) fallback = p;
                      if (!fallback) fallback = p;
                    }
                    if (fallback) return fallback;
                  }
                } catch (e1) {}
                try {
                  var refs = [window.shakaPlayer, window.player, window.shaka_player];
                  for (var j = 0; j < refs.length; j++) {
                    if (ok(refs[j])) {
                      window.__eaMaxActiveShakaPlayer = refs[j];
                      return refs[j];
                    }
                  }
                } catch (e2) {}
                return null;
              }
              function pickBestTrack(tracks, maxH) {
                var best = null, bestH = 0;
                for (var t = 0; t < tracks.length; t++) {
                  var tr = tracks[t];
                  if (tr.type && tr.type !== 'variant' && tr.type !== 'video') continue;
                  var h = tr.height || 0;
                  if (h > 0 && h <= maxH && h > bestH) { best = tr; bestH = h; }
                }
                if (!best && tracks.length) {
                  var minTr = tracks[0], minHt = tracks[0].height || 99999;
                  for (var u = 1; u < tracks.length; u++) {
                    var hh = tracks[u].height || 99999;
                    if (hh > 0 && hh < minHt) { minHt = hh; minTr = tracks[u]; }
                  }
                  best = minTr;
                }
                return best;
              }
              function tracksMatch(a, b) {
                if (!a || !b) return false;
                if (a.id != null && b.id != null && a.id === b.id) return true;
                return a.height === b.height &&
                  Math.abs((a.bandwidth || 0) - (b.bandwidth || 0)) < 5000;
              }
              function tryHls(maxH) {
                var ok = false;
                var tryOne = function(hls) {
                  if (!hls || !hls.levels || !hls.levels.length) return;
                  ok = true;
                  if (maxH <= 0) {
                    hls.currentLevel = -1;
                    if (typeof hls.loadLevel === 'function') hls.loadLevel(-1);
                    if (typeof hls.autoLevelEnabled !== 'undefined') hls.autoLevelEnabled = true;
                    return;
                  }
                  if (typeof hls.autoLevelEnabled !== 'undefined') hls.autoLevelEnabled = false;
                  var idx = pickLevel(hls.levels, maxH);
                  if (idx >= 0 && hls.currentLevel !== idx) {
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
                return ok;
              }
              function tryShaka(maxH, pl) {
                pl = pl || getActiveShakaPlayer();
                if (!pl) return false;
                try {
                  if (maxH <= 0) {
                    pl.configure({
                      abr: {
                        enabled: true,
                        restrictions: {
                          minHeight: 0, maxHeight: Infinity,
                          minBandwidth: 0, maxBandwidth: Infinity
                        }
                      }
                    });
                    return true;
                  }
                  var tracks = pl.getVariantTracks();
                  if (!tracks || !tracks.length) return false;
                  var active = null;
                  for (var t = 0; t < tracks.length; t++) {
                    if (tracks[t].active) { active = tracks[t]; break; }
                  }
                  var best = pickBestTrack(tracks, maxH);
                  if (!best) return false;
                  if (tracksMatch(active, best)) {
                    try {
                      var cfg = pl.getConfiguration();
                      var r = cfg && cfg.abr && cfg.abr.restrictions;
                      if (r && r.maxHeight === maxH) return true;
                    } catch (e4) {}
                  }
                  var cap = maxBitrateForHeight(maxH);
                  pl.configure({
                    abr: {
                      enabled: false,
                      restrictions: { maxHeight: maxH, maxBandwidth: cap }
                    }
                  });
                  if (!tracksMatch(active, best)) {
                    pl.selectVariantTrack(best, false);
                  }
                  return true;
                } catch (e3) {
                  return false;
                }
              }
              function applyOkoaQuality(mode) {
                var modeStr = String(mode);
                var maxH = parseTarget(modeStr);
                var pl = getActiveShakaPlayer();
                if (pl) {
                  if (tryShaka(maxH, pl)) {
                    window.__eaMaxOkoaActiveMode = modeStr;
                    return true;
                  }
                  return false;
                }
                if (tryHls(maxH)) {
                  window.__eaMaxOkoaActiveMode = modeStr;
                  return true;
                }
                return false;
              }
              window.__eaMaxOkoaSetQuality = function(mode, fromUser) {
                fromUser = !!fromUser;
                var modeStr = String(mode);
                if (fromUser) window.__eaMaxUserPickedQuality = true;
                if (window.__eaMaxOkoaActiveMode === modeStr) return true;
                window.__eaMaxOkoaLastMode = modeStr;
                window.__eaMaxOkoaActiveMode = null;
                if (window.__eaMaxOkoaRetryInterval) {
                  clearInterval(window.__eaMaxOkoaRetryInterval);
                  window.__eaMaxOkoaRetryInterval = null;
                }
                if (applyOkoaQuality(modeStr)) return true;
                var tries = 0;
                window.__eaMaxOkoaRetryInterval = setInterval(function() {
                  if (applyOkoaQuality(window.__eaMaxOkoaLastMode) || ++tries >= 4) {
                    clearInterval(window.__eaMaxOkoaRetryInterval);
                    window.__eaMaxOkoaRetryInterval = null;
                  }
                }, 400);
                return false;
              };
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
        androidInterfaceName: String = "ShakaPlayerBridge",
    ): String {
        val headerJson = org.json.JSONObject(headers as Map<*, *>).toString()
        val clearKeysJson = org.json.JSONObject(clearKeys as Map<*, *>).toString()
        val urlJson = org.json.JSONObject.quote(streamUrl)
        val licenseJson = org.json.JSONObject.quote(licenseUrl)
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
@media (orientation:landscape){video{object-fit:cover}}
video::-webkit-media-controls-enclosure,video::-webkit-media-controls,
video::-webkit-media-controls-panel,video::-webkit-media-controls-current-time-display,
video::-webkit-media-controls-time-remaining-display,video::-webkit-media-controls-duration-display,
video::-webkit-media-controls-timeline{display:none!important}
</style>
<script src="https://cdn.jsdelivr.net/npm/mux.js@6.3.0/dist/mux.js"></script>
<script src="https://cdn.jsdelivr.net/npm/shaka-player@4.11.4/dist/shaka-player.compiled.js"
  onerror="(function(){var s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.11.4/shaka-player.compiled.min.js';document.head.appendChild(s);})();"></script>
</head><body>
<video id="v" autoplay playsinline webkit-playsinline></video>
<script>
(function(){
  var BR='$androidInterfaceName';
  var url=$urlJson, headers=$headerJson, clearKeys=$clearKeysJson;
  var licenseUrl=$licenseJson, maxH=$maxHeight, maxW=$maxW;
  function postPlaying(){
    try{
      if(window.__eaMaxPlayingPosted) return;
      window.__eaMaxPlayingPosted=true;
      window[BR]&&window[BR].onPlaybackStarted&&window[BR].onPlaybackStarted();
    }catch(e){}
  }
  function postError(){ try{ window[BR]&&window[BR].onPlaybackError&&window[BR].onPlaybackError('unavailable'); }catch(e){} }
  function waitShaka(cb){ var n=0;(function t(){ if(typeof shaka!=='undefined'){ cb(true); return; } if(++n>80){ cb(false); return; } setTimeout(t,50); })(); }
  waitShaka(function(ok){
    if(!ok){ postError(); return; }
    var v=document.getElementById('v');
    shaka.polyfill.installAll();
    var player=new shaka.Player(v);
    player.getNetworkingEngine().registerRequestFilter(function(type,req){
      req.allowCrossSiteCredentials=(type===shaka.net.NetworkingEngine.RequestType.LICENSE);
      Object.keys(headers||{}).forEach(function(k){ if(headers[k]!=null) req.headers[k]=String(headers[k]); });
      if(type===shaka.net.NetworkingEngine.RequestType.MANIFEST){
        req.headers['Accept']=req.headers['Accept']||'application/dash+xml,application/vnd.apple.mpegurl,*/*';
      }
    });
    var drmCfg={};
    if(clearKeys&&Object.keys(clearKeys).length) drmCfg.clearKeys=clearKeys;
    if(licenseUrl) drmCfg.servers={'com.widevine.alpha':licenseUrl,'org.w3.clearkey':licenseUrl};
    player.configure({
      streaming:{bufferingGoal:10,rebufferingGoal:2,retryParameters:{maxAttempts:4,baseDelay:400,timeout:15000}},
      drm:drmCfg,
      abr:{enabled:true,restrictions:{maxHeight:maxH,maxWidth:maxW}}
    });
    player.addEventListener('error',function(){ postError(); });
    v.addEventListener('playing', postPlaying);
    player.load(url).then(function(){
      try{
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

    /** Admin-controlled audio language for Shaka / HTML5 in-page players. */
    fun eaMaxAudioLanguageApiScript(): String {
        return """
            (function () {
              if (window.__eaMaxAudioLangApi) return true;
              window.__eaMaxAudioLangApi = true;
              window.__eaMaxPreferredAudioLang = 'sw';
              window.__eaMaxSetAudioLanguage = function (lang) {
                var normalized = (!lang || lang === 'auto' || lang === 'default') ? 'sw' : String(lang).toLowerCase();
                window.__eaMaxPreferredAudioLang = (normalized === 'en') ? 'en' : 'sw';
                window.__eaMaxApplyAudioLanguage && window.__eaMaxApplyAudioLanguage();
              };
              function __eaMaxLangAliases(lang) {
                if (lang === 'en') return ['en','eng','en-us','en-gb','en-au'];
                return ['sw','swa','sw-tz','sw-ke'];
              }
              function __eaMaxTrackMatches(tl, lang) {
                var aliases = __eaMaxLangAliases(lang);
                for (var i = 0; i < aliases.length; i++) {
                  var a = aliases[i];
                  if (tl === a || tl.indexOf(a + '-') === 0) return true;
                }
                return false;
              }
              window.__eaMaxApplyAudioLanguage = function () {
                var lang = window.__eaMaxPreferredAudioLang || 'sw';
                var applied = false;
                try {
                  document.querySelectorAll('video').forEach(function (v) {
                    if (v.audioTracks && v.audioTracks.length) {
                      for (var i = 0; i < v.audioTracks.length; i++) {
                        var tl = (v.audioTracks[i].language || '').toLowerCase();
                        var match = __eaMaxTrackMatches(tl, lang);
                        v.audioTracks[i].enabled = match;
                        if (match) applied = true;
                      }
                    }
                  });
                } catch (e) {}
                try {
                  if (window.shaka && shaka.Player && typeof shaka.Player.getPlayerInstance === 'function') {
                    document.querySelectorAll('video').forEach(function (v) {
                      try {
                        var p = shaka.Player.getPlayerInstance(v);
                        if (p && typeof p.selectAudioLanguage === 'function') {
                          var aliases = __eaMaxLangAliases(lang);
                          for (var j = 0; j < aliases.length; j++) {
                            try {
                              p.selectAudioLanguage(aliases[j], true);
                              applied = true;
                              break;
                            } catch (e2) {}
                          }
                        }
                      } catch (e) {}
                    });
                  }
                } catch (e) {}
                return applied;
              };
              if (!window.__eaMaxAudioLangRetryInterval) {
                window.__eaMaxAudioLangRetryInterval = setInterval(function () {
                  if (window.__eaMaxPreferredAudioLang) window.__eaMaxApplyAudioLanguage();
                }, 2500);
              }
              return true;
            })();
        """.trimIndent()
    }
}
