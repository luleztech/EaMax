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

let WebView = null;
try {
  WebView = require('react-native-webview').WebView;
} catch (_) {}

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
  return { uri: url, headers: h };
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

  const url = videoUrl || '';
  const isWebPage = isWebPageUrl(url);
  const startWithWebView = !!(url && WebView && isWebPage);

  const mergedHeaders = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...customHeaders,
  };
  const source = buildSource(url, mergedHeaders);

  useEffect(() => {
    setPlayerVisible(visible);
    if (visible) {
      setPaused(false);
      setLoading(true);
      setLoadingMsg('Connecting…');
      setError(null);
      setDuration(0);
      setCurrentTime(0);
      setSourceKey((k) => k + 1);
      setLayoutSize({ width: 0, height: 0 });
      setUseWebView(startWithWebView);
      setRotateHintDismissed(false);
      StatusBar.setHidden(true, 'fade');
      unlockAllOrientations();
    } else {
      StatusBar.setHidden(false, 'fade');
      lockToPortrait();
    }
    return () => setPlayerVisible(false);
  }, [visible, url, startWithWebView]);

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

    if (isContainerError && WebView && !useWebView) {
      setUseWebView(true);
      setError(null);
      setLoading(true);
      setLoadingMsg('Switching to browser player…');
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
            source={{ uri: url }}
            style={[styles.video, { width: w, height: h }]}
            userAgent={WEBVIEW_USER_AGENT}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={['*']}
            mixedContentMode="always"
            onLoadEnd={() => {
              setLoading(false);
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
