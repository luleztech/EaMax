import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';

const { width, height } = Dimensions.get('window');

// Optional: use orientation locker for reliable portrait on close (no crash if not installed)
let Orientation = null;
try {
  Orientation = require('react-native-orientation-locker').default;
} catch (_) {
  Orientation = null;
}

// PlaybackState - matches Kotlin PlaybackState enum (IDLE, BUFFERING, READY, PLAYING, PAUSED, ENDED)
const PlaybackState = {
  IDLE: 'IDLE',
  BUFFERING: 'BUFFERING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  ENDED: 'ENDED',
};

// Stream format detection - matches ExoPlayerEngine.detectStreamFormat (DASH, HLS, PROGRESSIVE)
// Default unknown URLs to HLS to avoid MEDIA_ELEMENT_ERROR when a manifest is loaded as progressive
const detectStreamFormat = (url) => {
  if (!url || typeof url !== 'string') return 'PROGRESSIVE';
  const u = url.toLowerCase();
  if (u.includes('.mpd') || (u.includes('dash') && !u.includes('.m3u8')) || (u.includes('/manifest') && !u.includes('.m3u8'))) return 'DASH';
  if (u.includes('.m3u8') || u.includes('.m3u') || u.includes('hls') || u.includes('playlist.m3u')) return 'HLS';
  if (u.includes('.mp4') || u.includes('.m4v') || u.includes('.webm') || u.includes('.mkv')) return 'PROGRESSIVE';
  if (u.includes('.ts') && !u.includes('m3u8') && !u.includes('playlist')) return 'PROGRESSIVE';
  return 'HLS';
};

// User-Agent from WebViewEngine - matches stream provider expectations
const PLAYER_USER_AGENT = 'ReactNativeVideo/3.0 (Linux;Android 11) ExoPlayerLib/2.10.4';

// Quality options - matches StreamQuality enum (AUTO, 240p, 360p, 480p, 720p, 1080p) and PlayerConfig
const QUALITY_OPTIONS = [
  { label: 'Auto (ABR)', value: 'auto', recommended: true },
  { label: '240p', value: '240', recommended: false },
  { label: '360p', value: '360', recommended: false },
  { label: '480p', value: '480', recommended: false },
  { label: '720p', value: '720', recommended: false },
  { label: '1080p', value: '1080', recommended: false },
];

// User-friendly error messages - matches ExoPlayerEngine onPlayerError mapping
const getErrorMessage = (codeOrMessage) => {
  const msg = String(codeOrMessage || '').toLowerCase();
  if (msg.includes('network') || msg.includes('connection') || msg.includes('failed')) return 'Network connection failed. Please check your internet connection.';
  if (msg.includes('timeout')) return 'Connection timeout. Please try again.';
  if (msg.includes('cors') || msg.includes('cross-origin')) return 'Stream access denied. Please try again later.';
  if (msg.includes('drm') || msg.includes('license')) return 'Stream authorization failed. Stream may not be available.';
  if (msg.includes('not supported') || msg.includes('unsupported')) return 'This stream format is not supported on this device.';
  if (msg.includes('hls not supported')) return 'HLS playback is not supported in this browser.';
  if (msg.includes('dash not supported')) return 'DASH playback is not supported in this browser.';
  if (msg.includes('media_element_error') || msg.includes('format error') || msg.includes('decode') || msg.includes('src_not_supported') || msg.includes('mediasource')) {
    return 'This stream format or codec is not supported. Try another channel or update the stream URL in the admin app.';
  }
  return msg ? `Playback error: ${codeOrMessage}` : 'Playback error. Please try again.';
};

/**
 * VideoPlayer - React Native WebView implementation matching Kotlin player (PlayerManager + ExoPlayerEngine + WebViewEngine)
 * - PlaybackState: IDLE, BUFFERING, READY, PLAYING, PAUSED, ENDED
 * - StreamQuality: Auto (ABR), 240p, 360p, 480p, 720p, 1080p
 * - Format detection: DASH, HLS, PROGRESSIVE (same URL patterns as ExoPlayerEngine)
 * - videoUrl maps to StreamSession.mpdUrl
 */
const VideoPlayer = ({
  visible,
  onClose,
  videoUrl,
  channelName,
  onUnlockChannel,
  channelId,
  userId,
}) => {
  const [playbackState, setPlaybackState] = useState(PlaybackState.IDLE);
  const [selectedQuality, setSelectedQuality] = useState('auto');
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const webViewRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const closeTimeoutRef = useRef(null);

  const isHLS = videoUrl && detectStreamFormat(videoUrl) === 'HLS';
  const isDASH = videoUrl && detectStreamFormat(videoUrl) === 'DASH';

  // Back / close: lock to portrait first, then close after rotation settles (smooth, no errors)
  const handleClose = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    try {
      if (Orientation && typeof Orientation.lockToPortrait === 'function') {
        Orientation.lockToPortrait();
      }
    } catch (_) {}
    if (isFullscreen) {
      setIsFullscreen(false);
      closeTimeoutRef.current = setTimeout(() => {
        closeTimeoutRef.current = null;
        if (typeof onClose === 'function') onClose();
      }, 280);
    } else {
      if (typeof onClose === 'function') onClose();
    }
  };

  // Expand: rotate player to landscape (lock orientation then update UI)
  const handleExpand = () => {
    try {
      if (Orientation && typeof Orientation.lockToLandscape === 'function') {
        Orientation.lockToLandscape();
      }
    } catch (_) {}
    setIsFullscreen(true);
  };

  // Restore: rotate player back to portrait
  const handleRestore = () => {
    try {
      if (Orientation && typeof Orientation.lockToPortrait === 'function') {
        Orientation.lockToPortrait();
      }
    } catch (_) {}
    setIsFullscreen(false);
  };

  const generatePlayerHTML = (url, quality) => {
    const format = detectStreamFormat(url);
    const useHLS = format === 'HLS';
    const useDASH = format === 'DASH';
    const escapedUrl = JSON.stringify(url || '');

    const commonStyle = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; height: 100vh; overflow: hidden; font-family: system-ui, sans-serif; }
    #wrap { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
    video { width: 100%; height: 100%; object-fit: contain; display: block; }
    #overlay { position: absolute; inset: 0; background: transparent; display: flex; flex-direction: column; justify-content: space-between; opacity: 0; transition: opacity 0.25s; pointer-events: none; }
    #overlay.visible { opacity: 1; pointer-events: auto; }
    #topBar { padding: 12px 16px; background: linear-gradient(to bottom, rgba(0,0,0,0.7), transparent); }
    #bottomBar { padding: 16px; background: linear-gradient(to top, rgba(0,0,0,0.85), transparent); }
    #progressWrap { width: 100%; height: 28px; display: flex; align-items: center; cursor: pointer; }
    #progressBg { flex: 1; height: 4px; background: rgba(255,255,255,0.3); border-radius: 2px; overflow: hidden; position: relative; }
    #progressFill { height: 100%; background: #22c55e; border-radius: 2px; width: 0%; transition: width 0.05s; }
    #times { display: flex; justify-content: space-between; margin-top: 6px; font-size: 12px; color: rgba(255,255,255,0.9); }
    #centerPlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    #centerPlay button { width: 72px; height: 72px; border-radius: 50%; border: none; background: rgba(0,0,0,0.5); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    #centerPlay button:active { transform: scale(0.95); }
    #centerPlay .icon { font-size: 36px; }
    .hidden { display: none !important; }
    `;

    const qualityLevelIndex = `function levelForQuality(q, levels) {
      if (!levels || !levels.length) return -1;
      var idx = levels.findIndex(function(l) {
        var h = l.height || 0;
        if (q === '240' && h <= 240) return true;
        if (q === '360' && h <= 360 && h > 240) return true;
        if (q === '480' && h <= 480 && h > 360) return true;
        if (q === '720' && h <= 720 && h > 480) return true;
        if (q === '1080' && h <= 1080 && h > 720) return true;
        return false;
      });
      return idx;
    }`;

    const hlsScript = useHLS ? `
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      var hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 50, maxMaxBufferLength: 50 });
      hls.loadSource(${escapedUrl});
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, function() {
        var q = ${JSON.stringify(quality)};
        if (q !== 'auto' && hls.levels && hls.levels.length) {
          var idx = levelForQuality(q, hls.levels);
          if (idx >= 0) hls.currentLevel = idx;
        }
        video.play().catch(function(e) {});
      });
      hls.on(Hls.Events.ERROR, function(e, d) {
        if (d.fatal) {
          if (d.type === 'networkError') { hls.startLoad(); send({ type: 'buffering' }); }
          else if (d.type === 'mediaError') hls.recoverMediaError();
          else { hls.destroy(); send({ type: 'error', message: d.details || 'HLS error' }); }
        }
      });
      window._hls = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = ${escapedUrl};
      video.play().catch(function(e) {});
    } else {
      send({ type: 'error', message: 'HLS not supported' });
    }
    ` : '';

    const dashScript = useDASH ? `
    if (typeof dashjs !== 'undefined' && dashjs.supportsMediaSource()) {
      var player = dashjs.MediaPlayer().create();
      player.initialize(video, ${escapedUrl}, true);
      player.on('streamInitialized', function() {
        var q = ${JSON.stringify(quality)};
        if (q !== 'auto') {
          var bitrates = player.getBitrateInfoListFor('video');
          if (bitrates && bitrates.length) {
            var target = bitrates.find(function(b) {
              var h = b.height || 0;
              if (q === '240' && h <= 240) return true;
              if (q === '360' && h <= 360 && h > 240) return true;
              if (q === '480' && h <= 480 && h > 360) return true;
              if (q === '720' && h <= 720 && h > 480) return true;
              if (q === '1080' && h <= 1080 && h > 720) return true;
              return false;
            });
            if (target) player.setQualityFor('video', target.qualityIndex);
          }
        }
        video.play().catch(function(e) {});
      });
      player.on('error', function(e) {
        if (e.data && e.data.message) send({ type: 'error', message: e.data.message });
      });
      window._dashPlayer = player;
    } else {
      send({ type: 'error', message: 'DASH not supported' });
    }
    ` : '';

    const mp4Script = !useHLS && !useDASH ? `
    video.src = ${escapedUrl};
    video.play().catch(function(e) { send({ type: 'error', message: e && e.message }); });
    ` : '';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  ${useHLS ? '<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>' : ''}
  ${useDASH ? '<script src="https://cdn.dashjs.org/latest/dash.all.min.js"></script>' : ''}
  <style>${commonStyle}</style>
</head>
<body>
  <div id="wrap">
    <video id="video" playsinline webkit-playsinline x-webkit-airplay="allow"></video>
    <div id="overlay" class="visible">
      <div id="topBar"></div>
      <div id="centerPlay">
        <button id="playPauseBtn" type="button" aria-label="Play"><span class="icon">▶</span></button>
      </div>
      <div id="bottomBar">
        <div id="progressWrap">
          <div id="progressBg">
            <div id="progressFill"></div>
          </div>
        </div>
        <div id="times"><span id="curTime">0:00</span><span id="dur">0:00</span></div>
      </div>
    </div>
  </div>
  <script>
    ${qualityLevelIndex}
    var video = document.getElementById('video');
    var overlay = document.getElementById('overlay');
    var progressFill = document.getElementById('progressFill');
    var progressWrap = document.getElementById('progressWrap');
    var progressBg = document.getElementById('progressBg');
    var curTimeEl = document.getElementById('curTime');
    var durEl = document.getElementById('dur');
    var playPauseBtn = document.getElementById('playPauseBtn');
    var hideTimer;

    function send(obj) {
      try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch (e) {}
    }
    function fmt(t) {
      if (!t || isNaN(t)) return '0:00';
      var m = Math.floor(t / 60);
      var s = Math.floor(t % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }
    function updateUI() {
      var d = video.duration;
      if (d && isFinite(d)) {
        var p = (video.currentTime / d) * 100;
        progressFill.style.width = p + '%';
        curTimeEl.textContent = fmt(video.currentTime);
        durEl.textContent = fmt(d);
        send({ type: 'timeupdate', currentTime: video.currentTime, duration: d });
      }
    }
    function showOverlay() {
      overlay.classList.add('visible');
      clearTimeout(hideTimer);
      if (!video.paused) {
        hideTimer = setTimeout(function() { overlay.classList.remove('visible'); }, 3000);
      }
    }
    function hideOverlay() {
      clearTimeout(hideTimer);
      overlay.classList.remove('visible');
    }
    var wrap = document.getElementById('wrap');
    if (wrap) wrap.addEventListener('click', function(e) {
      if (e.target === wrap || e.target === video) showOverlay();
    });
    video.addEventListener('click', function(e) { e.stopPropagation(); showOverlay(); });
    video.addEventListener('timeupdate', updateUI);
    video.addEventListener('loadedmetadata', function() {
      durEl.textContent = fmt(video.duration);
      send({ type: 'loaded', duration: video.duration });
    });
    video.addEventListener('waiting', function() { send({ type: 'buffering' }); });
    video.addEventListener('playing', function() {
      send({ type: 'playing' });
      playPauseBtn.innerHTML = '<span class="icon">⏸</span>';
      playPauseBtn.setAttribute('aria-label', 'Pause');
      hideTimer = setTimeout(function() { overlay.classList.remove('visible'); }, 3000);
    });
    video.addEventListener('pause', function() {
      playPauseBtn.innerHTML = '<span class="icon">▶</span>';
      playPauseBtn.setAttribute('aria-label', 'Play');
      send({ type: 'pause' });
      showOverlay();
    });
    video.addEventListener('play', function() { send({ type: 'play' }); });
    video.addEventListener('ended', function() { send({ type: 'ended' }); });
    video.addEventListener('error', function(e) {
      var msg = 'Unknown error';
      if (video.error) {
        var c = video.error.code;
        if (c === 1) msg = 'MEDIA_ERR_ABORTED';
        else if (c === 2) msg = 'MEDIA_ERR_NETWORK';
        else if (c === 3) msg = 'MEDIA_ELEMENT_ERROR format error (decode)';
        else if (c === 4) msg = 'MEDIA_ELEMENT_ERROR format error (not supported)';
        else msg = video.error.message || ('MEDIA_ELEMENT_ERROR code ' + c);
      }
      send({ type: 'error', message: msg });
    });
    playPauseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (video.paused) video.play(); else video.pause();
    });
    progressWrap.addEventListener('click', function(e) {
      e.stopPropagation();
      var d = video.duration;
      if (!d || !isFinite(d)) return;
      var rect = progressBg.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var ratio = Math.max(0, Math.min(1, x / rect.width));
      video.currentTime = ratio * d;
      updateUI();
    });
    ${hlsScript}
    ${dashScript}
    ${mp4Script}
    window.changeQuality = function(q) {
      if (window._hls && window._hls.levels && window._hls.levels.length) {
        if (q === 'auto') { window._hls.currentLevel = -1; return; }
        var idx = levelForQuality(q, window._hls.levels);
        if (idx >= 0) window._hls.currentLevel = idx;
      }
      if (window._dashPlayer) {
        if (q === 'auto') return;
        var bitrates = window._dashPlayer.getBitrateInfoListFor('video');
        if (bitrates && bitrates.length) {
          var target = bitrates.find(function(b) {
            var h = b.height || 0;
            if (q === '240' && h <= 240) return true;
            if (q === '360' && h <= 360 && h > 240) return true;
            if (q === '480' && h <= 480 && h > 360) return true;
            if (q === '720' && h <= 720 && h > 480) return true;
            if (q === '1080' && h <= 1080 && h > 720) return true;
            return false;
          });
          if (target) window._dashPlayer.setQualityFor('video', target.qualityIndex);
        }
      }
    };
  </script>
</body>
</html>`;
    return html;
  };

  const handleMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      switch (data.type) {
        case 'timeupdate':
          setCurrentTime(data.currentTime || 0);
          if (data.duration != null) setDuration(data.duration);
          break;
        case 'play':
          setPlaybackState(PlaybackState.PLAYING);
          setError(null);
          break;
        case 'pause':
          setPlaybackState(PlaybackState.PAUSED);
          break;
        case 'loaded':
          setPlaybackState(PlaybackState.READY);
          if (data.duration != null) setDuration(data.duration);
          break;
        case 'buffering':
        case 'loading':
          setPlaybackState(PlaybackState.BUFFERING);
          break;
        case 'playing':
          setPlaybackState(PlaybackState.PLAYING);
          setError(null);
          break;
        case 'ended':
          setPlaybackState(PlaybackState.ENDED);
          break;
        case 'error':
          setPlaybackState(PlaybackState.IDLE);
          setError(getErrorMessage(data.message));
          break;
        default:
          break;
      }
    } catch (e) {}
  };

  const handleQualityChange = (q) => {
    setSelectedQuality(q);
    setShowQualityMenu(false);
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(
        `window.changeQuality && window.changeQuality(${JSON.stringify(q)}); true;`
      );
    }
  };

  const formatTime = (s) => {
    if (s == null || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  useEffect(() => {
    if (videoUrl) {
      setSelectedQuality('auto');
      setPlaybackState(PlaybackState.IDLE);
      setShowControls(true);
      setError(null);
      setCurrentTime(0);
      setDuration(0);
      setIsFullscreen(false);
    }
  }, [videoUrl]);

  // When modal closes, ensure app returns to portrait (no rotation left for the rest of the app)
  useEffect(() => {
    if (!visible) {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      if (Orientation && typeof Orientation.lockToPortrait === 'function') {
        try {
          Orientation.lockToPortrait();
        } catch (_) {}
      }
    }
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
    };
  }, [visible]);

  useEffect(() => {
    if (playbackState === PlaybackState.PLAYING && showControls) {
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
    }
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [playbackState, showControls]);

  if (!visible) return null;

  const isLoading = playbackState === PlaybackState.IDLE || playbackState === PlaybackState.BUFFERING;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleClose}
      supportedOrientations={isFullscreen ? ['landscape'] : ['portrait']}
      statusBarTranslucent>
      <View style={styles.container}>
        {!isFullscreen && (
          <View style={styles.topBar}>
            <TouchableOpacity onPress={handleClose} style={styles.iconBtn} activeOpacity={0.7}>
              <Icon name="arrow-left" size={26} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.channelName} numberOfLines={1}>{channelName || 'Video'}</Text>
            <TouchableOpacity
              onPress={handleExpand}
              style={styles.iconBtn}
              activeOpacity={0.7}
              accessibilityLabel="Expand to landscape">
              <Icon name="fullscreen" size={24} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowQualityMenu(!showQualityMenu)}
              style={styles.iconBtn}
              activeOpacity={0.7}>
              <Icon name="quality-high" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.playerWrap}>
          {videoUrl ? (
            <WebView
              key={videoUrl}
              ref={webViewRef}
              source={{ html: generatePlayerHTML(videoUrl, selectedQuality) }}
              style={styles.webview}
              userAgent={PLAYER_USER_AGENT}
              allowsFullscreenVideo
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserGesture={false}
              onMessage={handleMessage}
              onLoadStart={() => setPlaybackState(PlaybackState.BUFFERING)}
              javaScriptEnabled
              domStorageEnabled
              scrollEnabled={false}
              onError={() => {
                setError(getErrorMessage('Network connection failed'));
                setPlaybackState(PlaybackState.IDLE);
              }}
            />
          ) : (
            <View style={styles.placeholder}>
              <Icon name="video-off" size={48} color="#6b7280" />
              <Text style={styles.placeholderText}>No stream URL</Text>
            </View>
          )}

          {isLoading && !error && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#22c55e" />
              <Text style={styles.loadingText}>
                {playbackState === PlaybackState.BUFFERING ? 'Buffering...' : 'Loading...'}
              </Text>
            </View>
          )}

          {error ? (
            <View style={styles.errorOverlay}>
              <Icon name="alert-circle" size={40} color="#ef4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </View>

        {showControls && !isLoading && !error && playbackState !== PlaybackState.IDLE && (
          <TouchableOpacity
            style={styles.controlsOverlay}
            activeOpacity={1}
            onPress={() => setShowControls(!showControls)}>
            <View style={styles.bottomBar}>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${duration ? (currentTime / duration) * 100 : 0}%` }]} />
              </View>
              <View style={styles.timeRow}>
                <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
                <Text style={styles.timeText}>{formatTime(duration)}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

        {showQualityMenu && (
          <View style={styles.qualityMenu}>
            <Text style={styles.qualityMenuTitle}>Quality</Text>
            {QUALITY_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.qualityRow, selectedQuality === opt.value && styles.qualityRowActive]}
                onPress={() => handleQualityChange(opt.value)}
                activeOpacity={0.7}>
                <Text style={[styles.qualityLabel, selectedQuality === opt.value && styles.qualityLabelActive]}>
                  {opt.label}
                </Text>
                {opt.recommended && <Text style={styles.recommended}>ABR</Text>}
                {selectedQuality === opt.value && <AntDesign name="check" size={18} color="#22c55e" />}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    paddingTop: Platform.OS === 'android' ? 40 : 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  iconBtn: {
    padding: 8,
  },
  channelName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginHorizontal: 8,
  },
  playerWrap: {
    flex: 1,
    backgroundColor: '#000',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#9ca3af',
    marginTop: 8,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    marginTop: 12,
    fontSize: 14,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#ef4444',
    marginTop: 12,
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  controlsOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  bottomBar: {
    padding: 16,
    paddingBottom: 24,
  },
  progressBar: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 2,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
  },
  qualityMenu: {
    position: 'absolute',
    top: 70,
    right: 16,
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 10,
    minWidth: 180,
    borderWidth: 1,
    borderColor: '#374151',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  qualityMenuTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 10,
  },
  qualityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 4,
  },
  qualityRowActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
  },
  qualityLabel: {
    fontSize: 14,
    color: '#d1d5db',
    flex: 1,
  },
  qualityLabelActive: {
    color: '#22c55e',
    fontWeight: '600',
  },
  recommended: {
    fontSize: 10,
    color: '#fbbf24',
    marginRight: 8,
  },
});

export default VideoPlayer;
