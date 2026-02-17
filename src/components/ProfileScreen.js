import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import { userAPI } from '../config/api';

const { width } = Dimensions.get('window');

const ProfileScreen = ({ accentColor = '#4ade80' }) => {
  const [userId, setUserId] = useState(null);
  const [isPremium, setIsPremium] = useState(false);
  const [userPoints, setUserPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  const [subscriptionEndDate, setSubscriptionEndDate] = useState(null);

  // Generate unique user ID
  const generateUserId = () => {
    const prefix = 'User-';
    const randomChars = 'ABCDEF0123456789';
    let randomPart = '';
    for (let i = 0; i < 5; i++) {
      randomPart += randomChars.charAt(Math.floor(Math.random() * randomChars.length));
    }
    return prefix + randomPart;
  };

  // Load or generate user ID and register with backend
  useEffect(() => {
    const loadUserId = async () => {
      try {
        setLoading(true);
        let storedUserId = await AsyncStorage.getItem('userId');
        if (!storedUserId) {
          storedUserId = generateUserId();
          await AsyncStorage.setItem('userId', storedUserId);
        }
        setUserId(storedUserId);

        // Register user with backend
        try {
          const userData = await userAPI.register(storedUserId);
          setIsPremium(userData.isPremium || false);
          setUserPoints(userData.points || 0);
          
          // If premium, set subscription end date
          if (userData.isPremium && userData.subscriptionEndDate) {
            setSubscriptionEndDate(new Date(userData.subscriptionEndDate));
          } else if (userData.isPremium) {
            // Default 30 days if not set
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);
            setSubscriptionEndDate(endDate);
          }
        } catch (apiError) {
          console.error('Failed to register user:', apiError);
          // Continue with local data if API fails
        }

        // Fetch latest user data
        try {
          const userData = await userAPI.getUser(storedUserId);
          setIsPremium(userData.isPremium || false);
          setUserPoints(userData.points || 0);
          if (userData.isPremium && userData.subscriptionEndDate) {
            setSubscriptionEndDate(new Date(userData.subscriptionEndDate));
          }
        } catch (fetchError) {
          console.error('Failed to fetch user data:', fetchError);
        }
      } catch (error) {
        console.error('Error loading user ID:', error);
        const fallbackId = generateUserId();
        setUserId(fallbackId);
      } finally {
        setLoading(false);
      }
    };
    loadUserId();
  }, []);

  // Initialize subscription end date for premium users
  useEffect(() => {
    if (isPremium) {
      const loadSubscriptionDate = async () => {
        try {
          let storedDate = await AsyncStorage.getItem('subscriptionEndDate');
          if (!storedDate) {
            // Set default subscription to 30 days from now
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);
            storedDate = endDate.toISOString();
            await AsyncStorage.setItem('subscriptionEndDate', storedDate);
          }
          setSubscriptionEndDate(new Date(storedDate));
        } catch (error) {
          // Fallback: 30 days from now
          const endDate = new Date();
          endDate.setDate(endDate.getDate() + 30);
          setSubscriptionEndDate(endDate);
        }
      };
      loadSubscriptionDate();
    } else {
      setSubscriptionEndDate(null);
    }
  }, [isPremium]);

  // Countdown timer for premium users
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
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [isPremium, subscriptionEndDate]);

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
      
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
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
                <Text style={styles.sectionTitle}>Muda Ulio Baki</Text>
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
                  Umebakiwa na siku {timeRemaining.days}, masaa {timeRemaining.hours}, dakika {timeRemaining.minutes} na sekunde {timeRemaining.seconds}
                </Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.sectionHeader}>
                <AntDesign name="star" size={20} color="#fbbf24" />
                <Text style={styles.sectionTitle}>Jumla ya Points</Text>
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
    paddingBottom: 100,
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
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
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
