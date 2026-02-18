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
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';

const { width, height } = Dimensions.get('window');

const VideoPlayer = ({
  visible,
  onClose,
  videoUrl,
  channelName,
  onUnlockChannel,
  channelId,
  userId,
}) => {
  const [selectedQuality, setSelectedQuality] = useState('auto'); // Default to auto, 360p is recommended
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const webViewRef = useRef(null);
  const controlsTimeoutRef = useRef(null);

  // Quality options
  const qualityOptions = [
    { label: 'Auto', value: 'auto', recommended: false },
    { label: '360p', value: '360', recommended: true },
    { label: '480p', value: '480', recommended: false },
    { label: '720p', value: '720', recommended: false },
    { label: '1080p', value: '1080', recommended: false },
  ];

  // Generate HTML for video player
  const generatePlayerHTML = (url, quality) => {
    const isHLS = url.includes('.m3u8') || url.includes('hls');
    const isDASH = url.includes('.mpd') || url.includes('dash');
    
    // For HLS streams, we'll use hls.js
    // For DASH, we'll use dash.js
    // For regular MP4, use native HTML5 video
    
    if (isHLS) {
      return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background: #000;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      overflow: hidden;
    }
    #video-container {
      width: 100%;
      height: 100%;
      position: relative;
    }
    video {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .controls {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .progress-bar {
      width: 100%;
      height: 4px;
      background: rgba(255,255,255,0.3);
      border-radius: 2px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: #4ade80;
      transition: width 0.1s;
    }
    .time-info {
      color: #fff;
      font-size: 12px;
      display: flex;
      justify-content: space-between;
    }
    .play-pause-btn {
      background: rgba(255,255,255,0.2);
      border: none;
      color: #fff;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div id="video-container">
    <video id="video" controls playsinline webkit-playsinline></video>
    <div class="controls" id="controls">
      <div class="progress-bar">
        <div class="progress-fill" id="progress"></div>
      </div>
      <div class="time-info">
        <span id="current-time">0:00</span>
        <span id="duration">0:00</span>
      </div>
      <button class="play-pause-btn" id="play-pause">Pause</button>
    </div>
  </div>
  <script>
    const video = document.getElementById('video');
    const progress = document.getElementById('progress');
    const currentTimeEl = document.getElementById('current-time');
    const durationEl = document.getElementById('duration');
    const playPauseBtn = document.getElementById('play-pause');
    const controls = document.getElementById('controls');
    
    let hls;
    let controlsTimeout;
    
    const url = ${JSON.stringify(url)};
    const quality = ${JSON.stringify(quality)};
    
    console.log('Loading video:', url, 'Quality:', quality);
    
    function formatTime(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return mins + ':' + (secs < 10 ? '0' : '') + secs;
    }
    
    function updateProgress() {
      if (video.duration) {
        const percent = (video.currentTime / video.duration) * 100;
        progress.style.width = percent + '%';
        currentTimeEl.textContent = formatTime(video.currentTime);
        durationEl.textContent = formatTime(video.duration);
        
        // Send time updates to React Native
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'timeupdate',
          currentTime: video.currentTime,
          duration: video.duration,
        }));
      }
    }
    
    function showControls() {
      controls.style.display = 'flex';
      clearTimeout(controlsTimeout);
      controlsTimeout = setTimeout(() => {
        if (video.paused) return;
        controls.style.display = 'none';
      }, 3000);
    }
    
    function hideControls() {
      clearTimeout(controlsTimeout);
      controls.style.display = 'none';
    }
    
    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('click', showControls);
    video.addEventListener('play', () => {
      playPauseBtn.textContent = 'Pause';
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'play',
      }));
      hideControls();
    });
    video.addEventListener('pause', () => {
      playPauseBtn.textContent = 'Play';
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'pause',
      }));
      showControls();
    });
    video.addEventListener('loadedmetadata', () => {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'loaded',
        duration: video.duration,
      }));
    });
    video.addEventListener('waiting', () => {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'loading',
      }));
    });
    video.addEventListener('playing', () => {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'playing',
      }));
    });
    
    playPauseBtn.addEventListener('click', () => {
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    });
    
    // Initialize HLS.js
    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
      });
      
      hls.loadSource(url);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const levels = hls.levels;
        console.log('Available quality levels:', levels);
        
        // Set quality based on selection
        if (quality !== 'auto') {
          const targetLevel = levels.findIndex(level => {
            const levelHeight = level.height || 0;
            if (quality === '360' && levelHeight <= 360) return true;
            if (quality === '480' && levelHeight <= 480 && levelHeight > 360) return true;
            if (quality === '720' && levelHeight <= 720 && levelHeight > 480) return true;
            if (quality === '1080' && levelHeight <= 1080 && levelHeight > 720) return true;
            return false;
          });
          
          if (targetLevel !== -1) {
            hls.currentLevel = targetLevel;
          }
        }
        
        video.play().catch(e => console.log('Play error:', e));
      });
      
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari/iOS)
      video.src = url;
      video.play().catch(e => console.log('Play error:', e));
    } else {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'error',
        message: 'HLS not supported',
      }));
    }
    
    // Handle quality change from React Native
    window.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'changeQuality' && hls) {
        const newQuality = data.quality;
        if (newQuality === 'auto') {
          hls.currentLevel = -1; // Auto
        } else {
          const levels = hls.levels;
          const targetLevel = levels.findIndex(level => {
            const levelHeight = level.height || 0;
            if (newQuality === '360' && levelHeight <= 360) return true;
            if (newQuality === '480' && levelHeight <= 480 && levelHeight > 360) return true;
            if (newQuality === '720' && levelHeight <= 720 && levelHeight > 480) return true;
            if (newQuality === '1080' && levelHeight <= 1080 && levelHeight > 720) return true;
            return false;
          });
          if (targetLevel !== -1) {
            hls.currentLevel = targetLevel;
          }
        }
      }
    });
  </script>
</body>
</html>`;
    } else if (isDASH) {
      // DASH player implementation
      return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <script src="https://cdn.dashjs.org/latest/dash.all.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; display: flex; justify-content: center; align-items: center; height: 100vh; }
    video { width: 100%; height: 100%; object-fit: contain; }
  </style>
</head>
<body>
  <video id="video" controls playsinline webkit-playsinline></video>
  <script>
    const video = document.getElementById('video');
    const url = ${JSON.stringify(url)};
    const quality = ${JSON.stringify(quality)};
    
    if (dashjs.supportsMediaSource()) {
      const player = dashjs.MediaPlayer().create();
      player.initialize(video, url, true);
      
      player.on('streamInitialized', () => {
        const bitrates = player.getBitrateInfoListFor('video');
        console.log('Available bitrates:', bitrates);
        
        if (quality !== 'auto') {
          const targetBitrate = bitrates.find(bitrate => {
            const height = bitrate.height || 0;
            if (quality === '360' && height <= 360) return true;
            if (quality === '480' && height <= 480 && height > 360) return true;
            if (quality === '720' && height <= 720 && height > 480) return true;
            if (quality === '1080' && height <= 1080 && height > 720) return true;
            return false;
          });
          
          if (targetBitrate) {
            player.setQualityFor('video', targetBitrate.qualityIndex);
          }
        }
        
        video.play().catch(e => console.log('Play error:', e));
      });
      
      video.addEventListener('timeupdate', () => {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'timeupdate',
          currentTime: video.currentTime,
          duration: video.duration,
        }));
      });
    } else {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'error',
        message: 'DASH not supported',
      }));
    }
  </script>
</body>
</html>`;
    } else {
      // Regular MP4 or other formats
      return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; display: flex; justify-content: center; align-items: center; height: 100vh; }
    video { width: 100%; height: 100%; object-fit: contain; }
  </style>
</head>
<body>
  <video id="video" src="${url}" controls playsinline webkit-playsinline></video>
  <script>
    const video = document.getElementById('video');
    const url = ${JSON.stringify(url)};
    
    video.addEventListener('timeupdate', () => {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'timeupdate',
        currentTime: video.currentTime,
        duration: video.duration,
      }));
    });
    
    video.addEventListener('play', () => {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'play',
      }));
    });
    
    video.addEventListener('pause', () => {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'pause',
      }));
    });
    
    video.addEventListener('loadedmetadata', () => {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'loaded',
        duration: video.duration,
      }));
    });
    
    video.play().catch(e => console.log('Play error:', e));
  </script>
</body>
</html>`;
    }
  };

  // Handle messages from WebView
  const handleMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      switch (data.type) {
        case 'timeupdate':
          setCurrentTime(data.currentTime);
          if (data.duration) setDuration(data.duration);
          break;
        case 'play':
          setIsPlaying(true);
          setIsLoading(false);
          break;
        case 'pause':
          setIsPlaying(false);
          break;
        case 'loaded':
          setIsLoading(false);
          if (data.duration) setDuration(data.duration);
          break;
        case 'loading':
          setIsLoading(true);
          break;
        case 'playing':
          setIsLoading(false);
          setIsPlaying(true);
          break;
        case 'error':
          console.error('Video error:', data.message);
          setIsLoading(false);
          break;
      }
    } catch (error) {
      console.error('Error parsing WebView message:', error);
    }
  };

  // Change quality
  const handleQualityChange = (quality) => {
    setSelectedQuality(quality);
    setShowQualityMenu(false);
    
    // Send quality change to WebView
    if (webViewRef.current) {
      webViewRef.current.postMessage(
        JSON.stringify({
          type: 'changeQuality',
          quality: quality,
        })
      );
    }
  };

  // Format time
  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Handle unlock channel
  const handleUnlockChannel = async () => {
    if (onUnlockChannel && channelId && userId) {
      try {
        await onUnlockChannel(channelId, userId);
        // Channel unlocked, continue playing
      } catch (error) {
        console.error('Failed to unlock channel:', error);
      }
    }
  };

  // Reset quality to auto when video changes
  useEffect(() => {
    if (videoUrl) {
      setSelectedQuality('auto');
      setIsLoading(true);
      setIsPlaying(false);
      setShowControls(true);
    }
  }, [videoUrl]);

  // Auto-hide controls
  useEffect(() => {
    if (isPlaying && showControls) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
    
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [isPlaying, showControls]);

  if (!visible || !videoUrl) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            activeOpacity={0.7}>
            <Icon name="arrow-left" size={24} color="#fff" />
          </TouchableOpacity>
          
          <View style={styles.headerInfo}>
            <Text style={styles.channelName} numberOfLines={1}>
              {channelName || 'Video Player'}
            </Text>
            <Text style={styles.qualityLabel}>
              {selectedQuality === 'auto' ? 'Auto' : `${selectedQuality}p`}
            </Text>
          </View>
          
          <TouchableOpacity
            style={styles.qualityButton}
            onPress={() => setShowQualityMenu(!showQualityMenu)}
            activeOpacity={0.7}>
            <Icon name="quality-high" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Video Player */}
        <View style={styles.playerContainer}>
          {(() => {
            try {
              return (
                <WebView
                  ref={webViewRef}
                  source={{ html: generatePlayerHTML(videoUrl, selectedQuality) }}
                  style={styles.webview}
                  allowsFullscreenVideo={true}
                  mediaPlaybackRequiresUserAction={false}
                  onMessage={handleMessage}
                  onLoadStart={() => setIsLoading(true)}
                  onLoadEnd={() => setIsLoading(false)}
                  onError={(syntheticEvent) => {
                    const { nativeEvent } = syntheticEvent;
                    console.error('WebView error: ', nativeEvent);
                    setIsLoading(false);
                  }}
                  javaScriptEnabled={true}
                  domStorageEnabled={true}
                  startInLoadingState={true}
                  scalesPageToFit={true}
                />
              );
            } catch (error) {
              console.error('WebView initialization error:', error);
              return (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>
                    Video player failed to load. Please rebuild the app.
                  </Text>
                  <Text style={styles.errorSubtext}>
                    Run: npx react-native run-android (or run-ios)
                  </Text>
                </View>
              );
            }
          })()}
          
          {isLoading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#4ade80" />
              <Text style={styles.loadingText}>Loading video...</Text>
            </View>
          )}
          
          {/* Custom Controls Overlay */}
          {showControls && !isLoading && (
            <TouchableOpacity
              style={styles.controlsOverlay}
              activeOpacity={1}
              onPress={() => setShowControls(!showControls)}>
              <View style={styles.controlsContent}>
                <View style={styles.progressContainer}>
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${(currentTime / duration) * 100}%` },
                      ]}
                    />
                  </View>
                  <View style={styles.timeContainer}>
                    <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
                    <Text style={styles.timeText}>{formatTime(duration)}</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* Quality Selection Menu */}
        {showQualityMenu && (
          <View style={styles.qualityMenu}>
            <Text style={styles.qualityMenuTitle}>Select Quality</Text>
            {qualityOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.qualityOption,
                  selectedQuality === option.value && styles.qualityOptionSelected,
                ]}
                onPress={() => handleQualityChange(option.value)}
                activeOpacity={0.7}>
                <View style={styles.qualityOptionContent}>
                  <Text
                    style={[
                      styles.qualityOptionText,
                      selectedQuality === option.value && styles.qualityOptionTextSelected,
                    ]}>
                    {option.label}
                  </Text>
                  {option.recommended && (
                    <View style={styles.recommendedBadge}>
                      <Text style={styles.recommendedText}>Recommended</Text>
                    </View>
                  )}
                  {selectedQuality === option.value && (
                    <AntDesign name="check" size={18} color="#4ade80" />
                  )}
                </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  closeButton: {
    padding: 8,
  },
  headerInfo: {
    flex: 1,
    marginLeft: 12,
  },
  channelName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  qualityLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  qualityButton: {
    padding: 8,
  },
  playerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    marginTop: 12,
    fontSize: 14,
  },
  controlsOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  controlsContent: {
    padding: 16,
  },
  progressContainer: {
    marginBottom: 8,
  },
  progressBar: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4ade80',
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    color: '#fff',
    fontSize: 12,
  },
  qualityMenu: {
    position: 'absolute',
    top: 60,
    right: 16,
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 8,
    minWidth: 180,
    borderWidth: 1,
    borderColor: '#374151',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  qualityMenuTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  qualityOption: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  qualityOptionSelected: {
    backgroundColor: 'rgba(74, 222, 128, 0.2)',
  },
  qualityOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  qualityOptionText: {
    fontSize: 14,
    color: '#d1d5db',
  },
  qualityOptionTextSelected: {
    color: '#4ade80',
    fontWeight: 'bold',
  },
  recommendedBadge: {
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  recommendedText: {
    fontSize: 10,
    color: '#fbbf24',
    fontWeight: '600',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#000',
  },
  errorText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  errorSubtext: {
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'center',
  },
});

export default VideoPlayer;
