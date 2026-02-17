import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Animated,
  ScrollView,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';

const { width } = Dimensions.get('window');
const CAROUSEL_WIDTH = width - 32; // Full width minus padding
const AUTO_SLIDE_INTERVAL = 4000; // 4 seconds

const ImageCarousel = ({ items, onWatchAd, isPremium }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollViewRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      const nextIndex = (currentIndex + 1) % items.length;
      setCurrentIndex(nextIndex);
      
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      scrollViewRef.current?.scrollTo({
        x: nextIndex * CAROUSEL_WIDTH,
        animated: true,
      });
    }, AUTO_SLIDE_INTERVAL);

    return () => clearInterval(interval);
  }, [currentIndex, items.length]);

  const handleScroll = (event) => {
    const scrollPosition = event.nativeEvent.contentOffset.x;
    const index = Math.round(scrollPosition / CAROUSEL_WIDTH);
    if (index !== currentIndex) {
      setCurrentIndex(index);
    }
  };

  return (
    <View style={styles.carouselContainer}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        style={styles.scrollView}>
        {items.map((item, index) => (
          <Animated.View
            key={index}
            style={[
              styles.slide,
              {
                opacity: fadeAnim,
              },
            ]}>
            <LinearGradient
              colors={item.gradient || ['#14532d', '#111827', '#000000']}
              style={styles.slideGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}>
              <View style={styles.slideOverlay} />
              {item.badge && (
                <View style={styles.badge}>
                  <View style={styles.badgeDot} />
                  <Text style={styles.badgeText}>{item.badge}</Text>
                </View>
              )}
              <View style={styles.slideContent}>
                <Text style={styles.slideTitle}>{item.title}</Text>
                {item.subtitle && (
                  <Text style={styles.slideSubtitle}>{item.subtitle}</Text>
                )}
                {item.info && (
                  <View style={styles.slideInfo}>
                    {item.info.map((infoItem, i) => (
                      <View key={i} style={styles.infoItem}>
                        {infoItem.icon && (
                          <AntDesign name={infoItem.icon} size={14} color="#fbbf24" />
                        )}
                        <Text style={styles.infoText}>{infoItem.text}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <TouchableOpacity
                  style={styles.watchButton}
                  onPress={() => onWatchAd && onWatchAd()}>
                  <Icon name="play" size={20} color="#fff" />
                  <Text style={styles.watchButtonText}>
                    {isPremium ? 'Watch Now' : 'Watch Ad to Stream'}
                  </Text>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </Animated.View>
        ))}
      </ScrollView>
      {/* Pagination Dots */}
      <View style={styles.pagination}>
        {items.map((_, index) => (
          <View
            key={index}
            style={[
              styles.dot,
              index === currentIndex && styles.dotActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  carouselContainer: {
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  scrollView: {
    borderRadius: 16,
  },
  slide: {
    width: CAROUSEL_WIDTH,
    height: 240,
    borderRadius: 16,
    overflow: 'hidden',
    marginHorizontal: 0,
  },
  slideGradient: {
    flex: 1,
    borderRadius: 16,
  },
  slideOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  badge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#dc2626',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    zIndex: 1,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  slideContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  slideTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  slideSubtitle: {
    fontSize: 16,
    color: '#d1d5db',
    marginBottom: 16,
    textAlign: 'center',
  },
  slideInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  infoText: {
    fontSize: 14,
    color: '#fff',
  },
  watchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#22c55e',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  watchButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  dotActive: {
    width: 24,
    backgroundColor: '#22c55e',
  },
});

export default ImageCarousel;
