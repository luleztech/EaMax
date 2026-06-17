import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminAdsAPI } from '../../config/api';

const { width } = Dimensions.get('window');

const AdsSection = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const data = await adminAdsAPI.getStats();
      // adminAdsAPI.getStats() never throws – always returns a valid object
      setStats(data || {});
    } catch (err) {
      // This should never happen, but just in case – show zero-state, not error
      console.error('Failed to fetch ads stats:', err);
      setStats({
        adsWatchedToday: 0,
        pointsEarnedToday: 0,
        adsWatchedYesterday: 0,
        todayChange: '+0%',
        adsWatchedThisMonth: 0,
        pointsEarnedThisMonth: 0,
        adsWatchedLastMonth: 0,
        monthChange: '+0%',
        adsWatchedAllTime: 0,
        pointsEarnedAllTime: 0,
        totalPointsCollected: 0,
        usersWithPoints: 0,
        topUsers: [],
        dailyBreakdown: [],
        _fallback: true,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchStats();
  }, [fetchStats]);

  const formatNumber = (num) => {
    if (num === undefined || num === null) return '0';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return String(num);
  };

  const formatDay = (dayStr) => {
    if (!dayStr) return '';
    const date = new Date(dayStr);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const shortUserId = (uid) => {
    if (!uid) return 'Unknown';
    return uid.length > 14 ? uid.substring(0, 14) + '…' : uid;
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Loading ads data…</Text>
      </View>
    );
  }

  const todayChange = stats?.todayChange || '+0%';
  const monthChange = stats?.monthChange || '+0%';
  const todayChangePositive = !todayChange.startsWith('-');
  const monthChangePositive = !monthChange.startsWith('-');

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563eb" />}>

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Ads Statistics</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
          <Icon name="refresh" size={20} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      {/* Top Stats Row */}
      <View style={styles.statsRow}>
        {/* Ads Watched Today */}
        <LinearGradient
          colors={['#2563eb', '#1e40af']}
          style={styles.statCard}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}>
          <View style={styles.statHeader}>
            <Text style={styles.statTitle}>Ads Today</Text>
            <Icon name="play-circle" size={28} color="rgba(255,255,255,0.8)" />
          </View>
          <Text style={styles.statValue}>{formatNumber(stats?.adsWatchedToday)}</Text>
          <View style={styles.statFooter}>
            <Icon
              name={todayChangePositive ? 'trending-up' : 'trending-down'}
              size={14}
              color={todayChangePositive ? '#86efac' : '#fca5a5'}
            />
            <Text style={[styles.changeText, { color: todayChangePositive ? '#86efac' : '#fca5a5' }]}>
              {' '}{todayChange} vs yesterday
            </Text>
          </View>
        </LinearGradient>

        {/* Points Earned Today */}
        <LinearGradient
          colors={['#7c3aed', '#5b21b6']}
          style={styles.statCard}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}>
          <View style={styles.statHeader}>
            <Text style={styles.statTitle}>Points Today</Text>
            <Icon name="star-shooting" size={28} color="rgba(255,255,255,0.8)" />
          </View>
          <Text style={styles.statValue}>{formatNumber(stats?.pointsEarnedToday)}</Text>
          <Text style={styles.statSubtitle}>Points earned today</Text>
        </LinearGradient>
      </View>

      {/* Second Stats Row */}
      <View style={styles.statsRow}>
        {/* Ads This Month */}
        <LinearGradient
          colors={['#0891b2', '#0e7490']}
          style={styles.statCard}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}>
          <View style={styles.statHeader}>
            <Text style={styles.statTitle}>Ads This Month</Text>
            <Icon name="calendar-month" size={28} color="rgba(255,255,255,0.8)" />
          </View>
          <Text style={styles.statValue}>{formatNumber(stats?.adsWatchedThisMonth)}</Text>
          <View style={styles.statFooter}>
            <Icon
              name={monthChangePositive ? 'trending-up' : 'trending-down'}
              size={14}
              color={monthChangePositive ? '#86efac' : '#fca5a5'}
            />
            <Text style={[styles.changeText, { color: monthChangePositive ? '#86efac' : '#fca5a5' }]}>
              {' '}{monthChange} vs last month
            </Text>
          </View>
        </LinearGradient>

        {/* Points This Month */}
        <LinearGradient
          colors={['#d97706', '#b45309']}
          style={styles.statCard}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}>
          <View style={styles.statHeader}>
            <Text style={styles.statTitle}>Points This Month</Text>
            <Icon name="star-circle" size={28} color="rgba(255,255,255,0.8)" />
          </View>
          <Text style={styles.statValue}>{formatNumber(stats?.pointsEarnedThisMonth)}</Text>
          <Text style={styles.statSubtitle}>Points earned this month</Text>
        </LinearGradient>
      </View>

      {/* All-Time Summary */}
      <View style={styles.allTimeRow}>
        <View style={styles.allTimeCard}>
          <Icon name="eye-check" size={24} color="#60a5fa" />
          <Text style={styles.allTimeValue}>{formatNumber(stats?.adsWatchedAllTime)}</Text>
          <Text style={styles.allTimeLabel}>Total Ads Watched</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.allTimeCard}>
          <Icon name="star-four-points" size={24} color="#fbbf24" />
          <Text style={styles.allTimeValue}>{formatNumber(stats?.totalPointsCollected)}</Text>
          <Text style={styles.allTimeLabel}>Total Points (All Users)</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.allTimeCard}>
          <Icon name="account-star" size={24} color="#a78bfa" />
          <Text style={styles.allTimeValue}>{formatNumber(stats?.usersWithPoints)}</Text>
          <Text style={styles.allTimeLabel}>Users with Points</Text>
        </View>
      </View>

      {/* Daily Breakdown - Last 7 Days */}
      {stats?.dailyBreakdown && stats.dailyBreakdown.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Last 7 Days</Text>
          {stats.dailyBreakdown.map((item, index) => {
            const maxCount = Math.max(...stats.dailyBreakdown.map(d => d.adsCount), 1);
            const barWidth = (item.adsCount / maxCount) * 100;
            return (
              <View key={index} style={styles.dayRow}>
                <Text style={styles.dayLabel}>{formatDay(item.day)}</Text>
                <View style={styles.barContainer}>
                  <View style={[styles.bar, { width: `${barWidth}%` }]} />
                </View>
                <Text style={styles.dayCount}>{formatNumber(item.adsCount)}</Text>
                <Text style={styles.dayPoints}>+{formatNumber(item.points)} pts</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Top Users by Ads */}
      {stats?.topUsers && stats.topUsers.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Users by Points Earned</Text>
          {stats.topUsers.map((user, index) => (
            <View key={index} style={styles.userRow}>
              <View style={[styles.rank, index === 0 ? styles.rankGold : index === 1 ? styles.rankSilver : index === 2 ? styles.rankBronze : styles.rankDefault]}>
                <Text style={styles.rankText}>#{index + 1}</Text>
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userId}>{shortUserId(user.userId)}</Text>
                <Text style={styles.userSub}>{user.adsWatched} ads watched</Text>
              </View>
              <View style={styles.userPoints}>
                <Icon name="star" size={14} color="#fbbf24" />
                <Text style={styles.userPointsText}>{formatNumber(user.pointsFromAds)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={{ height: 100 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    color: '#9ca3af',
    marginTop: 12,
    fontSize: 14,
  },
  errorText: {
    color: '#ef4444',
    marginTop: 12,
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: '#2563eb',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
  },
  refreshBtn: {
    padding: 8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    minHeight: 140,
  },
  statHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  statTitle: {
    flex: 1,
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '600',
    marginRight: 4,
  },
  statValue: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  statFooter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  changeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  statSubtitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
  },
  allTimeRow: {
    flexDirection: 'row',
    backgroundColor: '#1f2937',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  allTimeCard: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  allTimeValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  allTimeLabel: {
    fontSize: 10,
    color: '#9ca3af',
    textAlign: 'center',
  },
  divider: {
    width: 1,
    height: 48,
    backgroundColor: '#374151',
    marginHorizontal: 8,
  },
  section: {
    backgroundColor: '#1f2937',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 14,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  dayLabel: {
    width: 90,
    fontSize: 11,
    color: '#9ca3af',
  },
  barContainer: {
    flex: 1,
    height: 8,
    backgroundColor: '#374151',
    borderRadius: 4,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 4,
    minWidth: 4,
  },
  dayCount: {
    width: 36,
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'right',
  },
  dayPoints: {
    width: 68,
    fontSize: 10,
    color: '#fbbf24',
    textAlign: 'right',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  rank: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rankGold: { backgroundColor: '#d97706' },
  rankSilver: { backgroundColor: '#6b7280' },
  rankBronze: { backgroundColor: '#92400e' },
  rankDefault: { backgroundColor: '#374151' },
  rankText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#fff',
  },
  userInfo: {
    flex: 1,
  },
  userId: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  userSub: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
  userPoints: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#374151',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  userPointsText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fbbf24',
  },
  fallbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
    borderLeftWidth: 3,
    borderLeftColor: '#fbbf24',
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  fallbackText: {
    flex: 1,
    fontSize: 12,
    color: '#d1d5db',
    lineHeight: 18,
  },
});

export default AdsSection;
