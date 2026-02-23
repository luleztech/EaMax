import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

// YouTube-style: soft sweeping shine, flat card, smooth easing
const SHINE_WIDTH = 180;
const BASE_COLOR = '#252525';

const getShineColors = (highlightColor) => {
  if (highlightColor) {
    return [
      'transparent',
      'transparent',
      highlightColor,
      'transparent',
      'transparent',
    ];
  }
  return [
    'transparent',
    'rgba(255,255,255,0.03)',
    'rgba(255,255,255,0.12)',
    'rgba(255,255,255,0.06)',
    'transparent',
  ];
};

const ShimmerPlaceholder = ({
  width = 200,
  height = 120,
  borderRadius = 12,
  style,
  baseColor = BASE_COLOR,
  highlightColor,
}) => {
  const progress = useRef(new Animated.Value(0)).current;
  const shineColors = getShineColors(highlightColor);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1650,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      { resetBeforeIteration: true }
    );
    animation.start();
    return () => animation.stop();
  }, [progress]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-SHINE_WIDTH, width + SHINE_WIDTH],
  });

  return (
    <View style={[styles.outer, { width, height }, style]}>
      <View
        style={[
          styles.box,
          {
            width,
            height,
            borderRadius,
            backgroundColor: baseColor,
          },
        ]}>
        <Animated.View
          style={[
            styles.shineStrip,
            {
              width: SHINE_WIDTH,
              transform: [{ translateX }],
            },
          ]}>
          <LinearGradient
            colors={shineColors}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.shineGradient}
          />
        </Animated.View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    position: 'relative',
  },
  box: {
    overflow: 'hidden',
    position: 'relative',
  },
  shineStrip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
  shineGradient: {
    flex: 1,
    width: SHINE_WIDTH,
  },
});

export default ShimmerPlaceholder;
