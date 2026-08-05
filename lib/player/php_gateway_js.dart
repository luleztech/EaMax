/// Injected after gateway pages load — adapted from `/player/PhpWebViewSupport.kt`
/// (video element recovery; Android JS bridge calls removed).
const String kPhpGatewayRecoveryJs = '''
(function () {
  if (window.__eaMaxRecoveryInstalled) { return true; }
  window.__eaMaxRecoveryInstalled = true;

  var lastNudgeAt = 0;

  function patchRecaptchaExecute() {
    try {
      var TOKEN = 'eamax';
      function invokeCb(cb) {
        try {
          if (!cb) return;
          if (typeof cb === 'function') { cb(TOKEN); return; }
          if (typeof cb === 'string' && typeof window[cb] === 'function') window[cb](TOKEN);
        } catch (e) {}
      }
      function fireUnlockCallbacks() {
        try {
          var nodes = document.querySelectorAll('[data-callback],.g-recaptcha,[class*="g-recaptcha"]');
          for (var i = 0; i < nodes.length; i++) {
            invokeCb(nodes[i].getAttribute('data-callback'));
            invokeCb(nodes[i].getAttribute('data-success-callback'));
          }
        } catch (e) {}
        var names = [
          'onCaptchaSuccess','onRecaptchaSuccess','captchaCallback','captchaSuccess',
          'verifyCallback','recaptchaCallback','grecaptchaCallback','onloadCallback',
          'onSubmit','submitCaptcha','captchaVerified','onHumanVerified'
        ];
        for (var n = 0; n < names.length; n++) {
          try { if (typeof window[names[n]] === 'function') window[names[n]](TOKEN); } catch (e2) {}
        }
      }
      function makeStub() {
        return {
          ready: function(cb) { try { if (typeof cb === 'function') cb(); } catch (e) {} fireUnlockCallbacks(); },
          execute: function() { try { fireUnlockCallbacks(); } catch (e) {} return Promise.resolve(TOKEN); },
          getResponse: function() { return TOKEN; },
          render: function(el, opts) {
            try {
              var cb = (opts && (opts.callback || opts['data-callback'])) || null;
              if (!cb && el) {
                try {
                  var node = typeof el === 'string' ? document.getElementById(el) : el;
                  if (node && node.getAttribute) cb = node.getAttribute('data-callback');
                } catch (e0) {}
              }
              setTimeout(function() { invokeCb(cb); fireUnlockCallbacks(); }, 0);
            } catch (e) {}
            return 0;
          },
          reset: function() {},
          __eamaxSilent: true
        };
      }
      function stubApi(api) {
        if (!api || typeof api !== 'object') return makeStub();
        if (api.__eamaxSilent) return api;
        try {
          var stub = makeStub();
          api.ready = stub.ready;
          api.execute = stub.execute;
          api.getResponse = stub.getResponse;
          api.render = stub.render;
          api.reset = stub.reset;
          api.__eamaxSilent = true;
        } catch (e) {}
        return api;
      }
      function hideCaptchaNodes() {
        try {
          var nodes = document.querySelectorAll('.g-recaptcha,iframe[src*="recaptcha"],#recaptchadiv,.lsrecaptcha,[class*="g-recaptcha"],[id*="recaptcha"],.rc-anchor,[title*="reCAPTCHA"],[class*="captcha"],[id*="captcha"]');
          for (var i = 0; i < nodes.length; i++) {
            try {
              nodes[i].style.setProperty('display', 'none', 'important');
              nodes[i].style.setProperty('visibility', 'hidden', 'important');
              nodes[i].style.setProperty('pointer-events', 'none', 'important');
              nodes[i].style.setProperty('opacity', '0', 'important');
            } catch (e3) {}
          }
          var all = document.querySelectorAll('body *');
          for (var j = 0; j < all.length && j < 400; j++) {
            var el = all[j];
            if (!el || (el.children && el.children.length > 6)) continue;
            var t = (el.innerText || el.textContent || '').toLowerCase();
            if (!t) continue;
            if (t.indexOf('not a robot') >= 0 || t.indexOf('verify you are') >= 0 ||
                (t.indexOf('403') >= 0 && t.indexOf('forbidden') >= 0) ||
                t.indexOf('access to this resource on the server is denied') >= 0) {
              try {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('visibility', 'hidden', 'important');
                if (el.parentElement && (el.parentElement.innerText || '').length < 120) {
                  el.parentElement.style.setProperty('display', 'none', 'important');
                }
              } catch (eH) {}
            }
          }
        } catch (e4) {}
      }
      window.__eamaxHideCaptchaNodes = hideCaptchaNodes;
      window.__eamaxFireCaptchaUnlock = fireUnlockCallbacks;
      if (!window.__eamaxSilentCaptcha) {
        window.__eamaxSilentCaptcha = true;
        try {
          var current = window.grecaptcha;
          Object.defineProperty(window, 'grecaptcha', {
            configurable: true,
            enumerable: true,
            get: function() { return current || (current = makeStub()); },
            set: function(v) { current = stubApi(v); }
          });
          current = stubApi(current || makeStub());
        } catch (e) {
          try { window.grecaptcha = makeStub(); } catch (e2) {}
        }
        try {
          if (!document.getElementById('eamax-hide-captcha')) {
            var s = document.createElement('style');
            s.id = 'eamax-hide-captcha';
            s.textContent = '.g-recaptcha,iframe[src*="recaptcha"],#recaptchadiv,.lsrecaptcha,[class*="g-recaptcha"],[id*="recaptcha"],.rc-anchor,[title*="reCAPTCHA"],[class*="captcha"],[id*="captcha"]{display:none!important;visibility:hidden!important;pointer-events:none!important;height:0!important;width:0!important;overflow:hidden!important;opacity:0!important}';
            (document.documentElement || document.head || document.body).appendChild(s);
          }
          hideCaptchaNodes();
          if (!window.__eamaxCaptchaObserver && document.documentElement) {
            window.__eamaxCaptchaObserver = new MutationObserver(function() { hideCaptchaNodes(); fireUnlockCallbacks(); });
            window.__eamaxCaptchaObserver.observe(document.documentElement, { childList: true, subtree: true });
          }
        } catch (e5) {}
      } else {
        try { hideCaptchaNodes(); } catch (e0) {}
      }
      try {
        if (window.grecaptcha && typeof window.grecaptcha.execute === 'function') {
          var p = window.grecaptcha.execute();
          if (p && typeof p.then === 'function') p.then(function(){ fireUnlockCallbacks(); }).catch(function(){});
        }
      } catch (e6) {}
      fireUnlockCallbacks();
    } catch (e) {}
  }

  function getVideo() {
    return document.querySelector('video');
  }

  function muteSecondaryVideos() {
    try {
      var vids = document.querySelectorAll('video');
      if (!vids || vids.length <= 1) return;
      var primary = null, best = -1;
      for (var i = 0; i < vids.length; i++) {
        var v = vids[i];
        var score = (v.clientWidth || 0) * (v.clientHeight || 0);
        if (!v.paused && !v.ended) score += 1000000000;
        if (score > best) { best = score; primary = v; }
      }
      for (var j = 0; j < vids.length; j++) {
        if (vids[j] === primary) {
          try { vids[j].muted = false; } catch (e0) {}
        } else {
          try { vids[j].muted = true; vids[j].pause(); } catch (e1) {}
        }
      }
    } catch (e) {}
  }

  function tryPlay(video) {
    if (!video || window.__eaMaxPlaybackLocked) return;
    if (!video.paused || video.ended) return;
    if (video.readyState < 2) return;
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
    video.controls = false;
    video.removeAttribute('controls');

    video.addEventListener('playing', function () {
      window.__eaMaxPlaybackLocked = true;
      try {
        if (window.EaMaxPlayback && EaMaxPlayback.postMessage) {
          EaMaxPlayback.postMessage('playing');
        }
      } catch (e) {}
    });

    if (!window.__eaMaxPlaybackLocked) tryPlay(video);
  }

  function startMonitor() {
    setInterval(function () {
      patchRecaptchaExecute();
      muteSecondaryVideos();
      if (window.__eaMaxPlaybackLocked) return;
      var video = getVideo();
      if (!video || video.ended || !video.paused) return;
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
      patchRecaptchaExecute();
      muteSecondaryVideos();
      if (window.__eaMaxPlaybackLocked) return;
      var v = getVideo();
      if (v) bindVideo(v);
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
  } catch (e) {}

  patchRecaptchaExecute();
  muteSecondaryVideos();
  bindVideo(getVideo());
  startMonitor();
  true;
})();
''';
