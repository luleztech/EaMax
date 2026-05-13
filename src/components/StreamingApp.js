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
import realtimeSyncService from '../services/realtimeSync';
import backgroundSyncService from '../services/backgroundSync';
import cacheService from '../services/cacheService';

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

  // Handle real-time WebSocket updates
  const handleRealtimeUpdate = useCallback((channel, data) => {
    console.log(`[RealtimeUpdate] Received update on ${channel}:`, data);
    if (channel === 'user_premium_update') {
      // Update premium status immediately from WebSocket
      // Support both camelCase and snake_case from backend
      const isPrem = !!data.isPremium || !!data.is_premium;
      const expiresAt = data.premiumExpiresAt || data.premium_expires_at;
      
      console.log(`[RealtimeUpdate] Premium update: ${isPrem}, expires: ${expiresAt}`);
      
      // Instantly set UI to premium
      setIsPremium(isPrem);
      
      // Show congrats if wasn't already shown
      if (isPrem) {
        AsyncStorage.getItem('userId').then(uid => {
          if (uid) {
            AsyncStorage.getItem(`${CONGRATS_STORAGE_KEY}_${uid}`).then(shown => {
              if (!shown) {
                setCongratsModalVisible(true);
                setHasShownCongrats(true);
                AsyncStorage.setItem(`${CONGRATS_STORAGE_KEY}_${uid}`, '1');
              }
            });
          }
        });
      }
      
      cacheService.update('user_data', {
        isPremium: isPrem,
        premium_expires_at: expiresAt,
      });
    } else if (channel === 'user_points_update') {
      // Update points immediately from WebSocket
      const pts = data.points || 0;
      console.log(`[RealtimeUpdate] Points update: ${pts}`);
      setUserPoints(pts);
      cacheService.update('user_data', { points: pts });
    }
  }, [CONGRATS_STORAGE_KEY]);

  // Handle notifications from FCM
  const handleNotificationReceived = useCallback((remoteMessage) => {
    const data = remoteMessage?.data || {};
    if (data.type === 'payment_success' || data.type === 'admin_access_granted') {
      // Refresh user data when payment succeeds or admin grants access
      refreshUserPoints();
    }
  }, [refreshUserPoints]);

  const refreshUserPoints = useCallback(async () => {
    try {
      const userId = await AsyncStorage.getItem('userId');
      if (userId) {
        // Fetch user data and update cache
        const userData = await userAPI.getUser(userId);
        const points = userData.points ?? 0;
        const premium = !!userData.isPremium;

        // Cache the user data with 60 second TTL
        cacheService.set('user_data', {
          points,
          isPremium: premium,
          premium_expires_at: userData.subscriptionEndDate,
          _fetchedAt: Date.now(),
        }, 60);

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
          // Check cache first for faster load
          const cachedUser = cacheService.get('user_data');
          if (cachedUser) {
            setUserPoints(cachedUser.points ?? 0);
            setIsPremium(!!cachedUser.isPremium);
          }

          // Then refresh from server (will update cache)
          await refreshUserPoints();

          // Refresh FCM token on every app open so backend has latest token
          refreshAndRegisterFCMToken(userId).catch(() => {});

          // Initialize real-time WebSocket connection for instant updates
          try {
            await realtimeSyncService.connect(userId);
            // Subscribe to user-specific channels
            realtimeSyncService.subscribe('user_premium_update', (data) =>
              handleRealtimeUpdate('user_premium_update', data)
            );
            realtimeSyncService.subscribe('user_points_update', (data) =>
              handleRealtimeUpdate('user_points_update', data)
            );
            console.log('[App] Real-time sync connected');
          } catch (err) {
            console.warn('[App] Failed to connect real-time sync:', err.message);
          }

          // Pending payment check
          const pendingOrderId = await AsyncStorage.getItem('pendingPaymentOrderId');
          if (pendingOrderId && typeof pendingOrderId === 'string' && pendingOrderId.trim()) {
            try {
              const res = await paymentsAPI.checkPaymentStatus(pendingOrderId.trim());
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
    return () => {
      cancelled = true;
      // Disconnect real-time sync on unmount
      realtimeSyncService.disconnect();
    };
  }, [refreshUserPoints, handleRealtimeUpdate]);

  // Initialize background sync service
  useEffect(() => {
    backgroundSyncService.initialize();

    // Register sync task to check user status
    backgroundSyncService.registerTask('refresh_user_status', refreshUserPoints, 60000); // 60 seconds

    // Start sync timer
    backgroundSyncService.startSyncTimer(30000); // Check every 30 seconds

    return () => {
      backgroundSyncService.cleanup();
    };
  }, [refreshUserPoints]);

  // Poll user status every 30 seconds for faster updates
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const userId = await AsyncStorage.getItem('userId');
        if (userId) {
          await refreshUserPoints();
        }
      } catch (error) {
        console.error('Polling user status failed:', error);
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
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
          setupNotificationHandlers(handleNotificationReceived, userId);
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
              setupNotificationHandlers(handleNotificationReceived, userId);
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

  /**
   * Ultra-fast payment success handler
   * Instantly updates UI and triggers server refresh in background
   */
  const handlePaymentSuccess = useCallback(async () => {
    console.log('[Payment] Success! Triggering instant premium upgrade...');
    
    // Immediately set premium to true for instant visual feedback
    setIsPremium(true);
    
    // Clear any congrats storage to show message
    const userId = await AsyncStorage.getItem('userId');
    if (userId) {
      await AsyncStorage.removeItem(`${CONGRATS_STORAGE_KEY}_${userId}`);
      setCongratsModalVisible(true);
      setHasShownCongrats(true);
    }

    // Refresh user data from server in the background (won't block UI)
    refreshUserPoints().catch(err => console.error('Background refresh failed:', err));
    
    // Also trigger real-time WebSocket sync if available
    if (realtimeSyncService.isConnected) {
      try {
        realtimeSyncService.send({
          type: 'sync_user_data',
          userId,
        });
      } catch (err) {
        console.log('[Payment] Could not trigger WebSocket sync:', err.message);
      }
    }
  }, [refreshUserPoints, CONGRATS_STORAGE_KEY]);

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
          onPointsRefresh={handlePaymentSuccess}
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
