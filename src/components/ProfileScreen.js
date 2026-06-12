import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LinearGradient from 'react-native-linear-gradient';
import AntDesign from 'react-native-vector-icons/AntDesign';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { userAPI } from '../config/api';
import { resolvePremiumFromUserData } from '../utils/premiumStatus';
import { getOrCreateUserId } from '../services/userId';
import {
  initializeNotifications,
  setupNotificationHandlers,
} from '../services/notifications';

const { width } = Dimensions.get('window');

const ProfileScreen = ({
  accentColor = '#4ade80',
  onWatchAd,
  userPoints: parentPoints,
  isPremium: parentIsPremium,
  subscriptionEndDate: parentSubscriptionEndDate,
  onPointsRefresh,
  bottomPadding = 0,
}) => {
  const [userId, setUserId] = useState(null);
  const [isPremium, setIsPremium] = useState(!!parentIsPremium);
  const [userPoints, setUserPoints] = useState(parentPoints ?? 0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [timeRemaining, setTimeRemaining] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  const [subscriptionEndDate, setSubscriptionEndDate] = useState(null);
  const prevParentPremium = useRef(undefined);

  // Load user data: use shared getOrCreateUserId (ID already created on app load), then fetch latest from backend
  const loadUserData = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const storedUserId = await getOrCreateUserId();
      if (!storedUserId) {
        setLoading(false);
        return;
      }
      setUserId(storedUserId);

      // Fetch latest user data (source of truth for points, premium, subscription)
      try {
        const userData = await userAPI.getUser(storedUserId);
        const { premium, subEnd } = resolvePremiumFromUserData(userData);
        setIsPremium(parentIsPremium === true ? true : premium);
        if (parentPoints === undefined || parentPoints === null) {
          setUserPoints(userData.points ?? 0);
        }
        setSubscriptionEndDate(premium ? subEnd : null);
      } catch (fetchError) {
        console.error('Failed to fetch user data:', fetchError);
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [parentPoints, parentIsPremium]);

  useEffect(() => {
    if (parentPoints !== undefined && parentPoints !== null) {
      setUserPoints(parentPoints);
    }
  }, [parentPoints]);

  useEffect(() => {
    if (parentIsPremium !== undefined && parentIsPremium !== null) {
      setIsPremium(!!parentIsPremium);
    }
  }, [parentIsPremium]);

  useEffect(() => {
    if (parentSubscriptionEndDate) {
      const d =
        parentSubscriptionEndDate instanceof Date
          ? parentSubscriptionEndDate
          : new Date(parentSubscriptionEndDate);
      if (!Number.isNaN(d.getTime())) setSubscriptionEndDate(d);
    } else if (parentIsPremium === false) {
      setSubscriptionEndDate(null);
    }
  }, [parentSubscriptionEndDate, parentIsPremium]);

  useEffect(() => {
    if (parentIsPremium && !prevParentPremium.current) {
      loadUserData(false);
    }
    prevParentPremium.current = parentIsPremium;
  }, [parentIsPremium, loadUserData]);

  // Load or generate user ID and register with backend
  useEffect(() => {
    loadUserData(true);
  }, [loadUserData]);

  // Initialize push notifications when user ID is available (permission + FCM)
  useEffect(() => {
    if (!userId) return;
    let unsubscribe = () => {};
    try {
      initializeNotifications(userId).catch((err) => {
        console.warn('Notifications init:', err?.message || err);
      });
      unsubscribe = setupNotificationHandlers((remoteMessage) => {
        if (remoteMessage) console.log('Notification received');
      }, userId);
    } catch (err) {
      console.warn('Notification setup error:', err?.message || err);
    }
    return () => {
      try {
        if (typeof unsubscribe === 'function') unsubscribe();
      } catch (e) {}
    };
  }, [userId]);

  // Refresh user data (sync points from parent when provided)
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (onPointsRefresh) await onPointsRefresh();
      await loadUserData(false);
    } finally {
      setRefreshing(false);
    }
  };

  // Handle watch ad with automatic points refresh
  const handleWatchAd = () => {
    if (onWatchAd) {
      // Call the parent's onWatchAd to open the modal
      onWatchAd();
      
      // Refresh points after ad completes (ad modal takes ~6-7 seconds)
      // Refresh multiple times to ensure we catch the backend update
      setTimeout(() => {
        loadUserData(false);
      }, 7500); // After ad completes
      
      setTimeout(() => {
        loadUserData(false);
      }, 10000); // Backup refresh
      
      setTimeout(() => {
        loadUserData(false);
      }, 12000); // Final refresh
    }
  };

  // Countdown timer for premium users (subscription end comes from API: paid or admin-granted)
  useEffect(() => {
    if (!isPremium || !subscriptionEndDate) return;

    const updateCountdown = () => {
      const now = new Date().getTime();
      const end = subscriptionEndDate.getTime();
      const difference = end - now;

      if (difference > 0) {
        const days = Math.floor(difference / (1000 * 60 * 60 * 24));
        const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((difference % (1000 * 60)) / 1000);

        setTimeRemaining({ days, hours, minutes, seconds });
      } else {
        setTimeRemaining({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        setIsPremium(false);
        setSubscriptionEndDate(null);
        if (onPointsRefresh) onPointsRefresh();
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [isPremium, subscriptionEndDate, onPointsRefresh]);

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <LinearGradient
          colors={['#030712', '#111827', '#000000']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <ActivityIndicator size="large" color={accentColor} />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#030712', '#111827', '#000000']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: 100 + bottomPadding }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
        {/* Header Section */}
        <View style={styles.headerSection}>
          <View style={[styles.avatarContainer, { backgroundColor: `${accentColor}20` }]}>
            <Icon name="account" size={48} color={accentColor} />
          </View>
          <Text style={styles.userIdText}>{userId || 'Loading...'}</Text>
          <View style={[styles.statusBadge, isPremium ? styles.premiumBadge : styles.freeBadge]}>
            <Icon
              name={isPremium ? 'crown' : 'account-circle'}
              size={16}
              color={isPremium ? '#fbbf24' : '#9ca3af'}
            />
            <Text style={[styles.statusText, isPremium && styles.premiumStatusText]}>
              {isPremium ? 'Premium User' : 'Free User'}
            </Text>
          </View>
        </View>

        {/* Account Info Card */}
        <View style={styles.infoCard}>
          {isPremium ? (
            <>
              <View style={styles.sectionHeader}>
                <Icon name="clock-outline" size={20} color={accentColor} />
                <Text style={styles.sectionTitle}>Muda uliobaki ni</Text>
              </View>
              <View style={styles.countdownContainer}>
                <View style={styles.countdownItem}>
                  <Text style={styles.countdownValue}>{timeRemaining.days}</Text>
                  <Text style={styles.countdownLabel}>Siku</Text>
                </View>
                <Text style={styles.countdownSeparator}>:</Text>
                <View style={styles.countdownItem}>
                  <Text style={styles.countdownValue}>{String(timeRemaining.hours).padStart(2, '0')}</Text>
                  <Text style={styles.countdownLabel}>Masaa</Text>
                </View>
                <Text style={styles.countdownSeparator}>:</Text>
                <View style={styles.countdownItem}>
                  <Text style={styles.countdownValue}>{String(timeRemaining.minutes).padStart(2, '0')}</Text>
                  <Text style={styles.countdownLabel}>Dakika</Text>
                </View>
                <Text style={styles.countdownSeparator}>:</Text>
                <View style={styles.countdownItem}>
                  <Text style={styles.countdownValue}>{String(timeRemaining.seconds).padStart(2, '0')}</Text>
                  <Text style={styles.countdownLabel}>Sekunde</Text>
                </View>
              </View>
              <View style={styles.countdownTextContainer}>
                <Text style={styles.countdownText}>
                 Muda wa matumizi ulio salia kwa mteja wa malipo
                </Text>
                {subscriptionEndDate && (
                  <Text style={[styles.countdownText, styles.expiresOnText]}>
                    Inaisha tarehe: {subscriptionEndDate.toLocaleDateString('sw-TZ', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </Text>
                )}
              </View>
            </>
          ) : (
            <>
              <View style={styles.sectionHeader}>
                <AntDesign name="star" size={20} color="#fbbf24" />
                <Text style={styles.sectionTitle}>Jumla ya Points</Text>
                {onWatchAd && (
                  <TouchableOpacity
                    style={styles.adsButton}
                    onPress={handleWatchAd}
                    activeOpacity={0.8}>
                    <LinearGradient
                      colors={['#22c55e', '#16a34a']}
                      style={styles.adsButtonGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}>
                      <AntDesign name="plus" size={16} color="#fff" />
                      <Text style={styles.adsButtonText}>Vuna Points</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.pointsContainer}>
                <View style={styles.pointsCircle}>
                  <AntDesign name="star" size={32} color="#fbbf24" />
                  <Text style={styles.pointsValue}>{userPoints}</Text>
                </View>
                <Text style={styles.pointsLabel}>Points Zilizokusanywa</Text>
              </View>
            </>
          )}
        </View>

        {/* Additional Info Cards */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Icon name="history" size={24} color={accentColor} />
            <Text style={styles.statValue}>0</Text>
            <Text style={styles.statLabel}>Historia ya Kutazama</Text>
          </View>
          <View style={styles.statCard}>
            <Icon name="download" size={24} color={accentColor} />
            <Text style={styles.statValue}>0</Text>
            <Text style={styles.statLabel}>Vilivyopakuliwa</Text>
          </View>
        </View>

        {/* Account Details */}
        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Icon name="calendar" size={20} color="#9ca3af" />
            <Text style={styles.detailLabel}>Tarehe ya Kujiunga:</Text>
            <Text style={styles.detailValue}>
              {new Date().toLocaleDateString('sw-TZ', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Icon name="shield-check" size={20} color="#9ca3af" />
            <Text style={styles.detailLabel}>Hali ya Akaunti:</Text>
            <Text style={[styles.detailValue, isPremium && { color: '#fbbf24' }]}>
              {isPremium ? 'Premium' : 'Bure'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
  },
  scrollView: {
    flex: 1,
  },
  headerSection: {
    alignItems: 'center',
    padding: 24,
    paddingTop: 32,
  },
  avatarContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 3,
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  userIdText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
    letterSpacing: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  premiumBadge: {
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    borderColor: 'rgba(251, 191, 36, 0.4)',
  },
  freeBadge: {
    backgroundColor: 'rgba(156, 163, 175, 0.2)',
    borderColor: 'rgba(156, 163, 175, 0.4)',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  premiumStatusText: {
    color: '#fbbf24',
  },
  infoCard: {
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.5)',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    flex: 1,
  },
  adsButton: {
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  adsButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  adsButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  countdownContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  countdownItem: {
    alignItems: 'center',
    minWidth: 60,
  },
  countdownValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#4ade80',
    marginBottom: 4,
  },
  countdownLabel: {
    fontSize: 12,
    color: '#9ca3af',
    textTransform: 'uppercase',
  },
  countdownSeparator: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4ade80',
    marginTop: -10,
  },
  countdownTextContainer: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.2)',
  },
  countdownText: {
    fontSize: 14,
    color: '#d1d5db',
    textAlign: 'center',
    lineHeight: 20,
  },
  expiresOnText: {
    marginTop: 8,
    color: '#9ca3af',
  },
  pointsContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  pointsCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(251, 191, 36, 0.3)',
    marginBottom: 16,
  },
  pointsValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fbbf24',
    marginTop: 8,
  },
  pointsLabel: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.5)',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 8,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
  },
  detailsCard: {
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.5)',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  detailLabel: {
    flex: 1,
    fontSize: 14,
    color: '#9ca3af',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#9ca3af',
  },
});

export default ProfileScreen;
