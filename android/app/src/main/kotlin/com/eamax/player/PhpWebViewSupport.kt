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
              var lastProgressAt = Date.now();
              var waitingSince = 0;
              var monitorStarted = false;

              function getVideo() {
                return document.querySelector('video');
              }

              function tryPlay(video) {
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
                  waitingSince = 0;
                });

                video.addEventListener('playing', function () {
                  lastProgressAt = Date.now();
                  waitingSince = 0;
                  $postPlaying
                });

                video.addEventListener('waiting', function () {
                  waitingSince = waitingSince || Date.now();
                });

                tryPlay(video);
              }

              function startMonitor() {
                if (monitorStarted) return;
                monitorStarted = true;
                setInterval(function () {
                  var video = getVideo();
                  if (!video) return;
                  bindVideo(video);

                  var now = Date.now();
                  var noProgressMs = now - lastProgressAt;
                  if (video.paused && !video.ended) {
                    tryPlay(video);
                  }

                  if ((video.readyState < 3 || video.seeking) && waitingSince === 0) {
                    waitingSince = now;
                  }

                  if (waitingSince > 0 && noProgressMs > 8000) {
                    try {
                      if (isFinite(video.currentTime) && video.currentTime > 0.15) {
                        video.currentTime = Math.max(0, video.currentTime - 0.1);
                      }
                    } catch (e) {}
                    tryPlay(video);
                    waitingSince = now;
                  }
                }, 2500);
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
                var html = document.documentElement ? document.documentElement.innerHTML : '';
                if (!html || html.indexOf('encryptedMpd') < 0) return false;
                function pick(name) {
                  var re = new RegExp(name + '\\s*=\\s*["\\']([^"\\']+)["\\']', 'i');
                  var m = html.match(re);
                  return m ? m[1] : '';
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
                var keyPart = pick('keyPart');
                var encMpd = pick('encryptedMpd');
                if (!keyPart || !encMpd) return false;
                var streamUrl = xorDecrypt(encMpd, keyPart);
                if (!streamUrl || streamUrl.indexOf('http') !== 0) return false;
                var licenseUrl = pick('encryptedLicense') ? xorDecrypt(pick('encryptedLicense'), keyPart) : '';
                var authToken = pick('encryptedToken') ? xorDecrypt(pick('encryptedToken'), keyPart) : '';
                var clearKeyRaw = pick('encryptedClearKey') ? xorDecrypt(pick('encryptedClearKey'), keyPart) : '';
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
                    hls.currentLevel = -1;
                    if (typeof hls.loadLevel === 'function') hls.loadLevel(-1);
                    if (typeof hls.autoLevelEnabled !== 'undefined') hls.autoLevelEnabled = true;
                    return;
                  }
                  if (typeof hls.autoLevelEnabled !== 'undefined') hls.autoLevelEnabled = false;
                  var idx = pickLevel(hls.levels, maxH);
                  if (idx >= 0) {
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
                      pl.configure({
                        abr: { enabled: true },
                        restrictions: {
                          minHeight: 0, maxHeight: Infinity,
                          minBandwidth: 0, maxBandwidth: Infinity
                        }
                      });
                      continue;
                    }
                    var cap = maxBitrateForHeight(maxH);
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
                      pl.selectVariantTrack(best, true);
                    } else if (tracks.length) {
                      var minTr = tracks[0], minHt = tracks[0].height || 99999;
                      for (var u = 1; u < tracks.length; u++) {
                        var hh = tracks[u].height || 99999;
                        if (hh > 0 && hh < minHt) { minHt = hh; minTr = tracks[u]; }
                      }
                      pl.selectVariantTrack(minTr, true);
                    }
                  } catch (e3) {}
                }
                return true;
              }
              function applyOkoaQuality(mode) {
                var maxH = parseTarget(String(mode));
                var hlsOk = tryHls(maxH);
                var shakaOk = tryShaka(maxH);
                return hlsOk || shakaOk;
              }
              window.__eaMaxOkoaSetQuality = function(mode) {
                window.__eaMaxOkoaLastMode = String(mode);
                if (applyOkoaQuality(mode)) return true;
                var tries = 0;
                var id = setInterval(function() {
                  if (applyOkoaQuality(window.__eaMaxOkoaLastMode) || ++tries >= 30) {
                    clearInterval(id);
                  }
                }, 300);
                return true;
              };
              true;
            })();
        """.trimIndent()
    }
}
