import React, { useState, useEffect } from 'react';
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
import AntDesign from 'react-native-vector-icons/AntDesign';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import ImageCarousel from './ImageCarousel';
import PaymentsScreen from './PaymentsScreen';
import ProfileScreen from './ProfileScreen';

const { width } = Dimensions.get('window');

const FootballApp = ({ isPremium, userPoints, onWatchAd, onPaymentsActiveChange }) => {
  const [activeTab, setActiveTab] = useState('home');

  useEffect(() => {
    if (onPaymentsActiveChange) {
      onPaymentsActiveChange(activeTab === 'payments' || activeTab === 'profile' || activeTab === 'channels');
    }
  }, [activeTab, onPaymentsActiveChange]);

  const carouselItems = [
    {
      title: 'MAN UTD vs LIVERPOOL',
      subtitle: 'Premier League',
      badge: 'LIVE',
      gradient: ['#14532d', '#111827', '#000000'],
      info: [
        { icon: 'clockcircleo', text: '78\' • 2nd Half' },
      ],
    },
    {
      title: 'Arsenal vs Chelsea',
      subtitle: 'Premier League',
      gradient: ['#065f46', '#111827', '#000000'],
      info: [
        { icon: 'clockcircleo', text: 'Today 19:00' },
      ],
    },
    {
      title: 'Barcelona vs Real Madrid',
      subtitle: 'La Liga',
      gradient: ['#14532d', '#1f2937', '#000000'],
      info: [
        { icon: 'clockcircleo', text: 'Today 21:45' },
      ],
    },
  ];
  const upcomingMatches = [
    {
      league: 'Premier League',
      team1: 'Arsenal',
      team2: 'Chelsea',
      time: 'Today 19:00',
      points: 15,
    },
    {
      league: 'La Liga',
      team1: 'Barcelona',
      team2: 'Real Madrid',
      time: 'Today 21:45',
      points: 20,
    },
    {
      league: 'Bundesliga',
      team1: 'Bayern',
      team2: 'Dortmund',
      time: 'Tomorrow 18:30',
      points: 15,
    },
  ];

  const footballChannels = [
    {
      id: 1,
      name: 'ESPN',
      icon: 'television-classic',
      color: '#e11d48',
      currentShow: 'Premier League Highlights',
      isLive: true,
      category: 'International',
    },
    {
      id: 2,
      name: 'BeIN Sports',
      icon: 'play-circle',
      color: '#3b82f6',
      currentShow: 'La Liga Live',
      isLive: true,
      category: 'International',
    },
    {
      id: 3,
      name: 'Sky Sports',
      icon: 'satellite-variant',
      color: '#f59e0b',
      currentShow: 'Champions League',
      isLive: false,
      category: 'International',
    },
    {
      id: 4,
      name: 'SuperSport',
      icon: 'soccer',
      color: '#10b981',
      currentShow: 'Premier League',
      isLive: true,
      category: 'Africa',
    },
    {
      id: 5,
      name: 'Star Sports',
      icon: 'star',
      color: '#8b5cf6',
      currentShow: 'Bundesliga',
      isLive: false,
      category: 'Asia',
    },
    {
      id: 6,
      name: 'BT Sport',
      icon: 'television',
      color: '#ec4899',
      currentShow: 'FA Cup',
      isLive: true,
      category: 'International',
    },
    {
      id: 7,
      name: 'DAZN',
      icon: 'play-box',
      color: '#06b6d4',
      currentShow: 'Serie A',
      isLive: false,
      category: 'International',
    },
    {
      id: 8,
      name: 'Fox Sports',
      icon: 'television-box',
      color: '#f97316',
      currentShow: 'MLS',
      isLive: true,
      category: 'International',
    },
  ];

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#14532d', '#111827', '#000000']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      {/* Header */}
      {activeTab !== 'payments' && activeTab !== 'profile' && activeTab !== 'channels' && (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Icon name="soccer" size={24} color="#4ade80" />
            <Text style={styles.headerTitle}>Tumia Points</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.pointsBadge}>
              <AntDesign name="star" size={16} color="#fbbf24" />
              <Text style={styles.pointsText}>{userPoints} pts</Text>
            </View>
            {!isPremium && (
              <TouchableOpacity style={styles.premiumButton}>
                <AntDesign name="star" size={14} color="#fff" />
                <Text style={styles.premiumButtonText}>Go Premium</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {activeTab === 'payments' ? (
        <PaymentsScreen accentColor="#4ade80" />
      ) : activeTab === 'profile' ? (
        <ProfileScreen accentColor="#4ade80" />
      ) : activeTab === 'channels' ? (
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          <View style={styles.channelsContainer}>
            <View style={styles.channelsHeader}>
              <Text style={styles.channelsTitle}>Football Channels</Text>
              <Text style={styles.channelsSubtitle}>Chagua channel unayotaka kuangalia</Text>
            </View>

            <View style={styles.channelsGrid}>
              {footballChannels.map((channel) => (
                <TouchableOpacity
                  key={channel.id}
                  style={styles.channelCard}
                  activeOpacity={0.8}>
                  <LinearGradient
                    colors={[channel.color + '20', channel.color + '10', 'transparent']}
                    style={styles.channelGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}>
                    <View style={styles.channelHeader}>
                      <View style={[styles.channelIconContainer, { backgroundColor: channel.color + '30' }]}>
                        <Icon name={channel.icon} size={32} color={channel.color} />
                      </View>
                      {channel.isLive && (
                        <View style={styles.channelLiveBadge}>
                          <View style={styles.channelLiveDot} />
                          <Text style={styles.channelLiveText}>LIVE</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.channelContent}>
                      <Text style={styles.channelName}>{channel.name}</Text>
                      <Text style={styles.channelShow}>{channel.currentShow}</Text>
                      <View style={styles.channelCategory}>
                        <Icon name="tag" size={12} color="#9ca3af" />
                        <Text style={styles.channelCategoryText}>{channel.category}</Text>
                      </View>
                    </View>
                    <TouchableOpacity style={[styles.channelWatchButton, { backgroundColor: channel.color }]}>
                      <Icon name="play" size={16} color="#fff" />
                      <Text style={styles.channelWatchText}>Watch Now</Text>
                    </TouchableOpacity>
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
      ) : (
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* Image Carousel */}
          <ImageCarousel
            items={carouselItems}
            onWatchAd={onWatchAd}
            isPremium={isPremium}
          />

          {/* Upcoming Matches */}
          <View style={styles.matchesSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Upcoming Matches</Text>
            <TouchableOpacity>
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>

          {upcomingMatches.map((match, index) => (
            <View key={index} style={styles.matchCard}>
              <Text style={styles.matchLeague}>{match.league}</Text>
              <View style={styles.matchTeams}>
                <View style={styles.teamInfo}>
                  <Text style={styles.matchTeamName}>{match.team1}</Text>
                </View>
                <Text style={styles.vs}>VS</Text>
                <View style={styles.teamInfo}>
                  <Text style={styles.matchTeamName}>{match.team2}</Text>
                </View>
              </View>
              <View style={styles.matchFooter}>
                <View style={styles.timeContainer}>
                  <Icon name="clock-outline" size={14} color="#9ca3af" />
                  <Text style={styles.timeText}>{match.time}</Text>
                </View>
                {!isPremium && (
                  <View style={styles.earnPointsBadge}>
                    <AntDesign name="star" size={12} color="#fbbf24" />
                    <Text style={styles.earnPointsText}>Earn {match.points} pts</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      )}

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('home')}>
          <Icon
            name="home"
            size={24}
            color={activeTab === 'home' ? '#4ade80' : '#9ca3af'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'home' && styles.navTextActive,
            ]}>
            Home
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('channels')}>
          <Icon
            name="television"
            size={24}
            color={activeTab === 'channels' ? '#4ade80' : '#9ca3af'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'channels' && styles.navTextActive,
            ]}>
            Channels
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('payments')}>
          <Icon
            name="wallet"
            size={24}
            color={activeTab === 'payments' ? '#4ade80' : '#9ca3af'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'payments' && styles.navTextActive,
            ]}>
            Payments
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('profile')}>
          <Icon
            name="account"
            size={24}
            color={activeTab === 'profile' ? '#4ade80' : '#9ca3af'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'profile' && styles.navTextActive,
            ]}>
            Profile
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
  },
  backgroundGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(34, 197, 94, 0.3)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  pointsText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  premiumButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#eab308',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  premiumButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
  scrollView: {
    flex: 1,
  },
  heroContainer: {
    padding: 16,
  },
  heroImage: {
    height: 192,
    borderRadius: 16,
    overflow: 'hidden',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  liveBadge: {
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
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  liveText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  heroContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  leagueText: {
    fontSize: 14,
    color: '#d1d5db',
    marginBottom: 8,
  },
  matchScore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    marginBottom: 12,
  },
  teamContainer: {
    alignItems: 'center',
  },
  teamName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  score: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#4ade80',
  },
  vsText: {
    fontSize: 18,
    color: '#9ca3af',
  },
  matchTime: {
    fontSize: 14,
    color: '#fbbf24',
    fontWeight: '600',
  },
  watchButton: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#22c55e',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
  },
  watchButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  matchesSection: {
    padding: 16,
    paddingBottom: 100,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  viewAllText: {
    color: '#4ade80',
    fontSize: 14,
  },
  matchCard: {
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.5)',
  },
  matchLeague: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 8,
  },
  matchTeams: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  teamInfo: {
    flex: 1,
  },
  matchTeamName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
  vs: {
    color: '#6b7280',
    fontWeight: 'bold',
    marginHorizontal: 16,
  },
  matchFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  earnPointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  earnPointsText: {
    fontSize: 12,
    color: '#fbbf24',
  },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
  },
  navItem: {
    alignItems: 'center',
    gap: 4,
  },
  navText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  navTextActive: {
    color: '#4ade80',
  },
  channelsContainer: {
    padding: 16,
    paddingBottom: 100,
  },
  channelsHeader: {
    marginBottom: 24,
    paddingTop: 8,
  },
  channelsTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  channelsSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
  },
  channelsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  channelCard: {
    width: (width - 48) / 2,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.5)',
  },
  channelGradient: {
    padding: 16,
    minHeight: 200,
  },
  channelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  channelIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  channelLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#dc2626',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  channelLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  channelLiveText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  channelContent: {
    flex: 1,
    marginBottom: 12,
  },
  channelName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
  },
  channelShow: {
    fontSize: 13,
    color: '#d1d5db',
    marginBottom: 8,
  },
  channelCategory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  channelCategoryText: {
    fontSize: 11,
    color: '#9ca3af',
  },
  channelWatchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  channelWatchText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});

export default FootballApp;
