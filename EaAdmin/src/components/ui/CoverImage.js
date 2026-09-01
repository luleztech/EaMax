import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { mediaImageSource } from '../../utils/mediaUrl';

const CoverImage = ({ url, style, radius = 0, children }) => {
  const [failed, setFailed] = useState(false);
  const source = mediaImageSource(url);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  const show = !!source && !failed;

  return (
    <View style={[styles.wrap, radius ? { borderRadius: radius, overflow: 'hidden' } : null, style]}>
      {show ? (
        <Image
          source={source}
          style={styles.image}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : null}
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
});

export default CoverImage;
