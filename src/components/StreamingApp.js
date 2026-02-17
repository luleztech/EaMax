import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import FootballApp from './FootballApp';
import MoviesApp from './MoviesApp';
import AdModal from './AdModal';

const { width } = Dimensions.get('window');

const StreamingApp = () => {
  const [currentApp, setCurrentApp] = useState('football');
  const [isPremium, setIsPremium] = useState(false);
  const [userPoints, setUserPoints] = useState(350);
  const [adModalVisible, setAdModalVisible] = useState(false);
  const [isPaymentsActive, setIsPaymentsActive] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const indicatorAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(indicatorAnim, {
      toValue: currentApp === 'movies' ? 1 : 0,
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start();
  }, [currentApp]);

  const switchApp = (app) => {
    if (app === currentApp) return;
    
    // Fade out animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: app === 'movies' ? -50 : 50,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setCurrentApp(app);
      // Fade in animation
      slideAnim.setValue(app === 'movies' ? 50 : -50);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  const togglePremium = (value) => {
    setIsPremium(value);
  };

  const handleWatchAd = () => {
    if (isPremium) {
      // Premium users can watch directly
      return;
    }
    setAdModalVisible(true);
  };

  const handleAdComplete = () => {
    setUserPoints((prev) => prev + 10);
  };

  const handleCloseAd = () => {
    setAdModalVisible(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* App Switcher */}
      {!isPaymentsActive && (
        <View style={styles.appSwitcher}>
        <View style={styles.switchContainer}>
          <Animated.View
            style={[
              styles.switchIndicator,
              {
                transform: [
                  {
                    translateX: indicatorAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, (width - 64) / 2],
                    }),
                  },
                ],
              },
            ]}
          />
          <TouchableOpacity
            style={[styles.switchButton, styles.switchButtonLeft]}
            onPress={() => switchApp('football')}
            activeOpacity={0.7}>
            <Icon
              name="football"
              size={22}
              color={currentApp === 'football' ? '#fff' : '#9ca3af'}
            />
            <Text
              style={[
                styles.switchButtonText,
                currentApp === 'football' && styles.switchButtonTextActive,
              ]}>
              Kabumbu
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.switchButton, styles.switchButtonRight]}
            onPress={() => switchApp('movies')}
            activeOpacity={0.7}>
            <Icon
              name="filmstrip"
              size={22}
              color={currentApp === 'movies' ? '#fff' : '#9ca3af'}
            />
            <Text
              style={[
                styles.switchButtonText,
                currentApp === 'movies' && styles.switchButtonTextActive,
              ]}>
              Movies na Habari
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      )}

      {/* Premium Toggle */}
      {!isPaymentsActive && (
        <View style={styles.premiumToggleContainer}>
        <Text style={styles.premiumToggleLabel}>Angalia Bure:</Text>
        <View style={styles.toggleWrapper}>
          <Switch
            value={isPremium}
            onValueChange={togglePremium}
            trackColor={{ false: '#374151', true: '#eab308' }}
            thumbColor={isPremium ? '#fff' : '#fff'}
            ios_backgroundColor="#374151"
          />
          <Text
            style={[
              styles.premiumLabel,
              isPremium && styles.premiumLabelActive,
            ]}>
            {isPremium ? 'Premium User' : 'Ondoa Matangazo'}
          </Text>
        </View>
      </View>
      )}

      {/* App Display Area */}
      <View style={styles.appContainer}>
        <Animated.View
          style={[
            styles.appWrapper,
            {
              opacity: fadeAnim,
              transform: [{ translateX: slideAnim }],
            },
          ]}>
          {currentApp === 'football' ? (
            <FootballApp
              isPremium={isPremium}
              userPoints={userPoints}
              onWatchAd={handleWatchAd}
              onPaymentsActiveChange={setIsPaymentsActive}
            />
          ) : (
            <MoviesApp
              isPremium={isPremium}
              userPoints={userPoints}
              onWatchAd={handleWatchAd}
              onPaymentsActiveChange={setIsPaymentsActive}
            />
          )}
        </Animated.View>
      </View>

      {/* Ad Modal */}
      <AdModal
        visible={adModalVisible}
        onClose={handleCloseAd}
        onComplete={handleAdComplete}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
  },
  appSwitcher: {
    paddingVertical: 12,
    paddingHorizontal: 30,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 60,
  },
  switchContainer: {
    flexDirection: 'row',
    backgroundColor: '#1f2937',
    borderRadius: 16,
    padding: 4,
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    maxWidth: width - 32,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
  },
  switchIndicator: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: ((width - 64) / 2) - 4,
    height: 44,
    backgroundColor: '#22c55e',
    borderRadius: 12,
    zIndex: 0,
  },
  switchButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    zIndex: 1,
    minHeight: 44,
  },
  switchButtonLeft: {
    marginRight: 2,
  },
  switchButtonRight: {
    marginLeft: 2,
  },
  switchButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#9ca3af',
    letterSpacing: 0.5,
  },
  switchButtonTextActive: {
    color: '#fff',
  },
  appWrapper: {
    flex: 1,
  },
  premiumToggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(31, 41, 55, 0.5)',
  },
  premiumToggleLabel: {
    fontSize: 14,
    color: '#9ca3af',
  },
  toggleWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  premiumLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  premiumLabelActive: {
    color: '#fbbf24',
  },
  appContainer: {
    flex: 1,
  },
});

export default StreamingApp;
