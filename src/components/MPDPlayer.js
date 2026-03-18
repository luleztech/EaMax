/**
 * MPDPlayer – Dedicated WebView + Shaka player for .mpd (DASH) streams.
 * Fetches manifest in React Native first to avoid CORS / Shaka error 1002, then injects into WebView.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  buildShakaDashHtmlWithManifest,
  getClearKeysForBrowser,
  getManifestBaseUrl,
} from '../utils/shakaDash';
import StreamEngine from '../engine/StreamEngine';

const WEBVIEW_USER_AGENT = 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36';

let WebView = null;
try {
  WebView = require('react-native-webview').WebView;
} catch (_) {}

export default function MPDPlayer({
  url,
  headers = {},
  drmClearKey,
  drmLicenseUrl,
  onClose,
  onError,
  onPlaying,
  style,
  maxHeight = 360,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [injectedHtml, setInjectedHtml] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const sourceKeyRef = useRef(0);

  const clearKeys = drmClearKey ? getClearKeysForBrowser(drmClearKey) : null;
  const drmConfig = {
    clearKeys: clearKeys || undefined,
    licenseUrl: drmLicenseUrl || '',
    licenseHeaders: headers,
  };

  // Fetch manifest in RN (no CORS) to avoid Shaka 1002, then build HTML with injected manifest
  useEffect(() => {
    if (!url) {
      setError('No stream URL');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setInjectedHtml(null);
    const accept = 'application/dash+xml,application/xml,text/xml;q=0.9,*/*;q=0.8';
    const fetchHeaders = { Accept: accept, ...headers };
    fetch(url, { headers: fetchHeaders })
      .then((res) => {
        if (!res.ok) throw new Error(`Manifest ${res.status}: ${res.statusText}`);
        return res.text();
      })
      .then((manifestText) => {
        const trimmed = manifestText.trim();
        if (!trimmed || (!trimmed.startsWith('<') && !trimmed.startsWith('<?xml'))) {
          throw new Error('Server did not return valid MPD XML (maybe HTML or error page)');
        }
        const repaired = StreamEngine.repairManifest(trimmed, url) || trimmed;
        const baseUrl = getManifestBaseUrl(url);
        const abrRestrictions = maxHeight > 0 ? { maxHeight, maxWidth: maxHeight >= 1080 ? 1920 : maxHeight >= 720 ? 1280 : maxHeight >= 480 ? 854 : maxHeight >= 360 ? 640 : 426 } : {};
        const html = buildShakaDashHtmlWithManifest(repaired, baseUrl, headers, drmConfig, abrRestrictions);
        setInjectedHtml(html);
        setLoading(false);
      })
      .catch((err) => {
        const msg = err?.message || 'Could not load manifest (network or CORS)';
        setError(msg);
        setLoading(false);
        onError?.(msg);
      });
  }, [url, JSON.stringify(headers), drmClearKey, drmLicenseUrl, maxHeight]);

  const handleMessage = useCallback(
    (e) => {
      try {
        const data = JSON.parse(e.nativeEvent?.data ?? '{}');
        if (data.type === 'playing') {
          setLoading(false);
          setError(null);
          onPlaying?.();
        }
        if (data.type === 'ready') {
          setLoading(false);
          setError(null);
        }
        if (data.type === 'error') {
          const msg = data.message || 'Playback failed';
          setError(msg);
          setLoading(false);
          onError?.(msg);
        }
        if (data.type === 'fallback') {
          setError(data.message || 'Manifest error');
          setLoading(false);
        }
      } catch (_) {}
    },
    [onPlaying, onError]
  );

  const handleRetry = useCallback(() => {
    setError(null);
    setInjectedHtml(null);
    setLoading(true);
    setRetryKey((k) => k + 1);
    sourceKeyRef.current += 1;
  }, []);

  if (!WebView) {
    return (
      <View style={[styles.container, style]}>
        <Text style={styles.noWebView}>WebView not available</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Icon name="close" size={28} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  }

  const { width, height } = Dimensions.get('window');

  // Only render WebView with injected manifest (fetched in RN to avoid Shaka 1002 CORS). No direct-URL load.
  const html = injectedHtml;

  return (
    <View style={[styles.container, style]}>
      {html ? (
      <WebView
        key={`mpd-${sourceKeyRef.current}`}
        source={{ html }}
        style={[styles.webview, { width, height }]}
        userAgent={WEBVIEW_USER_AGENT}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        mixedContentMode="always"
        onMessage={handleMessage}
        onError={() => {
          setError('Page could not be loaded.');
          setLoading(false);
        }}
      />
      ) : null}
      <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
        <Icon name="close" size={28} color="#fff" />
      </TouchableOpacity>
      {loading && !error && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingMsg}>Loading MPD…</Text>
        </View>
      )}
      {error && (
        <View style={styles.errorOverlay}>
          <Icon name="alert-circle" size={40} color="#fff" />
          <Text style={styles.errorTitle}>Playback Error</Text>
          <Text style={styles.errorMsg} numberOfLines={3}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
            <Icon name="refresh" size={18} color="#000" />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeErrBtn} onPress={onClose}>
            <Text style={styles.closeErrText}>Close</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  webview: {
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
  noWebView: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    padding: 24,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
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
    paddingHorizontal: 32,
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
  closeErrBtn: {
    marginTop: 16,
    paddingVertical: 8,
  },
  closeErrText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
});
