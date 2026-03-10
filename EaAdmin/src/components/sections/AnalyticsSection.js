import React, { useEffect, useState, useRef } from 'react';
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
import { dashboardAPI, adminChannelsAPI } from '../../config/api';

const { width } = Dimensions.get('window');

const AnalyticsSection = ({ isActive }) => {
  const [refreshing, setRefreshing] = useState(false);
  const wasActiveRef = useRef(false);
  const [stats, setStats] = useState([
    {
      title: 'Premium Payments',
      value: '$0',
      change: '+0%',
      subtitle: 'this month',
      gradient: ['#7c3aed', '#6d28d9'],
      icon: 'currency-usd',
    },
    {
      title: 'New Users',
      value: '0',
      change: '+0%',
      subtitle: 'this month',
      gradient: ['#10b981', '#059669'],
      icon: 'account-plus',
    },
    {
      title: 'Total Users',
      value: '0',
      change: '+0%',
      subtitle: 'all time',
      gradient: ['#2563eb', '#1e40af'],
      icon: 'account-group',
    },
    {
      title: 'Uninstall Users',
      value: '0',
      change: '-0%',
      subtitle: 'this month',
      gradient: ['#ef4444', '#dc2626'],
      icon: 'delete',
    },
  ]);

  const [mostWatchedPlatforms, setMostWatchedPlatforms] = useState([
    {
      name: 'Movies',
      views: 0,
      percentage: 0,
      gradient: ['#7c3aed', '#6d28d9'],
      icon: 'movie',
    },
    {
      name: 'Football',
      views: 0,
      percentage: 0,
      gradient: ['#10b981', '#059669'],
      icon: 'soccer',
    },
    {
      name: 'Habari',
      views: 0,
      percentage: 0,
      gradient: ['#ef4444', '#dc2626'],
      icon: 'newspaper-variant',
    },
  ]);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setRefreshing(true);
        const [data, channels] = await Promise.all([
          dashboardAPI.getStats(),
          adminChannelsAPI.getChannels().catch(() => []),
        ]);

        // Helper function to format large numbers with K/M
        const formatNumber = (num) => {
          if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
          if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
          return num.toString();
        };

        // Format revenue (data.revenue is already in TSh, not cents)
        const revenue = Number(data.revenue) || 0;
        const formatTsh = (n) => {
          if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M TSh`;
          if (n >= 1000) return `${(n / 1000).toFixed(1)}K TSh`;
          return `${n} TSh`;
        };

        setStats([
          {
            title: 'Premium Payments',
            value: formatTsh(revenue),
            change: data.revenueChange || '+0%',
            subtitle: 'this month',
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
            title: 'Ads Points',
            value: formatNumber(data.adsWatched ?? 0),
            change: data.adsChange || '+0%',
            subtitle: 'this month',
            gradient: ['#f97316', '#ea580c'],
            icon: 'eye',
          },
        ]);

        // Aggregate channel watch data by category (platform) for Most Watched Platforms
        const viewsByCategory = { football: 0, movies: 0, habari: 0 };
        const list = Array.isArray(channels) ? channels : [];
        list.forEach((ch) => {
          const cat = (ch.category || 'football').toLowerCase();
          const views = Number(ch.view_count ?? ch.viewCount) || 0;
          if (viewsByCategory[cat] !== undefined) viewsByCategory[cat] += views;
        });
        const totalViews = viewsByCategory.football + viewsByCategory.movies + viewsByCategory.habari;
        const pct = (v) => (totalViews > 0 ? Math.round((v / totalViews) * 100) : 0);
        setMostWatchedPlatforms([
          {
            name: 'Movies',
            views: viewsByCategory.movies,
            percentage: pct(viewsByCategory.movies),
            gradient: ['#7c3aed', '#6d28d9'],
            icon: 'movie',
          },
          {
            name: 'Football',
            views: viewsByCategory.football,
            percentage: pct(viewsByCategory.football),
            gradient: ['#10b981', '#059669'],
            icon: 'soccer',
          },
          {
            name: 'Habari',
            views: viewsByCategory.habari,
            percentage: pct(viewsByCategory.habari),
            gradient: ['#ef4444', '#dc2626'],
            icon: 'newspaper-variant',
          },
        ].sort((a, b) => b.views - a.views));
      } catch (error) {
        console.error('Failed to fetch analytics stats:', error);
      } finally {
        setRefreshing(false);
      }
    };

    fetchAnalytics();
  }, []);

  // Refetch when user switches to Analytics tab so revenue/premium payments stay in sync with Dashboard
  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      const fetchAnalytics = async () => {
        try {
          const [data, channels] = await Promise.all([
            dashboardAPI.getStats(),
            adminChannelsAPI.getChannels().catch(() => []),
          ]);
          const revenueTsh = Number(data.revenueTsh) || 0;
          const formatTsh = (n) =>
            n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toString();
          setStats((prev) => {
            const next = [...prev];
            const premiumCard = next.find((s) => s.title === 'Premium Payments');
            if (premiumCard) premiumCard.value = `${formatTsh(revenueTsh)} TSh`;
            const newUsersCard = next.find((s) => s.title === 'New Users');
            if (newUsersCard) newUsersCard.value = String(data.newUsersThisMonth ?? 0);
            const totalCard = next.find((s) => s.title === 'Total Users');
            if (totalCard) totalCard.value = String(data.totalUsers ?? 0);
            const uninstallCard = next.find((s) => s.title === 'Uninstall Users');
            if (uninstallCard) uninstallCard.value = String(data.uninstallUsersThisMonth ?? 0);
            return next;
          });
          const viewsByCategory = { football: 0, movies: 0, habari: 0 };
          const list = Array.isArray(channels) ? channels : [];
          list.forEach((ch) => {
            const cat = (ch.category || 'football').toLowerCase();
            const views = Number(ch.view_count ?? ch.viewCount) || 0;
            if (viewsByCategory[cat] !== undefined) viewsByCategory[cat] += views;
          });
          const totalViews = viewsByCategory.football + viewsByCategory.movies + viewsByCategory.habari;
          const pct = (v) => (totalViews > 0 ? Math.round((v / totalViews) * 100) : 0);
          setMostWatchedPlatforms([
            { name: 'Movies', views: viewsByCategory.movies, percentage: pct(viewsByCategory.movies), gradient: ['#7c3aed', '#6d28d9'], icon: 'movie' },
            { name: 'Football', views: viewsByCategory.football, percentage: pct(viewsByCategory.football), gradient: ['#10b981', '#059669'], icon: 'soccer' },
            { name: 'Habari', views: viewsByCategory.habari, percentage: pct(viewsByCategory.habari), gradient: ['#ef4444', '#dc2626'], icon: 'newspaper-variant' },
          ].sort((a, b) => b.views - a.views));
        } catch (e) {
          console.warn('Analytics tab refetch:', e);
        }
      };
      fetchAnalytics();
    }
    wasActiveRef.current = !!isActive;
  }, [isActive]);

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            Promise.all([
              dashboardAPI.getStats(),
              adminChannelsAPI.getChannels().catch(() => []),
            ]).then(([data, channels]) => {
              const revenueTsh = Number(data.revenueTsh) || 0;
              const formatTsh = (n) =>
                n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toString();
              setStats((prev) => [
                { ...prev[0], value: `${formatTsh(revenueTsh)} TSh` },
                { ...prev[1], value: String(data.newUsersThisMonth ?? 0) },
                { ...prev[2], value: String(data.totalUsers ?? 0) },
                { ...prev[3], value: String(data.uninstallUsersThisMonth ?? 0) },
              ]);
              const viewsByCategory = { football: 0, movies: 0, habari: 0 };
              (Array.isArray(channels) ? channels : []).forEach((ch) => {
                const cat = (ch.category || 'football').toLowerCase();
                const v = Number(ch.view_count ?? ch.viewCount) || 0;
                if (viewsByCategory[cat] !== undefined) viewsByCategory[cat] += v;
              });
              const total = viewsByCategory.football + viewsByCategory.movies + viewsByCategory.habari;
              const pct = (x) => (total > 0 ? Math.round((x / total) * 100) : 0);
              setMostWatchedPlatforms([
                { name: 'Movies', views: viewsByCategory.movies, percentage: pct(viewsByCategory.movies), gradient: ['#7c3aed', '#6d28d9'], icon: 'movie' },
                { name: 'Football', views: viewsByCategory.football, percentage: pct(viewsByCategory.football), gradient: ['#10b981', '#059669'], icon: 'soccer' },
                { name: 'Habari', views: viewsByCategory.habari, percentage: pct(viewsByCategory.habari), gradient: ['#ef4444', '#dc2626'], icon: 'newspaper-variant' },
              ].sort((a, b) => b.views - a.views));
            }).catch((e) => console.warn('Analytics refresh:', e))
            .finally(() => setRefreshing(false));
          }}
        />
      }>
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
});

export default AnalyticsSection;
