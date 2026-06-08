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
              function tryHls(maxH) {
                var tryOne = function(hls) {
                  if (!hls || !hls.levels || !hls.levels.length) return;
                  if (maxH <= 0) {
                    hls.currentLevel = -1;
                    if (typeof hls.loadLevel === 'function') hls.loadLevel(-1);
                    return;
                  }
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
                try {
                  for (var k in window) {
                    if (k === 'parent' || k === 'top' || k === 'frameElement') continue;
                    var o;
                    try { o = window[k]; } catch (xe) { continue; }
                    if (o && typeof o === 'object' && o.levels && o.levels.length &&
                        typeof o.currentLevel === 'number')
                      tryOne(o);
                  }
                } catch (e2) {}
              }
              function tryShaka(maxH) {
                var candidates = [];
                try {
                  [window.shakaPlayer, window.player, window.shaka_player].forEach(function (p) {
                    if (p && typeof p.getVariantTracks === 'function') candidates.push(p);
                  });
                } catch (e) {}
                try {
                  for (var k in window) {
                    try {
                      var o = window[k];
                      if (o && typeof o === 'object' && typeof o.getVariantTracks === 'function' &&
                          typeof o.selectVariantTrack === 'function')
                        candidates.push(o);
                    } catch (xe) {}
                  }
                } catch (e2) {}
                for (var i = 0; i < candidates.length; i++) {
                  var pl = candidates[i];
                  try {
                    if (maxH <= 0) {
                      pl.configure({ abr: { enabled: true } });
                      continue;
                    }
                    pl.configure({ abr: { enabled: false } });
                    var tracks = pl.getVariantTracks();
                    var best = null, bestH = 0;
                    for (var t = 0; t < tracks.length; t++) {
                      var tr = tracks[t];
                      var h = tr.height || 0;
                      if (h > 0 && h <= maxH && h > bestH) { best = tr; bestH = h; }
                    }
                    if (best) pl.selectVariantTrack(best, true);
                    else if (tracks.length) {
                      var minTr = tracks[0], minHt = tracks[0].height || 99999;
                      for (var u = 1; u < tracks.length; u++) {
                        var hh = tracks[u].height || 99999;
                        if (hh < minHt) { minHt = hh; minTr = tracks[u]; }
                      }
                      pl.selectVariantTrack(minTr, true);
                    }
                  } catch (e3) {}
                }
              }
              window.__eaMaxOkoaSetQuality = function(mode) {
                var maxH = parseTarget(String(mode));
                tryHls(maxH);
                tryShaka(maxH);
                return true;
              };
              true;
            })();
        """.trimIndent()
    }
}
