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

// Optional: use orientation locker for reliable portrait on close
let Orientation = null;
try {
  Orientation = require('react-native-orientation-locker').default;
} catch (_) {
  Orientation = null;
}

// PlaybackState
const PlaybackState = {
  IDLE: 'IDLE',
  BUFFERING: 'BUFFERING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  ENDED: 'ENDED',
};

// Stream format detection - enhanced for PHP URLs
const detectStreamFormat = (url) => {
  if (!url || typeof url !== 'string') return 'PROGRESSIVE';
  const u = url.toLowerCase();
  
  // Check for PHP URLs - they often output HLS or progressive streams
  if (u.includes('.php') || u.includes('stream') || u.includes('video') || u.includes('play')) {
    // Check if the URL has hints about the format
    if (u.includes('hls') || u.includes('m3u8') || u.includes('playlist')) return 'HLS';
    if (u.includes('dash') || u.includes('mpd')) return 'DASH';
    if (u.includes('mp4') || u.includes('webm')) return 'PROGRESSIVE';
    // Default PHP streams to HLS as most common for adaptive streaming
    return 'HLS';
  }
  
  // Standard format detection
  if (u.includes('.m3u8') || u.includes('.m3u') || u.includes('hls') || u.includes('playlist.m3u')) return 'HLS';
  if (u.includes('.mpd') || u.includes('dash') || u.includes('/manifest')) return 'DASH';
  if (u.includes('.mp4') || u.includes('.m4v') || u.includes('.webm') || u.includes('.mkv')) return 'PROGRESSIVE';
  if (u.includes('.ts') && !u.includes('m3u8')) return 'PROGRESSIVE';
  
  // Check for streaming patterns
  if (u.includes('manifest') || u.includes('playlist')) return 'HLS';
  
  return 'HLS'; // Default to HLS for unknown URLs
};

// Check if URL needs special headers/cookies handling
const needsSpecialHandling = (url) => {
  if (!url) return false;
  const u = url.toLowerCase();
  return u.includes('.php') || u.includes('token=') || u.includes('auth=') || u.includes('session');
};

// User-Agent - using common browser UA for better compatibility with PHP streams
const PLAYER_USER_AGENT = 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36';

// Quality options
const QUALITY_OPTIONS = [
  { label: 'Auto (ABR)', value: 'auto', recommended: true },
  { label: '240p', value: '240', recommended: false },
  { label: '360p', value: '360', recommended: false },
  { label: '480p', value: '480', recommended: false },
  { label: '720p', value: '720', recommended: false },
  { label: '1080p', value: '1080', recommended: false },
];

// User-friendly error messages
const getErrorMessage = (codeOrMessage) => {
  const msg = String(codeOrMessage || '').toLowerCase();
  if (msg.includes('network') || msg.includes('connection') || msg.includes('failed')) 
    return 'Network connection failed. Please check your internet connection.';
  if (msg.includes('timeout')) return 'Connection timeout. Please try again.';
  if (msg.includes('cors') || msg.includes('cross-origin')) 
    return 'Stream access denied. Please try again later.';
  if (msg.includes('drm') || msg.includes('license')) 
    return 'Stream authorization failed. Stream may not be available.';
  if (msg.includes('not supported') || msg.includes('unsupported')) 
    return 'This stream format is not supported on this device.';
  if (msg.includes('hls not supported')) 
    return 'HLS playback is not supported in this browser.';
  if (msg.includes('dash not supported')) 
    return 'DASH playback is not supported in this browser.';
  if (msg.includes('404') || msg.includes('not found')) 
    return 'Stream not found. The URL may be invalid.';
  if (msg.includes('403') || msg.includes('forbidden')) 
    return 'Access denied. The stream requires authentication.';
  if (msg.includes('media_element_error') || msg.includes('format error') || 
      msg.includes('decode') || msg.includes('src_not_supported') || msg.includes('mediasource')) {
    return 'This stream format or codec is not supported. Try another channel or update the stream URL in the admin app.';
  }
  return msg ? `Playback error: ${codeOrMessage}` : 'Playback error. Please try again.';
};

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
  const [loadAttempts, setLoadAttempts] = useState(0);
  const [webViewKey, setWebViewKey] = useState(Date.now());
  
  const webViewRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const closeTimeoutRef = useRef(null);

  const isHLS = videoUrl && detectStreamFormat(videoUrl) === 'HLS';
  const isDASH = videoUrl && detectStreamFormat(videoUrl) === 'DASH';
  const isPHP = videoUrl && videoUrl.toLowerCase().includes('.php');
  const needsHeaders = videoUrl && needsSpecialHandling(videoUrl);

  // Reset when video URL changes
  useEffect(() => {
    if (videoUrl) {
      console.log('Loading video URL:', videoUrl);
      console.log('Detected format:', detectStreamFormat(videoUrl));
      console.log('Is PHP URL:', isPHP);
      
      setPlaybackState(PlaybackState.BUFFERING);
      setError(null);
      setCurrentTime(0);
      setDuration(0);
      setLoadAttempts(0);
      setWebViewKey(Date.now()); // Force WebView remount on URL change
    }
  }, [videoUrl]);

  // Auto-hide controls
  useEffect(() => {
    if (showControls && playbackState === PlaybackState.PLAYING) {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [showControls, playbackState]);

  // Handle close
  const handleClose = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    
    // Pause video before closing
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        try {
          const video = document.getElementById('video-player');
          if (video) video.pause();
        } catch(e) {}
        true;
      `);
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

  // Expand to fullscreen
  const handleExpand = () => {
    try {
      if (Orientation && typeof Orientation.lockToLandscape === 'function') {
        Orientation.lockToLandscape();
      }
    } catch (_) {}
    setIsFullscreen(true);
  };

  // Generate optimized player HTML with PHP URL support
  const generatePlayerHTML = (url, quality) => {
    const format = detectStreamFormat(url);
    const useHLS = format === 'HLS';
    const useDASH = format === 'DASH';
    const escapedUrl = JSON.stringify(url || '');
    const isPhpUrl = url.toLowerCase().includes('.php');

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
          ${useHLS ? '<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>' : ''}
          ${useDASH ? '<script src="https://cdn.dashjs.org/latest/dash.all.min.js"></script>' : ''}
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              background: #000; 
              height: 100vh; 
              overflow: hidden; 
              display: flex;
              align-items: center;
              justify-content: center;
            }
            #player-container {
              width: 100%;
              height: 100%;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            video { 
              width: 100%; 
              height: 100%; 
              object-fit: contain; 
              background: #000;
              outline: none;
            }
            .controls {
              position: absolute;
              bottom: 0;
              left: 0;
              right: 0;
              background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%);
              padding: 20px 16px 16px;
              opacity: 0;
              transition: opacity 0.3s;
              pointer-events: none;
            }
            .controls.visible {
              opacity: 1;
              pointer-events: auto;
            }
            .progress-container {
              width: 100%;
              height: 40px;
              display: flex;
              align-items: center;
              cursor: pointer;
            }
            .progress-bg {
              flex: 1;
              height: 4px;
              background: rgba(255,255,255,0.3);
              border-radius: 2px;
              overflow: hidden;
              position: relative;
            }
            .progress-fill {
              height: 100%;
              background: #22c55e;
              width: 0%;
              transition: width 0.1s;
            }
            .time-display {
              display: flex;
              justify-content: space-between;
              margin-top: 4px;
              color: white;
              font-size: 12px;
              font-family: system-ui, -apple-system, sans-serif;
            }
            .center-play {
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              width: 64px;
              height: 64px;
              border-radius: 32px;
              background: rgba(0,0,0,0.6);
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
              opacity: 0;
              transition: opacity 0.3s;
              border: none;
              color: white;
            }
            .center-play.visible {
              opacity: 1;
            }
            .center-play svg {
              width: 32px;
              height: 32px;
              fill: white;
            }
            .error-overlay {
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: rgba(0,0,0,0.9);
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              color: white;
              padding: 20px;
              z-index: 1000;
            }
            .loading-spinner {
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              width: 40px;
              height: 40px;
              border: 3px solid rgba(255,255,255,0.3);
              border-top-color: #22c55e;
              border-radius: 50%;
              animation: spin 1s linear infinite;
              z-index: 100;
            }
            @keyframes spin {
              to { transform: translate(-50%, -50%) rotate(360deg); }
            }
            .debug-info {
              position: absolute;
              top: 10px;
              left: 10px;
              color: rgba(255,255,255,0.5);
              font-size: 10px;
              z-index: 1000;
            }
          </style>
        </head>
        <body>
          <div id="player-container">
            <video id="video-player" preload="auto" playsinline webkit-playsinline x-webkit-airplay="allow" crossorigin="anonymous"></video>
          </div>
          
          <div class="controls visible" id="controls">
            <div class="progress-container" id="progress-container">
              <div class="progress-bg" id="progress-bg">
                <div class="progress-fill" id="progress-fill"></div>
              </div>
            </div>
            <div class="time-display">
              <span id="current-time">0:00</span>
              <span id="duration">0:00</span>
            </div>
          </div>
          
          <button class="center-play visible" id="play-pause-btn">
            <svg viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
          
          <div id="loading-spinner" class="loading-spinner" style="display: none;"></div>
          
          <script>
            (function() {
              const video = document.getElementById('video-player');
              const controls = document.getElementById('controls');
              const playPauseBtn = document.getElementById('play-pause-btn');
              const progressFill = document.getElementById('progress-fill');
              const currentTimeEl = document.getElementById('current-time');
              const durationEl = document.getElementById('duration');
              const progressContainer = document.getElementById('progress-container');
              const loadingSpinner = document.getElementById('loading-spinner');
              
              let hideTimer = null;
              let playerInstance = null;
              let loadStartTime = Date.now();
              let isPhpUrl = ${isPhpUrl};
              
              function sendMessage(type, data = {}) {
                try {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type,
                    ...data
                  }));
                } catch (e) {}
              }
              
              function formatTime(seconds) {
                if (!seconds || isNaN(seconds)) return '0:00';
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                return mins + ':' + (secs < 10 ? '0' : '') + secs;
              }
              
              function updateProgress() {
                if (video.duration && isFinite(video.duration)) {
                  const percent = (video.currentTime / video.duration) * 100;
                  progressFill.style.width = percent + '%';
                  currentTimeEl.textContent = formatTime(video.currentTime);
                  durationEl.textContent = formatTime(video.duration);
                  sendMessage('timeupdate', { currentTime: video.currentTime, duration: video.duration });
                }
              }
              
              function showControls() {
                controls.classList.add('visible');
                playPauseBtn.classList.add('visible');
                
                if (hideTimer) clearTimeout(hideTimer);
                if (!video.paused) {
                  hideTimer = setTimeout(() => {
                    controls.classList.remove('visible');
                    playPauseBtn.classList.remove('visible');
                  }, 3000);
                }
              }
              
              function hideControls() {
                controls.classList.remove('visible');
                playPauseBtn.classList.remove('visible');
                if (hideTimer) clearTimeout(hideTimer);
              }
              
              function setLoading(loading) {
                loadingSpinner.style.display = loading ? 'block' : 'none';
              }
              
              // Helper to detect stream type from response
              function detectStreamTypeFromUrl(url) {
                const u = url.toLowerCase();
                if (u.includes('.m3u8') || u.includes('hls')) return 'hls';
                if (u.includes('.mpd') || u.includes('dash')) return 'dash';
                if (u.includes('.mp4')) return 'mp4';
                return 'unknown';
              }
              
              // Video event listeners
              video.addEventListener('loadstart', () => {
                console.log('Video loadstart');
                setLoading(true);
                sendMessage('state', { state: 'BUFFERING' });
              });
              
              video.addEventListener('waiting', () => {
                console.log('Video waiting');
                setLoading(true);
                sendMessage('state', { state: 'BUFFERING' });
              });
              
              video.addEventListener('canplay', () => {
                console.log('Video canplay');
                setLoading(false);
                sendMessage('state', { state: 'READY' });
              });
              
              video.addEventListener('playing', () => {
                console.log('Video playing');
                setLoading(false);
                sendMessage('state', { state: 'PLAYING' });
                playPauseBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
                showControls();
              });
              
              video.addEventListener('pause', () => {
                console.log('Video paused');
                sendMessage('state', { state: 'PAUSED' });
                playPauseBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
                showControls();
              });
              
              video.addEventListener('ended', () => {
                console.log('Video ended');
                sendMessage('state', { state: 'ENDED' });
                playPauseBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
                showControls();
              });
              
              video.addEventListener('timeupdate', updateProgress);
              
              video.addEventListener('loadedmetadata', () => {
                console.log('Video loadedmetadata, duration:', video.duration);
                durationEl.textContent = formatTime(video.duration);
                sendMessage('loaded', { duration: video.duration });
              });
              
              video.addEventListener('loadeddata', () => {
                console.log('Video loadeddata');
                setLoading(false);
              });
              
              video.addEventListener('stalled', () => {
                console.log('Video stalled');
                setLoading(true);
                sendMessage('state', { state: 'BUFFERING' });
              });
              
              video.addEventListener('error', (e) => {
                setLoading(false);
                let errorMsg = 'Unknown error';
                let errorCode = 0;
                
                if (video.error) {
                  errorCode = video.error.code;
                  switch(video.error.code) {
                    case 1:
                      errorMsg = 'MEDIA_ERR_ABORTED - Playback aborted';
                      break;
                    case 2:
                      errorMsg = 'MEDIA_ERR_NETWORK - Network error';
                      break;
                    case 3:
                      errorMsg = 'MEDIA_ERR_DECODE - Format not supported or corrupted';
                      break;
                    case 4:
                      errorMsg = 'MEDIA_ERR_SRC_NOT_SUPPORTED - Video format not supported';
                      break;
                    default:
                      errorMsg = video.error.message || 'MEDIA_ELEMENT_ERROR';
                  }
                }
                
                console.error('Video error:', errorCode, errorMsg);
                sendMessage('error', { message: errorMsg, code: errorCode });
              });
              
              // Handle HTTP errors for PHP streams
              if (isPhpUrl) {
                fetch(${escapedUrl}, { method: 'HEAD' })
                  .then(response => {
                    if (!response.ok) {
                      sendMessage('error', { message: 'HTTP ' + response.status + ': ' + response.statusText });
                    } else {
                      const contentType = response.headers.get('content-type');
                      console.log('PHP stream content-type:', contentType);
                      
                      // If it's a manifest, we might need to handle differently
                      if (contentType && contentType.includes('application/vnd.apple.mpegurl')) {
                        // It's an HLS manifest
                        ${useHLS ? `
                        if (Hls && Hls.isSupported()) {
                          const hls = new Hls({
                            enableWorker: true,
                            lowLatencyMode: true,
                            backBufferLength: 90,
                            maxBufferLength: 30,
                            maxMaxBufferLength: 50,
                            manifestLoadingTimeOut: 15000,
                            levelLoadingTimeOut: 15000,
                          });
                          
                          hls.loadSource(${escapedUrl});
                          hls.attachMedia(video);
                          window.hls = hls;
                          
                          hls.on(Hls.Events.MANIFEST_PARSED, () => {
                            video.play().catch(e => sendMessage('error', { message: e.message }));
                          });
                          
                          hls.on(Hls.Events.ERROR, (event, data) => {
                            if (data.fatal) {
                              sendMessage('error', { message: 'HLS: ' + data.type + ' - ' + data.details });
                            }
                          });
                        } else {
                          video.src = ${escapedUrl};
                        }
                        ` : ''}
                      } else {
                        // Assume progressive download
                        video.src = ${escapedUrl};
                      }
                    }
                  })
                  .catch(err => {
                    console.error('Fetch error:', err);
                    // Fallback to direct playback
                    video.src = ${escapedUrl};
                  });
              }
              
              // Interaction events
              document.body.addEventListener('click', (e) => {
                if (e.target === video || e.target === document.body) {
                  showControls();
                }
              });
              
              playPauseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (video.paused) {
                  video.play().catch(e => sendMessage('error', { message: e.message }));
                } else {
                  video.pause();
                }
                showControls();
              });
              
              progressContainer.addEventListener('click', (e) => {
                e.stopPropagation();
                if (video.duration && isFinite(video.duration)) {
                  const rect = document.getElementById('progress-bg').getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const percent = Math.max(0, Math.min(1, x / rect.width));
                  video.currentTime = percent * video.duration;
                  updateProgress();
                }
                showControls();
              });
              
              // Initialize player based on format
              function initPlayer() {
                const videoUrl = ${escapedUrl};
                const quality = ${JSON.stringify(quality)};
                const detectedFormat = '${format}';
                
                console.log('Initializing player with URL:', videoUrl);
                console.log('Detected format:', detectedFormat);
                
                // For PHP URLs, we already tried HEAD request above
                if (!isPhpUrl) {
                  ${useHLS ? `
                  if (Hls && Hls.isSupported()) {
                    console.log('Using HLS.js for playback');
                    const hls = new Hls({
                      enableWorker: true,
                      lowLatencyMode: true,
                      backBufferLength: 90,
                      maxBufferLength: 30,
                      maxMaxBufferLength: 50,
                      maxBufferSize: 60 * 1000 * 1000,
                      maxBufferHole: 0.5,
                      liveSyncDurationCount: 3,
                      manifestLoadingTimeOut: 10000,
                      levelLoadingTimeOut: 10000,
                    });
                    
                    hls.loadSource(videoUrl);
                    hls.attachMedia(video);
                    window.hls = hls;
                    
                    hls.on(Hls.Events.MANIFEST_PARSED, () => {
                      console.log('HLS manifest parsed, levels:', hls.levels.length);
                      if (quality !== 'auto' && hls.levels && hls.levels.length) {
                        const targetHeight = parseInt(quality);
                        let targetLevel = -1;
                        for (let i = 0; i < hls.levels.length; i++) {
                          if (hls.levels[i].height <= targetHeight) {
                            targetLevel = i;
                          }
                        }
                        if (targetLevel >= 0) {
                          hls.currentLevel = targetLevel;
                        }
                      }
                      video.play().catch(e => {
                        console.error('Play failed:', e);
                        sendMessage('error', { message: e.message });
                      });
                    });
                    
                    hls.on(Hls.Events.ERROR, (event, data) => {
                      console.error('HLS error:', data);
                      if (data.fatal) {
                        switch(data.type) {
                          case Hls.ErrorTypes.NETWORK_ERROR:
                            hls.startLoad();
                            break;
                          case Hls.ErrorTypes.MEDIA_ERROR:
                            hls.recoverMediaError();
                            break;
                          default:
                            sendMessage('error', { message: 'HLS: ' + data.details });
                            break;
                        }
                      }
                    });
                  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    console.log('Using native HLS support');
                    video.src = videoUrl;
                    video.play().catch(e => sendMessage('error', { message: e.message }));
                  } else {
                    console.log('HLS not supported, trying progressive');
                    video.src = videoUrl;
                  }
                  ` : useDASH ? `
                  if (dashjs && dashjs.supportsMediaSource()) {
                    console.log('Using DASH.js for playback');
                    const dash = dashjs.MediaPlayer().create();
                    dash.initialize(video, videoUrl, true);
                    window.dash = dash;
                    
                    dash.on('error', (e) => {
                      console.error('DASH error:', e);
                      sendMessage('error', { message: e.message || 'DASH error' });
                    });
                    
                    video.play().catch(e => sendMessage('error', { message: e.message }));
                  } else {
                    console.log('DASH not supported, trying progressive');
                    video.src = videoUrl;
                  }
                  ` : `
                  console.log('Using progressive download');
                  video.src = videoUrl;
                  video.play().catch(e => {
                    console.error('Play failed:', e);
                    sendMessage('error', { message: e.message });
                  });
                  `}
                }
              }
              
              // Start initialization for non-PHP URLs
              if (!isPhpUrl) {
                if (document.readyState === 'loading') {
                  document.addEventListener('DOMContentLoaded', initPlayer);
                } else {
                  initPlayer();
                }
              }
              
              // Handle quality changes
              window.changeQuality = (newQuality) => {
                console.log('Changing quality to:', newQuality);
                ${useHLS ? `
                if (window.hls && window.hls.levels && window.hls.levels.length) {
                  if (newQuality === 'auto') {
                    window.hls.currentLevel = -1;
                  } else {
                    const targetHeight = parseInt(newQuality);
                    let targetLevel = -1;
                    for (let i = 0; i < window.hls.levels.length; i++) {
                      if (window.hls.levels[i].height <= targetHeight) {
                        targetLevel = i;
                      }
                    }
                    if (targetLevel >= 0) {
                      window.hls.currentLevel = targetLevel;
                    }
                  }
                }
                ` : ''}
              };
            })();
          </script>
        </body>
      </html>
    `;
  };

  const handleMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      switch (data.type) {
        case 'state':
          setPlaybackState(data.state);
          if (data.state === PlaybackState.PLAYING) {
            setError(null);
          }
          break;
          
        case 'timeupdate':
          setCurrentTime(data.currentTime || 0);
          if (data.duration != null) setDuration(data.duration);
          break;
          
        case 'loaded':
          setPlaybackState(PlaybackState.READY);
          if (data.duration != null) setDuration(data.duration);
          break;
          
        case 'error':
          console.error('Player error:', data.message);
          setPlaybackState(PlaybackState.IDLE);
          setError(getErrorMessage(data.message));
          
          // Auto-retry on error (max 2 attempts)
          if (loadAttempts < 2 && !data.message.includes('not supported')) {
            setTimeout(() => {
              setLoadAttempts(prev => prev + 1);
              setWebViewKey(Date.now()); // Force WebView reload
            }, 2000);
          }
          break;
          
        default:
          break;
      }
    } catch (e) {
      console.error('Error parsing message:', e);
    }
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

  const togglePlayPause = () => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        const video = document.getElementById('video-player');
        if (video) {
          if (video.paused) video.play(); else video.pause();
        }
        true;
      `);
    }
  };

  const handleWebViewError = (syntheticEvent) => {
    const { nativeEvent } = syntheticEvent;
    console.error('WebView error:', nativeEvent);
    setError(getErrorMessage(nativeEvent.description));
    setPlaybackState(PlaybackState.IDLE);
  };

  const formatTime = (s) => {
    if (s == null || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  if (!visible) return null;

  const isLoading = playbackState === PlaybackState.IDLE || 
                    playbackState === PlaybackState.BUFFERING;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleClose}
      supportedOrientations={['portrait', 'landscape']}
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
              activeOpacity={0.7}>
              <Icon name="fullscreen" size={24} color="#fff" />
            </TouchableOpacity>
            {isHLS && (
              <TouchableOpacity
                onPress={() => setShowQualityMenu(!showQualityMenu)}
                style={styles.iconBtn}
                activeOpacity={0.7}>
                <Icon name="quality-high" size={24} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={styles.playerWrap}>
          {videoUrl ? (
            <WebView
              key={webViewKey}
              ref={webViewRef}
              source={{ html: generatePlayerHTML(videoUrl, selectedQuality) }}
              style={styles.webview}
              userAgent={PLAYER_USER_AGENT}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              scrollEnabled={false}
              onMessage={handleMessage}
              onError={handleWebViewError}
              onHttpError={handleWebViewError}
              cacheEnabled={true}
              cacheMode="LOAD_CACHE_ELSE_NETWORK"
              thirdPartyCookiesEnabled={true}
              mixedContentMode="always"
              startInLoadingState={true}
              renderLoading={() => (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="large" color="#22c55e" />
                  <Text style={styles.loadingText}>
                    {playbackState === PlaybackState.BUFFERING ? 'Buffering...' : 'Loading...'}
                  </Text>
                </View>
              )}
            />
          ) : (
            <View style={styles.placeholder}>
              <Icon name="video-off" size={48} color="#6b7280" />
              <Text style={styles.placeholderText}>No stream URL</Text>
            </View>
          )}

          {error && (
            <View style={styles.errorOverlay}>
              <Icon name="alert-circle" size={48} color="#ef4444" />
              <Text style={styles.errorText}>{error}</Text>
              <View style={styles.errorButtons}>
                <TouchableOpacity 
                  style={[styles.errorButton, styles.retryButton]} 
                  onPress={() => {
                    setError(null);
                    setLoadAttempts(0);
                    setWebViewKey(Date.now());
                  }}
                >
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.errorButton, styles.closeButton]} 
                  onPress={handleClose}
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          
          {!error && !isLoading && playbackState === PlaybackState.PLAYING && (
            <TouchableOpacity
              style={styles.controlsToggle}
              activeOpacity={1}
              onPress={() => setShowControls(!showControls)}
            />
          )}
        </View>

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
    backgroundColor: 'rgba(0,0,0,0.9)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  iconBtn: {
    padding: 8,
  },
  channelName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginHorizontal: 8,
  },
  playerWrap: {
    flex: 1,
    backgroundColor: '#000',
    position: 'relative',
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    marginTop: 12,
    fontSize: 14,
  },
  errorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 1000,
  },
  errorText: {
    color: '#ef4444',
    marginTop: 16,
    marginBottom: 24,
    fontSize: 16,
    textAlign: 'center',
  },
  errorButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  errorButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  retryButton: {
    backgroundColor: '#22c55e',
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  closeButton: {
    backgroundColor: '#374151',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 16,
  },
  controlsToggle: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  qualityMenu: {
    position: 'absolute',
    top: 70,
    right: 16,
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    minWidth: 200,
    borderWidth: 1,
    borderColor: '#374151',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    zIndex: 2000,
  },
  qualityMenuTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  qualityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
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
