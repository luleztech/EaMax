import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Animated,
  ScrollView,
  ImageBackground,
  Linking,
  Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';

const { width } = Dimensions.get('window');
const CAROUSEL_WIDTH = width - 32; // Full width minus padding
const AUTO_SLIDE_INTERVAL = 4000; // 4 seconds
const POINTS_PER_AD = 20;

const ImageCarousel = ({ items, onWatchAd, onGoPremium, isPremium, premiumToggleOn }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lockedModalVisible, setLockedModalVisible] = useState(false);
  const scrollViewRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!items || items.length === 0) {
      return undefined;
    }

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
  }, [currentIndex, items]);

  const handleScroll = (event) => {
    if (!items || items.length === 0) return;
    const scrollPosition = event.nativeEvent.contentOffset.x;
    const index = Math.round(scrollPosition / CAROUSEL_WIDTH);
    if (index !== currentIndex) {
      setCurrentIndex(index);
    }
  };

  if (!items || items.length === 0) {
    return null;
  }

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
            <ImageBackground
              source={item.imageUrl ? { uri: item.imageUrl } : null}
              style={styles.slideGradient}
              imageStyle={styles.slideImage}>
              <View style={styles.slideContentWrapper}>
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
                    onPress={async () => {
                      if (item.videoUrl && isPremium) {
                        try {
                          const supported = await Linking.canOpenURL(item.videoUrl);
                          if (supported) {
                            await Linking.openURL(item.videoUrl);
                          }
                        } catch (error) {
                          console.error('Failed to open video URL:', error);
                        }
                      } else if (isPremium) {
                        // Premium, no video URL – do nothing or open link if any
                        if (item.videoUrl) {
                          try {
                            const supported = await Linking.canOpenURL(item.videoUrl);
                            if (supported) await Linking.openURL(item.videoUrl);
                          } catch (e) {}
                        }
                      } else if (premiumToggleOn) {
                        if (onGoPremium) onGoPremium();
                      } else {
                        setLockedModalVisible(true);
                      }
                    }}>
                    <Icon name="play" size={20} color="#fff" />
                    <Text style={styles.watchButtonText}>Watch Now</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ImageBackground>
          </Animated.View>
        ))}
      </ScrollView>
      {/* Locked content modal: Go Premium or Earn points (1 ad = 20 pts) */}
      <Modal
        visible={lockedModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLockedModalVisible(false)}>
        <View style={styles.lockedModalOverlay}>
          <View style={styles.lockedModalContent}>
            <Icon name="lock" size={40} color="#fbbf24" style={styles.lockedModalIcon} />
            <Text style={styles.lockedModalTitle}>Content Imefungwa</Text>
            <Text style={styles.lockedModalMessage}>
              Jiandikishe Premium au angalia matangazo kupata points (tangazo 1 = {POINTS_PER_AD} pts) uangalie bure. Points zinaongezwa kwenye profile yako.
            </Text>
            <TouchableOpacity
              style={styles.lockedModalPrimaryBtn}
              onPress={() => {
                setLockedModalVisible(false);
                if (onGoPremium) onGoPremium();
              }}>
              <Text style={styles.lockedModalPrimaryBtnText}>Nenda Premium</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.lockedModalSecondaryBtn}
              onPress={() => {
                setLockedModalVisible(false);
                if (onWatchAd) onWatchAd();
              }}>
              <Text style={styles.lockedModalSecondaryBtnText}>Pata Points (1 tangazo = {POINTS_PER_AD} pts)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.lockedModalCancelBtn} onPress={() => setLockedModalVisible(false)}>
              <Text style={styles.lockedModalCancelBtnText}>Funga</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
  slideImage: {
    borderRadius: 16,
  },
  slideContentWrapper: {
    flex: 1,
    backgroundColor: 'transparent',
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
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  slideSubtitle: {
    fontSize: 16,
    color: '#d1d5db',
    marginBottom: 16,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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
  lockedModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  lockedModalContent: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
  },
  lockedModalIcon: {
    marginBottom: 12,
  },
  lockedModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  lockedModalMessage: {
    fontSize: 14,
    color: '#d1d5db',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  lockedModalPrimaryBtn: {
    width: '100%',
    backgroundColor: '#eab308',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  lockedModalPrimaryBtnText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 16,
  },
  lockedModalSecondaryBtn: {
    width: '100%',
    backgroundColor: '#22c55e',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  lockedModalSecondaryBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  lockedModalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  lockedModalCancelBtnText: {
    color: '#9ca3af',
    fontSize: 14,
  },
});

export default ImageCarousel;
