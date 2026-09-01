import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { channelArtworkUrl, mediaImageSource } from '../../utils/mediaUrl';

const ChannelThumb = ({
  url,
  channel,
  emoji,
  icon = 'television',
  fallbackColor = '#1f2937',
  size = 64,
  radius = 16,
}) => {
  const resolved = url || channelArtworkUrl(channel);
  const source = mediaImageSource(resolved);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolved]);

  const showImage = !!source && !failed;

  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: showImage ? '#0f172a' : `${fallbackColor}33`,
        },
      ]}>
      {showImage ? (
        <Image
          source={source}
          style={{ width: size, height: size, borderRadius: radius }}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : emoji ? (
        <Text style={[styles.emoji, { fontSize: Math.round(size * 0.42) }]}>{emoji}</Text>
      ) : (
        <Icon name={icon} size={Math.round(size * 0.38)} color="#cbd5e1" />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  emoji: {
    textAlign: 'center',
  },
});

export default ChannelThumb;
