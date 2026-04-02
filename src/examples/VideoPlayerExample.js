/**
 * VideoPlayer usage examples – matches new VideoPlayer API (Kotlin/Flutter style).
 * Props: visible, onClose, videoUrl, channelName, headers?, token?
 */

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Text, TouchableOpacity } from 'react-native';
import VideoPlayer from '../player/VideoPlayer';

const HLS_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const MP4_URL = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

const VideoPlayerExample = () => {
  const [visible, setVisible] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [channelName, setChannelName] = useState('');
  const [headers, setHeaders] = useState({});

  const open = (url, name, h = {}) => {
    setVideoUrl(url);
    setChannelName(name || 'Stream');
    setHeaders(h);
    setVisible(true);
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Video Player Examples</Text>

      <View style={styles.playerContainer}>
        <Text style={styles.subtitle}>1. HLS (M3U8)</Text>
        <TouchableOpacity style={styles.button} onPress={() => open(HLS_URL, 'HLS Test')}>
          <Text style={styles.buttonText}>Open HLS stream</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.playerContainer}>
        <Text style={styles.subtitle}>2. MP4</Text>
        <TouchableOpacity style={styles.button} onPress={() => open(MP4_URL, 'Big Buck Bunny')}>
          <Text style={styles.buttonText}>Open MP4</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.playerContainer}>
        <Text style={styles.subtitle}>3. With custom headers</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => open(HLS_URL, 'HLS + Headers', { Referer: 'https://example.com' })}
        >
          <Text style={styles.buttonText}>Open with Referer</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.guideContainer}>
        <Text style={styles.guideTitle}>Usage</Text>
        <Text style={styles.guideText}>
          Props: visible, onClose, videoUrl, channelName{'\n'}
          Optional: headers, token{'\n\n'}
          Supported URLs: .mp4, .m3u8, .m3u, .mpd, HLS, DASH, .php, .html (WebView).
          User-Agent matches Kotlin ExoPlayerEngine/WebViewEngine.
        </Text>
      </View>

      <VideoPlayer
        visible={visible}
        onClose={() => setVisible(false)}
        videoUrl={videoUrl}
        channelName={channelName}
        headers={headers}
      />
    </ScrollView>
  );
};

export default VideoPlayerExample;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 24, fontWeight: 'bold', padding: 16, backgroundColor: '#2196F3', color: '#fff' },
  playerContainer: { marginVertical: 16, backgroundColor: '#fff', padding: 16, borderRadius: 8, marginHorizontal: 16 },
  subtitle: { fontSize: 18, fontWeight: '600', marginBottom: 12, color: '#333' },
  button: { backgroundColor: '#4CAF50', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8, alignSelf: 'flex-start' },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  guideContainer: { margin: 16, padding: 16, backgroundColor: '#fff', borderRadius: 8, marginBottom: 32 },
  guideTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 12, color: '#333' },
  guideText: { fontSize: 14, lineHeight: 22, color: '#666' },
});
