import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  AppState,
  InteractionManager,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import LinearGradient from 'react-native-linear-gradient';
import CombinedApp from './CombinedApp';
import AdModal from './AdModal';
import NotificationPermissionModal from './NotificationPermissionModal';
import { userAPI, paymentsAPI, settingsAPI } from '../config/api';
import { getOrCreateUserId } from '../services/userId';
import {
  initializeNotifications,
  setupNotificationHandlers,
  markNotificationPermissionAsked,
  isNotificationPermissionGranted,
  requestNotificationPermission,
  refreshAndRegisterFCMToken,
} from '../services/notifications';

const StreamingApp = () => {
  const [isPremium, setIsPremium] = useState(false);
  const [channelsPremiumOnly, setChannelsPremiumOnly] = useState(false);
  const [userPoints, setUserPoints] = useState(0);
  const [adModalVisible, setAdModalVisible] = useState(false);
  const [isPaymentsActive, setIsPaymentsActive] = useState(false);
  const [congratsModalVisible, setCongratsModalVisible] = useState(false);
  const [hasShownCongrats, setHasShownCongrats] = useState(false);
  const [notifPermissionVisible, setNotifPermissionVisible] = useState(false);

  const CONGRATS_STORAGE_KEY = 'premiumCongratsShown';

  const refreshUserPoints = useCallback(async () => {
    try {
      const userId = await AsyncStorage.getItem('userId');
      if (userId) {
        const userData = await userAPI.getUser(userId);
        const points = userData.points ?? 0;
        const premium = !!userData.isPremium;
        setUserPoints(points);
        if (premium) {
          const alreadyShown = await AsyncStorage.getItem(`${CONGRATS_STORAGE_KEY}_${userId}`);
          if (!alreadyShown) {
            setCongratsModalVisible(true);
            setHasShownCongrats(true);
            await AsyncStorage.setItem(`${CONGRATS_STORAGE_KEY}_${userId}`, '1');
          } else {
            setHasShownCongrats(true);
          }
        }
        setIsPremium(premium);
        return points;
      }
    } catch (error) {
      console.error('Failed to refresh user points:', error);
    }
    return userPoints;
  }, [userPoints]);

  // Ensure user ID exists, load settings, and refresh FCM token on every app open
  // Token refresh is critical: FCM tokens can expire after ~270 days of inactivity (Android).
  // Users who don't open the app often need a fresh token when they do open it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [userId, settings] = await Promise.all([
          getOrCreateUserId(),
          settingsAPI.getChannelsPremiumOnly().catch(() => ({ channelsPremiumOnly: false })),
        ]);
        if (!cancelled) setChannelsPremiumOnly(!!settings.channelsPremiumOnly);
        if (cancelled) return;
        if (userId) {
          await refreshUserPoints();
          // Refresh FCM token on every app open so backend has latest token
          // (users who haven't opened in weeks get their token updated when they do)
          refreshAndRegisterFCMToken(userId).catch(() => {});
          // Pending payment check
          const pendingOrderId = await AsyncStorage.getItem('pendingPaymentOrderId');
          if (pendingOrderId && typeof pendingOrderId === 'string' && pendingOrderId.trim()) {
            try {
              const res = await paymentsAPI.checkZenoStatus(pendingOrderId.trim());
              const status = (res && (res.status || res.raw?.data?.[0]?.payment_status)) || '';
              if (String(status).toUpperCase() === 'COMPLETED') {
                await AsyncStorage.removeItem('pendingPaymentOrderId');
                await refreshUserPoints();
              }
            } catch (_) {}
          }
        }
      } catch (e) {
        console.warn('App user init:', e?.message || e);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshUserPoints]);

  // Show notification permission modal for every user who has not granted yet (like YouTube/WhatsApp).
  // So even if they skipped before or didn't open the app for a long time, they see the modal on next open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const userId = await getOrCreateUserId();
        if (cancelled || !userId) return;

        const isGranted = await isNotificationPermissionGranted();

        // If already granted, initialize notifications immediately so they receive in status bar
        if (isGranted) {
          await initializeNotifications(userId);
          setupNotificationHandlers(() => {}, userId);
          return;
        }

        // Show allow modal whenever permission is NOT granted so all users get a chance to enable notifications
        const showModal = () => {
          if (!cancelled) setNotifPermissionVisible(true);
        };
        setTimeout(showModal, 600);
      } catch (e) {
        console.warn('App notification init:', e?.message || e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleNotifAllow = async () => {
    await markNotificationPermissionAsked();

    // Close our modal first — the system "Allow notifications?" dialog cannot show on top of it
    setNotifPermissionVisible(false);

    // Wait for modal to fully unmount and UI to settle, then show the system permission dialog
    InteractionManager.runAfterInteractions(() => {
      setTimeout(async () => {
        try {
          const granted = await requestNotificationPermission();
          console.log('[NotifModal] System permission granted:', granted);

          if (granted) {
            const userId = await getOrCreateUserId();
            if (userId) {
              await initializeNotifications(userId);
              setupNotificationHandlers(() => {}, userId);
              console.log('[NotifModal] Notifications initialized successfully');
            }
          } else {
            console.log('[NotifModal] Permission denied or system dialog did not show');
          }
        } catch (e) {
          console.warn('[NotifModal] Allow error:', e?.message || e);
        }
      }, 600);
    });
  };

  const handleNotifSkip = async () => {
    setNotifPermissionVisible(false);
    await markNotificationPermissionAsked();
  };

  // When app comes to foreground: refresh FCM token and channels premium-only setting
  // so admin toggle takes effect without user reopening the app
  useEffect(() => {
    const refreshSettings = () => {
      settingsAPI.getChannelsPremiumOnly()
        .then((data) => setChannelsPremiumOnly(!!data.channelsPremiumOnly))
        .catch(() => {});
    };
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      getOrCreateUserId().then((userId) => {
        if (userId) refreshAndRegisterFCMToken(userId).catch(() => {});
      });
      refreshSettings();
    });
    return () => subscription?.remove();
  }, []);

  // Poll channels premium-only every 60s so when admin flips the button the app updates automatically
  useEffect(() => {
    const interval = setInterval(() => {
      settingsAPI.getChannelsPremiumOnly()
        .then((data) => setChannelsPremiumOnly(!!data.channelsPremiumOnly))
        .catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleWatchAd = () => {
    if (isPremium) return;
    setAdModalVisible(true);
  };

  const handleAdComplete = async () => {
    await refreshUserPoints();
  };

  const handleCloseAd = () => {
    setAdModalVisible(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.appContainer}>
        <CombinedApp
          isPremium={isPremium}
          channelsPremiumOnly={channelsPremiumOnly}
          userPoints={userPoints}
          onWatchAd={handleWatchAd}
          onPaymentsActiveChange={setIsPaymentsActive}
          onPointsRefresh={refreshUserPoints}
        />
      </View>

      <AdModal
        visible={adModalVisible}
        onClose={handleCloseAd}
        onComplete={handleAdComplete}
      />

      <NotificationPermissionModal
        visible={notifPermissionVisible}
        onAllow={handleNotifAllow}
        onSkip={handleNotifSkip}
      />

      {/* Congrats modal when user becomes premium */}
      <Modal
        visible={congratsModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCongratsModalVisible(false)}>
        <View style={styles.congratsOverlay}>
          <View style={styles.congratsCard}>
            <LinearGradient
              colors={['#eab308', '#ca8a04', '#a16207']}
              style={styles.congratsGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}>
              <View style={styles.congratsIconWrap}>
                <AntDesign name="star" size={48} color="#fff" />
              </View>
              <Text style={styles.congratsTitle}>Hongera! Umefanikiwa</Text>
              <Text style={styles.congratsMessage}>
                Umajiunga nasi kama mwanachama wa Premium. Channels zote sasa ni bure kwako – hakuna matangazo, hakuna vikwazo hadi muda wako utakapokwisha.
              </Text>
              <TouchableOpacity
                style={styles.congratsButton}
                onPress={() => setCongratsModalVisible(false)}
                activeOpacity={0.9}>
                <Text style={styles.congratsButtonText}>Sawa</Text>
              </TouchableOpacity>
            </LinearGradient>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
  },
  appContainer: { flex: 1 },
  congratsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  congratsCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(234, 179, 8, 0.5)',
  },
  congratsGradient: {
    padding: 28,
    alignItems: 'center',
  },
  congratsIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  congratsTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  congratsMessage: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.95)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  congratsButton: {
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 14,
  },
  congratsButtonText: {
    color: '#a16207',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default StreamingApp;
