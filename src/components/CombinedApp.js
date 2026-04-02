import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Animated,
  Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import ImageCarousel from './ImageCarousel';
import ShimmerPlaceholder from './ShimmerPlaceholder';
import { settingsAPI, channelsAPI, matchesAPI, userAPI, API_BASE_URL } from '../config/api';
import PaymentsScreen from './PaymentsScreen';
import ProfileScreen from './ProfileScreen';
import InsufficientPointsModal from './InsufficientPointsModal';
import ChannelUnlockModal from './ChannelUnlockModal';
import VideoPlayer from '../player/VideoPlayer';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');
const BOTTOM_NAV_BASE_HEIGHT = 56;
const CARD_WIDTH = (width - 44) / 2;
const CARD_HEIGHT = 240;

// 15 colors cycling back to start for seamless loop
const BASE_GLOW_COLORS = [
  '#a855f7', '#7c3aed', '#6366f1', '#3b82f6', '#0ea5e9',
  '#06b6d4', '#10b981', '#22c55e', '#84cc16', '#eab308',
  '#f97316', '#ef4444', '#ec4899', '#f43f5e', '#a855f7',
];

const CHANNEL_FILTERS = [
  { key: 'zote', label: 'Channel Zote', color: '#60a5fa', icon: 'television-play' },
  { key: 'mpira', label: 'Mpira', color: '#4ade80', icon: 'soccer' },
  { key: 'movies', label: 'Movies', color: '#a855f7', icon: 'movie' },
  { key: 'habari', label: 'Habari', color: '#ef4444', icon: 'newspaper-variant' },
];

const MOVIE_GENRES = [
  { name: 'Tamthilia', key: 'tamthilia', icon: 'drama-masks', color: '#ec4899' },
  { name: 'Filamu', key: 'movies', icon: 'movie', color: '#3b82f6' },
  { name: 'Wanyama', key: 'wanyama', icon: 'paw', color: '#10b981' },
  { name: 'Katuni', key: 'katuni', icon: 'animation', color: '#f59e0b' },
  { name: 'Sayansi', key: 'sayansi', icon: 'atom', color: '#8b5cf6' },
];

const CombinedApp = ({
  isPremium,
  channelsPremiumOnly,
  userPoints,
  onWatchAd,
  onPaymentsActiveChange,
  onPointsRefresh,
}) => {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 8 : 0);
  const contentBottomPadding = BOTTOM_NAV_BASE_HEIGHT + bottomInset;

  // ── Glow animation ──────────────────────────────────────────────────────────
  const glowAnim = useRef(new Animated.Value(0)).current;

  // 4 phase-shifted animated colors derived from a single shared animation
  const glowPhaseColors = useRef(
    [0, 0.25, 0.5, 0.75].map((phase) => {
      const n = BASE_GLOW_COLORS.length - 1;
      const offset = Math.round(phase * n);
      const rotated = [
        ...BASE_GLOW_COLORS.slice(offset, n),
        ...BASE_GLOW_COLORS.slice(0, offset),
        BASE_GLOW_COLORS[offset], // close the loop seamlessly
      ];
      const inputRange = rotated.map((_, i) => i / (rotated.length - 1));
      return glowAnim.interpolate({ inputRange, outputRange: rotated });
    })
  ).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 10000, // 10 s per full colour cycle – slow & smooth
        easing: Easing.linear,
        useNativeDriver: false,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [glowAnim]);

  // ── State ───────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('home');
  const [channelFilter, setChannelFilter] = useState('zote');
  const [carouselItems, setCarouselItems] = useState([]);
  const [footballChannels, setFootballChannels] = useState([]);
  const [channelsByCategory, setChannelsByCategory] = useState({
    tamthilia: [], wanyama: [], katuni: [], habari: [], sayansi: [], movies: [],
  });
  const [upcomingMatches, setUpcomingMatches] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [insufficientPointsModalVisible, setInsufficientPointsModalVisible] = useState(false);
  const [channelUnlockModalVisible, setChannelUnlockModalVisible] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [currentUserPoints, setCurrentUserPoints] = useState(userPoints);
  const [videoPlayerVisible, setVideoPlayerVisible] = useState(false);
  const [playingChannel, setPlayingChannel] = useState(null);
  const [userId, setUserId] = useState(null);
  const [loadingChannelId, setLoadingChannelId] = useState(null);

  // ── Side effects ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (onPaymentsActiveChange) {
      onPaymentsActiveChange(activeTab === 'payments' || activeTab === 'profile');
    }
    if (activeTab !== 'payments' && onPointsRefresh) {
      onPointsRefresh();
    }
  }, [activeTab, onPaymentsActiveChange, onPointsRefresh]);

  useEffect(() => {
    if (videoPlayerVisible && playingChannel) {
      const url = playingChannel.streamUrl || playingChannel.stream_url || '(empty)';
      const clearkey = playingChannel.drmClearKey ?? playingChannel.drm_clear_key ?? null;
      if (__DEV__) {
        console.log('[CombinedApp] Playing:', JSON.stringify({
          channelId: playingChannel.id, channelName: playingChannel.name,
          streamUrl: url, drmType: playingChannel.drmType ?? playingChannel.drm_type, clearkey,
        }, null, 2));
      }
    }
  }, [videoPlayerVisible, playingChannel]);

  // ── Data loaders ────────────────────────────────────────────────────────────
  const mapSlides = (data, defaultGradient) => {
    if (!Array.isArray(data) || data.length === 0) return [];
    return data.map((slide) => ({
      title: slide.title,
      subtitle: slide.subtitle,
      badge: slide.badge,
      imageUrl: slide.image_url,
      videoUrl: slide.video_url,
      gradient: [
        slide.gradient_start || defaultGradient[0],
        slide.gradient_mid || defaultGradient[1],
        slide.gradient_end || defaultGradient[2],
      ],
      info: slide.info_text
        ? [{ icon: slide.info_icon || 'clockcircleo', text: slide.info_text }]
        : [],
    }));
  };

  const loadSlides = useCallback(async () => {
    try {
      const [footballData, moviesData] = await Promise.all([
        settingsAPI.getCarouselSlides('football'),
        settingsAPI.getCarouselSlides('movies'),
      ]);
      const combined = [
        ...mapSlides(footballData, ['#14532d', '#111827', '#000000']),
        ...mapSlides(moviesData, ['#581c87', '#111827', '#000000']),
      ];
      setCarouselItems(combined);
    } catch (error) {
      console.error('Failed to load carousel slides:', error);
    }
  }, []);

  const loadChannels = useCallback(async () => {
    try {
      const allChannels = await channelsAPI.getChannels();
      const football = [];
      const categorized = { tamthilia: [], wanyama: [], katuni: [], habari: [], sayansi: [], movies: [] };
      const movieCategories = Object.keys(categorized);

      (allChannels || []).forEach((ch) => {
        if (!ch.is_active) return;
        const category = ch.category?.toLowerCase();
        const raw = ch.pointsRequired ?? ch.points_required ?? 0;
        const pointsRequired = typeof raw === 'number' && !Number.isNaN(raw) ? raw : parseInt(raw, 10) || 0;
        const unlockToFree = !!(ch.unlockToFree === true || ch.unlock_to_free === true);
        const mapped = {
          id: ch.id,
          name: ch.name,
          streamUrl: ch.stream_url,
          thumbnailUrl: ch.thumbnail_url,
          thumbnailEmoji: ch.thumbnail_emoji,
          color: ch.color || '#22c55e',
          category: ch.category,
          pointsRequired,
          unlockToFree,
          isLive: ch.is_active,
          icon: category === 'football' ? 'soccer' : category === 'movies' ? 'movie' : 'television',
        };
        if (category === 'football') {
          football.push(mapped);
        } else if (movieCategories.includes(category)) {
          categorized[category].push(mapped);
        }
      });

      setFootballChannels(football);
      setChannelsByCategory(categorized);
    } catch (error) {
      console.error('Failed to load channels:', error);
    }
  }, []);

  const loadMatches = useCallback(async () => {
    try {
      const data = await matchesAPI.getUpcomingMatches();
      setUpcomingMatches(Array.isArray(data) ? data : []);
    } catch (error) {
      setUpcomingMatches([]);
    }
  }, []);

  const refreshUserPoints = async () => {
    try {
      const uid = await AsyncStorage.getItem('userId');
      if (uid) {
        const userData = await userAPI.getUser(uid);
        const points = userData.points || 0;
        setCurrentUserPoints(points);
        return points;
      }
    } catch (error) {
      console.error('Failed to refresh user points:', error);
    }
    return currentUserPoints;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([loadSlides(), loadChannels(), loadMatches()]);
        if (!cancelled) setInitialLoading(false);
      } catch (_) {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    AsyncStorage.getItem('userId').then((id) => { if (id) setUserId(id); });
    return () => { cancelled = true; };
  }, [loadSlides, loadChannels, loadMatches]);

  useEffect(() => { setCurrentUserPoints(userPoints); }, [userPoints]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadSlides(), loadChannels(), loadMatches()]);
    } finally {
      setRefreshing(false);
    }
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const getChannelBadgeText = (pointsRequired, withPts = false, unlockToFree = false) => {
    if (isPremium) return 'Unlocked';
    if (channelsPremiumOnly && !unlockToFree) return 'Premium';
    if (channelsPremiumOnly && unlockToFree) return 'Bure';
    const pts = typeof pointsRequired === 'number' ? pointsRequired : parseInt(pointsRequired, 10) || 0;
    if (pts <= 0) return 'Bure';
    return withPts ? `${pts} pts` : `${pts}`;
  };

  // ── Event handlers ──────────────────────────────────────────────────────────
  const handlePlayCarouselSlide = async (slide) => {
    if (!slide?.videoUrl && !slide?.id) return;
    const channelId = slide.id || null;
    if (channelId) {
      setLoadingChannelId(channelId);
      try {
        const data = await channelsAPI.getChannel(channelId);
        const url = data.streamUrl || data.stream_url || slide.videoUrl;
        if (url) {
          setPlayingChannel({
            ...slide, id: channelId, name: slide.title || data.name || 'Video',
            streamUrl: url,
            drmType: data.drmType ?? data.drm_type ?? 'NONE',
            drmProtected: (data.drmType ?? data.drm_type ?? 'NONE') !== 'NONE',
            drmClearKey: data.drmClearKey ?? data.drm_clear_key ?? null,
            drm_clear_key: data.drm_clear_key ?? data.drmClearKey ?? null,
          });
          setVideoPlayerVisible(true);
        }
      } catch (err) {
        console.error('Failed to load carousel channel:', err);
        if (slide.videoUrl) {
          setPlayingChannel({ id: channelId, name: slide.title || 'Video', streamUrl: slide.videoUrl });
          setVideoPlayerVisible(true);
        }
      } finally {
        setLoadingChannelId(null);
      }
    } else {
      setPlayingChannel({ id: null, name: slide.title || 'Video', streamUrl: slide.videoUrl });
      setVideoPlayerVisible(true);
    }
  };

  const handleChannelClick = async (channel) => {
    const pointsRequired = channel.pointsRequired ?? 0;
    const unlockToFree = !!(channel.unlockToFree === true || channel.unlock_to_free === true);
    const canPlay = isPremium || (channelsPremiumOnly ? unlockToFree : pointsRequired === 0);
    if (canPlay) {
      setLoadingChannelId(channel.id);
      try {
        const data = await channelsAPI.getChannel(channel.id);
        const url = data.streamUrl || data.stream_url;
        if (url) {
          setPlayingChannel({ ...channel, ...data, streamUrl: url });
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
    if (channelsPremiumOnly) { handleGoPremium(); return; }
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
          setPlayingChannel({ ...ch, ...data, streamUrl: url });
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

  const handleGoPremium = () => setActiveTab('payments');

  const handlePointsUpdated = async () => {
    const updatedPoints = await refreshUserPoints();
    return updatedPoints;
  };

  // ── Channel section data ────────────────────────────────────────────────────
  const getFilteredSections = () => {
    switch (channelFilter) {
      case 'mpira':
        return footballChannels.length > 0
          ? [{ key: 'football', name: 'Mpira', icon: 'soccer', color: '#4ade80', channels: footballChannels }]
          : [];
      case 'movies':
        return MOVIE_GENRES
          .map(g => ({ key: g.key, name: g.name, icon: g.icon, color: g.color, channels: channelsByCategory[g.key] || [] }))
          .filter(s => s.channels.length > 0);
      case 'habari': {
        const habari = channelsByCategory.habari || [];
        return habari.length > 0
          ? [{ key: 'habari', name: 'Habari', icon: 'newspaper-variant', color: '#ef4444', channels: habari }]
          : [];
      }
      case 'zote':
      default: {
        const sections = [];
        if (footballChannels.length > 0) {
          sections.push({ key: 'football', name: 'Mpira', icon: 'soccer', color: '#4ade80', channels: footballChannels });
        }
        MOVIE_GENRES.forEach(g => {
          const channels = channelsByCategory[g.key] || [];
          if (channels.length > 0) sections.push({ key: g.key, name: g.name, icon: g.icon, color: g.color, channels });
        });
        const habari = channelsByCategory.habari || [];
        if (habari.length > 0) {
          sections.push({ key: 'habari', name: 'Habari', icon: 'newspaper-variant', color: '#ef4444', channels: habari });
        }
        return sections;
      }
    }
  };

  // ── Card renderer ───────────────────────────────────────────────────────────
  const renderChannelCard = (channel, sectionColor, cardIndex) => {
    const channelColor = channel.color || sectionColor || '#60a5fa';
    const isLoading = loadingChannelId === channel.id;
    const glowColor = glowPhaseColors[cardIndex % glowPhaseColors.length];

    const pointsBadge = (
      <View style={styles.cardPointsBadge}>
        <AntDesign name="star" size={11} color={isPremium ? '#22c55e' : '#fbbf24'} />
        <Text style={styles.cardPointsText}>
          {getChannelBadgeText(channel.pointsRequired, false, channel.unlockToFree)}
        </Text>
      </View>
    );

    const topBadges = (
      <View style={styles.cardTopRow}>
        {channel.isLive ? (
          <>
            <View style={styles.cardLiveBadge}>
              <View style={styles.cardLiveDot} />
              <Text style={styles.cardLiveText}>LIVE</Text>
            </View>
            {pointsBadge}
          </>
        ) : (
          <>
            <View style={styles.cardTopSpacer} />
            {pointsBadge}
          </>
        )}
      </View>
    );

    const bottomInfo = (
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.72)', 'rgba(0,0,0,0.97)']}
        style={styles.cardBottomGradient}>
        <View style={styles.cardBottomRow}>
          <Text style={styles.cardChannelName} numberOfLines={2}>{channel.name}</Text>
          <View style={styles.cardCategoryTag}>
            <Icon name={channel.icon || 'television'} size={10} color={channelColor} />
            <Text style={styles.cardCategoryText}>{channel.category || 'Channel'}</Text>
          </View>
        </View>
      </LinearGradient>
    );

    const loadingOverlay = isLoading ? (
      <View style={styles.cardLoadingOverlay}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    ) : null;

    return (
      <TouchableOpacity
        key={channel.id}
        activeOpacity={0.88}
        onPress={() => handleChannelClick(channel)}
        disabled={isLoading}
        style={styles.cardTouchable}>
        {/* Outer Animated.View carries the glowing border + iOS shadow – NO overflow so shadow is visible */}
        <Animated.View
          style={[
            styles.cardOuter,
            { borderColor: glowColor, shadowColor: glowColor },
          ]}>
          {channel.thumbnailUrl ? (
            /* ImageBackground clips itself via overflow + borderRadius on cardBg */
            <ImageBackground
              source={{ uri: channel.thumbnailUrl }}
              style={styles.cardBg}
              imageStyle={styles.cardBgImage}>
              {topBadges}
              {loadingOverlay}
              {bottomInfo}
            </ImageBackground>
          ) : (
            /* Plain View with overflow:hidden clips the gradient to rounded corners */
            <View style={styles.cardBgClip}>
              <LinearGradient
                colors={[channelColor + '55', channelColor + '22', '#090d18']}
                style={styles.cardBg}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.9, y: 1 }}>
                {/* Centred icon / emoji */}
                <View style={styles.cardNoImageCenter}>
                  {channel.thumbnailEmoji ? (
                    <Text style={styles.cardEmoji}>{channel.thumbnailEmoji}</Text>
                  ) : (
                    <Icon name={channel.icon || 'television'} size={56} color={channelColor + 'cc'} />
                  )}
                </View>
                {topBadges}
                {loadingOverlay}
                {bottomInfo}
              </LinearGradient>
            </View>
          )}
        </Animated.View>
      </TouchableOpacity>
    );
  };

  // ── Section renderer ────────────────────────────────────────────────────────
  const renderChannelSections = () => {
    const sections = getFilteredSections();
    if (sections.length === 0) {
      return (
        <View style={styles.emptyChannels}>
          <Icon name="television-off" size={52} color="#374151" />
          <Text style={styles.emptyChannelsText}>Bado hakuna channels.</Text>
        </View>
      );
    }
    let globalCardIndex = 0;
    return sections.map(section => (
      <View key={section.key} style={styles.categorySection}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderLeft}>
            <Icon name={section.icon} size={20} color={section.color} />
            <Text style={styles.sectionTitle}>{section.name}</Text>
          </View>
          <Text style={styles.sectionCount}>{section.channels.length} channels</Text>
        </View>
        <View style={styles.channelsGrid}>
          {section.channels.map((ch) => {
            const cardIndex = globalCardIndex++;
            return renderChannelCard(ch, section.color, cardIndex);
          })}
        </View>
      </View>
    ));
  };

  // ── Filter tabs ─────────────────────────────────────────────────────────────
  const renderFilterTabs = () => (
    <View style={styles.filterTabsContainer}>
      {CHANNEL_FILTERS.map(filter => {
        const isActive = channelFilter === filter.key;
        return (
          <TouchableOpacity
            key={filter.key}
            style={[
              styles.filterTab,
              isActive && { backgroundColor: filter.color, borderColor: filter.color },
            ]}
            onPress={() => setChannelFilter(filter.key)}
            activeOpacity={0.7}>
            <Icon name={filter.icon} size={15} color={isActive ? '#fff' : filter.color} />
            <Text style={[styles.filterTabText, isActive && styles.filterTabTextActive]}>
              {filter.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // ── Shimmer ─────────────────────────────────────────────────────────────────
  const renderShimmer = () => (
    <View style={styles.shimmerContainer}>
      {/* Single carousel shimmer */}
      <View style={styles.shimmerCarouselWrap}>
        <ShimmerPlaceholder
          width={width - 32} height={320} borderRadius={20}
          baseColor="#0c1322" highlightColor="rgba(96,165,250,0.14)"
        />
      </View>
      {/* Filter tabs shimmer */}
      <View style={styles.shimmerFilterRow}>
        {[1, 2, 3, 4].map(i => (
          <ShimmerPlaceholder key={i} width={78} height={36} borderRadius={20}
            baseColor="#0c1322" highlightColor="rgba(96,165,250,0.15)"
          />
        ))}
      </View>
      {/* Two rows of channel cards (4 cards = 2×2 grid) */}
      <View style={styles.shimmerGrid}>
        {[1, 2, 3, 4, 5, 6].map(i => (
          <View key={i} style={styles.shimmerCardWrap}>
            <ShimmerPlaceholder
              width={CARD_WIDTH} height={CARD_HEIGHT} borderRadius={18}
              baseColor="#0c1322" highlightColor="rgba(96,165,250,0.18)"
            />
          </View>
        ))}
      </View>
    </View>
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0c0f1a', '#111827', '#000000']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      {/* Header */}
      {activeTab !== 'payments' && activeTab !== 'profile' && (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Icon name="television-play" size={24} color="#60a5fa" />
            <Text style={styles.headerTitle}>EaMax TV</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.pointsBadge}>
              <AntDesign name="star" size={16} color="#fbbf24" />
              <Text style={styles.pointsText}>{userPoints} pts</Text>
            </View>
            {!isPremium && (
              <TouchableOpacity style={styles.premiumButton} onPress={handleGoPremium} activeOpacity={0.8}>
                <AntDesign name="star" size={14} color="#fff" />
                <Text style={styles.premiumButtonText}>Premium</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* ── Screens ── */}
      {activeTab === 'payments' ? (
        <PaymentsScreen
          accentColor="#60a5fa"
          bottomPadding={contentBottomPadding}
          onPaymentSuccess={onPointsRefresh}
        />
      ) : activeTab === 'profile' ? (
        <ProfileScreen
          accentColor="#60a5fa"
          onWatchAd={onWatchAd}
          userPoints={userPoints}
          onPointsRefresh={onPointsRefresh}
          bottomPadding={contentBottomPadding}
        />
      ) : activeTab === 'channels' ? (

        /* ── VITUO TAB ── */
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContentContainer, { paddingBottom: contentBottomPadding }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          <View style={styles.channelsPageHeader}>
            <Text style={styles.channelsPageTitle}>Vituo Vyote</Text>
            <Text style={styles.channelsPageSubtitle}>Chagua channel unayotaka kuangalia</Text>
          </View>
          {renderFilterTabs()}
          {(initialLoading || refreshing) ? (
            <View style={styles.shimmerGrid}>
              {[1, 2, 3, 4].map(i => (
                <View key={i} style={styles.shimmerCardWrap}>
                  <ShimmerPlaceholder
                    width={CARD_WIDTH} height={CARD_HEIGHT} borderRadius={18}
                    baseColor="#0c1322" highlightColor="rgba(96,165,250,0.18)"
                  />
                </View>
              ))}
            </View>
          ) : renderChannelSections()}
        </ScrollView>

      ) : (

        /* ── HOME TAB ── */
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContentContainer, { paddingBottom: contentBottomPadding }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          {(initialLoading || refreshing) ? renderShimmer() : (
            <>
              {/* Combined Carousel */}
              {carouselItems.length > 0 && (
                <ImageCarousel
                  items={carouselItems}
                  onWatchAd={onWatchAd}
                  onGoPremium={handleGoPremium}
                  isPremium={isPremium}
                  channelsPremiumOnly={channelsPremiumOnly}
                  onPlaySlide={handlePlayCarouselSlide}
                />
              )}

              {/* Channels section header */}
              <View style={styles.channelsSectionLabel}>
                <Icon name="television" size={20} color="#60a5fa" />
                <Text style={styles.channelsSectionLabelText}>Channels</Text>
              </View>

              {/* Filter Tabs */}
              {renderFilterTabs()}

              {/* Channel Sections */}
              {renderChannelSections()}

              {/* Upcoming Matches */}
              {(channelFilter === 'zote' || channelFilter === 'mpira') && upcomingMatches.length > 0 && (
                <View style={styles.matchesSection}>
                  <View style={styles.sectionHeader}>
                    <View style={styles.sectionHeaderLeft}>
                      <Icon name="calendar-clock" size={20} color="#4ade80" />
                      <Text style={styles.sectionTitle}>Ratiba ya michezo</Text>
                    </View>
                  </View>
                  {upcomingMatches.map((match) => {
                    const matchDate = new Date(match.match_time);
                    const timeStr = matchDate.toLocaleString('sw-TZ', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
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
                  })}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* Bottom Navigation */}
      <View style={[styles.bottomNav, { paddingBottom: bottomInset }]}>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('home')}>
          <Icon name="home" size={24} color={activeTab === 'home' ? '#60a5fa' : '#9ca3af'} />
          <Text style={[styles.navText, activeTab === 'home' && styles.navTextActive]}>Nyumbani</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('channels')}>
          <Icon name="television" size={24} color={activeTab === 'channels' ? '#60a5fa' : '#9ca3af'} />
          <Text style={[styles.navText, activeTab === 'channels' && styles.navTextActive]}>Vituo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('payments')}>
          <Icon name="wallet" size={24} color={activeTab === 'payments' ? '#60a5fa' : '#9ca3af'} />
          <Text style={[styles.navText, activeTab === 'payments' && styles.navTextActive]}>Malipo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('profile')}>
          <Icon name="account" size={24} color={activeTab === 'profile' ? '#60a5fa' : '#9ca3af'} />
          <Text style={[styles.navText, activeTab === 'profile' && styles.navTextActive]}>Salio</Text>
        </TouchableOpacity>
      </View>

      {/* Channel Unlock Modal */}
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
        channelsPremiumOnly={channelsPremiumOnly}
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
        channelsPremiumOnly={channelsPremiumOnly}
        onPointsUpdated={async () => {
          const updatedPoints = await handlePointsUpdated();
          if (selectedChannel && updatedPoints >= selectedChannel.pointsRequired) {
            try {
              await handleUnlockChannel(selectedChannel.id);
              const data = await channelsAPI.getChannel(selectedChannel.id);
              const url = data.streamUrl || data.stream_url;
              if (url) {
                setPlayingChannel({ ...selectedChannel, ...data, streamUrl: url });
                setVideoPlayerVisible(true);
              }
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
        drmProtected={(playingChannel?.drmType ?? playingChannel?.drm_type ?? 'NONE') !== 'NONE'}
        drmClearKey={playingChannel?.drmClearKey || playingChannel?.drm_clear_key || null}
        drmType={playingChannel?.drmType ?? playingChannel?.drm_type ?? 'NONE'}
        drmLicenseUrl={
          (playingChannel?.drmType === 'CLEARKEY' || playingChannel?.drm_type === 'CLEARKEY') && playingChannel?.id
            ? `${API_BASE_URL}/api/channels/${playingChannel.id}/drm-license`
            : undefined
        }
        fetchChannelClearKey={async (id) => {
          const d = await channelsAPI.getChannel(id);
          return { drmClearKey: d.drmClearKey ?? d.drm_clear_key ?? null };
        }}
      />
    </View>
  );
};

// ── Styles ──────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(96,165,250,0.2)',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', letterSpacing: 0.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pointsBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(96,165,250,0.12)',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(96,165,250,0.3)',
  },
  pointsText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  premiumButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#eab308', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
  },
  premiumButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  scrollView: { flex: 1 },
  scrollContentContainer: { paddingBottom: 100 },
  
  channelsSectionLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingTop: 20, paddingBottom: 2,
  },
  channelsSectionLabelText: { fontSize: 18, fontWeight: '700', color: '#fff' },

  // ── Filter tabs ──
  filterTabsContainer: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 8,
  },
  filterTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 8, paddingHorizontal: 4,
    borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.35)',
    backgroundColor: 'rgba(12,18,34,0.7)',
  },
  filterTabText: { fontSize: 10, fontWeight: '700', color: '#9ca3af', letterSpacing: 0.3 },
  filterTabTextActive: { color: '#fff' },

  // ── Channel card (new design) ──
  cardTouchable: {
    width: CARD_WIDTH,
    marginBottom: 4,
  },
  cardOuter: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1.8,
    // borderColor: animated
    // shadowColor: animated (iOS)
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 18,
    elevation: 14,
    backgroundColor: '#090d18',
  },
  // cardBg is shared between ImageBackground (with image) and LinearGradient (no image)
  // overflow + borderRadius here does the clipping so no intermediate wrapper is needed
  cardBg: {
    height: CARD_HEIGHT,
    justifyContent: 'space-between',
    overflow: 'hidden',
    borderRadius: 16,
  },
  // The image inside ImageBackground just needs resizeMode; clipping is handled by cardBg
  cardBgImage: {
    resizeMode: 'cover',
  },
  // Wrapper for the no-image gradient case so it clips to rounded corners
  cardBgClip: {
    height: CARD_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 10,
  },
  cardTopSpacer: { flex: 1 },
  cardLiveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#dc2626',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
  },
  cardLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  cardLiveText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  cardPointsBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(251,191,36,0.5)',
  },
  cardPointsText: { fontSize: 11, fontWeight: '800', color: '#fbbf24' },
  cardNoImageCenter: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
  },
  cardEmoji: { fontSize: 54 },
  cardBottomGradient: {
    paddingHorizontal: 10, paddingTop: 32, paddingBottom: 10,
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 6,
  },
  cardChannelName: {
    flex: 1,
    fontSize: 13, fontWeight: '800', color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
    letterSpacing: 0.1,
  },
  cardCategoryTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    flexShrink: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: 8,
  },
  cardCategoryText: { fontSize: 10, color: '#c0c0c0', fontWeight: '500' },
  cardLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', zIndex: 10,
  },

  // ── Sections ──
  categorySection: { paddingHorizontal: 16, paddingBottom: 8, marginBottom: 4 },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 14,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  sectionCount: { fontSize: 13, color: '#6b7280' },
  channelsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'space-between', gap: 12,
  },
  emptyChannels: { paddingVertical: 48, alignItems: 'center', gap: 12 },
  emptyChannelsText: { color: '#6b7280', fontSize: 15 },

  // ── Vituo page header ──
  channelsPageHeader: { padding: 16, paddingBottom: 4 },
  channelsPageTitle: { fontSize: 26, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  channelsPageSubtitle: { fontSize: 14, color: '#9ca3af' },

  // ── Matches ──
  matchesSection: { padding: 16, paddingBottom: 24 },
  matchCard: {
    backgroundColor: 'rgba(31,41,55,0.5)',
    borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: 'rgba(55,65,81,0.5)',
  },
  matchLeague: { fontSize: 12, color: '#9ca3af', marginBottom: 8 },
  matchTeams: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  teamInfo: { flex: 1 },
  matchTeamName: { fontSize: 15, fontWeight: '600', color: '#fff', textAlign: 'center' },
  vs: { color: '#6b7280', fontWeight: 'bold', marginHorizontal: 12 },
  matchFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timeContainer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeText: { fontSize: 13, color: '#9ca3af' },
  earnPointsBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  earnPointsText: { fontSize: 12, color: '#fbbf24' },

  // ── Shimmer ──
  shimmerContainer: { padding: 16, gap: 16 },
  shimmerCarouselWrap: { alignSelf: 'center' },
  shimmerFilterRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  shimmerGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 16, gap: 12, marginTop: 8,
  },
  shimmerCardWrap: {
    width: CARD_WIDTH, borderRadius: 18, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 6, elevation: 8,
  },

  // ── Bottom nav ──
  bottomNav: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.94)',
    paddingVertical: 10, paddingHorizontal: 4,
    minHeight: BOTTOM_NAV_BASE_HEIGHT,
    borderTopWidth: 1, borderTopColor: '#1f2937',
  },
  navItem: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 6, minWidth: 0,
  },
  navText: { fontSize: 12, color: '#9ca3af' },
  navTextActive: { color: '#60a5fa' },
});

export default CombinedApp;
