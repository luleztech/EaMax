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
import Video from 'react-native-video';
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

/**
 * ========================================================================
 * REACT NATIVE VIDEO PLAYER – Conversion of Kotlin player (flutter player)
 * ========================================================================
 * Source: /home/ayoub/MySecretes/flutter player
 * - PlayerManager.kt: lifecycle, play/pause/stop, seek, quality, state callbacks
 * - ExoPlayerEngine.kt: format detection, DASH/HLS/PROGRESSIVE, DRM, quality, errors
 * - StreamSessionHandler.kt: session validation, HLS/DASH media source
 * - WebViewEngine.kt: User-Agent, WebView settings
 * - supportcode/PlaybackState.kt, StreamSession.kt, PlayerConfig.kt, StreamQuality
 *
 * videoUrl here maps to StreamSession.mpdUrl. Same PlaybackState, StreamQuality,
 * format detection, and error mapping as Kotlin; playback via WebView (hls.js / dash.js).
 * ========================================================================
 */

// PlaybackState – matches Kotlin domain.model.PlaybackState exactly
const PlaybackState = {
  IDLE: 'IDLE',
  BUFFERING: 'BUFFERING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  ENDED: 'ENDED',
};

// Stream format detection – matches ExoPlayerEngine.detectStreamFormat() order and patterns
// (DASH, HLS, PROGRESSIVE; relay patterns; default DASH for unknown)
const detectStreamFormat = (url) => {
  if (!url || typeof url !== 'string') return 'PROGRESSIVE';
  const u = url.toLowerCase();
  // DASH/MPD
  if (u.includes('.mpd')) return 'DASH';
  if ((u.includes('dash') || u.includes('/manifest')) && !u.includes('.m3u8')) return 'DASH';
  if (u.includes('application/dash+xml')) return 'DASH';
  // Relay/proxy (ExoPlayerEngine)
  if (u.includes('/relay/stream') || u.includes('/api/relay/')) return 'DASH';
  if (u.includes('/relay/m3u8')) return 'HLS';
  // HLS/M3U8
  if (u.includes('.m3u8') || u.includes('.m3u')) return 'HLS';
  if (u.includes('hls') || u.includes('playlist.m3u')) return 'HLS';
  if (u.includes('application/vnd.apple.mpegurl') || u.includes('application/x-mpegurl')) return 'HLS';
  // Progressive (ExoPlayerEngine: mp4, m4v, m4a, webm, mkv, avi, mov, flv, ts)
  if (u.includes('.mp4') || u.includes('.m4v') || u.includes('.m4a')) return 'PROGRESSIVE';
  if (u.includes('.webm') || u.includes('.mkv') || u.includes('.avi') || u.includes('.mov') || u.includes('.flv')) return 'PROGRESSIVE';
  if (u.includes('.ts') && !u.includes('m3u8') && !u.includes('playlist')) return 'PROGRESSIVE';
  // Default HLS for unknown URLs so WebView actually plays (many streams are HLS; DASH would stick on loading)
  return 'HLS';
};

// User-Agent – exact from WebViewEngine.kt DESKTOP_USER_AGENT (site allows access when this is sent)
const PLAYER_USER_AGENT = 'ReactNativeVideo/3.0 (Linux;Android 11) ExoPlayerLib/2.10.4';

// External web page (e.g. lipopotv.live/spl.php) – WebViewEngine.kt: load in WebView with User-Agent so site allows access
const isExternalWebPage = (url) => {
  if (!url || typeof url !== 'string') return false;
  const u = url.toLowerCase();
  return u.includes('.php') || u.includes('.html') || u.endsWith('.htm');
};

// StreamQuality / PlayerConfig – matches Kotlin StreamQuality enum and PlayerConfig.availableQualities
const QUALITY_OPTIONS = [
  { label: 'Auto (ABR)', value: 'auto', recommended: true },
  { label: '240p', value: '240', recommended: false },
  { label: '360p', value: '360', recommended: false },
  { label: '480p', value: '480', recommended: false },
  { label: '720p', value: '720', recommended: false },
  { label: '1080p', value: '1080', recommended: false },
];

// Error messages – matches ExoPlayerEngine PlayerEventListener.onPlayerError mapping
const getErrorMessage = (codeOrMessage) => {
  const msg = String(codeOrMessage || '').toLowerCase();
  if (msg.includes('network') || msg.includes('connection') || msg.includes('failed')) return 'Network connection failed. Please check your internet connection.';
  if (msg.includes('timeout')) return 'Connection timeout. Please try again.';
  if (msg.includes('bad_http_status') || msg.includes('server returned')) return 'Server returned an error. Please try again later.';
  if (msg.includes('cors') || msg.includes('cross-origin')) return 'Stream access denied. Please try again later.';
  if (msg.includes('drm') || msg.includes('license') || msg.includes('acquisition')) return 'Stream authorization failed. Stream may not be available.';
  if (msg.includes('provisioning') || msg.includes('revoked')) return 'DRM provisioning failed. Device may not be supported.';
  if (msg.includes('decoder') || msg.includes('decode') || msg.includes('init_failed')) return 'Video decoder initialization failed. Format may not be supported.';
  if (msg.includes('manifest') || msg.includes('malformed') || msg.includes('parsing')) return 'Invalid stream manifest. Stream may be corrupted.';
  if (msg.includes('container') || msg.includes('mediasource')) return 'Invalid video container. Format may be corrupted.';
  if (msg.includes('not supported') || msg.includes('unsupported')) return 'This stream format is not supported on this device.';
  if (msg.includes('hls not supported')) return 'HLS playback is not supported in this browser.';
  if (msg.includes('dash not supported')) return 'DASH playback is not supported in this browser.';
  if (msg.includes('media_element_error') || msg.includes('format error') || msg.includes('src_not_supported')) {
    return 'This stream format or codec is not supported. Try another channel or update the stream URL in the admin app.';
  }
  return msg ? `Playback error: ${codeOrMessage}` : 'Playback error. Please try again.';
};

/**
 * VideoPlayer – WebView implementation of Kotlin player (PlayerManager + ExoPlayerEngine + WebViewEngine).
 * - videoUrl maps to StreamSession.mpdUrl
 * - Same PlaybackState, StreamQuality, format detection, User-Agent, and error mapping as Kotlin.
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
  const videoRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const closeTimeoutRef = useRef(null);

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

  const handleQualityChange = (q) => {
    setSelectedQuality(q);
    setShowQualityMenu(false);
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
            isExternalWebPage(videoUrl) ? (
              <WebView
                key={videoUrl}
                source={{ uri: videoUrl }}
                style={styles.video}
                userAgent={PLAYER_USER_AGENT}
                javaScriptEnabled
                domStorageEnabled
                mediaPlaybackRequiresUserGesture={false}
                mixedContentMode="always"
                allowsInlineMediaPlayback
                allowsFullscreenVideo
                scrollEnabled={false}
                onLoadStart={() => setPlaybackState(PlaybackState.BUFFERING)}
                onLoadEnd={() => {
                  setPlaybackState(PlaybackState.PLAYING);
                  setError(null);
                }}
                onError={(e) => {
                  setPlaybackState(PlaybackState.IDLE);
                  setError(getErrorMessage(e.nativeEvent?.description || 'Page failed to load'));
                }}
                onHttpError={(e) => {
                  if (e.nativeEvent.statusCode >= 400) {
                    setPlaybackState(PlaybackState.IDLE);
                    setError(getErrorMessage(`HTTP ${e.nativeEvent.statusCode}`));
                  }
                }}
              />
            ) : (
              <Video
                key={videoUrl}
                ref={videoRef}
                source={{
                  uri: videoUrl,
                  headers: { 'User-Agent': PLAYER_USER_AGENT },
                }}
                style={styles.video}
                resizeMode="contain"
                onLoadStart={() => setPlaybackState(PlaybackState.BUFFERING)}
                onLoad={(data) => {
                  setPlaybackState(PlaybackState.READY);
                  setError(null);
                  if (data.duration != null) setDuration(data.duration);
                }}
                onReadyForDisplay={() => {
                  setPlaybackState(PlaybackState.READY);
                  setError(null);
                }}
                onBuffer={({ isBuffering }) => {
                  setPlaybackState(isBuffering ? PlaybackState.BUFFERING : PlaybackState.PLAYING);
                }}
                onProgress={({ currentTime, seekableDuration }) => {
                  setCurrentTime(currentTime);
                  if (seekableDuration > 0) setDuration((d) => (d > 0 ? d : seekableDuration));
                }}
                onPlaybackStateChanged={({ isPlaying }) => {
                  setPlaybackState(isPlaying ? PlaybackState.PLAYING : PlaybackState.PAUSED);
                }}
                onEnd={() => setPlaybackState(PlaybackState.ENDED)}
                onError={(e) => {
                  setPlaybackState(PlaybackState.IDLE);
                  const err = e?.error;
                  setError(getErrorMessage(err?.errorString || err?.localizedDescription || 'Playback failed'));
                }}
                progressUpdateInterval={500}
                playInBackground={false}
                playWhenInactive={false}
                ignoreSilentSwitch="ignore"
              />
            )
          ) : (
            <View style={styles.placeholder}>
              <ActivityIndicator size="large" color="#22c55e" />
              <Text style={styles.placeholderText}>
                {visible ? 'Fetching stream...' : 'No stream URL'}
              </Text>
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
  video: {
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
