import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { dashboardAPI } from '../../config/api';

const { width } = Dimensions.get('window');

const AdsSection = () => {
  const [adsWatchedToday, setAdsWatchedToday] = useState(0);
  const [totalPoints, setTotalPoints] = useState(0);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await dashboardAPI.getStats();
        setAdsWatchedToday(data.adsWatchedToday || 0);
        setTotalPoints(data.totalPointsCollected || 0);
      } catch (error) {
        console.error('Failed to fetch ads stats:', error);
      }
    };

    fetchStats();
  }, []);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Ads Statistics</Text>
          <Text style={styles.headerSubtitle}>Monitor ads watched and points collected</Text>
        </View>
      </View>

      {/* Stats Cards */}
      <View style={styles.statsContainer}>
        <LinearGradient
          colors={['#2563eb', '#1e40af']}
          style={styles.statCard}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}>
          <View style={styles.statHeader}>
            <Text style={styles.statTitle}>Ads Watched Daily</Text>
            <Icon name="eye" size={32} color="rgba(255, 255, 255, 0.8)" />
          </View>
          <Text style={styles.statValue}>{adsWatchedToday}</Text>
          <Text style={styles.statSubtitle}>Today</Text>
        </LinearGradient>

        <LinearGradient
          colors={['#10b981', '#059669']}
          style={styles.statCard}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}>
          <View style={styles.statHeader}>
            <Text style={styles.statTitle}>Total Points Collected</Text>
            <Icon name="star" size={32} color="rgba(255, 255, 255, 0.8)" />
          </View>
          <Text style={styles.statValue}>{totalPoints}</Text>
          <Text style={styles.statSubtitle}>All time</Text>
        </LinearGradient>
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
  header: {
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    minHeight: 180,
  },
  statHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  statTitle: {
    flex: 1,
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '600',
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  statSubtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.8)',
  },
});

export default AdsSection;
