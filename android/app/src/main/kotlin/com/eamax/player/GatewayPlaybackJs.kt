package com.eamax.player

/** JS bridges for quality / audio on PHP gateway pages (Shaka / hls.js). */
object GatewayPlaybackJs {
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
              function widthForHeight(h) {
                if (h >= 1080) return 1920;
                if (h >= 720) return 1280;
                if (h >= 480) return 854;
                if (h >= 360) return 640;
                if (h >= 240) return 426;
                return 0;
              }
              function matchLang(trackLang, preferred) {
                var t = String(trackLang || '').toLowerCase();
                if (!t || !preferred) return true;
                if (preferred === 'en') {
                  return t === 'en' || t.indexOf('en-') === 0 || t === 'eng';
                }
                if (preferred === 'sw') {
                  return t === 'sw' || t.indexOf('sw-') === 0 || t === 'swa' ||
                    t.indexOf('swahili') >= 0 || t.indexOf('kiswahili') >= 0;
                }
                return t === preferred || t.indexOf(preferred + '-') === 0;
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
                function scanDoc(doc) {
                  if (!doc) return;
                  try {
                    [doc.defaultView && doc.defaultView.shakaPlayer,
                     doc.defaultView && doc.defaultView.player,
                     doc.defaultView && doc.defaultView.shaka_player].forEach(add);
                  } catch (e0) {}
                  try {
                    var vids = doc.querySelectorAll('video');
                    for (var i = 0; i < vids.length; i++) {
                      var v = vids[i];
                      if (doc.defaultView && doc.defaultView.shaka &&
                          doc.defaultView.shaka.Player &&
                          typeof doc.defaultView.shaka.Player.getPlayerInstance === 'function') {
                        add(doc.defaultView.shaka.Player.getPlayerInstance(v));
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
                    var iframes = doc.querySelectorAll('iframe');
                    for (var j = 0; j < iframes.length; j++) {
                      try {
                        var idoc = iframes[j].contentDocument ||
                          (iframes[j].contentWindow && iframes[j].contentWindow.document);
                        if (idoc) scanDoc(idoc);
                      } catch (e2) {}
                    }
                  } catch (e3) {}
                }
                scanDoc(document);
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
                } catch (e4) {}
                return out;
              }
              function variantTracksFor(pl) {
                return (pl.getVariantTracks() || []).filter(function(tr) {
                  return !tr.type || tr.type === 'variant';
                });
              }
              function pickBestVariant(tracks, maxH, prefLang) {
                var sorted = tracks.slice().sort(function(a, b) {
                  return (a.height || 0) - (b.height || 0);
                });
                var langBest = null, anyBest = null;
                for (var i = 0; i < sorted.length; i++) {
                  var tr = sorted[i];
                  var h = tr.height || 0;
                  if (h <= 0 || h > maxH) continue;
                  anyBest = tr;
                  if (!prefLang || matchLang(tr.language, prefLang)) langBest = tr;
                }
                return langBest || anyBest;
              }
              function allManifestHeights() {
                var seen = {}, out = [];
                collectShakaPlayers().forEach(function(pl) {
                  variantTracksFor(pl).forEach(function(tr) {
                    var h = tr.height || 0;
                    if (h > 0 && !seen[h]) { seen[h] = true; out.push(h); }
                  });
                });
                return out.sort(function(a, b) { return a - b; });
              }
              function targetHeightFor(maxH) {
                var pref = window.__eaMaxPreferredAudioLang || '';
                var best = 0;
                collectShakaPlayers().forEach(function(pl) {
                  var tr = pickBestVariant(variantTracksFor(pl), maxH, pref);
                  if (tr && tr.height > best) best = tr.height;
                });
                return best;
              }
              function qualityMet(maxH, activeH) {
                if (maxH <= 0) return true;
                if (activeH <= 0) return false;
                var manifestMax = 0;
                var allH = allManifestHeights();
                if (allH.length) manifestMax = allH[allH.length - 1];
                if (window.__eaMaxUserQualityLocked) {
                  var goal = maxH;
                  if (manifestMax > 0 && manifestMax < goal - 48) goal = manifestMax;
                  return activeH >= goal - 48;
                }
                var target = targetHeightFor(maxH);
                if (target <= 0) return false;
                return activeH >= target - 48;
              }
              function tryShakaUiResolution(maxH) {
                var label = maxH >= 1080 ? '1080' : maxH >= 720 ? '720' :
                  maxH >= 480 ? '480' : maxH >= 360 ? '360' : String(maxH);
                function scanDoc(doc) {
                  if (!doc) return false;
                  try {
                    var menus = doc.querySelectorAll(
                      '.shaka-resolution-button,.shaka-overflow-button,' +
                      'button[aria-label*="Resolution"],button[aria-label*="Quality"]'
                    );
                    for (var m = 0; m < menus.length; m++) {
                      try { menus[m].click(); } catch (e0) {}
                    }
                  } catch (e1) {}
                  var nodes = doc.querySelectorAll(
                    'button,span,div,li,[role="menuitem"]'
                  );
                  for (var i = 0; i < nodes.length; i++) {
                    var t = String(nodes[i].textContent || nodes[i].ariaLabel || '').toLowerCase();
                    if (t.indexOf(label + 'p') >= 0 || t.indexOf(label) >= 0) {
                      try { nodes[i].click(); return true; } catch (e2) {}
                    }
                  }
                  var iframes = doc.querySelectorAll('iframe');
                  for (var j = 0; j < iframes.length; j++) {
                    try {
                      var idoc = iframes[j].contentDocument ||
                        (iframes[j].contentWindow && iframes[j].contentWindow.document);
                      if (idoc && scanDoc(idoc)) return true;
                    } catch (e3) {}
                  }
                  return false;
                }
                return scanDoc(document);
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
                var prefLang = window.__eaMaxPreferredAudioLang || '';
                var currentH = activeVideoHeight();
                var isUpgrade = maxH > 0 && currentH > 0 && maxH > currentH + 48;
                var useAbr = isUpgrade || window.__eaMaxUserQualityLocked || maxH <= 0;
                var applied = false;
                for (var i = 0; i < candidates.length; i++) {
                  var pl = candidates[i];
                  try {
                    if (maxH <= 0) {
                      pl.__eaMaxOkoaMaxH = 0;
                      pl.configure({
                        abr: { enabled: true },
                        restrictions: {
                          minHeight: 0, maxHeight: Infinity,
                          minWidth: 0, maxWidth: Infinity,
                          minBandwidth: 0, maxBandwidth: Infinity
                        }
                      });
                      applied = true;
                      continue;
                    }
                    var cap = maxBitrateForHeight(maxH);
                    var maxW = widthForHeight(maxH);
                    pl.__eaMaxOkoaMaxH = maxH;
                    if (useAbr) {
                      pl.configure({
                        abr: {
                          enabled: true,
                          restrictions: {
                            minHeight: 0, maxHeight: maxH,
                            minWidth: 0, maxWidth: maxW || Infinity,
                            maxBandwidth: cap
                          },
                          bandwidthUpgradeTarget: 0.7,
                          switchInterval: 3
                        }
                      });
                    } else {
                      pl.configure({
                        abr: { enabled: false },
                        restrictions: {
                          minHeight: 0, maxHeight: maxH,
                          minWidth: 0, maxWidth: maxW || Infinity,
                          maxBandwidth: cap
                        }
                      });
                    }
                    var tracks = variantTracksFor(pl);
                    var best = pickBestVariant(tracks, maxH, prefLang);
                    if (best) {
                      if (!best.active || (best.height || 0) > currentH + 48) {
                        pl.selectVariantTrack(best, false, 0);
                      }
                      applied = true;
                      if (prefLang && typeof pl.selectAudioLanguage === 'function') {
                        var langs = pl.getAudioLanguages() || [];
                        for (var j = 0; j < langs.length; j++) {
                          if (matchLang(langs[j], prefLang)) {
                            pl.selectAudioLanguage(langs[j]);
                            break;
                          }
                        }
                      }
                    }
                  } catch (e3) {}
                }
                if (isUpgrade || window.__eaMaxUserQualityLocked) {
                  tryShakaUiResolution(maxH);
                }
                return applied;
              }
              function activeVideoHeight() {
                try {
                  var tracks = [];
                  collectShakaPlayers().forEach(function(pl) {
                    variantTracksFor(pl).forEach(function(tr) {
                      if (tr.active && tr.height > 0) tracks.push(tr.height);
                    });
                  });
                  return tracks.length ? Math.max.apply(null, tracks) : 0;
                } catch (e) { return 0; }
              }
              function availableHeights(maxH) {
                var heights = [];
                collectShakaPlayers().forEach(function(pl) {
                  variantTracksFor(pl).forEach(function(tr) {
                    var h = tr.height || 0;
                    if (h > 0 && h <= maxH) heights.push(h);
                  });
                });
                return heights.sort(function(a, b) { return a - b; });
              }
              function applyOkoaQuality(mode) {
                var maxH = parseTarget(String(mode));
                if (window.__eaMaxPlaybackLocked &&
                    !window.__eaMaxUserQualityLocked &&
                    !window.__eaMaxOkoaUserInitiated &&
                    maxH !== 360) {
                  return false;
                }
                tryHls(maxH);
                tryShaka(maxH);
                var activeH = activeVideoHeight();
                var targetH = targetHeightFor(maxH);
                var manifestHeights = allManifestHeights();
                var applied = qualityMet(maxH, activeH);
                try {
                  if (typeof ShakaPlayerBridge !== 'undefined' &&
                      ShakaPlayerBridge.onQualityProbe) {
                    ShakaPlayerBridge.onQualityProbe(JSON.stringify({
                      wanted: String(mode),
                      maxH: maxH,
                      targetH: targetH,
                      activeH: activeH,
                      heights: availableHeights(maxH || 9999),
                      manifestHeights: manifestHeights,
                      applied: applied,
                      userLocked: !!window.__eaMaxUserQualityLocked,
                      players: collectShakaPlayers().length
                    }));
                  }
                } catch (e) {}
                return applied;
              }
              window.__eaMaxOkoaApplyStartup360 = function() {
                if (window.__eaMaxUserQualityLocked || window.__eaMaxOkoaUserInitiated) return true;
                if (window.__eaMaxOkoaLastApplied === '360') return true;
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
                  if (window.__eaMaxUserQualityLocked) return true;
                  window.__eaMaxOkoaLastMode = String(mode);
                  return window.__eaMaxOkoaApplyStartup360();
                }
                window.__eaMaxUserQualityLocked = true;
                window.__eaMaxOkoaUserInitiated = true;
                var modeStr = String(mode);
                window.__eaMaxOkoaLastMode = modeStr;
                if (applyOkoaQuality(modeStr)) {
                  window.__eaMaxOkoaLastApplied = modeStr;
                  return true;
                }
                if (window.__eaMaxOkoaRetryId) {
                  try { clearInterval(window.__eaMaxOkoaRetryId); } catch (e) {}
                }
                var tries = 0;
                window.__eaMaxOkoaRetryId = setInterval(function() {
                  if (applyOkoaQuality(window.__eaMaxOkoaLastMode)) {
                    window.__eaMaxOkoaLastApplied = window.__eaMaxOkoaLastMode;
                    clearInterval(window.__eaMaxOkoaRetryId);
                    window.__eaMaxOkoaRetryId = null;
                  } else if (++tries >= 30) {
                    clearInterval(window.__eaMaxOkoaRetryId);
                    window.__eaMaxOkoaRetryId = null;
                  }
                }, 500);
                return true;
              };
              true;
            })();
        """.trimIndent()
    }

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
                if (preferred === 'en') {
                  return t === 'en' || t.indexOf('en-') === 0 || t === 'eng' || t === 'english';
                }
                if (preferred === 'sw') {
                  return t === 'sw' || t.indexOf('sw-') === 0 || t === 'swa' ||
                    t.indexOf('swahili') >= 0 || t.indexOf('kiswahili') >= 0 || t === 'ki';
                }
                return t === preferred || t.indexOf(preferred + '-') === 0;
              }
              function collectShakaPlayers() {
                var out = [], seen = [];
                function add(p) {
                  if (!p) return;
                  var canAudio = typeof p.selectAudioLanguage === 'function' ||
                    typeof p.getVariantTracks === 'function';
                  if (!canAudio) return;
                  for (var s = 0; s < seen.length; s++) { if (seen[s] === p) return; }
                  seen.push(p); out.push(p);
                }
                function scanDoc(doc) {
                  if (!doc) return;
                  try {
                    [doc.defaultView && doc.defaultView.shakaPlayer,
                     doc.defaultView && doc.defaultView.player,
                     doc.defaultView && doc.defaultView.shaka_player].forEach(add);
                  } catch (e0) {}
                  try {
                    var vids = doc.querySelectorAll('video');
                    for (var i = 0; i < vids.length; i++) {
                      var v = vids[i];
                      try {
                        if (doc.defaultView && doc.defaultView.shaka && doc.defaultView.shaka.Player &&
                            typeof doc.defaultView.shaka.Player.getPlayerInstance === 'function') {
                          add(doc.defaultView.shaka.Player.getPlayerInstance(v));
                        }
                      } catch (e1) {}
                      try {
                        if (v['ui'] && v['ui'].getControls &&
                            typeof v['ui'].getControls === 'function') {
                          var controls = v['ui'].getControls();
                          if (controls && typeof controls.getPlayer === 'function') {
                            add(controls.getPlayer());
                          }
                        }
                      } catch (e2) {}
                      try {
                        var container = v.closest('.shaka-video-container') || v.parentElement;
                        if (container && container['ui'] &&
                            typeof container['ui'].getPlayer === 'function') {
                          add(container['ui'].getPlayer());
                        }
                      } catch (e3) {}
                    }
                  } catch (e4) {}
                  try {
                    var iframes = doc.querySelectorAll('iframe');
                    for (var j = 0; j < iframes.length; j++) {
                      try {
                        var idoc = iframes[j].contentDocument ||
                          (iframes[j].contentWindow && iframes[j].contentWindow.document);
                        if (idoc) scanDoc(idoc);
                      } catch (e5) {}
                    }
                  } catch (e6) {}
                }
                scanDoc(document);
                try {
                  for (var k in window) {
                    if (k === 'parent' || k === 'top' || k === 'frameElement') continue;
                    try {
                      var o = window[k];
                      if (o && typeof o === 'object' &&
                          (typeof o.selectAudioLanguage === 'function' ||
                           typeof o.getVariantTracks === 'function')) add(o);
                    } catch (xe) {}
                  }
                } catch (e7) {}
                return out;
              }
              function activeAudioLang() {
                var players = collectShakaPlayers();
                for (var i = 0; i < players.length; i++) {
                  var pl = players[i];
                  try {
                    if (typeof pl.getVariantTracks === 'function') {
                      var tracks = pl.getVariantTracks() || [];
                      for (var t = 0; t < tracks.length; t++) {
                        var tr = tracks[t];
                        if (tr.active && tr.language) return normalizeLang(tr.language);
                      }
                    }
                    if (typeof pl.getAudioLanguages === 'function' &&
                        typeof pl.getConfiguration === 'function') {
                      var cfg = pl.getConfiguration();
                      if (cfg && cfg.preferredAudioLanguage) {
                        return normalizeLang(cfg.preferredAudioLanguage);
                      }
                    }
                  } catch (e) {}
                }
                return '';
              }
              function labelMatches(text, label) {
                if (label.length <= 3) {
                  var re = new RegExp('(^|[^a-z])' + label + '([^a-z]|$)');
                  return re.test(text);
                }
                return text.indexOf(label) >= 0;
              }
              function tryShaka(lang) {
                var players = collectShakaPlayers(), applied = false;
                for (var i = 0; i < players.length; i++) {
                  var pl = players[i];
                  try {
                    if (typeof pl.getAudioLanguages === 'function') {
                      var langs = pl.getAudioLanguages() || [];
                      for (var j = 0; j < langs.length; j++) {
                        if (matchLang(langs[j], lang)) {
                          pl.selectAudioLanguage(langs[j]);
                          applied = true;
                          break;
                        }
                      }
                    }
                    if (!applied && typeof pl.getVariantTracks === 'function') {
                      var tracks = pl.getVariantTracks(), best = null, bestBw = 0;
                      for (var t = 0; t < tracks.length; t++) {
                        var tr = tracks[t];
                        if (matchLang(tr.language, lang) || matchLang(tr.label, lang)) {
                          var bw = tr.bandwidth || 0;
                          if (!best || bw > bestBw) { best = tr; bestBw = bw; }
                        }
                      }
                      if (best && typeof pl.selectVariantTrack === 'function') {
                        pl.selectVariantTrack(best, false);
                        applied = true;
                      }
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
                    if (matchLang(tr.lang, lang) || matchLang(tr.name, lang) ||
                        matchLang(tr.label, lang)) {
                      hls.audioTrack = i;
                      found = true;
                      return;
                    }
                  }
                }
                function scanDoc(doc) {
                  if (!doc) return;
                  try { if (doc.defaultView && doc.defaultView.hls) tryOne(doc.defaultView.hls); } catch (e0) {}
                  try {
                    var vids = doc.querySelectorAll('video');
                    for (var i = 0; i < vids.length; i++) {
                      var v = vids[i];
                      if (v.hls) tryOne(v.hls);
                      if (v._hls) tryOne(v._hls);
                    }
                  } catch (e1) {}
                  try {
                    var iframes = doc.querySelectorAll('iframe');
                    for (var j = 0; j < iframes.length; j++) {
                      try {
                        var idoc = iframes[j].contentDocument ||
                          (iframes[j].contentWindow && iframes[j].contentWindow.document);
                        if (idoc) scanDoc(idoc);
                      } catch (e2) {}
                    }
                  } catch (e3) {}
                }
                scanDoc(document);
                return found;
              }
              function tryGatewayUiButtons(lang) {
                var labels = lang === 'en'
                  ? ['english', 'eng', 'english audio']
                  : ['swahili', 'kiswahili', 'swahili audio'];
                function scanDoc(doc) {
                  if (!doc) return false;
                  var nodes = doc.querySelectorAll('button,a,span,div,li,option');
                  for (var i = 0; i < nodes.length; i++) {
                    var t = String(nodes[i].textContent || nodes[i].value || '').toLowerCase();
                    for (var j = 0; j < labels.length; j++) {
                      if (labelMatches(t, labels[j])) {
                        try { nodes[i].click(); return true; } catch (e) {}
                      }
                    }
                  }
                  var iframes = doc.querySelectorAll('iframe');
                  for (var k = 0; k < iframes.length; k++) {
                    try {
                      var idoc = iframes[k].contentDocument ||
                        (iframes[k].contentWindow && iframes[k].contentWindow.document);
                      if (idoc && scanDoc(idoc)) return true;
                    } catch (e2) {}
                  }
                  return false;
                }
                return scanDoc(document);
              }
              function collectAudioProbe() {
                var probe = {players:0, shakaLangs:[], hlsLangs:[], variantLangs:[]};
                var players = collectShakaPlayers();
                probe.players = players.length;
                for (var i = 0; i < players.length; i++) {
                  var pl = players[i];
                  try {
                    if (typeof pl.getAudioLanguages === 'function') {
                      var langs = pl.getAudioLanguages() || [];
                      for (var j = 0; j < langs.length; j++) probe.shakaLangs.push(String(langs[j]));
                    }
                    if (typeof pl.getVariantTracks === 'function') {
                      var tracks = pl.getVariantTracks() || [];
                      for (var t = 0; t < tracks.length; t++) {
                        if (tracks[t].language) probe.variantLangs.push(String(tracks[t].language));
                      }
                    }
                  } catch (e) {}
                }
                function scanHls(doc) {
                  if (!doc) return;
                  try {
                    var hlsList = [];
                    if (doc.defaultView && doc.defaultView.hls) hlsList.push(doc.defaultView.hls);
                    var vids = doc.querySelectorAll('video');
                    for (var i = 0; i < vids.length; i++) {
                      if (vids[i].hls) hlsList.push(vids[i].hls);
                      if (vids[i]._hls) hlsList.push(vids[i]._hls);
                    }
                    for (var h = 0; h < hlsList.length; h++) {
                      var hls = hlsList[h];
                      if (!hls || !hls.audioTracks) continue;
                      for (var a = 0; a < hls.audioTracks.length; a++) {
                        var tr = hls.audioTracks[a];
                        probe.hlsLangs.push(String(tr.lang || tr.name || tr.label || a));
                      }
                    }
                  } catch (e) {}
                }
                scanHls(document);
                return probe;
              }
              function reportAudioProbe(wanted, applied) {
                try {
                  var probe = collectAudioProbe();
                  probe.wanted = wanted;
                  probe.applied = !!applied;
                  if (typeof ShakaPlayerBridge !== 'undefined' &&
                      ShakaPlayerBridge.onAudioLanguageProbe) {
                    ShakaPlayerBridge.onAudioLanguageProbe(JSON.stringify(probe));
                  }
                } catch (e) {}
              }
              function applyAudioLanguage(raw) {
                var lang = normalizeLang(raw);
                window.__eaMaxPreferredAudioLang = lang;
                tryShaka(lang);
                tryHls(lang);
                tryGatewayUiButtons(lang);
                var active = activeAudioLang();
                var applied = matchLang(active, lang);
                reportAudioProbe(lang, applied);
                return applied;
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
                  } else if (++tries >= 20) {
                    clearInterval(window.__eaMaxAudioLangRetryId);
                    window.__eaMaxAudioLangRetryId = null;
                  }
                }, 500);
                return true;
              };
              if (!window.__eaMaxAudioGuardId) {
                window.__eaMaxAudioGuardId = setInterval(function() {
                  var lang = window.__eaMaxPreferredAudioLang;
                  if (!lang) return;
                  var active = activeAudioLang();
                  if (active && !matchLang(active, lang)) {
                    tryShaka(lang);
                    tryHls(lang);
                  }
                }, 2500);
              }
              if (window.__eaMaxPreferredAudioLang) {
                try { window.__eaMaxSetAudioLanguage(window.__eaMaxPreferredAudioLang); } catch (e2) {}
              }
              true;
            })();
        """.trimIndent()
    }

}
