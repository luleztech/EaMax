/**
 * VideoPlayer - React Native
 * Mirrors Kotlin ExoPlayerEngine + WebViewEngine from flutter player.
 * Supports: .php, .html, .mp4, .m3u8, .m3u, .mpd, HLS, DASH, WebM, MKV, etc.
 * - Direct stream URLs → react-native-video (ExoPlayer) with same User-Agent/headers.
 * - Web pages (.php, .html, or generic HTTP non-stream URLs) → WebView.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Platform,
  Dimensions,
  StatusBar,
  Animated,
} from 'react-native';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { lockToPortrait, unlockAllOrientations, setPlayerVisible } from '../utils/orientation';
import { userAPI } from '../config/api';

let WebView = null;
try {
  WebView = require('react-native-webview').WebView;
} catch (_) { }

// ─── User-Agent (match Kotlin ExoPlayerEngine.kt + WebViewEngine.kt) ─────────
const NATIVE_USER_AGENT = 'ExoPlayerLib/2.18.0 (Linux;Android 11) ReactNativeVideo/3.0';
const WEBVIEW_USER_AGENT = 'ReactNativeVideo/3.0 (Linux;Android 11) ExoPlayerLib/2.10.4';

// ─── Direct stream URL patterns (ExoPlayer can handle these) ─────────────────
const DIRECT_STREAM_PATTERNS = [
  '.mpd', '.m3u8', '.m3u', '.mp4', '.m4v', '.m4a', '.webm', '.mkv', '.avi', '.mov', '.flv', '.ts',
  'dash', 'hls', 'playlist.m3u', '/manifest', '/relay/stream', '/relay/m3u8', '/api/relay/',
];

function isWebPageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.toLowerCase();
  if (u.includes('.php') || u.includes('.html')) return true;
  if (!u.startsWith('http://') && !u.startsWith('https://')) return false;
  const isDirect = DIRECT_STREAM_PATTERNS.some((p) => u.includes(p));
  return !isDirect;
}

function isMpdUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.toLowerCase();
  return u.includes('.mpd');
}

// Hex → base64url helper (mirror backend ClearKey conversion)
function hexToBase64Url(hexString) {
  try {
    if (!hexString || typeof hexString !== 'string') return hexString;
    const normalized = hexString.trim();
    if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) return hexString;
    const bytes = [];
    for (let i = 0; i < normalized.length; i += 2) {
      bytes.push(parseInt(normalized.substr(i, 2), 16));
    }
    const bin = String.fromCharCode(...bytes);
    const b64 = typeof btoa === 'function'
      ? btoa(bin)
      : Buffer.from(bin, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch {
    return hexString;
  }
}

// Parse a stored clearkey string into the clearKeys map ExoPlayer expects.
// Supported admin formats:
//   - "KID_hex:KEY_hex"  (recommended)
//   - "KID_hex,KEY_hex"
//   - A single hex value (used as both KID and KEY)
// All hex values are converted to base64url so ExoPlayer ClearKey can decrypt.
// Returns null when no valid key is found.
function parseClearKeys(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const str = raw.trim();
  if (!str) return null;

  let kid = '';
  let key = '';
  if (str.includes(':')) {
    const parts = str.split(':').map((s) => s.trim());
    kid = parts[0];
    key = parts[1] || parts[0];
  } else if (str.includes(',')) {
    const parts = str.split(',').map((s) => s.trim());
    kid = parts[0];
    key = parts[1] || parts[0];
  } else {
    kid = str;
    key = str;
  }
  if (!kid || !key) return null;

  const kidB64 = hexToBase64Url(kid);
  const keyB64 = hexToBase64Url(key);
  return { [kidB64]: keyB64 };
}

// When the native player fails and we fall back to WebView,
// opening an .mpd URL directly will usually just download the file.
// Instead, render a minimal HTML page that uses dash.js to play the manifest.
// Uses versioned CDN + fast-start ABR so .mpd plays quickly like other URLs.
function buildDashHtml(url) {
  if (!url) return '<html><body style="background:#000;color:#fff;">Missing MPD URL</body></html>';
  const encodedUrl = encodeURIComponent(url);
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
    <title>Player</title>
    <link rel="preconnect" href="https://cdn.dashjs.org" crossorigin />
    <script src="https://cdn.dashjs.org/v4.7.2/dash.all.min.js"></script>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #000;
        height: 100%;
        overflow: hidden;
      }
      #videoPlayer {
        width: 100%;
        height: 100%;
        background: #000;
      }
    </style>
  </head>
  <body>
    <video id="videoPlayer" controls autoplay playsinline></video>
    <script>
      (function () {
        function post(msg) {
          try {
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage)
              window.ReactNativeWebView.postMessage(JSON.stringify(msg));
          } catch (e) {}
        }
        try {
          var mpdUrl = decodeURIComponent('${encodedUrl}');
          var video = document.getElementById('videoPlayer');
          if (!video || !window.dashjs) return;
          var player = window.dashjs.MediaPlayer().create();
          player.updateSettings({
            streaming: { abr: { initialBitrate: 400 } }
          });
          player.initialize(video, mpdUrl, true);
          video.addEventListener('playing', function() { post({ type: 'playing' }); });
          video.addEventListener('error', function() { post({ type: 'error' }); });
        } catch (e) {
          post({ type: 'error' });
        }
      })();
    </script>
  </body>
</html>`;
}

function buildSource(url, headers = {}) {
  if (!url) return null;
  const h = {
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    'Connection': 'keep-alive',
    'User-Agent': NATIVE_USER_AGENT,
    ...headers,
  };
  const src = { uri: url, headers: h };
  // Hint DASH so ExoPlayer uses DashMediaSource immediately (faster, more reliable).
  if (isMpdUrl(url)) src.type = 'dash';
  return src;
}

export default function VideoPlayer({
  visible,
  onClose,
  videoUrl,
  channelName,
  headers: customHeaders = {},
  token,
  onUnlockChannel,
  channelId,
  userId,
  drmProtected,
  drmClearKey,
  drmLicenseUrl,
}) {
  const videoRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState('Connecting…');
  const [error, setError] = useState(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [useWebView, setUseWebView] = useState(false);
  const [sourceKey, setSourceKey] = useState(0);
  const [layoutSize, setLayoutSize] = useState({ width: 0, height: 0 });
  const [isPortrait, setIsPortrait] = useState(true);
  const [rotateHintDismissed, setRotateHintDismissed] = useState(false);
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const [selectedVideoTrack, setSelectedVideoTrack] = useState({
    type: 'resolution',
    value: 240,
  });
  const recordedWatchRef = useRef(null);
  const dashLoadFallbackRef = useRef(null);
  const nativeLoadTimeoutRef = useRef(null);
  const prevDrmKeyRef = useRef(null); // tracks last seen drmClearKey to restart player when key arrives

  const url = videoUrl || '';
  const isWebPage = isWebPageUrl(url);
  // Never fall back to WebView for DRM streams – WebView can't decrypt ClearKey DASH
  const isDrm = !!(drmProtected && (drmClearKey || drmLicenseUrl));
  const startWithWebView = !!(url && WebView && isWebPage && !isDrm);
  const isMpd = isMpdUrl(url);

  const mergedHeaders = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...customHeaders,
  };
  const source = buildSource(url, mergedHeaders);

  if (isDrm && source) {
    // For maximum reliability, always use backend ClearKey license endpoint when available.
    // This reuses the same proven JSON JWK response used by the Web player.
    if (drmLicenseUrl) {
      source.drm = {
        type: 'clearkey',
        licenseServer: drmLicenseUrl,
        headers: mergedHeaders,
      };
    } else {
      // Fallback: inline clearKeys when no license URL is configured for this channel.
      const clearKeysMap = parseClearKeys(drmClearKey);
      if (clearKeysMap) {
        source.drm = {
          type: 'clearkey',
          clearKeys: clearKeysMap,
        };
      }
    }
  }

  useEffect(() => {
    setPlayerVisible(visible);
    if (visible) {
      setPaused(false);
      setLoading(true);
      setLoadingMsg(isDrm ? 'Decrypting DRM stream…' : 'Connecting…');
      setError(null);
      setDuration(0);
      setCurrentTime(0);
      setSourceKey((k) => k + 1);
      setLayoutSize({ width: 0, height: 0 });
      setUseWebView(startWithWebView);
      setSelectedVideoTrack({
        type: 'resolution',
        value: 240,
      });
      setRotateHintDismissed(false);
      StatusBar.setHidden(true, 'fade');
      unlockAllOrientations();
    } else {
      if (dashLoadFallbackRef.current) clearTimeout(dashLoadFallbackRef.current);
      dashLoadFallbackRef.current = null;
      StatusBar.setHidden(false, 'fade');
      lockToPortrait();
    }
    return () => setPlayerVisible(false);
  }, [visible, url, startWithWebView]);

  // If native player is stuck loading (no onLoad/onReady), switch to WebView so stream can play.
  // Skip for DRM streams – WebView cannot decrypt ClearKey DASH, and DRM init needs more time.
  useEffect(() => {
    if (!visible || !url || useWebView || !WebView || !loading || isDrm) return;
    nativeLoadTimeoutRef.current = setTimeout(() => {
      nativeLoadTimeoutRef.current = null;
      setUseWebView(true);
      setError(null);
      setLoading(true);
      setLoadingMsg('Trying browser player…');
      setSourceKey((k) => k + 1);
    }, 10000); // 10 s is enough for normal streams
    return () => {
      if (nativeLoadTimeoutRef.current) clearTimeout(nativeLoadTimeoutRef.current);
      nativeLoadTimeoutRef.current = null;
    };
  }, [visible, url, useWebView, loading, isDrm]);

  // When the DRM clearKey prop changes (arrives from backend after the player was already open),
  // restart the Video source so ExoPlayer initialises with the correct key.
  useEffect(() => {
    if (!visible || !url) return;
    const keyChanged = drmClearKey !== prevDrmKeyRef.current;
    prevDrmKeyRef.current = drmClearKey;
    // Only trigger a restart if the key just arrived (was null, now has a value)
    if (keyChanged && drmClearKey) {
      setLoading(true);
      setLoadingMsg('Decrypting DRM stream…');
      setError(null);
      setUseWebView(false);
      setSourceKey((k) => k + 1);
    }
  }, [drmClearKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Record channel watch for admin "Most Watched" analytics (once per open)
  useEffect(() => {
    if (!visible || !userId || !channelId) {
      if (!visible) recordedWatchRef.current = null;
      return;
    }
    const key = `${userId}-${channelId}`;
    if (recordedWatchRef.current === key) return;
    recordedWatchRef.current = key;
    userAPI.recordChannelWatch(userId, String(channelId)).catch(() => { });
  }, [visible, userId, channelId]);

  useEffect(() => {
    const updateOrientation = () => {
      const { width, height } = Dimensions.get('window');
      setIsPortrait(width < height);
    };
    updateOrientation();
    const sub = Dimensions.addEventListener('change', updateOrientation);
    return () => sub?.remove?.();
  }, []);

  useEffect(() => {
    if (!visible || rotateHintDismissed) return;
    rotateAnim.setValue(0);
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(rotateAnim, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [visible, rotateHintDismissed]);

  const onLayout = useCallback((e) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w > 0 && h > 0) setLayoutSize({ width: w, height: h });
  }, []);

  const win = Dimensions.get('window');
  const w = layoutSize.width > 0 ? layoutSize.width : win.width;
  const h = layoutSize.height > 0 ? layoutSize.height : win.height;
  const videoStyle = [styles.video, { width: w, height: h }];

  const onLoad = useCallback((data) => {
    setLoading(false);
    setError(null);
    setDuration(data?.duration || 0);
  }, []);

  const onReadyForDisplay = useCallback(() => {
    setLoading(false);
  }, []);

  const onProgress = useCallback((ev) => {
    setCurrentTime(ev?.currentTime ?? 0);
  }, []);

  const onBuffer = useCallback((ev) => {
    setLoading(!!ev?.isBuffering);
    if (ev?.isBuffering) setLoadingMsg('Buffering…');
  }, []);

  const onError = useCallback((ev) => {
    setLoading(false);
    const msg =
      ev?.error?.errorString ||
      ev?.error?.error ||
      ev?.error?.errorException ||
      String(ev?.error?.errorCode ?? '') ||
      ev?.message ||
      'Stream unavailable.';
    const lower = (msg || '').toLowerCase();
    const isContainerError =
      lower.includes('container') ||
      lower.includes('unsupported') ||
      lower.includes('source error') ||
      lower.includes('parsing') ||
      lower.includes('format') ||
      lower.includes('3003') ||
      lower.includes('2004') ||
      lower.includes('io_bad_http') ||
      lower.includes('response code');
    const isRetryableError =
      lower.includes('network') ||
      lower.includes('timeout') ||
      lower.includes('connection') ||
      lower.includes('failed to load') ||
      lower.includes('cannot be loaded') ||
      lower.includes('unable to connect');

    if (WebView && !useWebView && (isContainerError || isRetryableError)) {
      setUseWebView(true);
      setError(null);
      setLoading(true);
      setLoadingMsg('Switching to browser player…');
      setSourceKey((k) => k + 1);
      return;
    }
    setError(msg);
  }, [useWebView]);

  const onEnd = useCallback(() => {
    setPaused(true);
  }, []);

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    setLoadingMsg('Reconnecting…');
    setPaused(false);
    setSourceKey((k) => k + 1);
  }, []);

  const switchToWebView = useCallback(() => {
    setUseWebView(true);
    setError(null);
    setLoading(true);
    setLoadingMsg('Switching to browser player…');
  }, []);

  const rotateInterpolate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });
  const showRotateHint = visible && isPortrait && !rotateHintDismissed && url;

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
      supportedOrientations={['landscape', 'portrait']}
    >
      <View style={styles.root} onLayout={onLayout} collapsable={false}>
        {url && useWebView && WebView ? (
          <WebView
            key={`wv-${sourceKey}`}
            source={isMpd ? { html: buildDashHtml(url) } : { uri: url }}
            style={[styles.video, { width: w, height: h }]}
            userAgent={WEBVIEW_USER_AGENT}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={['*']}
            mixedContentMode="always"
            onLoadEnd={() => {
              if (isMpd) {
                if (dashLoadFallbackRef.current) clearTimeout(dashLoadFallbackRef.current);
                dashLoadFallbackRef.current = setTimeout(() => setLoading(false), 4000);
              } else {
                setLoading(false);
              }
            }}
            onMessage={(e) => {
              if (!isMpd) return;
              try {
                const d = JSON.parse(e.nativeEvent?.data ?? '{}');
                if (d.type === 'playing') {
                  if (dashLoadFallbackRef.current) clearTimeout(dashLoadFallbackRef.current);
                  dashLoadFallbackRef.current = null;
                  setLoading(false);
                }
                if (d.type === 'error') setError('Playback failed');
              } catch (_) { }
            }}
            onError={() => setError('Page could not be loaded.')}
          />
        ) : source && w > 0 && h > 0 ? (
          <Video
            key={sourceKey}
            ref={videoRef}
            source={source}
            style={videoStyle}
            resizeMode="contain"
            paused={paused}
            controls={true}
            selectedVideoTrack={selectedVideoTrack}
            onLoad={onLoad}
            onReadyForDisplay={onReadyForDisplay}
            onProgress={onProgress}
            onBuffer={onBuffer}
            onError={onError}
            onEnd={onEnd}
          />
        ) : !url ? (
          <View style={styles.noSource}>
            <Icon name="video-off" size={48} color="#6b7280" />
            <Text style={styles.noSourceText}>No stream URL</Text>
          </View>
        ) : null}

        <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
          <Icon name="close" size={28} color="#fff" />
        </TouchableOpacity>

        {showRotateHint && (
          <View style={styles.rotateOverlay} pointerEvents="box-none">
            <View style={styles.rotateCard}>
              <Animated.View style={[styles.rotateIconWrap, { transform: [{ rotate: rotateInterpolate }] }]}>
                <Icon name="cellphone" size={72} color="rgba(255,255,255,0.95)" />
              </Animated.View>
              <Text style={styles.rotateTitle}>Ilaze simu yako</Text>
              <Text style={styles.rotateSubtitle}>Laza simu yako ili uweze kutizama kwa ukubwa kamili</Text>
              <View style={styles.rotateArrowWrap}>
                <Icon name="arrow-expand" size={40} color="rgba(255,255,255,0.6)" />
              </View>
              <TouchableOpacity
                style={styles.rotateDismissBtn}
                onPress={() => setRotateHintDismissed(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.rotateDismissText}>Baadaye</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {loading && !error && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingMsg}>{loadingMsg}</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorOverlay}>
            <View style={styles.errorCard}>
              <Icon name="wifi-off" size={40} color="#fff" />
              <Text style={styles.errorTitle}>Playback Error</Text>
              <Text style={styles.errorMsg} numberOfLines={3}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
                <Icon name="refresh" size={18} color="#000" />
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
              {WebView && !useWebView && (
                <TouchableOpacity style={styles.webviewBtn} onPress={switchToWebView}>
                  <Text style={styles.webviewBtnText}>Use browser player</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.closeErrBtn} onPress={onClose}>
                <Text style={styles.closeErrText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 9999,
    elevation: 9999,
  },
  video: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  closeBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99999,
  },
  noSource: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noSourceText: {
    color: '#888',
    fontSize: 16,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    gap: 12,
  },
  loadingMsg: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    fontWeight: '500',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.9)',
  },
  errorCard: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 28,
    maxWidth: 320,
  },
  errorTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
  },
  errorMsg: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 20,
    gap: 8,
  },
  retryText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '600',
  },
  webviewBtn: {
    marginTop: 10,
    paddingVertical: 10,
  },
  webviewBtnText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
  },
  closeErrBtn: {
    marginTop: 16,
    paddingVertical: 8,
  },
  closeErrText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
  rotateOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99998,
  },
  rotateCard: {
    alignItems: 'center',
    paddingHorizontal: 40,
    maxWidth: 340,
  },
  rotateIconWrap: {
    marginBottom: 24,
  },
  rotateTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  rotateSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  rotateArrowWrap: {
    marginBottom: 28,
    opacity: 0.9,
  },
  rotateDismissBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  rotateDismissText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
  },
});
