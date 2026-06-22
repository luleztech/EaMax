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
              if (typeof __eaMaxHideShakaUi === 'function') __eaMaxHideShakaUi();
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

              function getVideoInDoc(doc) {
                if (!doc) return null;
                var v = doc.querySelector('video');
                if (v) return v;
                var frames = doc.querySelectorAll('iframe');
                for (var fi = 0; fi < frames.length; fi++) {
                  try {
                    var fv = getVideoInDoc(frames[fi].contentDocument);
                    if (fv) return fv;
                  } catch (eFrame) {}
                }
                return null;
              }

              function getVideo() {
                return getVideoInDoc(document);
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
                  if (video.currentTime > 0.25) $postPlaying
                });

                video.addEventListener('playing', function () {
                  lastProgressAt = Date.now();
                  stallSince = 0;
                  $postPlaying
                });

                video.addEventListener('canplay', function () {
                  stallSince = 0;
                  if (video.currentTime > 0 || video.readyState >= 3) $postPlaying
                });

                video.addEventListener('loadeddata', function () {
                  if (!video.paused && video.currentTime > 0) $postPlaying
                });

                video.addEventListener('waiting', function () {
                  if (!stallSince) stallSince = Date.now();
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
                  if (!video.paused && video.currentTime > 0.2) $postPlaying

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
                }, 1000);
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

    private fun shakaMenuHideStylesCss(): String =
        """
        .shaka-overflow-menu-button,
        .shaka-overflow-menu,
        .shaka-overflow-menu-contents,
        .shaka-settings-menu,
        .shaka-language-menu,
        .shaka-audio-language-menu,
        .shaka-resolution-menu,
        .shaka-back-to-overflow-button,
        [class*="shaka-overflow"],
        [class*="shaka-resolutions"],
        [class*="shaka-audio-languages"],
        [class*="shaka-settings"]{
          display:none!important;
          visibility:hidden!important;
          opacity:0!important;
          pointer-events:none!important;
          max-height:0!important;
          overflow:hidden!important;
          clip-path:inset(100%)!important
        }
        """.trimIndent().replace("\n", "")

    private fun shakaUiHideStylesCss(): String =
        shakaMenuHideStylesCss() +
            """
            .shaka-controls-container,
            .shaka-bottom-controls,
            .shaka-controls-button-panel,
            [class*="shaka-caption"],
            [class*="shaka-context"],
            [class*="shaka-back-to"]{
              display:none!important;
              visibility:hidden!important;
              opacity:0!important;
              pointer-events:none!important;
              max-height:0!important;
              overflow:hidden!important;
              clip-path:inset(100%)!important
            }
            """.trimIndent().replace("\n", "")

    /** Injected at document-start — hide menus only so Shaka DRM can still initialize. */
    fun shakaUiHideDocumentStartScript(): String {
        val cssJson = org.json.JSONObject.quote(shakaMenuHideStylesCss())
        return """
            (function () {
              if (window.__eaMaxShakaHideCss) return true;
              window.__eaMaxShakaHideCss = true;
              var root = document.head || document.documentElement;
              if (!root) return false;
              var s = document.getElementById('__eaMaxHideShakaMenus');
              if (!s) {
                s = document.createElement('style');
                s.id = '__eaMaxHideShakaMenus';
                root.appendChild(s);
              }
              s.textContent = $cssJson;
              return true;
            })();
        """.trimIndent()
    }

    /** Layout gateway video full-screen — does not hide Shaka menus (see [hideShakaUiScript]). */
    fun playerOnlyUiScript(): String {
        return """
            (function () {
              var root = document.head || document.documentElement || document.body;
              if (!root) return false;
              var s = document.getElementById('__eaMaxPlayerOnly');
              if (!s) {
                s = document.createElement('style');
                s.id = '__eaMaxPlayerOnly';
                root.appendChild(s);
              }
              try {
                var meta = document.querySelector('meta[name="viewport"]');
                if (!meta) {
                  meta = document.createElement('meta');
                  meta.name = 'viewport';
                  (document.head || root).appendChild(meta);
                }
                meta.content = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
              } catch (eVp) {}
              s.textContent =
                'html,body{background:#000!important;margin:0!important;padding:0!important;overflow:hidden!important;' +
                'width:100%!important;height:100%!important}' +
                'video::-webkit-media-controls-enclosure,video::-webkit-media-controls,' +
                'video::-webkit-media-controls-panel,video::-webkit-media-controls-current-time-display,' +
                'video::-webkit-media-controls-time-remaining-display,video::-webkit-media-controls-duration-display,' +
                'video::-webkit-media-controls-timeline{display:none!important;visibility:hidden!important;opacity:0!important}' +
                '.vjs-time-control,.vjs-duration,.vjs-current-time,.vjs-remaining-time,' +
                '.shaka-current-time,.shaka-seek-bar-container,.shaka-spacer{display:none!important}' +
                'video,.shaka-video,.shaka-video-container,.video-js,.video-js video{' +
                'position:fixed!important;inset:0!important;top:0!important;left:0!important;' +
                'right:0!important;bottom:0!important;width:100%!important;height:100%!important;' +
                'max-width:100%!important;max-height:100%!important;margin:0!important;padding:0!important;' +
                'transform:none!important;object-fit:contain!important;object-position:center center!important;' +
                'z-index:1!important;opacity:1!important;visibility:visible!important;display:block!important}';
              ${ensureVideoVisibleScriptBody()}
              return true;
            })();
        """.trimIndent()
    }

    /** Keep the video layer visible (safe during load and after hiding Shaka menus). */
    fun ensureVideoVisibleScript(): String {
        return """
            (function () {
              ${ensureVideoVisibleScriptBody()}
              return true;
            })();
        """.trimIndent()
    }

    /** Hide in-page Shaka/gateway resolution & language menus (native app owns settings). */
    fun hideShakaUiScript(): String {
        return """
            (function () {
              ${hideShakaUiScriptBody()}
              return true;
            })();
        """.trimIndent()
    }

    /** @deprecated Use [hideShakaUiScript] — kept for call-site compatibility. */
    fun showPlayerControlsScript(): String = hideShakaUiScript()

    private fun ensureVideoVisibleScriptBody(): String {
        return """
              function __eaMaxEnsureVideoVisible() {
                try {
                  document.querySelectorAll('video,.shaka-video').forEach(function (el) {
                    el.style.setProperty('display', 'block', 'important');
                    el.style.setProperty('visibility', 'visible', 'important');
                    el.style.setProperty('opacity', '1', 'important');
                    el.style.setProperty('width', '100%', 'important');
                    el.style.setProperty('height', '100%', 'important');
                    el.style.setProperty('object-fit', 'contain', 'important');
                    el.style.setProperty('z-index', '1', 'important');
                  });
                  document.querySelectorAll('.shaka-video-container').forEach(function (el) {
                    el.style.setProperty('display', 'block', 'important');
                    el.style.setProperty('visibility', 'visible', 'important');
                    el.style.setProperty('opacity', '1', 'important');
                    el.style.setProperty('width', '100%', 'important');
                    el.style.setProperty('height', '100%', 'important');
                    el.style.setProperty('position', 'fixed', 'important');
                    el.style.setProperty('inset', '0', 'important');
                  });
                  if (typeof window.__eaMaxCenterVideo === 'function') {
                    window.__eaMaxCenterVideo('contain');
                  }
                } catch (e) {}
              }
              __eaMaxEnsureVideoVisible();
        """.trimIndent()
    }

    private fun hideShakaUiScriptBody(): String {
        val menuCssJson = org.json.JSONObject.quote(shakaMenuHideStylesCss())
        val fullCssJson = org.json.JSONObject.quote(shakaUiHideStylesCss())
        return """
              if (typeof __eaMaxEnsureVideoVisible !== 'function') {
                ${ensureVideoVisibleScriptBody()}
              }
              var __eaMaxMenuHideCss = $menuCssJson;
              var __eaMaxFullHideCss = $fullCssJson;
              function __eaMaxInjectHideCss(doc) {
                if (!doc) return;
                try {
                  var root = doc.head || doc.documentElement || doc.body;
                  if (!root) return;
                  var s = doc.getElementById('__eaMaxHideShakaMenus');
                  if (!s) {
                    s = doc.createElement('style');
                    s.id = '__eaMaxHideShakaMenus';
                    root.appendChild(s);
                  }
                  s.textContent = window.__eaMaxPlayingPosted ? __eaMaxFullHideCss : __eaMaxMenuHideCss;
                } catch (eCss) {}
              }
              function __eaMaxHideTextPanels() {
                try {
                  function hideEl(el) {
                    if (!el || el.querySelector('video,.shaka-video')) return;
                    el.style.setProperty('display', 'none', 'important');
                    el.style.setProperty('visibility', 'hidden', 'important');
                    el.style.setProperty('opacity', '0', 'important');
                    el.style.setProperty('pointer-events', 'none', 'important');
                  }
                  document.querySelectorAll('div, section, aside, ul, nav, [role="menu"], [role="dialog"]').forEach(function (el) {
                    if (el.querySelector('video,.shaka-video')) return;
                    var raw = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
                    if (raw.length < 4 || raw.length > 500) return;
                    var hasRes = raw.indexOf('resolution') >= 0 || raw.indexOf('1080p') >= 0 || raw.indexOf('720p') >= 0;
                    var hasLang = raw.indexOf('language') >= 0 || raw.indexOf('kiswahili') >= 0 || raw.indexOf('lugha') >= 0;
                    var cls = String(el.className || '').toLowerCase();
                    var isShaka = cls.indexOf('shaka') >= 0;
                    if ((hasRes && hasLang) || (isShaka && (hasRes || hasLang))) hideEl(el);
                  });
                  document.querySelectorAll('div, section, aside').forEach(function (el) {
                    if (el.querySelector('video,.shaka-video')) return;
                    var st = window.getComputedStyle(el);
                    if (st.position !== 'fixed' && st.position !== 'absolute') return;
                    var r = el.getBoundingClientRect();
                    if (r.width < 48 || r.height < 48) return;
                    if (r.left < window.innerWidth * 0.35) return;
                    if (r.top < window.innerHeight * 0.15) return;
                    var raw = (el.textContent || '').toLowerCase();
                    if ((raw.indexOf('resolution') >= 0 || raw.indexOf('1080p') >= 0) &&
                        (raw.indexOf('language') >= 0 || raw.indexOf('kiswahili') >= 0)) hideEl(el);
                  });
                  document.querySelectorAll('span, label, h1, h2, h3, h4, button, div').forEach(function (el) {
                    var label = (el.textContent || '').replace(/\s+/g, ' ').trim();
                    if (label !== 'Resolution' && label !== 'Language' && label !== 'Lugha' && label !== 'Ubora') return;
                    var panel = el.parentElement;
                    for (var depth = 0; panel && depth < 6; depth++) {
                      if (panel.querySelector('video,.shaka-video')) return;
                      var blob = (panel.textContent || '').toLowerCase();
                      if (blob.indexOf('resolution') >= 0 && blob.indexOf('language') >= 0) {
                        hideEl(panel);
                        return;
                      }
                      panel = panel.parentElement;
                    }
                  });
                } catch (e) {}
              }
              function __eaMaxHideShakaUi() {
                try {
                  if (window.__eaMaxShowControlsInterval) {
                    clearInterval(window.__eaMaxShowControlsInterval);
                    window.__eaMaxShowControlsInterval = null;
                  }
                  function runInDoc(doc) {
                    if (!doc) return;
                    __eaMaxInjectHideCss(doc);
                    try {
                      doc.querySelectorAll('video,.shaka-video').forEach(function (el) {
                        el.style.setProperty('display', 'block', 'important');
                        el.style.setProperty('visibility', 'visible', 'important');
                        el.style.setProperty('opacity', '1', 'important');
                        el.style.setProperty('width', '100%', 'important');
                        el.style.setProperty('height', '100%', 'important');
                        el.style.setProperty('object-fit', 'contain', 'important');
                      });
                      var menuSel = '[class*="shaka-overflow"],[class*="shaka-settings"],' +
                        '[class*="shaka-resolution"],[class*="shaka-resolutions"],' +
                        '[class*="shaka-language"],[class*="shaka-audio"],' +
                        '.shaka-overflow-menu-button,.shaka-overflow-menu,.shaka-overflow-menu-contents,' +
                        '.shaka-settings-menu,.shaka-language-menu,.shaka-audio-language-menu,.shaka-resolution-menu,' +
                        '.shaka-back-to-overflow-button,.shaka-caption-button,.shaka-context-menu';
                      if (window.__eaMaxPlayingPosted) {
                        menuSel += ',.shaka-controls-container,.shaka-bottom-controls,.shaka-controls-button-panel';
                      }
                      doc.querySelectorAll(menuSel).forEach(function (el) {
                        if (el.querySelector('video,.shaka-video')) return;
                        el.style.setProperty('display', 'none', 'important');
                        el.style.setProperty('visibility', 'hidden', 'important');
                        el.style.setProperty('opacity', '0', 'important');
                        el.style.setProperty('pointer-events', 'none', 'important');
                      });
                    } catch (eDoc) {}
                  }
                  __eaMaxEnsureVideoVisible();
                  runInDoc(document);
                  document.querySelectorAll('iframe').forEach(function (frame) {
                    try { runInDoc(frame.contentDocument); } catch (eFrame) {}
                  });
                  __eaMaxHideTextPanels();
                  document.querySelectorAll('iframe').forEach(function (frame) {
                    try {
                      var idoc = frame.contentDocument;
                      if (!idoc) return;
                      idoc.querySelectorAll('div, section, aside').forEach(function (el) {
                        if (el.querySelector('video,.shaka-video')) return;
                        var raw = (el.textContent || '').toLowerCase();
                        if ((raw.indexOf('resolution') >= 0 || raw.indexOf('1080p') >= 0) &&
                            (raw.indexOf('language') >= 0 || raw.indexOf('kiswahili') >= 0)) {
                          el.style.setProperty('display', 'none', 'important');
                        }
                      });
                    } catch (eFrame2) {}
                  });
                  __eaMaxEnsureVideoVisible();
                } catch (e) {}
              }
              __eaMaxHideShakaUi();
              if (!window.__eaMaxHideShakaUiInterval) {
                window.__eaMaxHideShakaUiInterval = setInterval(__eaMaxHideShakaUi, 800);
              }
              if (!window.__eaMaxShakaHideObserver) {
                try {
                  window.__eaMaxShakaHideObserver = new MutationObserver(function () {
                    __eaMaxHideShakaUi();
                  });
                  window.__eaMaxShakaHideObserver.observe(
                    document.documentElement || document.body,
                    { childList: true, subtree: true }
                  );
                } catch (eObs) {}
              }
        """.trimIndent()
    }

    /** Let taps reach Shaka gear/language buttons instead of the full-screen video layer. */
    fun playerTouchFixScript(): String {
        return """
            (function () {
              ${playerTouchFixScriptBody()}
              return true;
            })();
        """.trimIndent()
    }

    private fun playerTouchFixScriptBody(): String {
        return """
              function __eaMaxFixPlayerTouches() {
                try {
                  document.querySelectorAll('video,.shaka-video,.shaka-video-container').forEach(function (el) {
                    el.style.setProperty('pointer-events', 'none', 'important');
                    el.style.setProperty('touch-action', 'none', 'important');
                  });
                } catch (e) {}
              }
              __eaMaxFixPlayerTouches();
              if (!window.__eaMaxTouchFixInterval) {
                window.__eaMaxTouchFixInterval = setInterval(__eaMaxFixPlayerTouches, 2000);
              }
        """.trimIndent()
    }

    /** Tap-to-show overlay + report whether language/quality controls are useful. */
    fun playerOverlayScript(androidInterfaceName: String = "ShakaPlayerBridge"): String {
        return """
            (function () {
              if (window.__eaMaxOverlayApi) return true;
              window.__eaMaxOverlayApi = true;
              function getActiveShakaPlayer() {
                function ok(p) {
                  return p && typeof p.getVariantTracks === 'function';
                }
                try {
                  if (ok(window.__eaMaxActiveShakaPlayer)) return window.__eaMaxActiveShakaPlayer;
                } catch (e0) {}
                try {
                  if (window.shaka && shaka.Player &&
                      typeof shaka.Player.getPlayerInstance === 'function') {
                    var vids = document.querySelectorAll('video');
                    for (var i = 0; i < vids.length; i++) {
                      var p = shaka.Player.getPlayerInstance(vids[i]);
                      if (!ok(p) && ok(vids[i].shakaPlayer)) p = vids[i].shakaPlayer;
                      if (ok(p)) {
                        window.__eaMaxActiveShakaPlayer = p;
                        return p;
                      }
                    }
                  }
                } catch (e1) {}
                return null;
              }
              window.__eaMaxCenterVideo = function (fit) {
                var mode = 'contain';
                document.querySelectorAll('video,.shaka-video,.shaka-video-container,.video-js,.video-js video').forEach(function (el) {
                  el.style.setProperty('position', 'fixed', 'important');
                  el.style.setProperty('inset', '0', 'important');
                  el.style.setProperty('top', '0', 'important');
                  el.style.setProperty('left', '0', 'important');
                  el.style.setProperty('right', '0', 'important');
                  el.style.setProperty('bottom', '0', 'important');
                  el.style.setProperty('width', '100%', 'important');
                  el.style.setProperty('height', '100%', 'important');
                  el.style.setProperty('max-width', '100%', 'important');
                  el.style.setProperty('max-height', '100%', 'important');
                  el.style.setProperty('margin', '0', 'important');
                  el.style.setProperty('padding', '0', 'important');
                  el.style.setProperty('transform', 'none', 'important');
                  el.style.setProperty('object-fit', mode, 'important');
                  el.style.setProperty('object-position', 'center center', 'important');
                });
              };
              window.__eaMaxProbeCapabilities = function () {
                var langs = {};
                var heights = {};
                var pl = getActiveShakaPlayer();
                if (pl) {
                  try {
                    if (typeof pl.getAudioLanguagesAndRoles === 'function') {
                      var roles = pl.getAudioLanguagesAndRoles();
                      for (var r = 0; r < roles.length; r++) {
                        var code = (roles[r].language || '').toLowerCase();
                        if (code) langs[code] = true;
                      }
                    }
                    var tracks = pl.getVariantTracks();
                    for (var i = 0; i < tracks.length; i++) {
                      var tr = tracks[i];
                      var al = (tr.language || tr.audioLanguage || '').toLowerCase();
                      if (al) langs[al] = true;
                      var h = tr.height || tr.videoHeight || 0;
                      if (h > 0) heights[h] = true;
                    }
                  } catch (e2) {}
                }
                try {
                  document.querySelectorAll('video').forEach(function (v) {
                    if (v.audioTracks) {
                      for (var k = 0; k < v.audioTracks.length; k++) {
                        var tl = (v.audioTracks[k].language || '').toLowerCase();
                        if (tl) langs[tl] = true;
                      }
                    }
                  });
                } catch (e3) {}
                var hasSw = false, hasEn = false;
                Object.keys(langs).forEach(function (l) {
                  if (l.indexOf('sw') === 0 || l === 'swa') hasSw = true;
                  if (l.indexOf('en') === 0 || l === 'eng') hasEn = true;
                });
                var multiLang = (hasSw && hasEn) || Object.keys(langs).length >= 2;
                var multiQual = Object.keys(heights).length >= 2;
                try {
                  if (typeof $androidInterfaceName !== 'undefined' &&
                      $androidInterfaceName.onPlayerCapabilities) {
                    $androidInterfaceName.onPlayerCapabilities(JSON.stringify({
                      multiLang: multiLang,
                      multiQual: multiQual
                    }));
                  }
                } catch (e4) {}
                return { multiLang: multiLang, multiQual: multiQual };
              };
              if (!window.__eaMaxTapHook) {
                window.__eaMaxTapHook = true;
                var tapTarget = document.body || document.documentElement;
                if (tapTarget) {
                  tapTarget.addEventListener('click', function () {
                    try {
                      if (typeof $androidInterfaceName !== 'undefined' &&
                          $androidInterfaceName.onPlayerTapped) {
                        $androidInterfaceName.onPlayerTapped();
                      }
                    } catch (e5) {}
                  }, true);
                }
              }
              window.__eaMaxCenterVideo('contain');
              window.__eaMaxProbeCapabilities();
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
              function eaMaxParseTarget(mode) {
                if (!mode || mode === 'auto') return 0;
                var n = parseInt(String(mode), 10);
                return (isFinite(n) && n > 0) ? n : 0;
              }
              function eaMaxBitrateForHeight(h) {
                if (h <= 240) return 400000;
                if (h <= 360) return 800000;
                if (h <= 480) return 1400000;
                if (h <= 720) return 2500000;
                if (h <= 1080) return 4000000;
                return 8000000;
              }
              function capQualityCfg(cfg) {
                if (!cfg) return cfg;
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
              function clampUserQualityCfg(cfg) {
                if (!cfg || !window.__eaMaxUserPickedQuality) return cfg;
                var maxH = eaMaxParseTarget(window.__eaMaxOkoaLastMode || '');
                if (maxH <= 0) return cfg;
                if (!cfg.abr) cfg.abr = {};
                if (!cfg.abr.restrictions) cfg.abr.restrictions = {};
                var r = cfg.abr.restrictions;
                var cap = eaMaxBitrateForHeight(maxH);
                if (!r.maxHeight || r.maxHeight > maxH) r.maxHeight = maxH;
                if (!r.maxBandwidth || r.maxBandwidth > cap) r.maxBandwidth = cap;
                return cfg;
              }
              function applyStartupCap(player) {
                if (window.__eaMaxUserPickedQuality || !player) return;
                if (window.__eaMaxStartupCapApplied) return;
                try {
                  var maxH = window.__eaMaxDefaultMaxH || 360;
                  var cap = eaMaxBitrateForHeight(maxH);
                  player.configure({
                    abr: { enabled: true, restrictions: { maxHeight: maxH, maxBandwidth: cap } }
                  });
                  var pref = window.__eaMaxPreferredAudioLang || 'sw';
                  player.configure({ preferredAudioLanguage: pref === 'en' ? 'en' : 'sw' });
                  window.__eaMaxStartupCapApplied = true;
                  window.__eaMaxOkoaActiveMode = String(maxH);
                } catch (e) {}
              }
              function guardTrackSwitches(player) {
                if (!player || player.__eaMaxTrackGuard) return;
                player.__eaMaxTrackGuard = true;
                function abrEnabled() {
                  try {
                    var cfg = player.getConfiguration && player.getConfiguration();
                    return !!(cfg && cfg.abr && cfg.abr.enabled);
                  } catch (eAbr) {
                    return true;
                  }
                }
                function wrapIfAbr(orig) {
                  return function () {
                    if (!window.__eaMaxAllowVariantSwitch && abrEnabled()) {
                      return Promise.resolve();
                    }
                    return orig.apply(player, arguments);
                  };
                }
                if (typeof player.selectVariantTrack === 'function') {
                  player.selectVariantTrack = wrapIfAbr(player.selectVariantTrack);
                }
                if (typeof player.selectVideoTrack === 'function') {
                  player.selectVideoTrack = wrapIfAbr(player.selectVideoTrack);
                }
              }
              window.__eaMaxGuardTrackSwitches = guardTrackSwitches;
              function wrapPlayer(Orig) {
                var Wrapped = function (video) {
                  var p = new Orig(video);
                  try { window.__eaMaxActiveShakaPlayer = p; } catch (eStore) {}
                  guardTrackSwitches(p);
                  try {
                    var oc = p.configure;
                    if (typeof oc === 'function') {
                      p.configure = function (cfg, clear) {
                        captureCfg(cfg);
                        if (cfg) {
                          if (window.__eaMaxUserPickedQuality) cfg = clampUserQualityCfg(cfg);
                          else cfg = capQualityCfg(cfg);
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
            gatewayCdnRefererFixScript(gatewayUrl) +
            "\n" +
            shakaUiHideDocumentStartScript() +
            "\n" +
            eaMaxOkoaQualityApiScript() +
            "\n" +
            eaMaxAudioLanguageApiScript()

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
              function postPlaying() {
                try {
                  if (window.__eaMaxPlayingPosted) return;
                  window.__eaMaxPlayingPosted = true;
                  if (typeof __eaMaxHideShakaUi === 'function') __eaMaxHideShakaUi();
                  if (typeof $androidInterfaceName !== 'undefined' &&
                      $androidInterfaceName.onPlaybackStarted) {
                    $androidInterfaceName.onPlaybackStarted();
                  }
                } catch (e) {}
              }
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
              function hookPlayer(p) {
                if (!p || p.__eaMaxPlayingHook) return;
                p.__eaMaxPlayingHook = true;
                try {
                  p.addEventListener('streaming', postPlaying);
                  p.addEventListener('adaptation', postPlaying);
                } catch (eHook) {}
              }
              function tryShaka() {
                if (typeof shaka === 'undefined') return;
                var videos = document.querySelectorAll('video');
                for (var i = 0; i < videos.length; i++) {
                  var v = videos[i];
                  if (!v.paused && v.currentTime > 0.2) postPlaying();
                  var p = null;
                  try {
                    if (shaka.Player && shaka.Player.getPlayerInstance) {
                      p = shaka.Player.getPlayerInstance(v);
                    }
                  } catch (e1) {}
                  if (!p) continue;
                  hookPlayer(p);
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
              window.__eaMaxCancelMediaRetries = function () {
                if (window.__eaMaxOkoaRetryInterval) {
                  clearInterval(window.__eaMaxOkoaRetryInterval);
                  window.__eaMaxOkoaRetryInterval = null;
                }
                if (window.__eaMaxUserLangBurst) {
                  clearInterval(window.__eaMaxUserLangBurst);
                  window.__eaMaxUserLangBurst = null;
                }
              };
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
              function inferTrackHeight(tr) {
                if (!tr) return 0;
                var h = tr.height || tr.videoHeight || 0;
                if (h > 0) return h;
                var w = tr.width || tr.videoWidth || 0;
                if (w >= 1900) return 1080;
                if (w >= 1200) return 720;
                if (w >= 800) return 480;
                if (w >= 600) return 360;
                if (w >= 400) return 240;
                var bw = tr.bandwidth || 0;
                if (bw >= 3500000) return 1080;
                if (bw >= 2000000) return 720;
                if (bw >= 1200000) return 480;
                if (bw >= 700000) return 360;
                if (bw >= 350000) return 240;
                return 0;
              }
              function pickBestTrack(tracks, maxH, active) {
                var prefLang = window.__eaMaxPreferredAudioLang || '';
                var best = null, bestScore = -1;
                var capped = [];
                for (var t = 0; t < tracks.length; t++) {
                  var tr = tracks[t];
                  if (tr.type && tr.type !== 'variant' && tr.type !== 'video') continue;
                  var h = inferTrackHeight(tr);
                  if (maxH > 0 && h > 0 && h > maxH) continue;
                  if (maxH > 0 && h <= 0) {
                    var capBw = maxBitrateForHeight(maxH);
                    if ((tr.bandwidth || 0) > capBw * 1.35) continue;
                  }
                  capped.push(tr);
                  var score = h > 0 ? h : (tr.bandwidth || 0) / 10000;
                  if (active) {
                    var al = (tr.language || tr.audioLanguage || '').toLowerCase();
                    var aAl = (active.language || active.audioLanguage || '').toLowerCase();
                    if (al && aAl && al === aAl) score += 100000;
                    if (tr.audioId != null && active.audioId != null && tr.audioId === active.audioId) score += 100000;
                  }
                  if (prefLang && window.__eaMaxTrackMatches) {
                    var tl = (tr.language || tr.audioLanguage || '').toLowerCase();
                    var lbl = (tr.label || tr.audioLabel || '').toLowerCase();
                    if (window.__eaMaxTrackMatches(tl, prefLang)) score += 500000;
                    else if (window.__eaMaxLabelMatches && window.__eaMaxLabelMatches(lbl, prefLang)) score += 500000;
                  }
                  if (score > bestScore) { best = tr; bestScore = score; }
                }
                if (!best && capped.length) {
                  var lowH = 99999;
                  for (var c = 0; c < capped.length; c++) {
                    var hc = inferTrackHeight(capped[c]);
                    var sc = hc > 0 ? hc : (capped[c].bandwidth || 999999999) / 10000;
                    if (sc < lowH) { lowH = sc; best = capped[c]; }
                  }
                }
                return best;
              }
              function pickBestVideoTrack(vtracks, maxH) {
                if (!vtracks || !vtracks.length) return null;
                if (maxH <= 0) return null;
                var best = null, bestH = 0;
                for (var i = 0; i < vtracks.length; i++) {
                  var vt = vtracks[i];
                  var h = inferTrackHeight(vt);
                  if (h > 0 && h <= maxH && h >= bestH) { best = vt; bestH = h; }
                }
                if (!best) {
                  var capBw = maxBitrateForHeight(maxH);
                  for (var j = 0; j < vtracks.length; j++) {
                    var vj = vtracks[j];
                    if ((vj.bandwidth || 0) <= capBw * 1.35) {
                      var hj = inferTrackHeight(vj);
                      if (!best || hj > inferTrackHeight(best)) best = vj;
                    }
                  }
                }
                return best;
              }
              function tryShakaVideoOnly(maxH, pl, soft) {
                if (!pl || typeof pl.getVideoTracks !== 'function' ||
                    typeof pl.selectVideoTrack !== 'function') {
                  return false;
                }
                soft = !!soft;
                try {
                  var vtracks = pl.getVideoTracks();
                  if (!vtracks || !vtracks.length) return false;
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
                  if (qualityMatchesTarget(pl, maxH)) return true;
                  var cap = maxBitrateForHeight(maxH);
                  pl.configure({
                    abr: {
                      enabled: false,
                      restrictions: { maxHeight: maxH, maxBandwidth: cap }
                    }
                  });
                  var best = pickBestVideoTrack(vtracks, maxH);
                  if (!best) return false;
                  pl.selectVideoTrack(best, !soft);
                  return true;
                } catch (eVid) {
                  return false;
                }
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
              function qualityMatchesTarget(pl, maxH) {
                if (!pl || maxH <= 0) return false;
                try {
                  if (typeof pl.getVideoTracks === 'function') {
                    var vtracks = pl.getVideoTracks();
                    for (var i = 0; i < vtracks.length; i++) {
                      if (vtracks[i].active) {
                        var vh = inferTrackHeight(vtracks[i]);
                        if (vh > 0 && vh <= maxH + 40) return true;
                      }
                    }
                  }
                  var tracks = pl.getVariantTracks();
                  for (var t = 0; t < tracks.length; t++) {
                    if (tracks[t].active) {
                      var ah = inferTrackHeight(tracks[t]);
                      if (ah > 0 && ah <= maxH + 40) return true;
                    }
                  }
                } catch (eQ) {}
                return false;
              }
              function applyAbrCap(pl, maxH) {
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
                  } else {
                    var cap = maxBitrateForHeight(maxH);
                    pl.configure({
                      abr: { enabled: true, restrictions: { maxHeight: maxH, maxBandwidth: cap } }
                    });
                  }
                  return true;
                } catch (eAbr) {
                  return false;
                }
              }
              function tryShaka(maxH, pl, soft) {
                pl = pl || getActiveShakaPlayer();
                if (!pl) return false;
                soft = !!soft;
                try {
                  if (maxH <= 0) return applyAbrCap(pl, 0);
                  if (soft) return applyAbrCap(pl, maxH);
                  if (qualityMatchesTarget(pl, maxH)) {
                    var capOk = maxBitrateForHeight(maxH);
                    pl.configure({
                      abr: { enabled: false, restrictions: { maxHeight: maxH, maxBandwidth: capOk } }
                    });
                    return true;
                  }
                  var cap = maxBitrateForHeight(maxH);
                  pl.configure({
                    abr: { enabled: false, restrictions: { maxHeight: maxH, maxBandwidth: cap } }
                  });
                  window.__eaMaxAllowVariantSwitch = true;
                  try {
                    if (typeof pl.getVideoTracks === 'function' && typeof pl.selectVideoTrack === 'function') {
                      var vtracks = pl.getVideoTracks();
                      var bestV = pickBestVideoTrack(vtracks, maxH);
                      if (bestV) {
                        pl.selectVideoTrack(bestV, true);
                        return true;
                      }
                    }
                    var tracks = pl.getVariantTracks();
                    if (tracks && tracks.length) {
                      var active = null;
                      for (var t = 0; t < tracks.length; t++) {
                        if (tracks[t].active) { active = tracks[t]; break; }
                      }
                      var best = pickBestTrack(tracks, maxH, active);
                      if (best && !(active && tracksMatch(active, best))) {
                        pl.selectVariantTrack(best, true);
                      }
                    }
                  } finally {
                    window.__eaMaxAllowVariantSwitch = false;
                  }
                  return true;
                } catch (e3) {
                  return false;
                }
              }
              function applyOkoaQuality(mode, soft) {
                var modeStr = String(mode);
                var maxH = parseTarget(modeStr);
                soft = !!soft;
                var pl = getActiveShakaPlayer();
                if (pl) {
                  if (tryShaka(maxH, pl, soft)) {
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
              window.__eaMaxOkoaSetQuality = function(mode, fromUser, soft) {
                fromUser = !!fromUser;
                soft = !!soft;
                var modeStr = String(mode);
                if (fromUser && !soft) window.__eaMaxUserPickedQuality = true;
                if (!fromUser && !soft && window.__eaMaxOkoaActiveMode === modeStr) return true;
                if (soft && qualityMatchesTarget(getActiveShakaPlayer(), parseTarget(modeStr))) return true;
                window.__eaMaxOkoaLastMode = modeStr;
                if (!soft) window.__eaMaxOkoaActiveMode = null;
                if (!soft && window.__eaMaxOkoaRetryInterval) {
                  clearInterval(window.__eaMaxOkoaRetryInterval);
                  window.__eaMaxOkoaRetryInterval = null;
                }
                if (applyOkoaQuality(modeStr, soft)) return true;
                if (soft) return false;
                var tries = 0;
                window.__eaMaxOkoaRetryInterval = setInterval(function() {
                  if (applyOkoaQuality(window.__eaMaxOkoaLastMode, false) || ++tries >= 3) {
                    clearInterval(window.__eaMaxOkoaRetryInterval);
                    window.__eaMaxOkoaRetryInterval = null;
                  }
                }, 1200);
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
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}
video{width:100%;height:100%;background:#000;object-fit:contain;object-position:center;display:block}
video::-webkit-media-controls-enclosure,video::-webkit-media-controls,
video::-webkit-media-controls-panel,video::-webkit-media-controls-current-time-display,
video::-webkit-media-controls-time-remaining-display,video::-webkit-media-controls-duration-display,
video::-webkit-media-controls-timeline{display:none!important}
</style>
<script src="https://cdn.jsdelivr.net/npm/mux.js@6.3.0/dist/mux.js"></script>
<script src="https://cdn.jsdelivr.net/npm/shaka-player@4.11.4/dist/shaka-player.compiled.js"
  onerror="(function(){var s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.11.4/shaka-player.compiled.min.js';document.head.appendChild(s);})();"></script>
<script>${eaMaxOkoaQualityApiScript()}</script>
<script>${eaMaxAudioLanguageApiScript()}</script>
</head><body>
<video id="v" autoplay playsinline webkit-playsinline></video>
<script>
(function(){
  var BR='$androidInterfaceName';
  var url=$urlJson, headers=$headerJson, clearKeys=$clearKeysJson;
  var licenseUrl=$licenseJson, maxH=$maxHeight, maxW=$maxW;
  try{window.__eaMaxDefaultMaxH=maxH;}catch(e){}
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
    try{window.__eaMaxActiveShakaPlayer=player;}catch(e){}
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
        var pref = window.__eaMaxPreferredAudioLang || 'sw';
        player.configure({ preferredAudioLanguage: pref === 'en' ? 'en' : 'sw' });
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
              window.__eaMaxUserPickedLanguage = false;
              window.__eaMaxSetAudioLanguage = function (lang, fromUser, soft) {
                if (window.__eaMaxUserPickedLanguage && !fromUser) return false;
                soft = !!soft;
                var normalized = (!lang || lang === 'auto' || lang === 'default') ? 'sw' : String(lang).toLowerCase();
                window.__eaMaxPreferredAudioLang = (normalized === 'en') ? 'en' : 'sw';
                if (fromUser && !soft) window.__eaMaxUserPickedLanguage = true;
                if (soft) {
                  return window.__eaMaxApplyAudioLanguage &&
                    window.__eaMaxApplyAudioLanguage(fromUser, true);
                }
                var ok = window.__eaMaxApplyAudioLanguage &&
                  window.__eaMaxApplyAudioLanguage(fromUser, false);
                if (ok) return true;
                if (fromUser && !soft) {
                  try {
                    if (window.__eaMaxUserLangBurst) clearInterval(window.__eaMaxUserLangBurst);
                    var burst = 0;
                    window.__eaMaxUserLangBurst = setInterval(function () {
                      var applied = window.__eaMaxApplyAudioLanguage &&
                        window.__eaMaxApplyAudioLanguage(true, false);
                      if (applied || ++burst >= 2) clearInterval(window.__eaMaxUserLangBurst);
                    }, 2000);
                  } catch (eBurst) {}
                }
                return !!ok;
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
              function __eaMaxLabelMatches(lbl, lang) {
                var t = (lbl || '').toLowerCase();
                if (!t) return false;
                if (lang === 'en') {
                  return t.indexOf('english') >= 0 || t.indexOf('kiingereza') >= 0 ||
                    t.indexOf('eng') >= 0;
                }
                return t.indexOf('swahili') >= 0 || t.indexOf('kiswahili') >= 0 ||
                  t.indexOf('swa') >= 0;
              }
              function hookPlayerEvents(pl) {
                if (!pl || pl.__eaMaxLangHooked || typeof pl.addEventListener !== 'function') return;
                if (window.__eaMaxGuardTrackSwitches) window.__eaMaxGuardTrackSwitches(pl);
                pl.__eaMaxLangHooked = true;
                pl.addEventListener('loaded', function () {
                  if (window.__eaMaxUserPickedLanguage) return;
                  window.__eaMaxApplyAudioLanguage && window.__eaMaxApplyAudioLanguage(false, true);
                });
                pl.addEventListener('trackschanged', function () {
                  if (window.__eaMaxUserPickedLanguage) return;
                  if (window.__eaMaxLangTrackTimer) clearTimeout(window.__eaMaxLangTrackTimer);
                  window.__eaMaxLangTrackTimer = setTimeout(function () {
                    window.__eaMaxApplyAudioLanguage && window.__eaMaxApplyAudioLanguage(false, true);
                  }, 800);
                });
              }
              function getActiveShakaPlayer() {
                function ok(p) {
                  return p && typeof p.getVariantTracks === 'function';
                }
                try {
                  if (ok(window.__eaMaxActiveShakaPlayer)) {
                    hookPlayerEvents(window.__eaMaxActiveShakaPlayer);
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
                      hookPlayerEvents(p);
                      if (!v.paused && v.readyState >= 2) return p;
                      if (v.currentTime > 0) fallback = p;
                      if (!fallback) fallback = p;
                    }
                    if (fallback) {
                      hookPlayerEvents(fallback);
                      return fallback;
                    }
                  }
                } catch (e1) {}
                try {
                  var refs = [window.shakaPlayer, window.player, window.shaka_player];
                  for (var j = 0; j < refs.length; j++) {
                    if (ok(refs[j])) {
                      window.__eaMaxActiveShakaPlayer = refs[j];
                      hookPlayerEvents(refs[j]);
                      return refs[j];
                    }
                  }
                } catch (e2) {}
                return null;
              }
              function trySeparateAudioTracks(pl, lang, soft) {
                soft = !!soft;
                if (!pl || typeof pl.getAudioTracks !== 'function' ||
                    typeof pl.selectAudioTrack !== 'function') {
                  return false;
                }
                try {
                  var tracks = pl.getAudioTracks();
                  for (var i = 0; i < tracks.length; i++) {
                    var tr = tracks[i];
                    if (tr.active) {
                      var al = (tr.language || '').toLowerCase();
                      var lbl = (tr.label || '').toLowerCase();
                      if (__eaMaxTrackMatches(al, lang) || __eaMaxLabelMatches(lbl, lang)) return true;
                    }
                  }
                  for (var j = 0; j < tracks.length; j++) {
                    var tr2 = tracks[j];
                    var al2 = (tr2.language || '').toLowerCase();
                    var lbl2 = (tr2.label || '').toLowerCase();
                    if (__eaMaxTrackMatches(al2, lang) || __eaMaxLabelMatches(lbl2, lang)) {
                      pl.selectAudioTrack(tr2, !soft);
                      return true;
                    }
                  }
                } catch (eSep) {}
                return false;
              }
              function tryGatewayLanguageButtons(lang) {
                var wantEn = lang === 'en';
                var nodes = document.querySelectorAll(
                  'button, a, [role="button"], li, span, div, label, input[type="button"]'
                );
                for (var i = 0; i < nodes.length; i++) {
                  var el = nodes[i];
                  var txt = (el.textContent || el.getAttribute('aria-label') ||
                    el.getAttribute('title') || el.getAttribute('data-lang') || '').toLowerCase().trim();
                  if (!txt || txt.length > 48) continue;
                  if (wantEn && (txt === 'english' || txt === 'en' || txt === 'eng' ||
                      txt.indexOf('kiingereza') >= 0 || txt.indexOf('english audio') >= 0)) {
                    try { el.click(); return true; } catch (e0) {}
                  }
                  if (!wantEn && (txt === 'swahili' || txt === 'sw' || txt === 'swa' ||
                      txt.indexOf('kiswahili') >= 0 || txt.indexOf('swahili audio') >= 0)) {
                    try { el.click(); return true; } catch (e1) {}
                  }
                }
                return false;
              }
              function tryShakaUiLanguage(lang) {
                var wantEn = lang === 'en';
                var menuSel = '.shaka-overflow-menu-contents button, .shaka-settings-menu button, ' +
                  '.shaka-language-menu button, .shaka-audio-language-menu button, ' +
                  '[class*="shaka-language"] button, [class*="shaka-audio"] button';
                var items = document.querySelectorAll(menuSel);
                for (var i = 0; i < items.length; i++) {
                  var txt = (items[i].textContent || items[i].getAttribute('aria-label') || '').toLowerCase();
                  if (wantEn && (txt.indexOf('english') >= 0 || txt.indexOf('kiingereza') >= 0)) {
                    items[i].click();
                    return true;
                  }
                  if (!wantEn && (txt.indexOf('swahili') >= 0 || txt.indexOf('kiswahili') >= 0)) {
                    items[i].click();
                    return true;
                  }
                }
                var langBtn = document.querySelector(
                  'button.shaka-language-button, .shaka-overflow-menu-button, ' +
                  'button[aria-label*="audio"], button[aria-label*="Audio"], ' +
                  'button[aria-label*="language"], button[aria-label*="Language"]'
                );
                if (langBtn && items.length === 0) {
                  langBtn.click();
                  return false;
                }
                return false;
              }
              function tryShakaAudio(lang, soft) {
                soft = !!soft;
                var pl = getActiveShakaPlayer();
                if (!pl) return false;
                if (soft) {
                  try {
                    pl.configure({ preferredAudioLanguage: lang === 'en' ? 'en' : 'sw' });
                    return true;
                  } catch (ePref) {}
                  return false;
                }
                if (trySeparateAudioTracks(pl, lang, false)) return true;
                if (typeof pl.getAudioLanguagesAndRoles === 'function') {
                  try {
                    var entries = pl.getAudioLanguagesAndRoles();
                    for (var a = 0; a < entries.length; a++) {
                      var entry = entries[a];
                      var code = (entry.language || '').toLowerCase();
                      if (__eaMaxTrackMatches(code, lang)) {
                        pl.selectAudioLanguage(entry.language, entry.role || undefined);
                        return true;
                      }
                    }
                  } catch (eRoles) {}
                }
                if (typeof pl.getAudioLanguages === 'function') {
                  try {
                    var langs = pl.getAudioLanguages();
                    for (var li = 0; li < langs.length; li++) {
                      var raw = String(langs[li] || '').toLowerCase();
                      if (__eaMaxTrackMatches(raw, lang)) {
                        pl.selectAudioLanguage(langs[li]);
                        return true;
                      }
                    }
                  } catch (eLangs) {}
                }
                if (typeof pl.selectAudioLanguage === 'function') {
                  var aliases = __eaMaxLangAliases(lang);
                  for (var k = 0; k < aliases.length; k++) {
                    try {
                      pl.selectAudioLanguage(aliases[k]);
                      return true;
                    } catch (e4) {}
                    try {
                      pl.selectAudioLanguage(aliases[k], 'main');
                      return true;
                    } catch (e5) {}
                  }
                }
                try {
                  pl.configure({ preferredAudioLanguage: lang === 'en' ? 'en' : 'sw' });
                  return true;
                } catch (eCfg) {}
                if (tryGatewayLanguageButtons(lang)) return true;
                return tryShakaUiLanguage(lang);
              }
              window.__eaMaxApplyAudioLanguage = function (fromUser, soft) {
                if (window.__eaMaxUserPickedLanguage && !fromUser) return false;
                soft = !!soft;
                var lang = window.__eaMaxPreferredAudioLang || 'sw';
                var applied = false;
                try {
                  document.querySelectorAll('video').forEach(function (v) {
                    if (v.audioTracks && v.audioTracks.length) {
                      for (var i = 0; i < v.audioTracks.length; i++) {
                        var tl = (v.audioTracks[i].language || '').toLowerCase();
                        var lbl = (v.audioTracks[i].label || '').toLowerCase();
                        var match = __eaMaxTrackMatches(tl, lang) || __eaMaxLabelMatches(lbl, lang);
                        if (v.audioTracks[i].enabled && match) applied = true;
                        else if (!soft) v.audioTracks[i].enabled = match;
                        if (match) applied = true;
                      }
                    }
                  });
                } catch (e) {}
                if (applied && soft) return true;
                if (tryShakaAudio(lang, soft)) applied = true;
                else if (!soft && tryGatewayLanguageButtons(lang)) applied = true;
                return applied;
              };
              return true;
            })();
        """.trimIndent()
    }
}
