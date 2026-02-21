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

// Optional: use orientation locker for reliable portrait on close
let Orientation = null;
try {
  Orientation = require('react-native-orientation-locker').default;
} catch (_) {
  Orientation = null;
}

// PlaybackState – matches Kotlin domain.model.PlaybackState
const PlaybackState = {
  IDLE: 'IDLE',
  BUFFERING: 'BUFFERING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  ENDED: 'ENDED',
};

// Stream format detection – ExoPlayerEngine-style; .php/.html use WebView (isExternalWebPage)
const detectStreamFormat = (url) => {
  if (!url || typeof url !== 'string') return 'PROGRESSIVE';
  const u = url.toLowerCase();
  if (u.includes('.mpd')) return 'DASH';
  if ((u.includes('dash') || u.includes('/manifest')) && !u.includes('.m3u8')) return 'DASH';
  if (u.includes('/relay/stream') || u.includes('/api/relay/')) return 'DASH';
  if (u.includes('/relay/m3u8')) return 'HLS';
  if (u.includes('.m3u8') || u.includes('.m3u') || u.includes('hls') || u.includes('playlist.m3u')) return 'HLS';
  if (u.includes('.mp4') || u.includes('.m4v') || u.includes('.m4a')) return 'PROGRESSIVE';
  if (u.includes('.webm') || u.includes('.mkv') || u.includes('.avi') || u.includes('.mov') || u.includes('.flv')) return 'PROGRESSIVE';
  if (u.includes('.ts') && !u.includes('m3u8') && !u.includes('playlist')) return 'PROGRESSIVE';
  return 'HLS';
};

const PLAYER_USER_AGENT = 'ReactNativeVideo/3.0 (Linux;Android 11) ExoPlayerLib/2.10.4';

const isExternalWebPage = (url) => {
  if (!url || typeof url !== 'string') return false;
  const u = url.toLowerCase();
  return u.includes('.php') || u.includes('.html') || u.endsWith('.htm');
};

const PLAYER_USER_AGENT = 'ReactNativeVideo/3.0 (Linux;Android 11) ExoPlayerLib/2.10.4';

const QUALITY_OPTIONS = [
  { label: 'Auto (ABR)', value: 'auto', recommended: true },
  { label: '240p', value: '240', recommended: false },
  { label: '360p', value: '360', recommended: false },
  { label: '480p', value: '480', recommended: false },
  { label: '720p', value: '720', recommended: false },
  { label: '1080p', value: '1080', recommended: false },
];

const getErrorMessage = (codeOrMessage) => {
  const msg = String(codeOrMessage || '').toLowerCase();
  if (msg.includes('network') || msg.includes('connection') || msg.includes('failed')) 
    return 'Network connection failed. Please check your internet connection.';
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

  // Expand to fullscreen
  const handleExpand = () => {
    try {
      if (Orientation && typeof Orientation.lockToLandscape === 'function') {
        Orientation.lockToLandscape();
      }
    } catch (_) {}
    setIsFullscreen(true);
  };

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

          {error && (
            <View style={styles.errorOverlay}>
              <Icon name="alert-circle" size={48} color="#ef4444" />
              <Text style={styles.errorText}>{error}</Text>
              <View style={styles.errorButtons}>
                <TouchableOpacity 
                  style={[styles.errorButton, styles.retryButton]} 
                  onPress={() => setError(null)}
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
