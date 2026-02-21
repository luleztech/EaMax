import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  TextInput,
  RefreshControl,
  ImageBackground,
  Alert,
  ActivityIndicator,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import ImageCarousel from './ImageCarousel';
import PaymentsScreen from './PaymentsScreen';
import ProfileScreen from './ProfileScreen';
import InsufficientPointsModal from './InsufficientPointsModal';
import ChannelUnlockModal from './ChannelUnlockModal';
import VideoPlayer from './VideoPlayer';
import { settingsAPI, channelsAPI, userAPI } from '../config/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');

const MoviesApp = ({ isPremium, premiumToggleOn, userPoints, onWatchAd, onPaymentsActiveChange, onPointsRefresh }) => {
  const [activeTab, setActiveTab] = useState('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [carouselItems, setCarouselItems] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [insufficientPointsModalVisible, setInsufficientPointsModalVisible] = useState(false);
  const [channelUnlockModalVisible, setChannelUnlockModalVisible] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [currentUserPoints, setCurrentUserPoints] = useState(userPoints);
  const [videoPlayerVisible, setVideoPlayerVisible] = useState(false);
  const [playingChannel, setPlayingChannel] = useState(null);
  const [userId, setUserId] = useState(null);
  const [loadingChannelId, setLoadingChannelId] = useState(null);
  const [channelsByCategory, setChannelsByCategory] = useState({
    tamthilia: [],
    wanyama: [],
    katuni: [],
    habari: [],
    sayansi: [],
    movies: [],
  });

  useEffect(() => {
    if (onPaymentsActiveChange) {
      onPaymentsActiveChange(activeTab === 'payments' || activeTab === 'profile' || activeTab === 'search');
    }
    if (activeTab !== 'payments' && onPointsRefresh) {
      onPointsRefresh();
    }
  }, [activeTab, onPaymentsActiveChange, onPointsRefresh]);

  // Load carousel slides from backend (movies category)
  const loadSlides = async () => {
    try {
      const data = await settingsAPI.getCarouselSlides('movies');
      if (Array.isArray(data) && data.length > 0) {
        const mapped = data.map((slide) => ({
          title: slide.title,
          subtitle: slide.subtitle,
          badge: slide.badge,
          imageUrl: slide.image_url,
          videoUrl: slide.video_url,
          gradient: [
            slide.gradient_start || '#581c87',
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

  // Load channels by category
  const loadChannels = async () => {
    try {
      const categories = ['tamthilia', 'wanyama', 'katuni', 'habari', 'sayansi', 'movies'];
      const allChannels = await channelsAPI.getChannels();
      
      const categorized = {
        tamthilia: [],
        wanyama: [],
        katuni: [],
        habari: [],
        sayansi: [],
        movies: [],
      };

      (allChannels || []).forEach((ch) => {
        const category = ch.category?.toLowerCase();
        if (categories.includes(category) && ch.is_active) {
          const raw = ch.pointsRequired ?? ch.points_required ?? 0;
          const pointsRequired = typeof raw === 'number' && !Number.isNaN(raw) ? raw : parseInt(raw, 10) || 0;
          categorized[category].push({
            id: ch.id,
            name: ch.name,
            streamUrl: ch.stream_url,
            thumbnailUrl: ch.thumbnail_url,
            thumbnailEmoji: ch.thumbnail_emoji,
            color: ch.color || '#7c3aed',
            category: ch.category,
            pointsRequired,
          });
        }
      });

      setChannelsByCategory(categorized);
    } catch (error) {
      console.error('Failed to load channels:', error);
      setChannelsByCategory({
        tamthilia: [],
        wanyama: [],
        katuni: [],
        habari: [],
        sayansi: [],
        movies: [],
      });
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

  // Open player immediately (pro: instant UI), then set stream URL when we have it from admin
  const openPlayerWithChannel = (channel, streamUrl) => {
    setPlayingChannel({ ...channel, streamUrl: streamUrl || channel.streamUrl || null });
    setVideoPlayerVisible(true);
  };

  // Fetch stream URL from backend (admin) and update player – single source of truth, play as soon as URL arrives
  const fetchAndSetStreamUrl = (channel) => {
    if (!channel?.id) return;
    channelsAPI
      .getChannel(channel.id)
      .then((data) => {
        const url = data.streamUrl || data.stream_url;
        if (url) {
          setPlayingChannel((prev) =>
            prev && prev.id === channel.id ? { ...prev, streamUrl: url } : prev
          );
        }
      })
      .catch(() => {});
  };

  // Handle channel click: open player instantly, fetch URL from admin and play (pro: fast + always admin URL)
  const handleChannelClick = async (channel) => {
    const pointsRequired = channel.pointsRequired ?? 0;

    const canPlay = isPremium || pointsRequired === 0;
    if (canPlay) {
      openPlayerWithChannel(channel, channel.streamUrl);
      fetchAndSetStreamUrl(channel);
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

  useEffect(() => {
    loadSlides();
    loadChannels();
    refreshUserPoints();
    
    // Get user ID
    AsyncStorage.getItem('userId').then((id) => {
      if (id) setUserId(id);
    });
  }, []);

  // Update currentUserPoints when userPoints prop changes
  useEffect(() => {
    setCurrentUserPoints(userPoints);
  }, [userPoints]);

  // Refresh all data
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadSlides(), loadChannels()]);
    } finally {
      setRefreshing(false);
    }
  };
  const trendingMovies = [
    { title: 'Dark Waters', rating: 7.8, duration: '1h 45m', points: 20, color: '#7c3aed' },
    { title: 'Summer Love', rating: 8.2, duration: '2h 05m', points: 25, color: '#ec4899' },
    { title: 'Space Quest', rating: 9.1, duration: '2h 30m', points: 30, color: '#2563eb' },
    { title: 'Mystery Manor', rating: 7.5, duration: '1h 50m', points: 20, color: '#ea580c' },
  ];

  const genres = [
    { name: 'Tamthilia', key: 'tamthilia', icon: 'drama-masks', color: '#ec4899' },
    { name: 'Movies', key: 'movies', icon: 'movie', color: '#3b82f6' },
    { name: 'Wanyama', key: 'wanyama', icon: 'paw', color: '#10b981' },
    { name: 'Katuni', key: 'katuni', icon: 'animation', color: '#f59e0b' },
    { name: 'Habari', key: 'habari', icon: 'newspaper-variant', color: '#ef4444' },
    { name: 'Sayansi', key: 'sayansi', icon: 'atom', color: '#8b5cf6' },
  ];

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#581c87', '#111827', '#000000']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      {/* Header */}
      {activeTab !== 'payments' && activeTab !== 'profile' && activeTab !== 'search' && (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Icon name="movie" size={24} color="#a855f7" />
            <Text style={styles.headerTitle}>Bure kwa Points</Text>
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
        <PaymentsScreen accentColor="#a855f7" />
      ) : activeTab === 'profile' ? (
        <ProfileScreen accentColor="#a855f7" onWatchAd={onWatchAd} userPoints={userPoints} onPointsRefresh={onPointsRefresh} />
      ) : activeTab === 'search' ? (
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.scrollContentContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }>
          <View style={styles.searchContainer}>
            {/* Search Box */}
            <View style={styles.searchBoxContainer}>
              <View style={styles.searchBox}>
                <Icon name="magnify" size={24} color="#a855f7" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Tafuta filamu, tamthilia, habari..."
                  placeholderTextColor="#6b7280"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setSearchQuery('')}
                    style={styles.clearButton}>
                    <Icon name="close-circle" size={20} color="#9ca3af" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* All Categories with Channels - same style as Football */}
            <View style={styles.searchCategoriesSection}>
              <Text style={styles.searchSectionTitle}>Machaguo mbalimbali</Text>
              {genres.map((genre) => {
                const channels = channelsByCategory[genre.key] || [];
                if (channels.length === 0) return null;

                return (
                  <View key={genre.key} style={styles.searchCategoryBlock}>
                    <View style={styles.searchCategoryHeader}>
                      <View style={styles.searchCategoryHeaderLeft}>
                        <Icon name={genre.icon} size={20} color={genre.color} />
                        <Text style={styles.searchCategoryTitle}>{genre.name}</Text>
                      </View>
                      <Text style={styles.searchCategoryCount}>{channels.length} channels</Text>
                    </View>
                    <View style={styles.searchChannelsGrid}>
                      {channels.map((channel) => {
                        const channelColor = channel.color || genre.color || '#a855f7';
                        return (
                          <TouchableOpacity
                            key={channel.id}
                            style={styles.searchChannelCard}
                            activeOpacity={0.8}
                            onPress={() => handleChannelClick(channel)}
                            disabled={loadingChannelId === channel.id}>
                            {channel.thumbnailUrl ? (
                              <ImageBackground
                                source={{ uri: channel.thumbnailUrl }}
                                style={styles.searchChannelImageBackground}
                                imageStyle={styles.searchChannelImage}>
                                <View style={[styles.searchChannelColorOverlay, { backgroundColor: channelColor + '50' }]} />
                                <View style={styles.searchChannelGradient}>
                                  <View style={styles.searchChannelHeader}>
                                    <View style={styles.searchChannelPointsBadgeTop}>
                                        <AntDesign name="star" size={14} color={isPremium ? '#22c55e' : '#fbbf24'} />
                                        <Text style={styles.searchChannelPointsTextTop}>
                                          {getChannelBadgeText(channel.pointsRequired)}
                                        </Text>
                                      </View>
                                  </View>
                                  <View style={styles.searchChannelContent}>
                                  <Text style={styles.searchChannelName} numberOfLines={2}>{channel.name}</Text>
                                  </View>
                                  <TouchableOpacity
                                    style={[styles.searchChannelWatchButton, { backgroundColor: channelColor }]}
                                    onPress={() => handleChannelClick(channel)}
                                    disabled={loadingChannelId === channel.id}>
                                    {loadingChannelId === channel.id ? (
                                      <ActivityIndicator size="small" color="#fff" />
                                    ) : (
                                      <>
                                        <Icon name="play" size={16} color="#fff" />
                                        <Text style={styles.searchChannelWatchText}>Watch Now</Text>
                                      </>
                                    )}
                                  </TouchableOpacity>
                                </View>
                              </ImageBackground>
                            ) : (
                              <LinearGradient
                                colors={[channelColor + '20', channelColor + '10', 'transparent']}
                                style={styles.searchChannelGradient}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}>
                                <View style={styles.searchChannelHeader}>
                                  <View style={[styles.searchChannelIconContainer, { backgroundColor: channelColor + '30' }]}>
                                    {channel.thumbnailEmoji ? (
                                      <Text style={styles.searchChannelEmoji}>{channel.thumbnailEmoji}</Text>
                                    ) : (
                                      <Icon name={genre.icon} size={32} color={channelColor} />
                                    )}
                                  </View>
                                  <View style={styles.searchChannelPointsBadgeTop}>
                                      <AntDesign name="star" size={14} color={isPremium ? '#22c55e' : '#fbbf24'} />
                                      <Text style={styles.searchChannelPointsTextTop}>
                                        {getChannelBadgeText(channel.pointsRequired)}
                                      </Text>
                                    </View>
                                </View>
                                <View style={styles.searchChannelContent}>
                                  <Text style={styles.searchChannelName} numberOfLines={2}>{channel.name}</Text>
                                  <View style={styles.searchChannelPointsBadge}>
                                    <AntDesign name="star" size={12} color={isPremium ? '#22c55e' : '#fbbf24'} />
                                    <Text style={styles.searchChannelPointsText}>
                                      {getChannelBadgeText(channel.pointsRequired, true)}
                                    </Text>
                                  </View>
                                </View>
                                <TouchableOpacity
                                  style={[styles.searchChannelWatchButton, { backgroundColor: channelColor }]}
                                  onPress={() => handleChannelClick(channel)}
                                  disabled={loadingChannelId === channel.id}>
                                  {loadingChannelId === channel.id ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                  ) : (
                                    <>
                                      <Icon name="play" size={16} color="#fff" />
                                      <Text style={styles.searchChannelWatchText}>Watch Now</Text>
                                    </>
                                  )}
                                </TouchableOpacity>
                              </LinearGradient>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>
      ) : (
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.scrollContentContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }>
          {/* Image Carousel */}
          {carouselItems.length > 0 && (
            <ImageCarousel
              items={carouselItems}
              onWatchAd={onWatchAd}
              onGoPremium={handleGoPremium}
              isPremium={isPremium}
              premiumToggleOn={premiumToggleOn}
            />
          )}

          {/* Channels by Category - same style as Football/Kabumbu */}
          {genres.map((genre) => {
            const channels = channelsByCategory[genre.key] || [];
            if (channels.length === 0) return null;

            return (
              <View key={genre.key} style={styles.categorySection}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionHeaderLeft}>
                    <Icon name={genre.icon} size={20} color={genre.color} />
                    <Text style={styles.sectionTitle}>{genre.name}</Text>
                  </View>
                  <Text style={styles.sectionCount}>{channels.length} channels</Text>
                </View>
                <View style={styles.channelsGrid}>
                  {channels.map((channel) => {
                    const channelColor = channel.color || genre.color || '#a855f7';
                    return (
                      <TouchableOpacity
                        key={channel.id}
                        style={styles.channelCard}
                        activeOpacity={0.8}
                        onPress={() => handleChannelClick(channel)}>
                        {channel.thumbnailUrl ? (
                          <ImageBackground
                            source={{ uri: channel.thumbnailUrl }}
                            style={styles.channelImageBackground}
                            imageStyle={styles.channelImage}>
                            {channelColor ? (
                              <View style={[styles.channelColorOverlay, { backgroundColor: channelColor + '50' }]} />
                            ) : null}
                            <View style={styles.channelGradient}>
                              <View style={styles.channelHeader}>
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
                                style={[styles.channelWatchButton, { backgroundColor: channelColor }]}
                                onPress={() => handleChannelClick(channel)}
                                disabled={loadingChannelId === channel.id}>
                                {loadingChannelId === channel.id ? (
                                  <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                  <>
                                    <Icon name="play" size={16} color="#fff" />
                                    <Text style={styles.channelWatchText}>Watch Now</Text>
                                  </>
                                )}
                              </TouchableOpacity>
                            </View>
                          </ImageBackground>
                        ) : (
                          <LinearGradient
                            colors={[channelColor + '20', channelColor + '10', 'transparent']}
                            style={styles.channelGradient}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}>
                            <View style={styles.channelHeader}>
                              <View style={[styles.channelIconContainer, { backgroundColor: channelColor + '30' }]}>
                                {channel.thumbnailEmoji ? (
                                  <Text style={styles.channelEmoji}>{channel.thumbnailEmoji}</Text>
                                ) : (
                                  <Icon name={genre.icon} size={32} color={channelColor} />
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
                              style={[styles.channelWatchButton, { backgroundColor: channelColor }]}
                              onPress={() => handleChannelClick(channel)}
                              disabled={loadingChannelId === channel.id}>
                              {loadingChannelId === channel.id ? (
                                <ActivityIndicator size="small" color="#fff" />
                              ) : (
                                <>
                                  <Icon name="play" size={16} color="#fff" />
                                  <Text style={styles.channelWatchText}>Watch Now</Text>
                                </>
                              )}
                            </TouchableOpacity>
                          </LinearGradient>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })}
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
            color={activeTab === 'home' ? '#a855f7' : '#9ca3af'}
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
          onPress={() => setActiveTab('search')}>
          <Icon
            name="magnify"
            size={24}
            color={activeTab === 'search' ? '#a855f7' : '#9ca3af'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'search' && styles.navTextActive,
            ]}>
            Search
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('payments')}>
          <Icon
            name="wallet"
            size={24}
            color={activeTab === 'payments' ? '#a855f7' : '#9ca3af'}
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
            color={activeTab === 'profile' ? '#a855f7' : '#9ca3af'}
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(168, 85, 247, 0.3)',
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
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
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
    height: 256,
    borderRadius: 16,
    overflow: 'hidden',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  newBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: '#9333ea',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  newBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  heroContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  movieTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  movieInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  separator: {
    color: '#9ca3af',
  },
  durationText: {
    color: '#fff',
    fontSize: 14,
  },
  genreText: {
    color: '#fff',
    fontSize: 14,
  },
  movieDescription: {
    fontSize: 14,
    color: '#d1d5db',
    textAlign: 'center',
    marginBottom: 16,
    maxWidth: 300,
  },
  watchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#9333ea',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 20,
  },
  watchButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  pointsInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  pointsInfoText: {
    fontSize: 12,
    color: '#fbbf24',
  },
  trendingSection: {
    padding: 16,
    paddingBottom: 100,
  },
  trendingScroll: {
    marginBottom: 24,
  },
  movieCard: {
    width: 160,
    marginRight: 12,
  },
  movieCardImage: {
    height: 224,
    borderRadius: 8,
    marginBottom: 8,
    position: 'relative',
  },
  movieCardRating: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  movieCardRatingText: {
    color: '#fff',
    fontSize: 12,
  },
  movieCardPoints: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(234, 179, 8, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  movieCardPointsText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  movieCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  movieCardDuration: {
    fontSize: 12,
    color: '#9ca3af',
  },
  categoriesSection: {
    marginTop: 24,
  },
  genresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  genreCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.5)',
    alignItems: 'center',
    marginBottom: 12,
  },
  genreIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  genreName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
    textAlign: 'center',
  },
  genreCount: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
  },
  scrollContentContainer: {
    paddingBottom: 100,
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
    color: '#a855f7',
  },
  searchContainer: {
    flex: 1,
    padding: 16,
    paddingTop: 24,
    paddingBottom: 100,
  },
  searchBoxContainer: {
    marginBottom: 32,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderWidth: 2,
    borderColor: 'rgba(168, 85, 247, 0.3)',
    gap: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#fff',
    padding: 0,
  },
  clearButton: {
    padding: 4,
  },
  searchCategoriesSection: {
    marginTop: 8,
  },
  searchSectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  searchGenresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  searchGenreCard: {
    width: (width - 48) / 2,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.5)',
  },
  searchGenreGradient: {
    padding: 20,
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchGenreIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  searchGenreName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
    textAlign: 'center',
  },
  searchGenreCount: {
    fontSize: 13,
    color: '#d1d5db',
    textAlign: 'center',
  },
  categorySection: {
    padding: 16,
    paddingBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  sectionCount: {
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
  channelEmoji: {
    fontSize: 32,
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
  },
  searchCategoryBlock: {
    marginBottom: 24,
  },
  searchCategoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  searchCategoryHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchCategoryTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  searchCategoryCount: {
    fontSize: 14,
    color: '#9ca3af',
  },
  searchChannelsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  searchChannelCard: {
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
  searchChannelImageBackground: {
    width: '100%',
    minHeight: 200,
    borderRadius: 16,
    overflow: 'hidden',
  },
  searchChannelImage: {
    borderRadius: 16,
    resizeMode: 'cover',
  },
  searchChannelColorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
  },
  searchChannelGradient: {
    padding: 16,
    minHeight: 200,
    position: 'relative',
    zIndex: 1,
  },
  searchChannelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  searchChannelIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  searchChannelContent: {
    flex: 1,
    marginBottom: 12,
  },
  searchChannelName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  searchChannelShow: {
    fontSize: 13,
    color: '#d1d5db',
    marginBottom: 8,
  },
  searchChannelEmoji: {
    fontSize: 32,
  },
  searchChannelPointsBadge: {
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
  searchChannelPointsText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#fbbf24',
  },
  searchChannelPointsBadgeTop: {
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
  searchChannelPointsTextTop: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#fbbf24',
  },
  searchChannelWatchButton: {
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
  searchChannelWatchText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default MoviesApp;
