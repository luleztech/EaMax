import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Platform,
  RefreshControl,
  ImageBackground,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import ImageCarousel from './ImageCarousel';
import ShimmerPlaceholder from './ShimmerPlaceholder';
import { settingsAPI, channelsAPI, matchesAPI, userAPI } from '../config/api';
import PaymentsScreen from './PaymentsScreen';
import ProfileScreen from './ProfileScreen';
import InsufficientPointsModal from './InsufficientPointsModal';
import ChannelUnlockModal from './ChannelUnlockModal';
import VideoPlayer from './VideoPlayer';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');
const BOTTOM_NAV_BASE_HEIGHT = 56;

const FootballApp = ({ isPremium, premiumToggleOn, userPoints, onWatchAd, onPaymentsActiveChange, onPointsRefresh }) => {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 8 : 0);
  const contentBottomPadding = BOTTOM_NAV_BASE_HEIGHT + bottomInset;

  const [activeTab, setActiveTab] = useState('home');
  const [carouselItems, setCarouselItems] = useState([]);
  const [upcomingMatches, setUpcomingMatches] = useState([]);
  const [footballChannels, setFootballChannels] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [insufficientPointsModalVisible, setInsufficientPointsModalVisible] = useState(false);
  const [channelUnlockModalVisible, setChannelUnlockModalVisible] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [currentUserPoints, setCurrentUserPoints] = useState(userPoints);
  const [videoPlayerVisible, setVideoPlayerVisible] = useState(false);
  const [playingChannel, setPlayingChannel] = useState(null);
  const [userId, setUserId] = useState(null);
  const [loadingChannelId, setLoadingChannelId] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    if (onPaymentsActiveChange) {
      onPaymentsActiveChange(activeTab === 'payments' || activeTab === 'profile' || activeTab === 'channels');
    }
    if (activeTab !== 'payments' && onPointsRefresh) {
      onPointsRefresh();
    }
  }, [activeTab, onPaymentsActiveChange, onPointsRefresh]);

  // Load all data functions
  const loadSlides = async () => {
    try {
      const data = await settingsAPI.getCarouselSlides('football');
      if (Array.isArray(data) && data.length > 0) {
        const mapped = data.map((slide) => ({
          title: slide.title,
          subtitle: slide.subtitle,
          badge: slide.badge,
          imageUrl: slide.image_url,
          videoUrl: slide.video_url,
          gradient: [
            slide.gradient_start || '#14532d',
            slide.gradient_mid || '#111827',
            slide.gradient_end || '#000000',
          ],
          info:
            slide.info_text
              ? [
                  {
                    icon: slide.info_icon || 'clockcircleo',
                    text: slide.info_text,
                  },
                ]
              : [],
        }));
        setCarouselItems(mapped);
      } else {
        setCarouselItems([]);
      }
    } catch (error) {
      console.error('Failed to load carousel slides:', error);
      setCarouselItems([]);
    }
  };

  const loadMatches = async () => {
    try {
      const data = await matchesAPI.getUpcomingMatches();
      if (Array.isArray(data) && data.length > 0) {
        setUpcomingMatches(data);
      } else {
        setUpcomingMatches([]);
      }
    } catch (error) {
      console.error('Failed to load upcoming matches:', error);
      setUpcomingMatches([]);
    }
  };

  const loadFootballChannels = async () => {
    try {
      const data = await channelsAPI.getChannels('football');
      const mapped = (data || []).map((ch) => {
        const raw = ch.pointsRequired ?? ch.points_required ?? 0;
        const pointsRequired = typeof raw === 'number' && !Number.isNaN(raw) ? raw : parseInt(raw, 10) || 0;
        return {
          id: ch.id,
          name: ch.name,
          icon:
            ch.category === 'football'
              ? 'soccer'
              : ch.category === 'movies'
              ? 'movie'
              : 'television',
          color: ch.color || '#22c55e',
          currentShow: ch.stream_url ? 'Live Channel' : 'Football Channel',
          isLive: ch.is_active,
          category: ch.category || 'Football',
          pointsRequired,
          streamUrl: ch.stream_url,
          thumbnailUrl: ch.thumbnail_url,
          thumbnailEmoji: ch.thumbnail_emoji,
        };
      });
      setFootballChannels(mapped);
    } catch (error) {
      console.error('Failed to load football channels:', error);
      setFootballChannels([]);
    }
  };

  // Refresh user points from backend
  const refreshUserPoints = async () => {
    try {
      const userId = await AsyncStorage.getItem('userId');
      if (userId) {
        const userData = await userAPI.getUser(userId);
        const points = userData.points || 0;
        setCurrentUserPoints(points);
        return points;
      }
    } catch (error) {
      console.error('Failed to refresh user points:', error);
    }
    return currentUserPoints;
  };

  // Badge: Unlocked (subscribed); toggle OFF = points mode (show "Bure" if 0, else points from admin); toggle ON = "Premium"
  const getChannelBadgeText = (pointsRequired, withPts = false) => {
    if (isPremium) return 'Unlocked';
    if (premiumToggleOn) return 'Premium';
    const pts = typeof pointsRequired === 'number' ? pointsRequired : parseInt(pointsRequired, 10) || 0;
    if (pts <= 0) return 'Bure';
    return withPts ? `${pts} pts` : `${pts}`;
  };

  // Open player only when we have a stream URL from backend (admin) – guarantees playback
  const openPlayerWithChannel = (channel, streamUrl) => {
    const url = streamUrl || channel.streamUrl;
    if (!url) return;
    setPlayingChannel({ ...channel, streamUrl: url });
    setVideoPlayerVisible(true);
  };

  // Handle channel click: fetch stream URL from backend first, then open player and play
  const handleChannelClick = async (channel) => {
    const pointsRequired = channel.pointsRequired ?? 0;

    const canPlay = isPremium || pointsRequired === 0;
    if (canPlay) {
      setLoadingChannelId(channel.id);
      try {
        const data = await channelsAPI.getChannel(channel.id);
        const url = data.streamUrl || data.stream_url;
        if (url) {
          setPlayingChannel({ ...channel, streamUrl: url });
          setVideoPlayerVisible(true);
        } else {
          Alert.alert('Stream unavailable', 'No stream URL for this channel.');
        }
      } catch (err) {
        console.error('Failed to load stream URL:', err);
        Alert.alert('Could not load stream', 'Check your connection and try again.');
      } finally {
        setLoadingChannelId(null);
      }
      return;
    }

    if (premiumToggleOn) {
      handleGoPremium();
      return;
    }

    setSelectedChannel(channel);
    setChannelUnlockModalVisible(true);
  };

  const handleUnlockFromModal = async () => {
    if (!selectedChannel) return;
    try {
      const currentUserId = userId || await AsyncStorage.getItem('userId');
      if (!currentUserId) return;
      await userAPI.unlockChannel(currentUserId, selectedChannel.id);
      await refreshUserPoints();
      if (onPointsRefresh) await onPointsRefresh();
      setChannelUnlockModalVisible(false);
      const ch = selectedChannel;
      setSelectedChannel(null);
      setLoadingChannelId(ch.id);
      try {
        const data = await channelsAPI.getChannel(ch.id);
        const url = data.streamUrl || data.stream_url;
        if (url) {
          setPlayingChannel({ ...ch, streamUrl: url });
          setVideoPlayerVisible(true);
        } else {
          Alert.alert('Stream unavailable', 'No stream URL for this channel.');
        }
      } catch (err) {
        console.error('Failed to load stream URL:', err);
        Alert.alert('Could not load stream', 'Check your connection and try again.');
      } finally {
        setLoadingChannelId(null);
      }
    } catch (error) {
      console.error('Failed to unlock channel:', error);
      setInsufficientPointsModalVisible(true);
    }
  };

  const handleUnlockChannel = async (channelId) => {
    const currentUserId = userId || await AsyncStorage.getItem('userId');
    if (!currentUserId) return;
    await userAPI.unlockChannel(currentUserId, channelId);
    await refreshUserPoints();
    if (onPointsRefresh) await onPointsRefresh();
  };

  // Handle go to premium
  const handleGoPremium = () => {
    setActiveTab('payments');
  };

  // Handle points updated after watching ad
  const handlePointsUpdated = async () => {
    const updatedPoints = await refreshUserPoints();
    return updatedPoints;
  };

  // Load all data on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([
          loadSlides(),
          loadMatches(),
          loadFootballChannels(),
        ]);
        if (!cancelled) setInitialLoading(false);
      } catch (_) {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    AsyncStorage.getItem('userId').then((id) => {
      if (id) setUserId(id);
    });
    return () => { cancelled = true; };
  }, []);

  // Update currentUserPoints when userPoints prop changes
  useEffect(() => {
    setCurrentUserPoints(userPoints);
  }, [userPoints]);

  // Refresh all data
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        loadSlides(),
        loadMatches(),
        loadFootballChannels(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

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
        <ProfileScreen accentColor="#4ade80" onWatchAd={onWatchAd} userPoints={userPoints} onPointsRefresh={onPointsRefresh} />
      ) : activeTab === 'channels' ? (
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={[styles.scrollContentContainer, { paddingBottom: contentBottomPadding }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }>
          <View style={styles.channelsContainer}>
            <View style={styles.channelsHeader}>
              <Text style={styles.channelsTitle}>Vituo</Text>
              <Text style={styles.channelsSubtitle}>Chagua channel unayotaka kuangalia</Text>
            </View>

          {(initialLoading || refreshing) ? (
            <View style={styles.channelsShimmerGrid}>
                {[1, 2, 3, 4].map((i) => (
                  <View key={i} style={styles.shimmerChannelCardWrapChannels}>
                    <ShimmerPlaceholder
                      width={(width - 48) / 2}
                      height={120}
                      borderRadius={14}
                      baseColor="#1e1b4b"
                      highlightColor="rgba(74, 222, 128, 0.15)"
                    />
                  </View>
                ))}
              </View>
            ) : footballChannels.length === 0 ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <Text style={{ color: '#9ca3af' }}>
                  Bado hakuna channels za mpira.
                </Text>
              </View>
              
            ) : (
              <View style={styles.channelsGrid}>
                {footballChannels.map((channel) => (
                  <TouchableOpacity
                    key={channel.id}
                    style={styles.channelCard}
                    activeOpacity={0.8}
                    onPress={() => handleChannelClick(channel)}
                    disabled={loadingChannelId === channel.id}>
                    {channel.thumbnailUrl ? (
                      <ImageBackground
                        source={{ uri: channel.thumbnailUrl }}
                        style={styles.channelImageBackground}
                        imageStyle={styles.channelImage}>
                        {/* Optional light overlay (lighter so Watch button stays visible) */}
                        {channel.color ? (
                          <View style={[styles.channelColorOverlay, { backgroundColor: (channel.color || '#000') + '50' }]} />
                        ) : null}
                        <View style={styles.channelGradient}>
                          <View style={styles.channelHeader}>
                            {channel.isLive && (
                              <View style={styles.channelLiveBadge}>
                                <View style={styles.channelLiveDot} />
                                <Text style={styles.channelLiveText}>LIVE</Text>
                              </View>
                            )}
                            <View style={styles.channelPointsBadgeTop}>
                                <AntDesign name="star" size={14} color={isPremium ? '#22c55e' : '#fbbf24'} />
                                <Text style={styles.channelPointsTextTop}>
                                  {getChannelBadgeText(channel.pointsRequired)}
                                </Text>
                              </View>
                          </View>
                          <View style={styles.channelContent}>
                            <Text style={styles.channelName}>{channel.name}</Text>
                          </View>
                          <TouchableOpacity
                            style={[
                              styles.channelWatchButton,
                              { backgroundColor: channel.color },
                            ]}
                            onPress={() => handleChannelClick(channel)}
                            disabled={loadingChannelId === channel.id}>
                            {loadingChannelId === channel.id ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <>
                                <Icon name="play" size={16} color="#fff" />
                                <Text style={styles.channelWatchText}>Play Now</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        </View>
                      </ImageBackground>
                    ) : (
                      <LinearGradient
                        colors={[channel.color + '20', channel.color + '10', 'transparent']}
                        style={styles.channelGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}>
                        <View style={styles.channelHeader}>
                          <View
                            style={[
                              styles.channelIconContainer,
                              { backgroundColor: channel.color + '30' },
                            ]}>
                            {channel.thumbnailEmoji ? (
                              <Text style={styles.channelEmoji}>{channel.thumbnailEmoji}</Text>
                            ) : (
                              <Icon name={channel.icon} size={32} color={channel.color} />
                            )}
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
                          <View style={styles.channelCategory}>
                            <Icon name="tag" size={12} color="#9ca3af" />
                            <Text style={styles.channelCategoryText}>
                              {channel.category}
                            </Text>
                          </View>
                          <View style={styles.channelPointsBadge}>
                              <AntDesign name="star" size={12} color={isPremium ? '#22c55e' : '#fbbf24'} />
                              <Text style={styles.channelPointsText}>
                                {getChannelBadgeText(channel.pointsRequired, true)}
                              </Text>
                            </View>
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.channelWatchButton,
                            { backgroundColor: channel.color },
                          ]}
                          onPress={() => handleChannelClick(channel)}
                          disabled={loadingChannelId === channel.id}>
                          {loadingChannelId === channel.id ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <>
                              <Icon name="play" size={16} color="#fff" />
                              <Text style={styles.channelWatchText}>Play Now</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </LinearGradient>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      ) : (
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContentContainer, { paddingBottom: contentBottomPadding }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }>
          {(initialLoading || refreshing) ? (
            <View style={styles.shimmerContainer}>
              <View style={styles.shimmerCarouselWrap}>
                <ShimmerPlaceholder
                  width={width - 32}
                  height={180}
                  borderRadius={16}
                  baseColor="#1e1b4b"
                  highlightColor="rgba(74, 222, 128, 0.18)"
                />
              </View>
              <View style={styles.homeChannelsSection}>
                <View style={styles.sectionHeader}>
                  <ShimmerPlaceholder
                    width={120}
                    height={20}
                    borderRadius={6}
                    baseColor="#1e1b4b"
                    highlightColor="rgba(74, 222, 128, 0.15)"
                  />
                  <ShimmerPlaceholder
                    width={72}
                    height={16}
                    borderRadius={6}
                    baseColor="#1e1b4b"
                    highlightColor="rgba(74, 222, 128, 0.15)"
                  />
                </View>
                <View style={styles.homeChannelsGrid}>
                  {[1, 2, 3, 4].map((i) => (
                    <View key={i} style={styles.shimmerChannelCardWrap}>
                      <ShimmerPlaceholder
                        width={(width - 48) / 2}
                        height={120}
                        borderRadius={14}
                        baseColor="#1e1b4b"
                        highlightColor="rgba(74, 222, 128, 0.15)"
                      />
                    </View>
                  ))}
                </View>
              </View>
              <View style={[styles.homeChannelsSection, { marginTop: 8 }]}>
                <View style={styles.sectionHeader}>
                  <ShimmerPlaceholder
                    width={120}
                    height={20}
                    borderRadius={6}
                    baseColor="#1e1b4b"
                    highlightColor="rgba(74, 222, 128, 0.15)"
                  />
                  <ShimmerPlaceholder
                    width={72}
                    height={16}
                    borderRadius={6}
                    baseColor="#1e1b4b"
                    highlightColor="rgba(74, 222, 128, 0.15)"
                  />
                </View>
                <View style={styles.matchesShimmerRow}>
                  {[1, 2].map((i) => (
                    <ShimmerPlaceholder
                      key={i}
                      width={width - 32}
                      height={72}
                      borderRadius={12}
                      baseColor="#1e1b4b"
                      highlightColor="rgba(74, 222, 128, 0.15)"
                    />
                  ))}
                </View>
              </View>
            </View>
          ) : (
            <>
          {/* Image Carousel */}
          <ImageCarousel
            items={carouselItems}
            onWatchAd={onWatchAd}
            onGoPremium={handleGoPremium}
            isPremium={isPremium}
            premiumToggleOn={premiumToggleOn}
          />

          {/* Channels preview (4 channels + View all → channels tab) */}
          <View style={styles.homeChannelsSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Tranding</Text>
              <TouchableOpacity onPress={() => setActiveTab('channels')}>
                <Text style={styles.viewAllText}>View all</Text>
              </TouchableOpacity>
            </View>
            {footballChannels.length === 0 ? (
              <View style={styles.homeChannelsEmpty}>
                <Text style={styles.homeChannelsEmptyText}>Bado hakuna channels.</Text>
              </View>
            ) : (
              <View style={styles.homeChannelsGrid}>
                {(footballChannels.slice(0, 4)).map((channel) => (
                  <TouchableOpacity
                    key={channel.id}
                    style={styles.homeChannelCard}
                    activeOpacity={0.8}
                    onPress={() => handleChannelClick(channel)}
                    disabled={loadingChannelId === channel.id}>
                    {channel.thumbnailUrl ? (
                      <ImageBackground
                        source={{ uri: channel.thumbnailUrl }}
                        style={styles.channelImageBackground}
                        imageStyle={styles.channelImage}>
                        {channel.color ? (
                          <View style={[styles.channelColorOverlay, { backgroundColor: (channel.color || '#000') + '50' }]} />
                        ) : null}
                        <View style={styles.channelGradient}>
                          <View style={styles.channelHeader}>
                            {channel.isLive && (
                              <View style={styles.channelLiveBadge}>
                                <View style={styles.channelLiveDot} />
                                <Text style={styles.channelLiveText}>LIVE</Text>
                              </View>
                            )}
                            <View style={styles.channelPointsBadgeTop}>
                              <AntDesign name="star" size={14} color={isPremium ? '#22c55e' : '#fbbf24'} />
                              <Text style={styles.channelPointsTextTop}>
                                {getChannelBadgeText(channel.pointsRequired)}
                              </Text>
                            </View>
                          </View>
                          <View style={styles.channelContent}>
                            <Text style={styles.channelName} numberOfLines={1}>{channel.name}</Text>
                          </View>
                          <TouchableOpacity
                            style={[styles.channelWatchButton, { backgroundColor: channel.color || '#22c55e' }]}
                            onPress={() => handleChannelClick(channel)}
                            disabled={loadingChannelId === channel.id}>
                            {loadingChannelId === channel.id ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <>
                                <Icon name="play" size={16} color="#fff" />
                                <Text style={styles.channelWatchText}>Play Now</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        </View>
                      </ImageBackground>
                    ) : (
                      <LinearGradient
                        colors={[(channel.color || '#22c55e') + '20', (channel.color || '#22c55e') + '10', 'transparent']}
                        style={styles.channelGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}>
                        <View style={styles.channelHeader}>
                          <View style={[styles.channelIconContainer, { backgroundColor: (channel.color || '#22c55e') + '30' }]}>
                            {channel.thumbnailEmoji ? (
                              <Text style={styles.channelEmoji}>{channel.thumbnailEmoji}</Text>
                            ) : (
                              <Icon name={channel.icon || 'soccer'} size={32} color={channel.color || '#22c55e'} />
                            )}
                          </View>
                          <View style={styles.channelPointsBadgeTop}>
                              <AntDesign name="star" size={14} color={isPremium ? '#22c55e' : '#fbbf24'} />
                              <Text style={styles.channelPointsTextTop}>
                                {getChannelBadgeText(channel.pointsRequired)}
                              </Text>
                            </View>
                        </View>
                        <View style={styles.channelContent}>
                          <Text style={styles.channelName} numberOfLines={1}>{channel.name}</Text>
                          <View style={styles.channelPointsBadge}>
                            <AntDesign name="star" size={12} color={isPremium ? '#22c55e' : '#fbbf24'} />
                            <Text style={styles.channelPointsText}>
                              {getChannelBadgeText(channel.pointsRequired, true)}
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={[styles.channelWatchButton, { backgroundColor: channel.color || '#22c55e' }]}
                          onPress={() => handleChannelClick(channel)}
                          disabled={loadingChannelId === channel.id}>
                          {loadingChannelId === channel.id ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <>
                              <Icon name="play" size={16} color="#fff" />
                              <Text style={styles.channelWatchText}>Play Now</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </LinearGradient>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Upcoming Matches */}
          <View style={styles.matchesSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Ratiba ya michezo</Text>
            <TouchableOpacity>
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>

          {upcomingMatches.length === 0 ? (
            <View style={styles.emptyMatchesContainer}>
              <Text style={styles.emptyMatchesText}>
                .
              </Text>
            </View>
          ) : (
            upcomingMatches.map((match) => {
              const matchDate = new Date(match.match_time);
              const timeStr = matchDate.toLocaleString('sw-TZ', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              });
              return (
                <View key={match.id} style={styles.matchCard}>
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
                      <Text style={styles.timeText}>{timeStr}</Text>
                    </View>
                    {!isPremium && (
                      <View style={styles.earnPointsBadge}>
                        <AntDesign name="star" size={12} color="#fbbf24" />
                        <Text style={styles.earnPointsText}>
                          Earn {match.points_required || 15} pts
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </View>
            </>
          )}
        </ScrollView>
      )}

      {/* Bottom Navigation - safe area so not covered by system nav/gesture bar */}
      <View style={[styles.bottomNav, { paddingBottom: bottomInset }]}>
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
            Nyumbani
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
            Vituo
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
            Malipo
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
            Salio
          </Text>
        </TouchableOpacity>
      </View>

      {/* Channel Unlock Choice Modal (non-premium) */}
      <ChannelUnlockModal
        visible={channelUnlockModalVisible}
        onClose={() => {
          setChannelUnlockModalVisible(false);
          setSelectedChannel(null);
        }}
        channelName={selectedChannel?.name || ''}
        pointsRequired={selectedChannel?.pointsRequired ?? 0}
        currentPoints={currentUserPoints}
        onUnlock={handleUnlockFromModal}
        onWatchAd={onWatchAd}
        onGoPremium={handleGoPremium}
      />

      {/* Insufficient Points Modal */}
      <InsufficientPointsModal
        visible={insufficientPointsModalVisible}
        onClose={() => {
          setInsufficientPointsModalVisible(false);
          setSelectedChannel(null);
        }}
        channelName={selectedChannel?.name || ''}
        pointsRequired={selectedChannel?.pointsRequired || 0}
        userPoints={currentUserPoints}
        onWatchAd={onWatchAd}
        onGoPremium={handleGoPremium}
        onPointsUpdated={async () => {
          const updatedPoints = await handlePointsUpdated();
          // If user now has enough points, unlock and play
          if (selectedChannel && updatedPoints >= selectedChannel.pointsRequired) {
            try {
              await handleUnlockChannel(selectedChannel.id);
              setPlayingChannel(selectedChannel);
              setVideoPlayerVisible(true);
              setInsufficientPointsModalVisible(false);
              setSelectedChannel(null);
            } catch (error) {
              console.error('Failed to unlock channel after earning points:', error);
            }
          }
          return updatedPoints;
        }}
      />

      {/* Video Player */}
      <VideoPlayer
        visible={videoPlayerVisible}
        onClose={() => {
          setVideoPlayerVisible(false);
          setPlayingChannel(null);
        }}
        videoUrl={playingChannel?.streamUrl}
        channelName={playingChannel?.name}
        onUnlockChannel={handleUnlockChannel}
        channelId={playingChannel?.id}
        userId={userId}
      />
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
  scrollContentContainer: {
    paddingBottom: 100,
  },
  shimmerContainer: {
    padding: 16,
    paddingBottom: 100,
  },
  shimmerCarouselWrap: {
    marginBottom: 24,
    alignSelf: 'center',
  },
  matchesShimmerRow: {
    gap: 12,
  },
  shimmerChannelCardWrap: {
    width: (width - 48) / 2,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 8,
  },
  shimmerChannelCardWrapChannels: {
    width: (width - 44) / 2,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 8,
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
  homeChannelsSection: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  homeChannelsEmpty: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  homeChannelsEmptyText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  homeChannelsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  homeChannelCard: {
    width: (width - 44) / 2,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.5)',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
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
  emptyMatchesContainer: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyMatchesText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    paddingVertical: 10,
    paddingHorizontal: 4,
    minHeight: BOTTOM_NAV_BASE_HEIGHT,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    minWidth: 0,
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
  channelsShimmerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
    width: '100%',
  },
  channelCard: {
    width: (width - 48) / 2,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.5)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  channelImageBackground: {
    width: '100%',
    minHeight: 200,
    borderRadius: 16,
    overflow: 'hidden',
  },
  channelImage: {
    borderRadius: 16,
    resizeMode: 'cover',
  },
  channelColorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
  },
  channelGradient: {
    padding: 16,
    minHeight: 200,
    position: 'relative',
    zIndex: 1,
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
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
  channelPointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  channelPointsText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#fbbf24',
  },
  channelPointsBadgeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.5)',
  },
  channelPointsTextTop: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#fbbf24',
  },
  channelEmoji: {
    fontSize: 32,
  },
  channelWatchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginTop: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
  },
  channelWatchText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    fontWeight: '600',
  },
});

export default FootballApp;
