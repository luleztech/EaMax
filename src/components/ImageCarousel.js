import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Animated,
  Easing,
  Image,
  ImageBackground,
  PanResponder,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';

const { width } = Dimensions.get('window');
const CAROUSEL_WIDTH = width - 32;
const CAROUSEL_HEIGHT = 320;
const AUTO_SLIDE_INTERVAL = 5000;
const TRANSITION_DURATION = 680;
const SWIPE_THRESHOLD = 55;
const ImageCarousel = ({ items }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const slideOffset = useRef(new Animated.Value(0)).current;
  const isAnimatingRef = useRef(false);
  const currentIndexRef = useRef(0);
  const autoTimerRef = useRef(null);
  const queuedSlideRef = useRef(null);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    if (!items || items.length === 0) return;
    items.forEach((item) => {
      const url = item?.imageUrl;
      if (url && typeof url === 'string') {
        Image.prefetch(url).catch(() => {});
      }
    });
  }, [items]);

  const triggerSlide = (targetIndex) => {
    if (!items || items.length <= 1) return;
    if (targetIndex === currentIndexRef.current) return;

    if (isAnimatingRef.current) {
      queuedSlideRef.current = targetIndex;
      return;
    }

    isAnimatingRef.current = true;
    const targetX = -targetIndex * CAROUSEL_WIDTH;

    Animated.timing(slideOffset, {
      toValue: targetX,
      duration: TRANSITION_DURATION,
      easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setCurrentIndex(targetIndex);
        isAnimatingRef.current = false;

        const queued = queuedSlideRef.current;
        if (queued !== null) {
          queuedSlideRef.current = null;
          triggerSlide(queued);
        }
      }
    });
  };

  const goTo = (dir) => {
    if (isAnimatingRef.current || !items || items.length <= 1) return;
    const next = ((currentIndexRef.current + dir) + items.length) % items.length;
    triggerSlide(next);
  };

  // ── Auto-advance ─────────────────────────────────────────────────────────────
  const resetTimer = () => {
    if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    if (!items || items.length <= 1) return;
    autoTimerRef.current = setInterval(() => goTo(1), AUTO_SLIDE_INTERVAL);
  };

  useEffect(() => {
    resetTimer();
    return () => { if (autoTimerRef.current) clearInterval(autoTimerRef.current); };
  }, [items]);

  // ── Swipe gesture ────────────────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dy) < 50,
      onPanResponderRelease: (_, g) => {
        if (isAnimatingRef.current) return;
        if (g.dx < -SWIPE_THRESHOLD) {
          goTo(1);
        } else if (g.dx > SWIPE_THRESHOLD) {
          goTo(-1);
        }
      },
    })
  ).current;

  if (!items || items.length === 0) return null;

  // ── Slide content ────────────────────────────────────────────────────────────
  const renderSlide = (item) => (
    <ImageBackground
      source={item.imageUrl ? { uri: item.imageUrl } : null}
      style={[styles.slideGradient, { backgroundColor: '#0c0f1a' }]}
      imageStyle={styles.slideImage}>
      {/* Dark vignette for text readability */}
      <LinearGradient
        colors={['rgba(0,0,0,0.08)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.72)']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      {/* Badge top-left */}
      {item.badge && (
        <View style={styles.badge}>
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>{item.badge}</Text>
        </View>
      )}

      {/* Centred content */}
      <View style={styles.slideContent}>
        {item.title ? (
          <Text style={styles.slideTitle} numberOfLines={2}>{item.title}</Text>
        ) : null}
        {item.subtitle ? (
          <Text style={styles.slideSubtitle} numberOfLines={2}>{item.subtitle}</Text>
        ) : null}
        {item.info && item.info.length > 0 && (
          <View style={styles.slideInfo}>
            {item.info.map((inf, i) => (
              <View key={i} style={styles.infoItem}>
                {inf.icon ? <AntDesign name={inf.icon} size={13} color="#fbbf24" /> : null}
                <Text style={styles.infoText}>{inf.text}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </ImageBackground>
  );

  // ── Render: single horizontal strip, pure translateX sliding ──────────────────
  return (
    <View style={styles.carouselContainer}>
      <View style={styles.slideStack} {...panResponder.panHandlers}>
        <Animated.View
          style={[
            styles.slideStrip,
            { width: CAROUSEL_WIDTH * items.length, transform: [{ translateX: slideOffset }] },
          ]}>
          {items.map((item, i) => (
            <View key={i} style={styles.slide}>
              {renderSlide(item)}
            </View>
          ))}
        </Animated.View>

        {/* Left / Right tap zones */}
        {items.length > 1 && (
          <>
            <TouchableOpacity
              style={styles.navZoneLeft}
              activeOpacity={0.4}
              onPress={() => { goTo(-1); resetTimer(); }}>
              <View style={styles.navArrow}>
                <Icon name="chevron-left" size={20} color="rgba(255,255,255,0.85)" />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navZoneRight}
              activeOpacity={0.4}
              onPress={() => { goTo(1); resetTimer(); }}>
              <View style={styles.navArrow}>
                <Icon name="chevron-right" size={20} color="rgba(255,255,255,0.85)" />
              </View>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Pagination dots */}
      {items.length > 1 && (
        <View style={styles.pagination}>
          {items.map((_, i) => {
            const isActive = i === currentIndex;
            return (
              <TouchableOpacity
                key={i}
                onPress={() => { triggerSlide(i); resetTimer(); }}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                <View style={[styles.dot, isActive && styles.dotActive]} />
              </TouchableOpacity>
            );
          })}
        </View>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  carouselContainer: {
    marginBottom: 8,
    paddingHorizontal: 16,
  },

  // ── Slide stack ──
  slideStack: {
    width: CAROUSEL_WIDTH,
    height: CAROUSEL_HEIGHT,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#0c0f1a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 14,
  },
  slideStrip: {
    flexDirection: 'row',
    height: CAROUSEL_HEIGHT,
  },
  slide: {
    width: CAROUSEL_WIDTH,
    height: CAROUSEL_HEIGHT,
    flexShrink: 0,
  },
  slideGradient: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  slideImage: {
    resizeMode: 'cover',
  },

  // ── Slide content ──
  slideContent: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: 12,
  },
  slideTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 4,
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  slideSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.82)',
    marginBottom: 10,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  slideInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  infoText: {
    fontSize: 12,
    color: '#fbbf24',
    fontWeight: '600',
  },

  // ── Badge ──
  badge: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#dc2626',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    zIndex: 2,
  },
  badgeDot: {
    width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#fff',
  },
  badgeText: {
    color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.4,
  },

  // ── Nav arrow zones ──
  navZoneLeft: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 48,
    justifyContent: 'center', alignItems: 'flex-start', paddingLeft: 8,
  },
  navZoneRight: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: 48,
    justifyContent: 'center', alignItems: 'flex-end', paddingRight: 8,
  },
  navArrow: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.38)',
    justifyContent: 'center', alignItems: 'center',
  },

  // ── Pagination dots ──
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  dotActive: {
    width: 22, height: 7, borderRadius: 3.5,
    backgroundColor: '#22c55e',
  },

});

export default ImageCarousel;
