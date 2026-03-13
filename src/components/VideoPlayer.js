/**
 * VideoPlayer - React Native
 * COMPLETE REWRITE v2.0 - Matches Flutter/Kotlin ExoPlayerEngine functionality
 * 
 * Features:
 * - Full DRM support (Widevine L1/L3, PlayReady, ClearKey)
 * - Proper MIME type handling for all formats
 * - Native ExoPlayer configuration via module
 * - Automatic format detection
 * - Proper header management with priority system
 * - Session refresh and token management
 * - Trial timer support
 * - Quality selection with ABR
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
  Alert,
} from 'react-native';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { lockToPortrait, unlockAllOrientations, setPlayerVisible } from '../utils/orientation';
import { userAPI } from '../config/api';
import StreamEngine from '../engine/StreamEngine';

// Optional native module for Widevine/PlayReady DRM config (not needed for ClearKey)
let ExoPlayerConfig = null;
try {
  ExoPlayerConfig = require('../native/ExoPlayerConfig').default;
} catch (_) {
  // Module not present – playback uses react-native-video DRM (ClearKey, license server)
}

let WebView = null;
try {
  WebView = require('react-native-webview').WebView;
} catch (_) { }

// ─── Constants (ExoPlayer / Shaka / OTT-style) ─────────────────────────────
const NATIVE_USER_AGENT = 'ExoPlayerLib/2.18.0 (Linux;Android 11) ReactNativeVideo/3.0';
const WEBVIEW_USER_AGENT = 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36 ExoPlayerLib/2.18';

// Buffer configuration (matches Kotlin)
const MIN_BUFFER_MS = 15000;
const MAX_BUFFER_MS = 50000;
const BUFFER_FOR_PLAYBACK_MS = 2500;
const BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS = 5000;

// Timeout configuration
const CONNECT_TIMEOUT_MS = 30000;
const READ_TIMEOUT_MS = 30000;

// DRM UUIDs (matches Kotlin)
const DRM_UUIDS = {
  WIDEVINE: 'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed',
  PLAYREADY: '9a04f079-9840-4286-ab92-e65be0885f95',
  CLEARKEY: '1077efec-c0b2-4d02-ace3-3c1e52e2fb4b',
};

// Stream format detection (DASH: .mpd, query params, manifest path)
const STREAM_PATTERNS = {
  DASH: ['.mpd', 'dash', '/manifest', '/manifest.mpd', '.mpd?', 'application/dash+xml'],
  HLS: ['.m3u8', '.m3u', 'hls', 'playlist.m3u', 'application/vnd.apple.mpegurl', 'application/x-mpegurl'],
  PROGRESSIVE: ['.mp4', '.m4v', '.m4a', '.webm', '.mkv', '.avi', '.mov', '.flv', '.ts'],
};

// Quality options (matches Kotlin StreamQuality enum)
const QUALITY_OPTIONS = [
  { label: 'Auto (ABR)', value: 0, height: 0 },
  { label: '240p', value: 240, height: 240 },
  { label: '360p (inapendekezwa)', value: 360, height: 360 },
  { label: '480p', value: 480, height: 480 },
  { label: '720p', value: 720, height: 720 },
  { label: '1080p', value: 1080, height: 1080 },
];

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Detects stream format based on URL patterns (matches Kotlin detectStreamFormat)
 */
function detectStreamFormat(url) {
  if (!url || typeof url !== 'string') return 'UNKNOWN';
  
  const urlLower = url.toLowerCase();
  
  // DASH detection
  if (STREAM_PATTERNS.DASH.some(pattern => urlLower.includes(pattern))) {
    return 'DASH';
  }
  
  // HLS detection
  if (STREAM_PATTERNS.HLS.some(pattern => urlLower.includes(pattern))) {
    return 'HLS';
  }
  
  // Progressive detection
  if (STREAM_PATTERNS.PROGRESSIVE.some(pattern => urlLower.includes(pattern))) {
    return 'PROGRESSIVE';
  }
  
  // Relay/proxy detection
  if (urlLower.includes('/relay/stream') || urlLower.includes('/relay/m3u8') || urlLower.includes('/api/relay/')) {
    return 'DASH';
  }
  
  return 'UNKNOWN'; // Don't assume DASH - wrong type causes "play error" / PARSING_MANIFEST_MALFORMED
}

/**
 * Builds complete headers with priority system (matches Kotlin buildHeaders)
 */
function buildHeaders(streamSession) {
  const headers = new Map();
  
  // Priority 1: Add DRM-specific headers first (highest priority)
  if (streamSession.drmData?.headers) {
    Object.entries(streamSession.drmData.headers).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }
  
  // Priority 2: Add session-level headers
  if (streamSession.headers) {
    Object.entries(streamSession.headers).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }
  
  // Priority 3: Add standard headers (lowest priority)
  const standardHeaders = {
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    'Connection': 'keep-alive',
    'User-Agent': NATIVE_USER_AGENT,
  };
  
  Object.entries(standardHeaders).forEach(([key, value]) => {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  });
  
  // Priority 4: Add authorization token
  if (streamSession.token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${streamSession.token}`);
  }
  
  // Convert Map to object
  const headerObj = {};
  headers.forEach((value, key) => {
    headerObj[key] = value;
  });
  
  return headerObj;
}

/** Hex → base64url (for ExoPlayer/native ClearKey JWK). */
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
    const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch {
    return hexString;
  }
}

/** Hex → base64 with padding (for browser Shaka clearKeys). Do not remove padding. */
function hexToBase64(hexString) {
  try {
    if (!hexString || typeof hexString !== 'string') return hexString;
    const normalized = hexString.trim();
    if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) return hexString;
    const bytes = [];
    for (let i = 0; i < normalized.length; i += 2) {
      bytes.push(parseInt(normalized.substr(i, 2), 16));
    }
    const bin = String.fromCharCode(...bytes);
    return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  } catch {
    return hexString;
  }
}

/** ClearKey string (kid:key hex) → map for Shaka: { "KID_BASE64": "KEY_BASE64" } (standard base64, with padding). */
function getClearKeysForBrowser(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const str = raw.trim();
  if (!str) return null;
  let kid = '';
  let key = '';
  if (str.includes(':')) {
    const parts = str.split(':').map(s => s.trim());
    kid = parts[0];
    key = parts[1] || parts[0];
  } else if (str.includes(',')) {
    const parts = str.split(',').map(s => s.trim());
    kid = parts[0];
    key = parts[1] || parts[0];
  } else {
    kid = str;
    key = str;
  }
  if (!kid || !key) return null;
  return { [hexToBase64(kid)]: hexToBase64(key) };
}

/**
 * Parse ClearKey string into key map (matches Kotlin buildClearKeyJson)
 */
function parseClearKeys(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const str = raw.trim();
  if (!str) return null;

  let kid = '';
  let key = '';
  if (str.includes(':')) {
    const parts = str.split(':').map(s => s.trim());
    kid = parts[0];
    key = parts[1] || parts[0];
  } else if (str.includes(',')) {
    const parts = str.split(',').map(s => s.trim());
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

/**
 * Build ClearKey JWK JSON (matches Kotlin buildClearKeyJson)
 */
function buildClearKeyJwkJson(clearKeysMap) {
  if (!clearKeysMap || typeof clearKeysMap !== 'object') return null;
  const keys = Object.entries(clearKeysMap).map(([kid, k]) => ({ 
    kty: 'oct', 
    kid, 
    k 
  }));
  if (keys.length === 0) return null;
  return JSON.stringify({ keys, type: 'temporary' });
}

/**
 * Build DASH HTML for WebView fallback using Shaka Player (DASH + DRM: ClearKey, Widevine, license server, headers).
 * clearKeys: { "KID_BASE64": "KEY_BASE64" } (standard base64 with padding).
 * licenseServer + requestHeaders: for Widevine/PlayReady.
 */
function buildShakaDashHtml(url, headers = {}, drmConfig = {}) {
  if (!url) return '<html><body style="background:#000;color:#fff;">Missing MPD URL</body></html>';
  const encodedUrl = encodeURIComponent(url);
  const headerStr = JSON.stringify(headers || {});
  const clearKeysStr = JSON.stringify(drmConfig.clearKeys || {});
  const licenseUrl = drmConfig.licenseUrl || '';
  const licenseHeadersStr = JSON.stringify(drmConfig.licenseHeaders || {});
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
  <title>DASH Player</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.6/shaka-player.compiled.js"></script>
  <style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}#videoPlayer{width:100%;height:100%;background:#000}</style>
</head>
<body>
  <video id="videoPlayer" controls autoplay playsinline></video>
  <script>
    (function() {
      function post(type, data) {
        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage)
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, ...(data || {}) }));
        } catch (e) {}
      }
      function mapError(code, msg) {
        if (code === 2 || (msg && msg.toLowerCase().includes('network'))) return 'Internet connection failed';
        if (code === 3 || (msg && msg.toLowerCase().includes('manifest'))) return 'Stream manifest corrupted';
        if (code === 4 || (msg && msg.toLowerCase().includes('drm') || msg && msg.toLowerCase().includes('license'))) return 'Stream authorization failed';
        if (code === 5 || (msg && msg.toLowerCase().includes('decode'))) return 'Device cannot decode video';
        return msg || 'Playback failed in browser';
      }
      var mpdUrl = decodeURIComponent('${encodedUrl}');
      var requestHeaders = ${headerStr};
      var clearKeys = ${clearKeysStr};
      var licenseUrl = ${JSON.stringify(licenseUrl)};
      var licenseHeaders = ${licenseHeadersStr};
      var video = document.getElementById('videoPlayer');
      if (!video || !window.shaka) {
        post('error', { message: 'Shaka Player not loaded' });
        return;
      }
      shaka.polyfill.installAll();
      var player = new shaka.Player(video);
      var networkingEngine = player.getNetworkingEngine();
      networkingEngine.registerRequestFilter(function(type, request) {
        request.allowCrossSiteCredentials = true;
        if (type === shaka.net.NetworkingEngine.RequestType.MANIFEST) {
          request.headers['Accept'] = request.headers['Accept'] || 'application/dash+xml, application/xml, text/xml, */*';
          request.headers['User-Agent'] = request.headers['User-Agent'] || 'ExoPlayerLib/2.18 (Linux; Android 11)';
        }
        var h = requestHeaders || {};
        Object.keys(h).forEach(function(k) {
          if (h[k] != null) request.headers[k] = String(h[k]);
        });
        if (licenseUrl && licenseHeaders && type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
          Object.keys(licenseHeaders).forEach(function(k) {
            if (licenseHeaders[k] != null) request.headers[k] = String(licenseHeaders[k]);
          });
        }
      });
      if (clearKeys && Object.keys(clearKeys).length > 0) {
        console.log('[Shaka] Using ClearKey DRM with keys:', clearKeys);
      }
      var config = {
        streaming: {
          bufferingGoal: 50,
          rebufferingGoal: 5,
          bufferBehind: 50,
        },
        drm: {}
      };
      if (clearKeys && Object.keys(clearKeys).length > 0) {
        config.drm.clearKeys = clearKeys;
      }
      if (licenseUrl) {
        config.drm.servers = { 'com.widevine.alpha': licenseUrl, 'com.microsoft.playready': licenseUrl };
      }
      player.configure(config);
      player.load(mpdUrl).then(function() {
        post('ready');
      }).catch(function(e) {
        var msg = mapError(e.code, e.message || e.data);
        // Shaka 1002 = manifest parse error. Ask React Native side to fallback to native player instead of staying broken.
        if (e.code === 1002) {
          post('fallback', { message: msg, code: e.code });
        } else {
          post('error', { message: msg, code: e.code });
        }
      });
      video.addEventListener('playing', function() { post('playing'); });
      video.addEventListener('ended', function() { post('ended'); });
      video.addEventListener('error', function() { post('error', { message: 'Video element error' }); });
    })();
  </script>
</body>
</html>`;
}

// ─── Main Component ─────────────────────────────────────────────────────────

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
  drmType: drmTypeProp,
  fetchChannelClearKey,
  sessionExpiry, // Unix timestamp in seconds
  onSessionExpired,
  onTrialUpdate,
}) {
  // ─── State Management ───────────────────────────────────────────────────
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
  const [selectedQuality, setSelectedQuality] = useState(
    QUALITY_OPTIONS.find((q) => q.value === 360) || QUALITY_OPTIONS[0]
  ); // 360p (inapendekezwa) by default
  const [qualityModalVisible, setQualityModalVisible] = useState(false);
  const [fetchedDrmClearKey, setFetchedDrmClearKey] = useState(null);
  const [drmSessionConfigured, setDrmSessionConfigured] = useState(false);
  const [trialRemaining, setTrialRemaining] = useState(null);
  const [trialTotal, setTrialTotal] = useState(null);
  const [isPremiumChannel, setIsPremiumChannel] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [preparedSource, setPreparedSource] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState(null);
  const [forceTokenRefresh, setForceTokenRefresh] = useState(false);
  
  // Refs for timeouts and tracking
  const recordedWatchRef = useRef(null);
  const nativeLoadTimeoutRef = useRef(null);
  const sessionCheckIntervalRef = useRef(null);
  const trialTimerRef = useRef(null);
  const lastPlaybackPositionRef = useRef(0);
  const lastTrialUpdateRef = useRef(Date.now());
  const manifestMalformedRetryRef = useRef(0); // retry once on PARSING_MANIFEST_MALFORMED
  const playbackRetryCountRef = useRef(0);
  const rotateHintAnimRef = useRef(new Animated.Value(0));

  // ─── Derived Values ─────────────────────────────────────────────────────
  const url = videoUrl || '';
  const format = detectStreamFormat(url);
  const isMpd = format === 'DASH' || (url && (url.toLowerCase().includes('.mpd') || /\/manifest\.mpd|\.mpd\?/i.test(url)));
  const isHls = format === 'HLS';
  const isProgressive = format === 'PROGRESSIVE';
  
  // DRM handling
  const drmType = (drmTypeProp ?? (drmProtected ? 'CLEARKEY' : 'NONE')).toUpperCase();
  const effectiveDrmClearKey = drmClearKey || fetchedDrmClearKey;
  const isClearKeyChannel = drmType === 'CLEARKEY';
  const isWidevineChannel = drmType === 'WIDEVINE' || drmType === 'WIDEVINE_L1' || drmType === 'WIDEVINE_L3';
  const isPlayReadyChannel = drmType === 'PLAYREADY';
  const isDrm = isClearKeyChannel || isWidevineChannel || isPlayReadyChannel;
  
  // Check if this is a web page that needs WebView
  const isWebPage = url.includes('.php') || url.includes('.html') || 
    (url.startsWith('http') && !isMpd && !isHls && !isProgressive);
  
  // Use WebView (Shaka) for:
  // - Non-DRM web pages / special URLs
  // - ClearKey DASH streams (.mpd) where Shaka can handle ClearKey reliably
  const startWithWebView = !!(
    url &&
    WebView &&
    (
      (isWebPage && !isDrm) ||
      (isClearKeyChannel && isMpd)
    )
  );

  // When ClearKey channel has no key yet and we can fetch it, wait so we don't start playback without DRM
  const drmWaitingForKey = !!(
    isClearKeyChannel &&
    !effectiveDrmClearKey &&
    !drmLicenseUrl &&
    channelId &&
    fetchChannelClearKey
  );

  // Build complete headers with priority system
  const streamSession = {
    mpdUrl: url,
    licenseUrl: drmLicenseUrl || '',
    token: token || '',
    drmType,
    drmData: {
      headers: customHeaders,
      keys: effectiveDrmClearKey ? [parseClearKeys(effectiveDrmClearKey)] : null,
    },
    headers: customHeaders,
  };
  
  const mergedHeaders = buildHeaders(streamSession);

  // Build video source with proper configuration (avoids PARSING_MANIFEST_MALFORMED for .mpd + ClearKey)
  const buildVideoSource = () => {
    if (!url) return null;

    // .mpd: Accept must request DASH XML so server returns manifest (not HTML) → avoids PARSING_MANIFEST_MALFORMED
    const headers = { ...mergedHeaders };
    if (isMpd) {
      headers.Accept = 'application/dash+xml, application/xml, text/xml, */*';
      headers['User-Agent'] = headers['User-Agent'] || NATIVE_USER_AGENT;
    }

    const source = { uri: url, headers };

    // Required for ExoPlayer: type forces DASH so manifest is parsed correctly (no PARSING_MANIFEST_MALFORMED)
    if (isMpd) source.type = 'mpd';
    else if (isHls) source.type = 'm3u8';

    // ClearKey from admin: prefer inline key (licenseResponse) so native uses LocalMediaDrmCallback like Flutter
    if (isClearKeyChannel && (effectiveDrmClearKey || drmLicenseUrl)) {
      const clearKeysMap = effectiveDrmClearKey ? parseClearKeys(effectiveDrmClearKey) : null;
      const licenseResponseJson = clearKeysMap ? buildClearKeyJwkJson(clearKeysMap) : null;
      if (licenseResponseJson) {
        source.drm = { type: 'clearkey', licenseResponse: licenseResponseJson };
      } else if (drmLicenseUrl) {
        source.drm = { type: 'clearkey', licenseServer: drmLicenseUrl, headers };
      }
    } else if (isWidevineChannel && drmLicenseUrl) {
      source.drm = {
        type: 'widevine',
        licenseServer: drmLicenseUrl,
        headers: mergedHeaders,
        ...(drmType === 'WIDEVINE_L1' && { securityLevel: 'L1' }),
        ...(drmType === 'WIDEVINE_L3' && { securityLevel: 'L3' }),
      };
    } else if (isPlayReadyChannel && drmLicenseUrl) {
      source.drm = { type: 'playready', licenseServer: drmLicenseUrl, headers: mergedHeaders };
    }

    return source;
  };

  const legacySource = buildVideoSource();

  // StreamEngine: single entry point — prepare stream (analyze, validate, headers, DRM, cache)
  // NOTE: For DRM streams we always use the legacy native path to avoid native crashes on some .mpd DRM URLs.
  const source = !isDrm && preparedSource
    ? {
        uri: preparedSource.uri,
        type: preparedSource.type,
        headers: preparedSource.headers || {},
        drm: preparedSource.drm,
      }
    : legacySource;

  // Browser (Shaka) DRM config: clearKeys (base64 with padding) or license server + headers
  const browserDrmConfig = (() => {
    if (isClearKeyChannel && effectiveDrmClearKey) {
      const clearKeys = getClearKeysForBrowser(effectiveDrmClearKey);
      return clearKeys ? { clearKeys } : (drmLicenseUrl ? { licenseUrl: drmLicenseUrl, licenseHeaders: mergedHeaders } : {});
    }
    if ((isWidevineChannel || isPlayReadyChannel || (isClearKeyChannel && drmLicenseUrl)) && drmLicenseUrl) {
      return { licenseUrl: drmLicenseUrl, licenseHeaders: mergedHeaders };
    }
    return {};
  })();

  // ─── Effects ────────────────────────────────────────────────────────────

  // StreamEngine.prepareStream: analyze → validate → headers → token refresh → manifest repair → cache
  // Note: customHeaders omitted from deps to avoid "Maximum update depth" — object ref often changes every render.
  // For DRM streams we skip StreamEngine and use the legacy source directly to keep ExoPlayer path simple and stable.
  useEffect(() => {
    if (!visible || !url || isDrm) {
      if (!visible) {
        setPreparedSource(null);
        setPrepareError(null);
        setPreparing(false);
      }
      return;
    }
    let cancelled = false;
    setPreparing(true);
    setPrepareError(null);
    const streamData = {
      url,
      channelId,
      drmType,
      drmClearKey: effectiveDrmClearKey,
      drmLicenseUrl,
      headers: customHeaders,
      token,
      forceTokenRefresh,
      refreshStreamApi: async (payload) => {
        try {
          const r = await userAPI.refreshStream(payload);
          return r?.url ?? r?.streamUrl ?? payload?.url;
        } catch (_) {
          return payload?.url;
        }
      },
    };
    StreamEngine.prepareStream(streamData)
      .then((result) => {
        if (cancelled) return;
        setPreparedSource(result);
        setPreparing(false);
        setPrepareError(null);
        setForceTokenRefresh(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setPrepareError(e?.message || 'Failed to prepare stream');
        setPreparing(false);
        setPreparedSource(null);
        setForceTokenRefresh(false);
      });
    return () => { cancelled = true; };
  }, [visible, url, channelId, drmType, effectiveDrmClearKey, drmLicenseUrl, token, sourceKey, forceTokenRefresh, isDrm]);

  // Configure native ExoPlayer with DRM session
  useEffect(() => {
    if (!visible || !url || !isDrm || !ExoPlayerConfig || drmSessionConfigured) return;
    
    const configureNativeDrm = async () => {
      try {
        if (Platform.OS === 'android' && (isWidevineChannel || isPlayReadyChannel)) {
          await ExoPlayerConfig.configureDrmSession({
            url,
            licenseUrl: drmLicenseUrl,
            drmType,
            headers: mergedHeaders,
          });
          setDrmSessionConfigured(true);
        }
      } catch (error) {
        console.error('Native DRM configuration failed:', error);
        // Continue anyway - may still work
      }
    };

    configureNativeDrm();
  }, [visible, url, drmType, drmLicenseUrl, isDrm]);

  // Fetch ClearKey if needed
  useEffect(() => {
    if (!visible || !channelId || drmType !== 'CLEARKEY' || drmClearKey || drmLicenseUrl || !fetchChannelClearKey) {
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
  }, [visible, channelId, drmType, drmClearKey, fetchChannelClearKey]);

  // Playback diagnostics (format, DRM, headers, keys)
  useEffect(() => {
    if (!visible || !url) return;
    const hasKey = !!(effectiveDrmClearKey || drmLicenseUrl);
    if (__DEV__) {
      console.log('[VideoPlayer] stream', {
        format,
        drmType,
        isMpd,
        isHls,
        headersUsed: !!Object.keys(mergedHeaders).length,
        clearKeyPresent: !!effectiveDrmClearKey,
        licenseUrlPresent: !!drmLicenseUrl,
        drmReady: hasKey || !isDrm,
      });
    }
  }, [visible, url, format, drmType, isMpd, isHls, effectiveDrmClearKey, drmLicenseUrl, isDrm, mergedHeaders]);

  // Log ClearKey for each selected ClearKey channel so we can verify admin data
  useEffect(() => {
    if (visible && isClearKeyChannel && effectiveDrmClearKey) {
      console.log('[VideoPlayer] ClearKey for channel', channelId, ':', effectiveDrmClearKey);
    }
  }, [visible, isClearKeyChannel, effectiveDrmClearKey, channelId]);

  // Initialize player when visible
  useEffect(() => {
    setPlayerVisible(visible);
    if (visible) playbackRetryCountRef.current = 0;
    if (visible) {
      manifestMalformedRetryRef.current = 0;
      setPaused(false);
      setLoading(true);
      setLoadingMsg(isDrm ? 'Initializing DRM…' : 'Connecting…');
      setError(null);
      setDuration(0);
      setCurrentTime(0);
      setSourceKey(prev => prev + 1);
      setUseWebView(startWithWebView);
      setDrmSessionConfigured(false);
      
      StatusBar.setHidden(true, 'fade');
      unlockAllOrientations();
      
      // Start session expiry check
      if (sessionExpiry) {
        sessionCheckIntervalRef.current = setInterval(() => {
          const now = Math.floor(Date.now() / 1000);
          if (now >= sessionExpiry - 30) { // 30 seconds buffer
            onSessionExpired?.();
            clearInterval(sessionCheckIntervalRef.current);
          }
        }, 5000);
      }
    } else {
      // Cleanup
      if (nativeLoadTimeoutRef.current) {
        clearTimeout(nativeLoadTimeoutRef.current);
        nativeLoadTimeoutRef.current = null;
      }
      if (sessionCheckIntervalRef.current) {
        clearInterval(sessionCheckIntervalRef.current);
        sessionCheckIntervalRef.current = null;
      }
      if (trialTimerRef.current) {
        clearInterval(trialTimerRef.current);
        trialTimerRef.current = null;
      }
      
      StatusBar.setHidden(false, 'fade');
      lockToPortrait();
    }
    
    return () => {
      setPlayerVisible(false);
      if (sessionCheckIntervalRef.current) {
        clearInterval(sessionCheckIntervalRef.current);
      }
      if (trialTimerRef.current) {
        clearInterval(trialTimerRef.current);
      }
    };
  }, [visible, url, startWithWebView]);

  // Native player timeout fallback (10 seconds)
  useEffect(() => {
    if (!visible || !url || useWebView || !WebView || !loading || isDrm) return;
    
    nativeLoadTimeoutRef.current = setTimeout(() => {
      if (!useWebView && loading) {
        console.log('⏱️ Native player timeout, switching to WebView');
        setUseWebView(true);
        setError(null);
        setLoading(true);
        setLoadingMsg('Trying browser player…');
        setSourceKey(prev => prev + 1);
      }
    }, 10000);
    
    return () => {
      if (nativeLoadTimeoutRef.current) {
        clearTimeout(nativeLoadTimeoutRef.current);
        nativeLoadTimeoutRef.current = null;
      }
    };
  }, [visible, url, useWebView, loading, isDrm]);

  // Record channel watch for analytics
  useEffect(() => {
    if (!visible || !userId || !channelId) {
      if (!visible) recordedWatchRef.current = null;
      return;
    }
    
    const key = `${userId}-${channelId}`;
    if (recordedWatchRef.current === key) return;
    
    recordedWatchRef.current = key;
    userAPI.recordChannelWatch(userId, String(channelId)).catch(() => {});
  }, [visible, userId, channelId]);

  // Orientation detection
  useEffect(() => {
    const updateOrientation = () => {
      const { width, height } = Dimensions.get('window');
      setIsPortrait(width < height);
    };
    
    updateOrientation();
    const subscription = Dimensions.addEventListener('change', updateOrientation);
    
    return () => subscription?.remove?.();
  }, []);

  // Rotate hint animation: phone icon rotates portrait → landscape to show user how to turn device
  useEffect(() => {
    if (!visible || rotateHintDismissed || !isPortrait) return;
    const anim = rotateHintAnimRef.current;
    anim.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 1400,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [visible, rotateHintDismissed, isPortrait]);

  // Trial timer management
  useEffect(() => {
    if (!visible || !isPremiumChannel || trialRemaining === null || trialRemaining <= 0) return;
    
    // Clear any existing timer
    if (trialTimerRef.current) {
      clearInterval(trialTimerRef.current);
    }
    
    lastTrialUpdateRef.current = Date.now();
    
    trialTimerRef.current = setInterval(() => {
      if (!paused && !loading) {
        const now = Date.now();
        const elapsedSeconds = Math.floor((now - lastTrialUpdateRef.current) / 1000);
        
        if (elapsedSeconds > 0) {
          setTrialRemaining(prev => {
            const newRemaining = Math.max(0, prev - elapsedSeconds);
            
            // Report trial update
            onTrialUpdate?.(newRemaining);
            
            // Show paywall when trial expires
            if (newRemaining <= 0) {
              setPaused(true);
              setShowPaywall(true);
              clearInterval(trialTimerRef.current);
            }
            
            return newRemaining;
          });
          
          lastTrialUpdateRef.current = now;
        }
      } else {
        // Reset timer when paused/buffering (trial doesn't count down)
        lastTrialUpdateRef.current = Date.now();
      }
    }, 1000);
    
    return () => {
      if (trialTimerRef.current) {
        clearInterval(trialTimerRef.current);
      }
    };
  }, [visible, isPremiumChannel, trialRemaining, paused, loading]);

  // ─── Event Handlers ─────────────────────────────────────────────────────

  const onLoad = useCallback((data) => {
    playbackRetryCountRef.current = 0;
    if (__DEV__) console.log('[VideoPlayer] native loaded', isMpd ? '(manifest loaded)' : '', data?.duration);
    setLoading(false);
    setError(null);
    setDuration(data?.duration || 0);
    if (nativeLoadTimeoutRef.current) {
      clearTimeout(nativeLoadTimeoutRef.current);
      nativeLoadTimeoutRef.current = null;
    }
  }, [isMpd]);

  const onReadyForDisplay = useCallback(() => {
    console.log('✅ Video ready for display');
    setLoading(false);
  }, []);

  const onProgress = useCallback((ev) => {
    setCurrentTime(ev?.currentTime ?? 0);
    lastPlaybackPositionRef.current = ev?.currentTime ?? 0;
  }, []);

  const onBuffer = useCallback((ev) => {
    setLoading(!!ev?.isBuffering);
    if (ev?.isBuffering) {
      setLoadingMsg('Buffering…');
    }
  }, []);

  const onError = useCallback((ev) => {
    const errorCode = ev?.error?.errorCode;
    const errorString = ev?.error?.errorString || ev?.message || 'Unknown error';

    // Retry once on PARSING_MANIFEST_MALFORMED (e.g. CDN first response was non-XML)
    if (errorCode === 'ERROR_CODE_PARSING_MANIFEST_MALFORMED' && manifestMalformedRetryRef.current < 1) {
      manifestMalformedRetryRef.current += 1;
      setError(null);
      setLoading(true);
      setLoadingMsg('Retrying stream…');
      setSourceKey(prev => prev + 1);
      return;
    }

    const errorMessage = StreamEngine.classifyError(errorCode, errorString) || `Playback error: ${errorString}`;

    // Smart retry: 1 = reload, 2 = refresh token, 3 = switch player (max 3)
    if (playbackRetryCountRef.current < StreamEngine.MAX_RETRIES) {
      playbackRetryCountRef.current += 1;
      const step = StreamEngine.getRetryStep(playbackRetryCountRef.current);
      if (step === 'reload') {
        setError(null);
        setLoading(true);
        setLoadingMsg('Retrying…');
        setSourceKey(prev => prev + 1);
        return;
      }
      if (step === 'refresh_token') {
        setError(null);
        setLoading(true);
        setLoadingMsg('Refreshing stream…');
        setForceTokenRefresh(true);
        setSourceKey(prev => prev + 1);
        return;
      }
      if (step === 'switch_player' && !isDrm && WebView && !useWebView) {
        setUseWebView(true);
        setError(null);
        setLoading(true);
        setLoadingMsg('Switching to browser player…');
        setSourceKey(prev => prev + 1);
        return;
      }
    }

    setError(errorMessage);
    setLoading(false);
  }, [isDrm, useWebView]);

  const onEnd = useCallback(() => {
    console.log('🏁 Playback ended');
    setPaused(true);
  }, []);

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    setLoadingMsg('Reconnecting…');
    setPaused(false);
    // For ClearKey channels we stay on Shaka/WebView to avoid native crashes; others retry native first.
    if (!isClearKeyChannel) {
      setUseWebView(false);
    }
    setSourceKey(prev => prev + 1);
  }, [isClearKeyChannel]);

  const switchToWebView = useCallback(() => {
    setUseWebView(true);
    setError(null);
    setLoading(true);
    setLoadingMsg('Switching to browser player…');
    setSourceKey(prev => prev + 1);
  }, []);

  const handleQualityChange = useCallback((quality) => {
    setSelectedQuality(quality);
    setSourceKey(prev => prev + 1);
    setLoading(true);
    setLoadingMsg('Changing quality…');
    setQualityModalVisible(false);
    
    // Seek to current position after quality change
    setTimeout(() => {
      if (videoRef.current && lastPlaybackPositionRef.current > 0) {
        videoRef.current.seek(lastPlaybackPositionRef.current);
      }
    }, 100);
  }, []);

  const handleClose = useCallback(() => {
    setPaused(true);
    onClose();
  }, [onClose]);

  const handleRefreshSession = useCallback(() => {
    setSourceKey(prev => prev + 1);
    setLoading(true);
    setLoadingMsg('Refreshing session…');
    setError(null);
  }, []);

  // ─── Layout ─────────────────────────────────────────────────────────────

  const onLayout = useCallback((e) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w > 0 && h > 0) setLayoutSize({ width: w, height: h });
  }, []);

  const window = Dimensions.get('window');
  const width = layoutSize.width > 0 ? layoutSize.width : window.width;
  const height = layoutSize.height > 0 ? layoutSize.height : window.height;
  const videoStyle = [styles.video, { width, height }];

  // Map selected quality to react-native-video props
  const selectedVideoTrackProp =
    selectedQuality.height > 0
      ? { type: 'resolution', value: selectedQuality.height }
      : { type: 'auto' };

  // Approximate maxBitRate caps per quality (in bits per second)
  const maxBitRate =
    selectedQuality.height === 240
      ? 400_000
      : selectedQuality.height === 360
      ? 800_000
      : selectedQuality.height === 480
      ? 1_400_000
      : selectedQuality.height === 720
      ? 2_500_000
      : selectedQuality.height === 1080
      ? 4_000_000
      : 0; // Auto/uncapped

  // ─── Render ─────────────────────────────────────────────────────────────

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClose}
      supportedOrientations={['landscape', 'portrait']}
    >
      <View style={styles.root} onLayout={onLayout} collapsable={false}>
        {/* Main Player */}
        {url && useWebView && WebView ? (
          <WebView
            key={`wv-${sourceKey}`}
            source={isMpd ? { html: buildShakaDashHtml(url, mergedHeaders, browserDrmConfig) } : { uri: url }}
            style={videoStyle}
            userAgent={WEBVIEW_USER_AGENT}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={['*']}
            mixedContentMode="always"
            onLoadEnd={() => {
              if (!isMpd) setLoading(false);
            }}
            onMessage={(e) => {
              try {
                const data = JSON.parse(e.nativeEvent?.data ?? '{}');
                if (data.type === 'playing') setLoading(false);
                if (data.type === 'ready') setLoading(false);
                if (data.type === 'error') setError(data.message || 'Playback failed in browser');
                if (data.type === 'fallback') {
                  // Shaka reported manifest parse error (1002). Retry with native player instead.
                  setUseWebView(false);
                  setError(null);
                  setLoading(true);
                  setLoadingMsg('Retrying in app player…');
                  setSourceKey(prev => prev + 1);
                }
              } catch (_) {}
            }}
            onError={() => setError('Page could not be loaded.')}
          />
        ) : drmWaitingForKey ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingMsg}>Fetching keys…</Text>
          </View>
        ) : source && width > 0 && height > 0 ? (
          <Video
            key={`video-${sourceKey}`}
            ref={videoRef}
            source={source}
            style={videoStyle}
            resizeMode="contain"
            paused={paused}
            controls={true}
            selectedVideoTrack={selectedVideoTrackProp}
            onLoad={onLoad}
            onReadyForDisplay={onReadyForDisplay}
            onProgress={onProgress}
            onBuffer={onBuffer}
            onError={onError}
            onEnd={onEnd}
            // Buffer / quality configuration
            minLoadRetryCount={3}
            maxBitRate={maxBitRate}
            // DRM configuration
            drm={source?.drm}
          />
        ) : (
          <View style={styles.noSource}>
            <Icon name="video-off" size={48} color="#6b7280" />
            <Text style={styles.noSourceText}>No stream URL</Text>
          </View>
        )}

        {/* Controls Overlay */}
        <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.8}>
          <Icon name="close" size={28} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.qualityBtn}
          onPress={() => setQualityModalVisible(true)}
          activeOpacity={0.8}>
          <Icon name="speedometer" size={22} color="#fff" />
          <Text style={styles.qualityBtnText}>
            OKOA BANDO
          </Text>
        </TouchableOpacity>

        {/* Quality Selection Modal */}
        <Modal
          visible={qualityModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setQualityModalVisible(false)}>
          <TouchableOpacity
            style={styles.qualityModalOverlay}
            activeOpacity={1}
            onPress={() => setQualityModalVisible(false)}>
            <View style={styles.qualityModalCard}>
              <Text style={styles.qualityModalTitle}>Chagua ubora wa video</Text>
              <Text style={styles.qualityModalSubtitle}>
                Chini = okoa bando (360p inapendekezwa), juu = ubora bora zaidi
              </Text>
              {QUALITY_OPTIONS.map((opt) => {
                const isSelected = selectedQuality.value === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.qualityOption, isSelected && styles.qualityOptionSelected]}
                    onPress={() => handleQualityChange(opt)}
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
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Trial/Paywall Overlay */}
        {showPaywall && (
          <View style={styles.paywallOverlay}>
            <View style={styles.paywallCard}>
              <Icon name="lock" size={48} color="#fff" />
              <Text style={styles.paywallTitle}>Trial Expired</Text>
              <Text style={styles.paywallText}>
                Your free trial has ended. Subscribe to continue watching.
              </Text>
              <TouchableOpacity
                style={styles.subscribeBtn}
                onPress={() => {
                  setShowPaywall(false);
                  onUnlockChannel?.();
                }}>
                <Text style={styles.subscribeBtnText}>Subscribe Now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.paywallCloseBtn}
                onPress={handleClose}>
                <Text style={styles.paywallCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Trial Timer Overlay */}
        {isPremiumChannel && trialRemaining !== null && trialRemaining > 0 && !showPaywall && (
          <View style={styles.trialOverlay}>
            <View style={styles.trialBadge}>
              <Icon name="clock-outline" size={16} color="#fff" />
              <Text style={styles.trialText}>
                Trial: {Math.floor(trialRemaining / 60)}:{(trialRemaining % 60).toString().padStart(2, '0')}
              </Text>
            </View>
          </View>
        )}

        {/* Rotate Hint - animated phone shows user how to rotate device */}
        {visible && isPortrait && !rotateHintDismissed && (
          <View style={styles.rotateOverlay} pointerEvents="box-none">
            <View style={styles.rotateCard}>
              <Animated.View
                style={{
                  transform: [
                    {
                      rotate: rotateHintAnimRef.current.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '90deg'],
                      }),
                    },
                  ],
                }}>
                <Icon name="cellphone" size={72} color="rgba(255,255,255,0.95)" />
              </Animated.View>
              <Text style={styles.rotateTitle}>Ilaze simu yako</Text>
              <Text style={styles.rotateSubtitle}>
                Laza simu yako ili uweze kutizama kwa ukubwa kamili
              </Text>
              <TouchableOpacity
                style={styles.rotateDismissBtn}
                onPress={() => setRotateHintDismissed(true)}
                activeOpacity={0.8}>
                <Text style={styles.rotateDismissText}>Baadaye</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Loading Overlay - only wait for DRM "configuring" for Widevine/PlayReady (ClearKey uses inline key, no native config) */}
        {(loading || ((isWidevineChannel || isPlayReadyChannel) && !drmSessionConfigured)) && !error && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingMsg}>
              {(isWidevineChannel || isPlayReadyChannel) && !drmSessionConfigured ? 'Configuring DRM…' : loadingMsg}
            </Text>
          </View>
        )}

        {/* Error Overlay */}
        {error && (
          <View style={styles.errorOverlay}>
            <View style={styles.errorCard}>
              <Icon name="alert-circle" size={40} color="#fff" />
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

// ─── Styles ────────────────────────────────────────────────────────────────

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
    right: 80,
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
  rotateDismissBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  rotateDismissText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
  },
  trialOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 70,
    left: 20,
    zIndex: 99998,
  },
  trialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  trialText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  paywallOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100000,
  },
  paywallCard: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 28,
    maxWidth: 320,
  },
  paywallTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  paywallText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  subscribeBtn: {
    backgroundColor: '#22c55e',
    borderRadius: 8,
    paddingHorizontal: 32,
    paddingVertical: 14,
    marginBottom: 12,
  },
  subscribeBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  paywallCloseBtn: {
    paddingVertical: 8,
  },
  paywallCloseText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
});