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
  // Native uses type as file extension for Util.inferContentType(); must be 'mpd' for DASH (not 'dash') to avoid PARSING_CONTAINER_UNSUPPORTED.
  if (isMpdUrl(url)) src.type = 'mpd';
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
  fetchChannelClearKey, // optional: (channelId) => Promise<{ drmClearKey }> – used when channel needs ClearKey but none was passed (e.g. from admin)
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
  // Default 360p; user can change via OKOA BANDO (quality) button
  const [selectedVideoTrack, setSelectedVideoTrack] = useState({
    type: 'resolution',
    value: 360,
  });
  const [qualityModalVisible, setQualityModalVisible] = useState(false);
  const [fetchedDrmClearKey, setFetchedDrmClearKey] = useState(null); // ClearKey loaded from API when channel requires it but none was passed
  const [drmKeyRetryTrigger, setDrmKeyRetryTrigger] = useState(0); // increment to retry fetching DRM key
  const recordedWatchRef = useRef(null);
  const dashLoadFallbackRef = useRef(null);
  const nativeLoadTimeoutRef = useRef(null);
  const prevDrmKeyRef = useRef(null); // tracks last seen drmClearKey to restart player when key arrives

  const url = videoUrl || '';
  const isWebPage = isWebPageUrl(url);
  // Use passed ClearKey or the one we fetched from API (admin-configured for this channel)
  const effectiveDrmClearKey = drmClearKey || fetchedDrmClearKey;
  // Treat as DRM when we have a key, a license URL, or will fetch the key (so we don't fall back to WebView)
  const isDrm = !!(drmProtected && (effectiveDrmClearKey || drmLicenseUrl || (channelId && fetchChannelClearKey)));
  // For DRM that depends on fetchChannelClearKey (no license server): don't start playback until we have the key.
  // When we have drmLicenseUrl, ExoPlayer handles key fetching natively – no need to wait in JS.
  const drmWaitingForKey = !!(
    drmProtected &&
    !drmLicenseUrl &&
    channelId &&
    fetchChannelClearKey &&
    !effectiveDrmClearKey
  );
  const startWithWebView = !!(url && WebView && isWebPage && !isDrm);
  const isMpd = isMpdUrl(url);

  const isDrmRef = useRef(isDrm);
  isDrmRef.current = isDrm;

  const mergedHeaders = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...customHeaders,
  };
  const source = buildSource(url, mergedHeaders);

  if (isDrm && source) {
    // Force DASH container: native uses source.type as extension for inferContentType(); 'mpd' yields CONTENT_TYPE_DASH and DashMediaSource (fixes PARSING_CONTAINER_UNSUPPORTED).
    if (isMpdUrl(url)) source.type = 'mpd';

    // License server: ExoPlayer fetches key from our API (admin-configured). Use both licenseServer and headers (library expects these).
    if (drmLicenseUrl) {
      source.drm = {
        type: 'clearkey',
        licenseServer: drmLicenseUrl,
        headers: mergedHeaders,
      };
    } else {
      const clearKeysMap = parseClearKeys(effectiveDrmClearKey);
      if (clearKeysMap) {
        source.drm = {
          type: 'clearkey',
          clearKeys: clearKeysMap,
        };
      }
    }
  }

  const QUALITY_OPTIONS = [
    { label: 'Auto', value: 0 },
    { label: '240p', value: 240 },
    { label: '360p (inapendekezwa)', value: 360 },
    { label: '480p', value: 480 },
    { label: '720p', value: 720 },
    { label: '1080p', value: 1080 },
  ];

  // When player opens for a DRM channel but no ClearKey was passed and we don't have a license server,
  // fetch ClearKey from API (admin-configured for this channel). For drmLicenseUrl we let ExoPlayer fetch natively.
  useEffect(() => {
    if (!visible || !channelId || !drmProtected || drmClearKey || drmLicenseUrl || !fetchChannelClearKey) {
      if (!visible) setFetchedDrmClearKey(null);
      return;
    }
    let cancelled = false;
    fetchChannelClearKey(String(channelId))
      .then((data) => {
        if (cancelled) return;
        const key = data?.drmClearKey ?? data?.drm_clear_key ?? null;
        if (key) setFetchedDrmClearKey(key);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visible, channelId, drmProtected, drmClearKey, fetchChannelClearKey, drmKeyRetryTrigger]);

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
      setSelectedVideoTrack({ type: 'resolution', value: 360 });
      setQualityModalVisible(false);
      setFetchedDrmClearKey(null);
      setDrmKeyRetryTrigger(0);
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

  // When the DRM clearKey (or fetched key) changes, restart the Video source so ExoPlayer uses the correct key.
  useEffect(() => {
    if (!visible || !url) return;
    const keyChanged = effectiveDrmClearKey !== prevDrmKeyRef.current;
    prevDrmKeyRef.current = effectiveDrmClearKey;
    if (keyChanged && effectiveDrmClearKey) {
      setLoading(true);
      setLoadingMsg('Decrypting DRM stream…');
      setError(null);
      setUseWebView(false);
      setSourceKey((k) => k + 1);
    }
  }, [visible, url, effectiveDrmClearKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Never switch to WebView for DRM – browser cannot decrypt ClearKey DASH
    if (!isDrmRef.current && WebView && !useWebView && (isContainerError || isRetryableError)) {
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
        ) : source && w > 0 && h > 0 && !drmWaitingForKey ? (
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

        <TouchableOpacity
          style={styles.qualityBtn}
          onPress={() => setQualityModalVisible(true)}
          activeOpacity={0.8}>
          <Icon name="quality-high" size={22} color="#fff" />
          <Text style={styles.qualityBtnText}>OKOA BANDO</Text>
        </TouchableOpacity>

        <Modal
          visible={qualityModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setQualityModalVisible(false)}>
          <TouchableOpacity
            style={styles.qualityModalOverlay}
            activeOpacity={1}
            onPress={() => setQualityModalVisible(false)}>
            <TouchableOpacity
              style={styles.qualityModalCard}
              activeOpacity={1}
              onPress={() => {}}
              onStartShouldSetResponder={() => true}>
              <Text style={styles.qualityModalTitle}>Chagua ubora wa video</Text>
              <Text style={styles.qualityModalSubtitle}>Chini = okoa bando (360p inapendekezwa), juu = ubora bora zaidi</Text>
              {QUALITY_OPTIONS.map((opt) => {
                const isSelected = selectedVideoTrack.type === 'resolution' && selectedVideoTrack.value === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.qualityOption, isSelected && styles.qualityOptionSelected]}
                    onPress={() => {
                      setSelectedVideoTrack({ type: 'resolution', value: opt.value });
                      setSourceKey((k) => k + 1);
                      setLoading(true);
                      setLoadingMsg('Inabadilisha ubora…');
                      setQualityModalVisible(false);
                    }}
                    activeOpacity={0.7}>
                    <Text style={[styles.qualityOptionText, isSelected && styles.qualityOptionTextSelected]}>
                      {opt.label}
                    </Text>
                    {isSelected && <Icon name="check-circle" size={20} color="#22c55e" />}
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={styles.qualityModalClose}
                onPress={() => setQualityModalVisible(false)}>
                <Text style={styles.qualityModalCloseText}>Funga</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

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

        {(loading || drmWaitingForKey) && !error && (
          <View style={[styles.loadingOverlay, drmWaitingForKey && styles.loadingOverlayInteractive]} pointerEvents={drmWaitingForKey ? 'auto' : 'none'}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingMsg}>{drmWaitingForKey ? 'Fetching keys…' : loadingMsg}</Text>
            {drmWaitingForKey && (
              <TouchableOpacity style={styles.retryKeyBtn} onPress={() => setDrmKeyRetryTrigger((t) => t + 1)}>
                <Text style={styles.retryKeyBtnText}>Retry</Text>
              </TouchableOpacity>
            )}
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
              {WebView && !useWebView && !isDrm && (
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
  qualityBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    right: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 99999,
  },
  qualityBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  qualityModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  qualityModalCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#1f2937',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#374151',
  },
  qualityModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
    textAlign: 'center',
  },
  qualityModalSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 16,
    textAlign: 'center',
  },
  qualityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: 'rgba(55, 65, 81, 0.5)',
  },
  qualityOptionSelected: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.5)',
  },
  qualityOptionText: {
    fontSize: 15,
    color: '#e5e7eb',
    fontWeight: '500',
  },
  qualityOptionTextSelected: {
    color: '#22c55e',
    fontWeight: '600',
  },
  qualityModalClose: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  qualityModalCloseText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
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
  loadingOverlayInteractive: {},
  retryKeyBtn: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
  },
  retryKeyBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
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
