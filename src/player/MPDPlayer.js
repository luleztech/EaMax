/**
 * MPDPlayer.js — React Native WebView-based DASH player (Shaka Player)
 *
 * FIXES IN THIS VERSION:
 * 1. "Browser/device does not support DASH" — Root fix is in shakaDash.js:
 *    shaka.polyfill.installAll() is now called BEFORE isBrowserSupported().
 *    MPDPlayer no longer pre-checks support itself (Shaka handles it internally).
 *
 * 2. CDN fallback in shakaDash.js: jsDelivr → cdnjs.cloudflare.com.
 *    MPDPlayer shows a proper "Failed to load player" error if both CDNs fail,
 *    rather than the cryptic "DASH not supported" message.
 *
 * 3. licenseUrl guard: rejects URLs containing "undefined" (broken env var bug).
 *
 * 4. onBuffering prop properly forwarded for loading overlay sync.
 *
 * 5. Shaka 4.11.4 pinned (stable on Android WebView 85+).
 *    Shaka 5.x requires WebView 100+ — too risky for older devices.
 *
 * 6. mountedRef tracks unmount to prevent setState on unmounted component.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform, Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  buildShakaDashHtmlWithManifest,
  getClearKeysForBrowser,
  getManifestBaseUrl,
} from './shakaDash';
import StreamEngine from './StreamEngine';

const WEBVIEW_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36';

let WebView = null;
try { WebView = require('react-native-webview').WebView; } catch (_) {}

function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const s = url.trim();
  return (s.startsWith('http://') || s.startsWith('https://')) && !s.includes('undefined');
}

export default function MPDPlayer({
  url, headers = {}, drmClearKey, drmLicenseUrl,
  onClose, onError, onPlaying, onBuffering,
  style, maxHeight = 360,
}) {
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [injectedHtml, setInjectedHtml] = useState(null);
  const [retryKey,     setRetryKey]     = useState(0);
  const sourceKeyRef  = useRef(0);
  const mountedRef    = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // FIX: guard licenseUrl — reject if it contains "undefined" (bad env var) or isn't http(s)
  const effectiveLicenseUrl = isValidUrl(drmLicenseUrl) ? drmLicenseUrl : null;

  const clearKeys = drmClearKey ? getClearKeysForBrowser(drmClearKey) : null;
  const drmConfig = {
    clearKeys: clearKeys || undefined,
    licenseUrl: effectiveLicenseUrl || '',
    licenseHeaders: headers,
  };

  // ── Fetch manifest & build injected HTML ────────────────────────────────────
  useEffect(() => {
    if (!url) {
      setError('No stream URL provided');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setInjectedHtml(null);

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 15000);

    const fetchHeaders = {
      Accept: 'application/dash+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
      ...headers,
    };

    fetch(url, { headers: fetchHeaders, signal: controller.signal })
      .then((res) => {
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`Manifest HTTP ${res.status}: ${res.statusText}`);
        return res.text();
      })
      .then((manifestText) => {
        if (cancelled) return;
        const trimmed = manifestText.trim();
        if (!trimmed) throw new Error('Empty manifest response');
        if (!trimmed.startsWith('<') && !trimmed.startsWith('<?xml')) {
          throw new Error('Server returned non-XML response (HTML error page?)');
        }

        const repaired = StreamEngine.repairManifest(trimmed, url) || trimmed;
        const baseUrl  = getManifestBaseUrl(url);

        const abrRestrictions = {
          maxHeight: maxHeight > 0 ? maxHeight : 360,
          maxWidth:  maxHeight >= 1080 ? 1920 : maxHeight >= 720 ? 1280 : maxHeight >= 480 ? 854 : maxHeight >= 360 ? 640 : 426,
        };

        const html = buildShakaDashHtmlWithManifest(repaired, baseUrl, headers, drmConfig, abrRestrictions);

        if (!cancelled && mountedRef.current) {
          setInjectedHtml(html);
          setLoading(false);
        }
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (cancelled) return;
        let msg;
        if (err?.name === 'AbortError') {
          msg = 'Stream load timed out — check your internet connection';
        } else {
          msg = err?.message || 'Could not load stream';
        }
        if (mountedRef.current) { setError(msg); setLoading(false); }
        onError?.(msg);
      });

    return () => { cancelled = true; clearTimeout(timeoutId); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, JSON.stringify(headers), drmClearKey, drmLicenseUrl, maxHeight, retryKey]);

  // ── WebView message handler ──────────────────────────────────────────────────
  const handleMessage = useCallback((e) => {
    try {
      const data = JSON.parse(e.nativeEvent?.data ?? '{}');
      if (data.type === 'playing')   { setLoading(false); setError(null); onPlaying?.(); }
      if (data.type === 'ready')     { setLoading(false); setError(null); }
      if (data.type === 'buffering') { const b = !!data.isBuffering; setLoading(b); onBuffering?.(b); }
      if (data.type === 'error')     { const msg = data.message || 'Playback failed'; setError(msg); setLoading(false); onError?.(msg); }
      if (data.type === 'fallback')  { setError(data.message || 'Stream manifest error'); setLoading(false); }
    } catch (_) {}
  }, [onPlaying, onError, onBuffering]);

  const handleRetry = useCallback(() => {
    setError(null); setInjectedHtml(null); setLoading(true);
    setRetryKey(k => k + 1); sourceKeyRef.current++;
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

  return (
    <View style={[styles.container, style]}>
      {injectedHtml ? (
        <WebView
          key={`mpd-${sourceKeyRef.current}-h${maxHeight}`}
          source={{ html: injectedHtml }}
          style={[styles.webview, { width, height }]}
          userAgent={WEBVIEW_USER_AGENT}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
          mixedContentMode="always"
          allowsFullscreenVideo={false}
          onMessage={handleMessage}
          onError={(e) => {
            const msg = e?.nativeEvent?.description || 'WebView failed to load';
            setError(msg); setLoading(false);
          }}
        />
      ) : null}

      <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
        <Icon name="close" size={28} color="#fff" />
      </TouchableOpacity>

      {loading && !error && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingMsg}>{injectedHtml ? 'Buffering…' : 'Loading stream…'}</Text>
        </View>
      )}

      {!!error && (
        <View style={styles.errorOverlay}>
          <Icon name="alert-circle" size={40} color="#ef4444" />
          <Text style={styles.errorTitle}>Playback Error</Text>
          <Text style={styles.errorMsg} numberOfLines={4}>{error}</Text>
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
  container: { flex: 1, backgroundColor: '#000' },
  webview:   { position: 'absolute', top: 0, left: 0, backgroundColor: '#000' },
  closeBtn: {
    position: 'absolute', top: Platform.OS === 'ios' ? 50 : 20, right: 20,
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center', zIndex: 99999,
  },
  noWebView: { color: '#fff', fontSize: 16, textAlign: 'center', padding: 24, marginTop: 80 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)', gap: 12, zIndex: 9997,
  },
  loadingMsg: { color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: '500' },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.93)', paddingHorizontal: 32,
  },
  errorTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 12, marginBottom: 8 },
  errorMsg:   { color: 'rgba(255,255,255,0.65)', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 4 },
  retryBtn:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 24, paddingVertical: 12, marginTop: 20, gap: 8 },
  retryText:  { color: '#000', fontSize: 15, fontWeight: '600' },
  closeErrBtn:  { marginTop: 16, paddingVertical: 10 },
  closeErrText: { color: 'rgba(255,255,255,0.45)', fontSize: 14 },
});
