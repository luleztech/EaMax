/// Injected after gateway pages load — adapted from `/player/PhpWebViewSupport.kt`
/// (video element recovery; Android JS bridge calls removed).
const String kPhpGatewayRecoveryJs = '''
(function () {
  if (window.__eaMaxRecoveryInstalled) { return true; }
  window.__eaMaxRecoveryInstalled = true;

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

    video.addEventListener('playing', function () {
      window.__eaMaxPlaybackLocked = true;
      try {
        if (window.SupasokaPlayback && SupasokaPlayback.postMessage) {
          SupasokaPlayback.postMessage('playing');
        }
      } catch (e) {}
    });

    if (!window.__eaMaxPlaybackLocked) tryPlay(video);
  }

  function startMonitor() {
    setInterval(function () {
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
''';
