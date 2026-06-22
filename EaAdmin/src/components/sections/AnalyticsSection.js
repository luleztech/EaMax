import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  RefreshControl,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { dashboardAPI, adminChannelsAPI, adminControlAPI } from '../../config/api';

const { width } = Dimensions.get('window');

// Shared helpers
const compact = (value) => {
  const n = Number(value) || 0;
  if (n >= 1000000) {
    const m = (n / 1000000).toFixed(1).replace(/\.0$/, '');
    return `${m}m`;
  }
  if (n >= 1000) {
    const k = (n / 1000).toFixed(1).replace(/\.0$/, '');
    return `${k}k`;
  }
  return String(n);
};

const formatNumber = (num) => compact(num);

const formatTsh = (n) => {
  const v = Math.round(Number(n) || 0);
  return `TSh ${v.toLocaleString('en-US')}`;
};

const buildPlatforms = (channels) => {
  const viewsByCategory = { football: 0, movies: 0, habari: 0 };
  (Array.isArray(channels) ? channels : []).forEach((ch) => {
    const cat = (ch.category || 'football').toLowerCase();
    const views = Number(ch.view_count ?? ch.viewCount) || 0;
    if (viewsByCategory[cat] !== undefined) viewsByCategory[cat] += views;
  });
  const total = viewsByCategory.football + viewsByCategory.movies + viewsByCategory.habari;
  const pct = (v) => (total > 0 ? Math.round((v / total) * 100) : 0);
  return [
    { name: 'Movies',   views: viewsByCategory.movies,   percentage: pct(viewsByCategory.movies),   gradient: ['#7c3aed', '#6d28d9'], icon: 'movie' },
    { name: 'Football', views: viewsByCategory.football, percentage: pct(viewsByCategory.football), gradient: ['#10b981', '#059669'], icon: 'soccer' },
    { name: 'Habari',   views: viewsByCategory.habari,   percentage: pct(viewsByCategory.habari),   gradient: ['#ef4444', '#dc2626'], icon: 'newspaper-variant' },
  ].sort((a, b) => b.views - a.views);
};

const buildStats = (data) => [
  {
    title: 'Premium Payments',
    value: formatTsh(data.todayRevenue ?? data.revenue ?? 0),
    change: data.revenueChange || '+0%',
    subtitle: `${data.completedPaymentsToday ?? data.completedPaymentsTotal ?? 0} completed leo`,
    gradient: ['#7c3aed', '#6d28d9'],
    icon: 'currency-usd',
  },
  {
    title: 'New Users',
    value: formatNumber(data.todayInstalls ?? 0),
    change: data.installChange || '+0%',
    subtitle: 'today',
    gradient: ['#10b981', '#059669'],
    icon: 'account-plus',
  },
  {
    title: 'Total Users',
    value: formatNumber(data.totalUsers ?? 0),
    change: '+0%',
    subtitle: 'all time',
    gradient: ['#2563eb', '#1e40af'],
    icon: 'account-group',
  },
  {
    title: 'Ads Watched',
    value: formatNumber(data.adsWatched ?? 0),
    change: data.adsChange || '+0%',
    subtitle: 'this month',
    gradient: ['#f97316', '#ea580c'],
    icon: 'eye',
  },
];

const AnalyticsSection = ({ isActive }) => {
  const [refreshing, setRefreshing] = useState(false);
  const wasActiveRef = useRef(false);
  const [stats, setStats] = useState(buildStats({}));
  const [mostWatchedPlatforms, setMostWatchedPlatforms] = useState(buildPlatforms([]));
  const [playbackStats, setPlaybackStats] = useState(null);

  // Single source-of-truth fetch function
  const fetchAnalytics = useCallback(async () => {
    try {
      setRefreshing(true);
      const [data, channels, playback] = await Promise.all([
        dashboardAPI.getStats(),
        adminChannelsAPI.getChannels().catch(() => []),
        adminControlAPI.getPlaybackAnalytics(7).catch(() => null),
      ]);
      setStats(buildStats(data));
      setMostWatchedPlatforms(buildPlatforms(channels));
      setPlaybackStats(playback?.summary || null);
    } catch (error) {
      console.error('Failed to fetch analytics stats:', error);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Refetch whenever the tab becomes active
  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      fetchAnalytics();
    }
    wasActiveRef.current = !!isActive;
  }, [isActive, fetchAnalytics]);

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={fetchAnalytics}
          tintColor="#2563eb"
        />
      }>
      {playbackStats ? (
        <View style={styles.playbackCard}>
          <Text style={styles.sectionTitle}>Playback (7 days)</Text>
          <View style={styles.playbackGrid}>
            <View style={styles.playbackStat}>
              <Text style={styles.playbackValue}>{formatNumber(playbackStats.channelOpens)}</Text>
              <Text style={styles.playbackLabel}>Channel opens</Text>
            </View>
            <View style={styles.playbackStat}>
              <Text style={styles.playbackValue}>{formatNumber(playbackStats.streamFailures)}</Text>
              <Text style={styles.playbackLabel}>Stream failures</Text>
            </View>
            <View style={styles.playbackStat}>
              <Text style={styles.playbackValue}>{formatNumber(playbackStats.playerCrashes)}</Text>
              <Text style={styles.playbackLabel}>Crashes</Text>
            </View>
            <View style={styles.playbackStat}>
              <Text style={styles.playbackValue}>
                {formatNumber(Math.round((playbackStats.totalWatchSeconds || 0) / 60))}
              </Text>
              <Text style={styles.playbackLabel}>Watch min</Text>
            </View>
          </View>
        </View>
      ) : null}
      {/* Stats Cards */}
      <View style={styles.statsContainer}>
        {stats.map((stat, index) => (
          <LinearGradient
            key={index}
            colors={stat.gradient}
            style={styles.statCard}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}>
            <View style={styles.statHeader}>
              <Text style={styles.statTitle}>{stat.title}</Text>
              <Icon name={stat.icon} size={28} color="rgba(255, 255, 255, 0.8)" />
            </View>
            <Text style={styles.statValue}>{stat.value}</Text>
            <View style={styles.statFooter}>
              <Text style={[styles.statChange, stat.change.startsWith('-') && styles.statChangeNegative]}>
                {stat.change}
              </Text>
              <Text style={styles.statSubtitle}>{stat.subtitle}</Text>
            </View>
          </LinearGradient>
        ))}
      </View>

      {/* Most Watched Platforms */}
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>Most Watched Platforms</Text>
        <View style={styles.platformsList}>
          {mostWatchedPlatforms.map((platform, index) => (
            <View key={index} style={styles.platformItem}>
              <LinearGradient
                colors={platform.gradient}
                style={styles.platformIcon}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}>
                <Icon name={platform.icon} size={24} color="#fff" />
              </LinearGradient>
              <View style={styles.platformInfo}>
                <Text style={styles.platformName}>{platform.name}</Text>
                <Text style={styles.platformViews}>{platform.views} views</Text>
              </View>
              <View style={styles.platformStats}>
                <View style={styles.platformBarContainer}>
                  <View style={styles.platformBar}>
                    <View
                      style={[
                        styles.platformBarFill,
                        { width: `${platform.percentage}%`, backgroundColor: platform.gradient[0] },
                      ]}
                    />
                  </View>
                </View>
                <Text style={styles.platformPercentage}>{platform.percentage}%</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingBottom: 100,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    width: (width - 44) / 2,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  statHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 8,
    paddingRight: 0,
  },
  statTitle: {
    flex: 1,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '600',
    marginRight: 4,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  statFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statChange: {
    fontSize: 13,
    color: '#86efac',
    fontWeight: '600',
  },
  statChangeNegative: {
    color: '#fca5a5',
  },
  statSubtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  chartCard: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 16,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  platformsList: {
    gap: 16,
  },
  platformItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 12,
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
  },
  platformIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  platformInfo: {
    flex: 1,
  },
  platformName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  platformViews: {
    fontSize: 13,
    color: '#9ca3af',
  },
  platformStats: {
    alignItems: 'flex-end',
    gap: 6,
  },
  platformBarContainer: {
    width: 100,
  },
  platformBar: {
    height: 6,
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  platformBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  platformPercentage: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  playbackCard: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  playbackGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  playbackStat: {
    width: (width - 64) / 2,
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
    padding: 12,
  },
  playbackValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
  },
  playbackLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
});

export default AnalyticsSection;
