/**
 * VideoPlayer.js — Main React Native video player component
 *
 * FIXES IN THIS VERSION:
 * 1. console.warn → console.log for channel-selected log
 *    (was causing LogBox warning overlay spam in DevTools).
 * 2. .php/.html streams go to a plain WebView — NOT MPDPlayer.
 *    MPDPlayer is only used for actual .mpd DASH streams.
 * 3. PHP WebView gets PHP_WEBVIEW_INJECTED_JS:
 *    - One-time autoplay setup (playsinline, no aggressive pause-fight loops).
 *    - Posts 'playing' / 'buffering' messages to React Native for loading UI.
 *    - Gentle stall recovery only after 20s of no progress (no seek-back).
 * 4. StreamEngine.prepareStream is skipped for pure web-page streams.
 * 5. ONE source of truth for default quality: DEFAULT_PLAYBACK_HEIGHT = 360.
 * 6. bufferConfig tuned for smooth mobile playback.
 * 7. selectedVideoTrack locks ExoPlayer to 360p.
 * 8. maxBitRate caps ExoPlayer ABR at 800kbps for 360p.
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
import StreamEngine, { DEFAULT_START_HEIGHT, DEFAULT_START_BITRATE } from './StreamEngine';
import { getClearKeysForBrowser } from './shakaDash';
import MPDPlayer from './MPDPlayer';

const USER_PLAYBACK_ERROR =
  'Mafundi wetu wanahangaikia channel hii, itarejea hivi punde.';

let ExoPlayerConfig = null;
try { ExoPlayerConfig = require('../native/ExoPlayerConfig').default; } catch (_) {}

let WebView = null;
try { WebView = require('react-native-webview').WebView; } catch (_) {}

const NATIVE_USER_AGENT  = 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36';
const WEBVIEW_USER_AGENT = 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36';

const DEFAULT_PLAYBACK_HEIGHT = DEFAULT_START_HEIGHT; // 360

const BUFFER_CONFIG = {
  minBufferMs:                     3_000,
  maxBufferMs:                    25_000,
  bufferForPlaybackMs:             1_000,
  bufferForPlaybackAfterRebufferMs:2_500,
};

const STREAM_PATTERNS = {
  DASH:        ['.mpd', 'dash', '/manifest', '/manifest.mpd', '.mpd?', 'application/dash+xml'],
  HLS:         ['.m3u8', '.m3u', 'hls', 'playlist.m3u', 'application/vnd.apple.mpegurl', 'application/x-mpegurl'],
  PROGRESSIVE: ['.mp4', '.m4v', '.m4a', '.webm', '.mkv', '.avi', '.mov', '.flv', '.ts'],
};

function detectStreamFormat(url) {
  if (!url || typeof url !== 'string') return 'UNKNOWN';
  const u = url.toLowerCase();
  if (STREAM_PATTERNS.DASH.some(p => u.includes(p))) return 'DASH';
  if (STREAM_PATTERNS.HLS.some(p  => u.includes(p))) return 'HLS';
  if (STREAM_PATTERNS.PROGRESSIVE.some(p => u.includes(p))) return 'PROGRESSIVE';
  if (u.includes('/relay/stream') || u.includes('/relay/m3u8') || u.includes('/api/relay/')) return 'DASH';
  // Common IPTV live stream URL patterns (no file extension)
  // Port-based /live/ or /stream/ paths — Xtream Codes, MediaCP, Wowza, Nimble, etc.
  if (/^https?:\/\/[^/]+:\d{2,5}\/(live|stream|play|hls|iptv|channel|ch)\//.test(u)) return 'HLS';
  // Xtream Codes: host:port/user/pass/streamid  (exactly 3 path segments)
  if (/^https?:\/\/[^/]+:\d{2,5}\/[^/]+\/[^/]+\/[^/?#]+$/.test(u.split('#')[0])) return 'HLS';
  return 'UNKNOWN';
}

function getBitrateCap(height) {
  switch (height) {
    case 240:  return 400_000;
    case 360:  return 800_000;
    case 480:  return 1_400_000;
    case 720:  return 2_500_000;
    case 1080: return 4_000_000;
    default:   return 0;
  }
}

function normalizeAdminAudioLanguage(raw) {
  const lang = String(raw || 'sw').trim().toLowerCase();
  if (!lang || lang === 'auto' || lang === 'default') return 'sw';
  return lang === 'en' ? 'en' : 'sw';
}

function audioTrackMatches(trackLang, target) {
  const t = String(trackLang || '').toLowerCase();
  const aliases = target === 'en' ? ['en', 'eng'] : ['sw', 'swa'];
  return aliases.some((alias) => t === alias || t.startsWith(`${alias}-`));
}

function pickAudioTrackIndex(tracks, target) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const match = tracks.find((track) => audioTrackMatches(track.language, target));
  if (match && Number.isFinite(match.index)) return match.index;
  return target === 'en' ? null : 0;
}

function buildHeaders(streamSession, audioLanguage) {
  const h = new Map();
  if (streamSession.drmData?.headers) Object.entries(streamSession.drmData.headers).forEach(([k, v]) => h.set(k, v));
  if (streamSession.headers) Object.entries(streamSession.headers).forEach(([k, v]) => h.set(k, v));
  const lang = normalizeAdminAudioLanguage(audioLanguage);
  const acceptLanguage = lang === 'en'
    ? 'en-US,en;q=0.9,sw;q=0.8'
    : 'sw-TZ,sw;q=0.9,en;q=0.8';
  const std = {
    'Accept': '*/*', 'Accept-Language': acceptLanguage,
    'Accept-Encoding': 'gzip, deflate', 'Connection': 'keep-alive',
    'User-Agent': NATIVE_USER_AGENT,
  };
  Object.entries(std).forEach(([k, v]) => { if (!h.has(k)) h.set(k, v); });
  if (streamSession.token && !h.has('Authorization')) h.set('Authorization', `Bearer ${streamSession.token}`);
  const out = {};
  h.forEach((v, k) => { out[k] = v; });
  return out;
}

function hexToBase64Url(hex) {
  try {
    if (!hex || typeof hex !== 'string') return hex;
    const n = hex.trim().replace(/[^0-9a-fA-F]/g, '');
    if (!n.length || n.length % 2 !== 0) return hex;
    const bytes = [];
    for (let i = 0; i < n.length; i += 2) bytes.push(parseInt(n.substr(i, 2), 16));
    const bin = String.fromCharCode(...bytes);
    const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch (e) { return hex; }
}

function parseClearKeys(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const str = raw.trim();
  if (!str) return null;
  let kid = '', key = '';
  if (str.includes(':'))      { const p = str.split(':').map(s => s.trim()); kid = p[0]; key = p[1] || p[0]; }
  else if (str.includes(',')) { const p = str.split(',').map(s => s.trim()); kid = p[0]; key = p[1] || p[0]; }
  else { kid = str; key = str; }
  if (!kid || !key) return null;
  return { [hexToBase64Url(kid)]: hexToBase64Url(key) };
}

function normalizeClearKeyKeys(drmClearKey, drmData) {
  if (drmData?.keys?.length) {
    return drmData.keys.map((item) => {
      let kid = item.kid != null ? String(item.kid) : '';
      let k   = item.k   != null ? String(item.k)   : '';
      if (/^[0-9a-fA-F]{32,}$/.test(kid)) kid = hexToBase64Url(kid);
      if (/^[0-9a-fA-F]{32,}$/.test(k))   k   = hexToBase64Url(k);
      return { kty: item.kty || 'oct', kid: kid.replace(/=+$/,''), k: k.replace(/=+$/,'') };
    }).filter(item => item.kid && item.k);
  }
  if (drmClearKey) {
    const map = parseClearKeys(drmClearKey);
    if (!map) return null;
    return Object.entries(map).map(([kid, k]) => ({ kty: 'oct', kid, k }));
  }
  return null;
}

function buildClearKeyJwkJson(keys) {
  if (!keys?.length) return null;
  const clean = keys.map(k => ({ kty: k.kty||'oct', kid: String(k.kid).replace(/=+$/,''), k: String(k.k).replace(/=+$/,'') }));
  const jwk = { keys: clean, type: 'temporary' };
  if (__DEV__) console.log('[VideoPlayer] ClearKey JWK:', JSON.stringify(jwk, null, 2));
  return JSON.stringify(jwk);
}

function base64EncodeUtf8(str) {
  if (typeof str !== 'string') return '';
  try {
    return typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(str)))
      : Buffer.from(str, 'utf8').toString('base64');
  } catch { return ''; }
}

// ─── WebView autoplay JS (injected into .php / .html pages) ─────────────────
//
// Smooth playback: one-time setup, no pause-fight loops, no seek-back.
// Gentle recovery only after 20s stall — avoids repeating audio/video every second.
//
const PHP_WEBVIEW_INJECTED_JS = `
(function() {
  if (window.__eaMaxPhpPlayerStarted) return;
  window.__eaMaxPhpPlayerStarted = true;

  var POST = function(type, extra) {
    try {
      var msg = JSON.stringify(Object.assign({ type: type }, extra || {}));
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
    } catch(e) {}
  };

  var lastProgressAt = Date.now();
  var lastRecoveryAt = 0;

  function tryPlay(v) {
    if (!v || v.ended) return;
    try { var p = v.play(); if (p && p.catch) p.catch(function(){}); } catch(e) {}
  }

  function attachVideo(v) {
    if (!v || v.__rnAttached) return;
    v.__rnAttached = true;
    v.autoplay = true;
    v.muted = false;
    v.setAttribute('autoplay','');
    v.setAttribute('playsinline','');
    v.setAttribute('webkit-playsinline','');
    v.controls = false;
    v.removeAttribute('controls');

    v.addEventListener('playing', function(){ lastProgressAt = Date.now(); POST('playing'); });
    v.addEventListener('timeupdate', function(){ lastProgressAt = Date.now(); });
    v.addEventListener('waiting', function(){ POST('buffering', { isBuffering: true }); });
    v.addEventListener('canplay', function(){ POST('buffering', { isBuffering: false }); });
    v.addEventListener('ended', function(){ POST('ended'); });
    v.addEventListener('error', function(){ POST('error', { message: 'Video element error' }); });
    tryPlay(v);
  }

  function scanAndAttach() {
    var vs = document.querySelectorAll('video');
    for (var i = 0; i < vs.length; i++) attachVideo(vs[i]);
  }

  // Gentle stall recovery — play() only, never seek (seek causes repeat/stutter)
  setInterval(function() {
    var v = document.querySelector('video');
    if (!v || v.ended) return;
    var now = Date.now();
    if (now - lastProgressAt < 20000) return;
    if (now - lastRecoveryAt < 15000) return;
    lastRecoveryAt = now;
    tryPlay(v);
  }, 5000);

  if (window.MutationObserver) {
    new MutationObserver(function(){ scanAndAttach(); })
      .observe(document.documentElement, { childList: true, subtree: true });
  }

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Live Stream' });
      navigator.mediaSession.setActionHandler('play', function() {
        var v = document.querySelector('video'); if (v) tryPlay(v);
      });
      navigator.mediaSession.playbackState = 'playing';
    } catch(e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ scanAndAttach(); setTimeout(function(){ POST('ready'); }, 800); });
  } else {
    scanAndAttach();
    setTimeout(function(){ POST('ready'); }, 800);
  }
})();
true;
`;

// ─── Main Component ────────────────────────────────────────────────────────────

export default function VideoPlayer({
  visible, onClose, videoUrl, channelName,
  headers: customHeaders = {}, token, onUnlockChannel,
  channelId, userId, drmProtected, drmClearKey,
  drmData: drmDataProp, drmLicenseUrl, drmType: drmTypeProp,
  fetchChannelClearKey, sessionExpiry, onSessionExpired, onTrialUpdate,
  audioLanguage,
}) {
  const videoRef  = useRef(null);
  const webViewRef = useRef(null);

  const [paused,               setPaused]               = useState(false);
  const [loading,              setLoading]              = useState(true);
  const [loadingMsg,           setLoadingMsg]           = useState('Connecting…');
  const [error,                setError]                = useState(null);
  const [duration,             setDuration]             = useState(0);
  const [currentTime,          setCurrentTime]          = useState(0);
  const [useWebView,           setUseWebView]           = useState(false);
  const [sourceKey,            setSourceKey]            = useState(0);
  const [layoutSize,           setLayoutSize]           = useState({ width: 0, height: 0 });
  const [fetchedDrmClearKey,   setFetchedDrmClearKey]   = useState(null);
  const [drmSessionConfigured, setDrmSessionConfigured] = useState(false);
  const [trialRemaining,       setTrialRemaining]       = useState(null);
  const [isPremiumChannel,     setIsPremiumChannel]     = useState(false);
  const [showPaywall,          setShowPaywall]          = useState(false);
  const [preparedSource,       setPreparedSource]       = useState(null);
  const [forceTokenRefresh,    setForceTokenRefresh]    = useState(false);
  const [selectedAudioTrack,   setSelectedAudioTrack]   = useState(null);

  const recordedWatchRef         = useRef(null);
  const nativeLoadTimeoutRef     = useRef(null);
  const sessionCheckIntervalRef  = useRef(null);
  const trialTimerRef            = useRef(null);
  const lastPlaybackPositionRef  = useRef(0);
  const lastTrialUpdateRef       = useRef(Date.now());
  const manifestMalformedRetryRef = useRef(0);
  const playbackRetryCountRef    = useRef(0);

  // ─── Derived ─────────────────────────────────────────────────────────────

  const url    = videoUrl || '';
  const format = detectStreamFormat(url);
  const isMpd  = format === 'DASH' || /\.(mpd)(\?|$)/i.test(url);
  const isHls  = format === 'HLS';
  const isProgressive = format === 'PROGRESSIVE';

  const drmType            = (drmTypeProp ?? (drmProtected ? 'CLEARKEY' : 'NONE')).toUpperCase();
  const effectiveDrmClearKey = drmClearKey || fetchedDrmClearKey;
  const effectiveDrmData   = drmDataProp || null;
  const isClearKeyChannel  = drmType === 'CLEARKEY';
  const isWidevineChannel  = drmType === 'WIDEVINE' || drmType === 'WIDEVINE_L1' || drmType === 'WIDEVINE_L3';
  const isPlayReadyChannel = drmType === 'PLAYREADY';
  const isDrm              = isClearKeyChannel || isWidevineChannel || isPlayReadyChannel;

  // FIX: isWebPage ONLY for real HTML pages (.php/.html/.htm).
  // Unknown-format HTTP URLs (IPTV streams without extensions) must go to ExoPlayer first,
  // NOT a plain WebView — WebView cannot play raw video streams without MSE/HLS.js.
  const isWebPage = !isMpd && !isHls && !isProgressive && format === 'UNKNOWN' &&
    url.startsWith('http') && /\.(php|html|htm)(\?|$|#)/i.test(url);

  // FIX: startWithWebView only for .php/.html pages (NOT mpd — MPDPlayer handles those separately)
  const startWithWebView = !!(url && WebView && isWebPage);

  const drmWaitingForKey = !!(isClearKeyChannel && !effectiveDrmClearKey && !drmLicenseUrl && channelId && fetchChannelClearKey);

  const adminAudioLanguage = normalizeAdminAudioLanguage(audioLanguage);

  const streamSession = {
    mpdUrl: url, licenseUrl: drmLicenseUrl || '', token: token || '', drmType,
    drmData: { headers: customHeaders, keys: effectiveDrmClearKey ? [parseClearKeys(effectiveDrmClearKey)] : null },
    headers: customHeaders,
  };
  const mergedHeaders = buildHeaders(streamSession, adminAudioLanguage);

  // ─── Build video source ─────────────────────────────────────────────────

  const buildVideoSource = () => {
    if (!url) return null;
    const headers = { ...mergedHeaders };
    if (isMpd) { headers.Accept = 'application/dash+xml,application/xml,text/xml;q=0.9,*/*;q=0.8'; }
    const source = { uri: url, headers };
    if (isMpd)      { source.type = 'dash'; source.contentType = 'application/dash+xml'; }
    else if (isHls) { source.type = 'm3u8'; source.contentType = 'application/vnd.apple.mpegurl'; }
    else if (!isWebPage && !isProgressive && format === 'UNKNOWN') {
      // Default unknown-format streams to HLS — most IPTV live streams are HLS without a file extension.
      // ExoPlayer will attempt HLS; on failure the existing retry/WebView fallback chain runs.
      source.type = 'm3u8'; source.contentType = 'application/vnd.apple.mpegurl';
    }
    if (isClearKeyChannel && (effectiveDrmClearKey || effectiveDrmData?.keys?.length || drmLicenseUrl)) {
      const jwkKeys = normalizeClearKeyKeys(effectiveDrmClearKey, effectiveDrmData);
      if (jwkKeys?.length) {
        const jwkJson = buildClearKeyJwkJson(jwkKeys);
        if (jwkJson) source.drm = { type: 'clearkey', licenseServer: `data:application/json;base64,${base64EncodeUtf8(jwkJson)}`, headers: {} };
      } else if (drmLicenseUrl) {
        source.drm = { type: 'clearkey', licenseServer: drmLicenseUrl, headers };
      }
    } else if (isWidevineChannel && drmLicenseUrl) {
      source.drm = {
        type: 'widevine', licenseServer: drmLicenseUrl, headers: mergedHeaders,
        ...(drmType === 'WIDEVINE_L1' && { securityLevel: 'L1' }),
        ...(drmType === 'WIDEVINE_L3' && { securityLevel: 'L3' }),
      };
    } else if (isPlayReadyChannel && drmLicenseUrl) {
      source.drm = { type: 'playready', licenseServer: drmLicenseUrl, headers: mergedHeaders };
    }
    return source;
  };

  const legacySource = buildVideoSource();

  const source = (() => {
    const raw = preparedSource
      ? { uri: preparedSource.uri, type: preparedSource.type, contentType: preparedSource.contentType, headers: preparedSource.headers || {}, drm: preparedSource.drm }
      : legacySource;
    if (!raw) return null;
    const v = {
      uri: raw.uri,
      type: raw.type  || (isMpd ? 'dash' : isHls ? 'm3u8' : undefined),
      contentType: raw.contentType || (isMpd ? 'application/dash+xml' : isHls ? 'application/vnd.apple.mpegurl' : undefined),
      headers: raw.headers || {},
      drm: raw.drm,
    };
    if (__DEV__) console.log('[VideoPlayer] Final source:', {
      uri: v.uri ? `${String(v.uri).slice(0, 60)}…` : v.uri,
      type: v.type, contentType: v.contentType, hasDrm: !!v.drm,
      drmType: v.drm?.type,
      drmServer: v.drm?.licenseServer?.startsWith('data:') ? 'inline-base64' : 'url',
    });
    return v;
  })();

  // ─── Effects ─────────────────────────────────────────────────────────────

  // StreamEngine — skip for pure web-page streams
  useEffect(() => {
    if (!visible || !url) {
      if (!visible) setPreparedSource(null);
      return;
    }
    if (isWebPage && !isMpd) return; // plain WebView streams don't need prepareStream

    let cancelled = false;
    StreamEngine.prepareStream({
      url, channelId, drmType, drmClearKey: effectiveDrmClearKey, drmLicenseUrl,
      headers: customHeaders, token, forceTokenRefresh,
      refreshStreamApi: async (payload) => {
        try { const r = await userAPI.refreshStream(payload); return r?.url ?? r?.streamUrl ?? payload?.url; }
        catch (_) { return payload?.url; }
      },
    }).then(result => { if (!cancelled) { setPreparedSource(result); setForceTokenRefresh(false); } })
      .catch(() => { if (!cancelled) { setPreparedSource(null); setForceTokenRefresh(false); } });
    return () => { cancelled = true; };
  }, [visible, url, channelId, drmType, effectiveDrmClearKey, drmLicenseUrl, token, sourceKey, forceTokenRefresh]);

  // Native DRM session
  useEffect(() => {
    if (!visible || !url || !isDrm || !ExoPlayerConfig || drmSessionConfigured) return;
    (async () => {
      try {
        if (Platform.OS === 'android' && (isWidevineChannel || isPlayReadyChannel)) {
          await ExoPlayerConfig.configureDrmSession({ url, licenseUrl: drmLicenseUrl, drmType, headers: mergedHeaders });
          setDrmSessionConfigured(true);
        }
      } catch (err) { console.error('[VideoPlayer] Native DRM config failed:', err); }
    })();
  }, [visible, url, drmType, drmLicenseUrl, isDrm]);

  // Fetch ClearKey from API
  useEffect(() => {
    if (!visible || !channelId || drmType !== 'CLEARKEY' || drmClearKey || drmLicenseUrl || !fetchChannelClearKey) {
      if (!visible) setFetchedDrmClearKey(null);
      return;
    }
    let cancelled = false;
    fetchChannelClearKey(String(channelId))
      .then(data => { if (!cancelled) { const k = data?.drmClearKey ?? data?.drm_clear_key; if (k) setFetchedDrmClearKey(k); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visible, channelId, drmType, drmClearKey, fetchChannelClearKey]);

  // FIX: Dev log — console.log only (never console.warn — that triggers LogBox warning overlay)
  useEffect(() => {
    if (!visible || !url || !__DEV__) return;
    console.log('[VideoPlayer] stream config', {
      format, drmType, isMpd, isHls, isWebPage,
      clearKeyPresent: !!effectiveDrmClearKey,
      licenseUrlPresent: !!drmLicenseUrl,
      defaultHeight: DEFAULT_PLAYBACK_HEIGHT,
      maxBitRate: getBitrateCap(DEFAULT_PLAYBACK_HEIGHT),
    });
  }, [visible, url, format, drmType]);

  // FIX: Channel log — console.log NOT console.warn (warn = LogBox warning box)
  useEffect(() => {
    if (!visible || !__DEV__) return;
    console.log('[VideoPlayer] Channel selected:', JSON.stringify({
      channelId: channelId ?? null,
      channelName: channelName ?? null,
      streamUrl: url || '(empty)',
      drmType,
      clearkey: isClearKeyChannel ? (effectiveDrmClearKey || '(none)') : null,
      licenseUrl: drmLicenseUrl || null,
      defaultQuality: `${DEFAULT_PLAYBACK_HEIGHT}p`,
    }, null, 2));
  }, [visible, url, channelId, channelName, drmType]);

  // Player init / cleanup
  useEffect(() => {
    setPlayerVisible(visible);
    if (visible) {
      playbackRetryCountRef.current     = 0;
      manifestMalformedRetryRef.current = 0;
      setPaused(false); setLoading(true);
      setLoadingMsg(isDrm ? 'Initializing DRM…' : 'Connecting…');
      setError(null); setDuration(0); setCurrentTime(0);
      setSourceKey(prev => prev + 1);
      setUseWebView(startWithWebView);
      setDrmSessionConfigured(false);
      StatusBar.setHidden(true, 'fade');
      unlockAllOrientations();
      if (sessionExpiry) {
        sessionCheckIntervalRef.current = setInterval(() => {
          if (Math.floor(Date.now() / 1000) >= sessionExpiry - 30) {
            onSessionExpired?.(); clearInterval(sessionCheckIntervalRef.current);
          }
        }, 5000);
      }
    } else {
      if (nativeLoadTimeoutRef.current)    clearTimeout(nativeLoadTimeoutRef.current);
      if (sessionCheckIntervalRef.current) clearInterval(sessionCheckIntervalRef.current);
      if (trialTimerRef.current)           clearInterval(trialTimerRef.current);
      StatusBar.setHidden(false, 'fade'); lockToPortrait();
    }
    return () => {
      setPlayerVisible(false);
      if (sessionCheckIntervalRef.current) clearInterval(sessionCheckIntervalRef.current);
      if (trialTimerRef.current)           clearInterval(trialTimerRef.current);
    };
  }, [visible, url, startWithWebView]);

  // Native fallback timeout (skip for .php — WebView is the primary for those)
  useEffect(() => {
    if (!visible || !url || useWebView || isWebPage || !WebView || !loading) return;
    nativeLoadTimeoutRef.current = setTimeout(() => {
      if (!useWebView && loading) {
        setUseWebView(true); setError(null); setLoading(true);
        setLoadingMsg('Trying browser player…'); setSourceKey(prev => prev + 1);
      }
    }, 25000);
    return () => { if (nativeLoadTimeoutRef.current) clearTimeout(nativeLoadTimeoutRef.current); };
  }, [visible, url, useWebView, isWebPage, loading]);

  useEffect(() => {
    setSelectedAudioTrack(null);
  }, [adminAudioLanguage, sourceKey, url]);

  // Analytics
  useEffect(() => {
    if (!visible || !userId || !channelId) { if (!visible) recordedWatchRef.current = null; return; }
    const key = `${userId}-${channelId}`;
    if (recordedWatchRef.current === key) return;
    recordedWatchRef.current = key;
    userAPI.recordChannelWatch(userId, String(channelId)).catch(() => {});
  }, [visible, userId, channelId]);

  // Trial timer
  useEffect(() => {
    if (!visible || !isPremiumChannel || trialRemaining === null || trialRemaining <= 0) return;
    if (trialTimerRef.current) clearInterval(trialTimerRef.current);
    lastTrialUpdateRef.current = Date.now();
    trialTimerRef.current = setInterval(() => {
      if (!paused && !loading) {
        const now = Date.now();
        const elapsed = Math.floor((now - lastTrialUpdateRef.current) / 1000);
        if (elapsed > 0) {
          setTrialRemaining(prev => {
            const next = Math.max(0, prev - elapsed);
            onTrialUpdate?.(next);
            if (next <= 0) { setPaused(true); setShowPaywall(true); clearInterval(trialTimerRef.current); }
            return next;
          });
          lastTrialUpdateRef.current = now;
        }
      } else { lastTrialUpdateRef.current = Date.now(); }
    }, 1000);
    return () => { if (trialTimerRef.current) clearInterval(trialTimerRef.current); };
  }, [visible, isPremiumChannel, trialRemaining, paused, loading]);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const onLoad = useCallback((data) => {
    manifestMalformedRetryRef.current = 0; playbackRetryCountRef.current = 0;
    if (__DEV__) console.log('[VideoPlayer] onLoad', { format, duration: data?.duration });
    setLoading(false); setError(null); setDuration(data?.duration || 0);
    if (nativeLoadTimeoutRef.current) clearTimeout(nativeLoadTimeoutRef.current);
    const tracks = data?.audioTracks;
    if (Array.isArray(tracks) && tracks.length > 0) {
      const idx = pickAudioTrackIndex(tracks, adminAudioLanguage);
      if (idx != null) {
        setSelectedAudioTrack({ type: 'index', value: idx });
      } else {
        setSelectedAudioTrack({ type: 'language', value: adminAudioLanguage });
      }
    } else {
      setSelectedAudioTrack({ type: 'language', value: adminAudioLanguage });
    }
  }, [format, adminAudioLanguage]);

  const onReadyForDisplay = useCallback(() => { setLoading(false); }, []);
  const onProgress = useCallback((ev) => { setCurrentTime(ev?.currentTime ?? 0); lastPlaybackPositionRef.current = ev?.currentTime ?? 0; }, []);
  const onBuffer = useCallback((ev) => { const b = !!ev?.isBuffering; setLoading(b); if (b) setLoadingMsg('Buffering…'); }, []);

  const onError = useCallback((ev) => {
    const errorCode   = ev?.error?.errorCode;
    const errorString = ev?.error?.errorString || ev?.message || 'Unknown error';
    if (__DEV__) console.log('[VideoPlayer] onError', { errorCode, errorString });

    if (errorCode === 'ERROR_CODE_PARSING_MANIFEST_MALFORMED' && manifestMalformedRetryRef.current < 4) {
      manifestMalformedRetryRef.current++;
      setError(null); setLoading(true); setLoadingMsg('Retrying stream…');
      setSourceKey(prev => prev + 1); return;
    }

    const errorMessage = StreamEngine.classifyError(errorCode, errorString);

    if (playbackRetryCountRef.current < StreamEngine.MAX_RETRIES) {
      playbackRetryCountRef.current++;
      const step = StreamEngine.getRetryStep(playbackRetryCountRef.current);
      if (step === 'reload') { setError(null); setLoading(true); setLoadingMsg('Retrying…'); setSourceKey(prev => prev + 1); return; }
      if (step === 'refresh_token') { setError(null); setLoading(true); setLoadingMsg('Refreshing stream…'); setForceTokenRefresh(true); setSourceKey(prev => prev + 1); return; }
      if (step === 'switch_player' && !useWebView && WebView) { setUseWebView(true); setError(null); setLoading(true); setLoadingMsg('Trying browser player…'); setSourceKey(prev => prev + 1); return; }
    }
    setError(errorMessage); setLoading(false);
  }, [isDrm, useWebView]);

  const onEnd = useCallback(() => { setPaused(true); }, []);

  const handleRetry = useCallback(() => {
    setError(null); setLoading(true); setLoadingMsg('Reconnecting…');
    setPaused(false); playbackRetryCountRef.current = 0; manifestMalformedRetryRef.current = 0;
    setSourceKey(prev => prev + 1);
  }, []);

  const switchToWebView = useCallback(() => {
    setUseWebView(true); setError(null); setLoading(true);
    setLoadingMsg('Switching to browser player…'); setSourceKey(prev => prev + 1);
  }, []);

  const handleClose = useCallback(() => { setPaused(true); onClose(); }, [onClose]);

  const handleWebViewMessage = useCallback((e) => {
    try {
      const data = JSON.parse(e.nativeEvent?.data ?? '{}');
      if (data.type === 'playing') { setLoading(false); setError(null); }
      if (data.type === 'ready')   { setLoading(false); setError(null); }
      if (data.type === 'buffering') { setLoading(!!data.isBuffering); }
      if (data.type === 'error')   { setError(USER_PLAYBACK_ERROR); setLoading(false); }
    } catch (_) {}
  }, []);

  const onLayout = useCallback((e) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w > 0 && h > 0) setLayoutSize({ width: w, height: h });
  }, []);

  const win     = Dimensions.get('window');
  const hasLayout = layoutSize.width > 0 && layoutSize.height > 0;
  const width   = hasLayout ? layoutSize.width  : win.width;
  const height  = hasLayout ? layoutSize.height : win.height;
  const videoStyle = [styles.video, { width, height }];
  const cappedBitRate = getBitrateCap(DEFAULT_PLAYBACK_HEIGHT);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent={false} animationType="none" statusBarTranslucent onRequestClose={handleClose} supportedOrientations={['landscape', 'portrait']}>
      <View style={styles.root} onLayout={onLayout} collapsable={false}>

        {/* CASE 1: DASH .mpd → MPDPlayer (Shaka in WebView) */}
        {url && useWebView && isMpd && WebView ? (
          <MPDPlayer
            key={`mpd-${sourceKey}-h${DEFAULT_PLAYBACK_HEIGHT}`}
            url={url} headers={mergedHeaders}
            drmClearKey={effectiveDrmClearKey} drmLicenseUrl={drmLicenseUrl} drmType={drmType}
            onClose={handleClose}
            onError={() => { setError(USER_PLAYBACK_ERROR); setLoading(false); }}
            onPlaying={() => { setLoading(false); setError(null); }}
            onBuffering={(b) => setLoading(b)}
            style={videoStyle} maxHeight={DEFAULT_PLAYBACK_HEIGHT}
          />

        /* CASE 2: .php / .html → plain WebView with autoplay keepalive JS */
        ) : url && useWebView && isWebPage && WebView ? (
          <WebView
            key={`wv-php-${sourceKey}`}
            ref={webViewRef}
            source={{ uri: url }}
            style={videoStyle}
            userAgent={WEBVIEW_USER_AGENT}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={['*']}
            mixedContentMode="always"
            allowsFullscreenVideo={false}
            injectedJavaScript={PHP_WEBVIEW_INJECTED_JS}
            onMessage={handleWebViewMessage}
            onError={() => setError(USER_PLAYBACK_ERROR)}
          />

        /* CASE 3: Waiting for DRM key */
        ) : drmWaitingForKey ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingMsg}>Fetching DRM keys…</Text>
          </View>

        /* CASE 4: Layout not ready */
        ) : source && !hasLayout ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingMsg}>Preparing…</Text>
          </View>

        /* CASE 5: Native ExoPlayer */
        ) : source && hasLayout ? (
          <Video
            key={`video-${sourceKey}-${adminAudioLanguage}`}
            ref={videoRef} source={source} style={videoStyle}
            resizeMode="contain" paused={paused} controls={false}
            selectedVideoTrack={{ type: 'resolution', value: DEFAULT_PLAYBACK_HEIGHT }}
            selectedAudioTrack={
              selectedAudioTrack || { type: 'language', value: adminAudioLanguage }
            }
            bufferConfig={BUFFER_CONFIG}
            onLoad={onLoad} onReadyForDisplay={onReadyForDisplay}
            onProgress={onProgress} onBuffer={onBuffer}
            onError={onError} onEnd={onEnd}
            minLoadRetryCount={3}
            maxBitRate={cappedBitRate}
            reportBandwidth={true}
            disableFocus={false}
            ignoreSilentSwitch="ignore"
            playInBackground={false}
            automaticallyWaitsToMinimizeStalling={true}
            useTextureView={true}
            renderToHardwareTextureAndroid={true}
            androidHardwareAccelerationDisabled={false}
            progressUpdateInterval={500}
            preferredForwardBufferDuration={30}
            rate={1.0}
            disableDisconnectError={true}
          />
        ) : (
          <View style={styles.noSource}>
            <Icon name="video-off" size={48} color="#6b7280" />
            <Text style={styles.noSourceText}>No stream URL</Text>
          </View>
        )}

        {source && hasLayout && !useWebView && (
          <TouchableOpacity style={[StyleSheet.absoluteFill, styles.tapOverlay]} onPress={() => setPaused(p => !p)} activeOpacity={1} />
        )}

        <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.8}>
          <Icon name="close" size={28} color="#fff" />
        </TouchableOpacity>

        {showPaywall && (
          <View style={styles.paywallOverlay}>
            <View style={styles.paywallCard}>
              <Icon name="lock" size={48} color="#fff" />
              <Text style={styles.paywallTitle}>Trial Expired</Text>
              <Text style={styles.paywallText}>Subscribe to continue watching.</Text>
              <TouchableOpacity style={styles.subscribeBtn} onPress={() => { setShowPaywall(false); onUnlockChannel?.(); }}>
                <Text style={styles.subscribeBtnText}>Subscribe Now</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.paywallCloseBtn} onPress={handleClose}>
                <Text style={styles.paywallCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {isPremiumChannel && trialRemaining !== null && trialRemaining > 0 && !showPaywall && (
          <View style={styles.trialOverlay}>
            <View style={styles.trialBadge}>
              <Icon name="clock-outline" size={16} color="#fff" />
              <Text style={styles.trialText}>Trial: {Math.floor(trialRemaining / 60)}:{(trialRemaining % 60).toString().padStart(2, '0')}</Text>
            </View>
          </View>
        )}

        {(loading || ((isWidevineChannel || isPlayReadyChannel) && !drmSessionConfigured)) && !error && !(useWebView && isMpd) && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingMsg}>
              {(isWidevineChannel || isPlayReadyChannel) && !drmSessionConfigured ? 'Configuring DRM…' : loadingMsg}
            </Text>
          </View>
        )}

        {error && (
          <View style={styles.errorOverlay}>
            <View style={styles.errorCard}>
              <Icon name="alert-circle" size={40} color="#fff" />
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
              <TouchableOpacity style={styles.closeErrBtn} onPress={handleClose}>
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
  root:        { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 9999, elevation: 9999 },
  video:       { position: 'absolute', top: 0, left: 0 },
  tapOverlay:  { zIndex: 9998 },
  closeBtn: {
    position: 'absolute', top: Platform.OS === 'ios' ? 50 : 20, right: 20,
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center', zIndex: 99999,
  },
  noSource:     { flex: 1, justifyContent: 'center', alignItems: 'center' },
  noSourceText: { color: '#888', fontSize: 16 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', gap: 12, zIndex: 9997 },
  loadingMsg: { color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: '500' },
  errorOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.9)' },
  errorCard:  { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 28, maxWidth: 320 },
  errorTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  errorMsg:   { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  retryBtn:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 12, marginTop: 20, gap: 8 },
  retryText:  { color: '#000', fontSize: 15, fontWeight: '600' },
  webviewBtn: { marginTop: 10, paddingVertical: 10 },
  webviewBtnText: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  closeErrBtn:  { marginTop: 16, paddingVertical: 8 },
  closeErrText: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  trialOverlay: { position: 'absolute', top: Platform.OS === 'ios' ? 100 : 70, left: 20, zIndex: 99998 },
  trialBadge:   { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 6 },
  trialText:    { color: '#fff', fontSize: 14, fontWeight: '600' },
  paywallOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center', zIndex: 100000 },
  paywallCard:  { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 28, maxWidth: 320 },
  paywallTitle: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  paywallText:  { color: 'rgba(255,255,255,0.8)', fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  subscribeBtn: { backgroundColor: '#22c55e', borderRadius: 8, paddingHorizontal: 32, paddingVertical: 14, marginBottom: 12 },
  subscribeBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  paywallCloseBtn: { paddingVertical: 8 },
  paywallCloseText: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
});
