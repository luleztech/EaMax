import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Modal,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import {
  dashboardAPI,
  adminChannelsAPI,
  adminNotificationsAPI,
  adminCarouselAPI,
  adminMatchesAPI,
} from '../../config/api';

const { width } = Dimensions.get('window');

const DashboardSection = ({ onNavigate, refreshTrigger }) => {
  const [stats, setStats] = useState([
    {
      title: 'Total Users',
      value: '0',
      change: '+0%',
      subtitle: 'vs last month',
      gradient: ['#2563eb', '#1e40af'],
      icon: 'account-group',
    },
    {
      title: 'Premium Users',
      value: '0',
      change: '+0%',
      subtitle: 'conversion rate',
      gradient: ['#10b981', '#059669'],
      icon: 'star',
    },
    {
      title: 'Revenue',
      value: '$0',
      change: '+0%',
      subtitle: 'this month',
      gradient: ['#7c3aed', '#6d28d9'],
      icon: 'currency-usd',
    },
    {
      title: 'Ads Watched per Month',
      value: '0',
      change: '+0%',
      subtitle: 'this month',
      gradient: ['#f97316', '#ea580c'],
      icon: 'eye',
    },
  ]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mostWatchedChannels, setMostWatchedChannels] = useState([]);
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [footballCarouselSlides, setFootballCarouselSlides] = useState([]);
  const [moviesCarouselSlides, setMoviesCarouselSlides] = useState([]);
  const [upcomingMatches, setUpcomingMatches] = useState([]);
  const [slideModalVisible, setSlideModalVisible] = useState(false);
  const [slideCategory, setSlideCategory] = useState('football'); // Track which carousel we're editing
  const [editingSlide, setEditingSlide] = useState(null);
  const [matchModalVisible, setMatchModalVisible] = useState(false);
  const [editingMatch, setEditingMatch] = useState(null);
  const [matchLeague, setMatchLeague] = useState('');
  const [matchTeam1, setMatchTeam1] = useState('');
  const [matchTeam2, setMatchTeam2] = useState('');
  const [matchTime, setMatchTime] = useState('');
  const [matchPoints, setMatchPoints] = useState('15');
  const [savingMatch, setSavingMatch] = useState(false);
  const [slideTitle, setSlideTitle] = useState('');
  const [slideSubtitle, setSlideSubtitle] = useState('');
  const [slideBadge, setSlideBadge] = useState('');
  const [gradientStart, setGradientStart] = useState('#14532d');
  const [gradientMid, setGradientMid] = useState('#111827');
  const [gradientEnd, setGradientEnd] = useState('#000000');
  const [slideImageUrl, setSlideImageUrl] = useState('');
  const [slideVideoUrl, setSlideVideoUrl] = useState('');
  const [slideInfoText, setSlideInfoText] = useState('');
  const [slideInfoIcon, setSlideInfoIcon] = useState('clockcircleo');
  const [slideSortOrder, setSlideSortOrder] = useState('0');
  const [savingSlide, setSavingSlide] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [statusModalTitle, setStatusModalTitle] = useState('');
  const [statusModalMessage, setStatusModalMessage] = useState('');
  const [statusModalType, setStatusModalType] = useState('info');

  const showStatusModal = (type, title, message) => {
    setStatusModalType(type);
    setStatusModalTitle(title);
    setStatusModalMessage(message);
    setStatusModalVisible(true);
  };

  // Fetch dashboard stats from backend
  const fetchDashboardStats = async () => {
    try {
      const data = await dashboardAPI.getStats();
      
      // Format numbers with commas
      const formatNumber = (num) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
      };

      setStats([
        {
          title: 'Total Users',
          value: formatNumber(data.totalUsers || 0),
          change: data.totalUsersChange ? `+${data.totalUsersChange}%` : '+0%',
          subtitle: 'vs last month',
          gradient: ['#2563eb', '#1e40af'],
          icon: 'account-group',
        },
        {
          title: 'Premium Users',
          value: formatNumber(data.premiumUsers || 0),
          change: data.premiumUsersChange ? `+${data.premiumUsersChange}%` : '+0%',
          subtitle: 'conversion rate',
          gradient: ['#10b981', '#059669'],
          icon: 'star',
        },
        {
          title: 'Revenue',
          value: `$${formatNumber(data.revenue || 0)}`,
          change: data.revenueChange ? `+${data.revenueChange}%` : '+0%',
          subtitle: 'this month',
          gradient: ['#7c3aed', '#6d28d9'],
          icon: 'currency-usd',
        },
        {
          title: 'Ads Watched per Month',
          value: formatNumber(data.adsWatchedThisMonth || 0),
          change: data.adsWatchedChange ? `+${data.adsWatchedChange}%` : '+0%',
          subtitle: 'this month',
          gradient: ['#f97316', '#ea580c'],
          icon: 'eye',
        },
      ]);
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
    }
  };

  // Fetch top channels, recent notifications, carousels, and matches
  const fetchExtraData = async () => {
    try {
      const [channels, notifications, footballSlides, moviesSlides, matches] = await Promise.all([
        adminChannelsAPI.getChannels(),
        adminNotificationsAPI.getNotifications(),
        adminCarouselAPI.getSlides('football'),
        adminCarouselAPI.getSlides('movies'),
        adminMatchesAPI.getMatches(),
      ]);

      const top = channels
        .filter((ch) => ch.is_active)
        .slice(0, 5)
        .map((ch, index) => ({
          title: ch.name,
          views: ch.is_active ? 'Active channel' : 'Inactive channel',
          change: '+0%',
          icon:
            ch.category === 'football'
              ? 'soccer'
              : ch.category === 'movies'
              ? 'movie'
              : 'newspaper-variant',
          gradient:
            ch.color && ch.color.startsWith('#')
              ? [ch.color, '#020617']
              : index % 2 === 0
              ? ['#0ea5e9', '#0369a1']
              : ['#7c3aed', '#4c1d95'],
        }));

      setMostWatchedChannels(top);

      const recent = (notifications || []).slice(0, 10).map((n) => ({
        title: n.title,
        description: n.message,
        clicks:
          typeof n.clicks === 'number'
            ? `${n.clicks} clicks`
            : 'Clicks data',
        time: n.sent_at
          ? new Date(n.sent_at).toLocaleString('sw-TZ', {
              hour: '2-digit',
              minute: '2-digit',
              day: '2-digit',
              month: 'short',
            })
          : '',
        color:
          n.category === 'kabumbu'
            ? '#10b981'
            : n.category === 'movies'
            ? '#7c3aed'
            : '#3b82f6',
      }));

      setRecentNotifications(recent);

      const mapSlides = (slides) =>
        (slides || [])
          .filter((s) => s.is_active)
          .slice(0, 5)
          .map((s) => ({
            ...s,
            imageUrl: s.image_url,
            gradient: [
              s.gradient_start || '#14532d',
              s.gradient_mid || '#111827',
              s.gradient_end || '#000000',
            ],
          }));

      setFootballCarouselSlides(mapSlides(footballSlides));
      setMoviesCarouselSlides(mapSlides(moviesSlides));
      setUpcomingMatches((matches || []).filter((m) => m.is_active).slice(0, 10));
    } catch (error) {
      console.error('Failed to fetch extra dashboard data:', error);
    }
  };

  const openNewSlideModal = (category) => {
    setEditingSlide(null);
    setSlideCategory(category || 'football');
    setSlideTitle('');
    setSlideSubtitle('');
    setSlideBadge('');
    setSlideImageUrl('');
    setSlideVideoUrl('');
    setGradientStart('#14532d');
    setGradientMid('#111827');
    setGradientEnd('#000000');
    setSlideInfoText('');
    setSlideInfoIcon('clockcircleo');
    setSlideSortOrder('0');
    setSlideModalVisible(true);
  };

  const openEditSlideModal = (slide) => {
    setEditingSlide(slide);
    setSlideCategory(slide.category || 'football');
    setSlideTitle(slide.title || '');
    setSlideSubtitle(slide.subtitle || '');
    setSlideBadge(slide.badge || '');
    setSlideImageUrl(slide.imageUrl || slide.image_url || '');
    setSlideVideoUrl(slide.videoUrl || slide.video_url || '');
    setGradientStart(slide.gradient ? slide.gradient[0] : '#14532d');
    setGradientMid(slide.gradient ? slide.gradient[1] : '#111827');
    setGradientEnd(slide.gradient ? slide.gradient[2] : '#000000');
    setSlideInfoText(slide.info_text || slide.infoText || '');
    setSlideInfoIcon(slide.info_icon || slide.infoIcon || 'clockcircleo');
    setSlideSortOrder(
      typeof slide.sort_order === 'number'
        ? String(slide.sort_order)
        : '0',
    );
    setSlideModalVisible(true);
  };

  const handleSaveSlide = async () => {
    if (!slideTitle.trim()) {
      showStatusModal('error', 'Missing title', 'Please enter slide title.');
      return;
    }

    if (!slideImageUrl.trim()) {
      showStatusModal('error', 'Missing image', 'Please enter carousel image URL.');
      return;
    }

    const payload = {
      title: slideTitle.trim(),
      subtitle: slideSubtitle.trim() || undefined,
      badge: slideBadge.trim() || undefined,
      imageUrl: slideImageUrl.trim(),
      videoUrl: slideVideoUrl.trim() || undefined,
      gradientStart: gradientStart.trim() || undefined,
      gradientMid: gradientMid.trim() || undefined,
      gradientEnd: gradientEnd.trim() || undefined,
      infoText: slideInfoText.trim() || undefined,
      infoIcon: slideInfoIcon.trim() || undefined,
      category: slideCategory,
      sortOrder: parseInt(slideSortOrder || '0', 10),
    };

    try {
      setSavingSlide(true);
      if (editingSlide?.id) {
        await adminCarouselAPI.updateSlide(editingSlide.id, payload);
      } else {
        await adminCarouselAPI.createSlide(payload);
      }
      await fetchExtraData();
      setSlideModalVisible(false);
      showStatusModal('success', 'Slide saved', 'Carousel slide saved successfully.');
    } catch (error) {
      console.error('Failed to save slide:', error);
      showStatusModal('error', 'Save failed', 'Failed to save slide. Please try again.');
    } finally {
      setSavingSlide(false);
    }
  };

  const handleDeleteSlide = async (slideId) => {
    try {
      setSavingSlide(true);
      await adminCarouselAPI.deleteSlide(slideId);
      await fetchExtraData();
      showStatusModal('success', 'Slide deleted', 'Carousel slide deleted successfully.');
    } catch (error) {
      console.error('Failed to delete slide:', error);
      showStatusModal('error', 'Delete failed', 'Failed to delete slide. Please try again.');
    } finally {
      setSavingSlide(false);
    }
  };

  const openNewMatchModal = () => {
    setEditingMatch(null);
    setMatchLeague('');
    setMatchTeam1('');
    setMatchTeam2('');
    setMatchTime('');
    setMatchPoints('15');
    setMatchModalVisible(true);
  };

  const openEditMatchModal = (match) => {
    setEditingMatch(match);
    setMatchLeague(match.league || '');
    setMatchTeam1(match.team1 || '');
    setMatchTeam2(match.team2 || '');
    const matchTimeDate = match.match_time
      ? new Date(match.match_time).toISOString().slice(0, 16)
      : '';
    setMatchTime(matchTimeDate);
    setMatchPoints(String(match.points_required || 15));
    setMatchModalVisible(true);
  };

  const handleSaveMatch = async () => {
    if (!matchLeague.trim() || !matchTeam1.trim() || !matchTeam2.trim() || !matchTime.trim()) {
      showStatusModal('error', 'Missing fields', 'Please fill all match fields.');
      return;
    }

    const payload = {
      league: matchLeague.trim(),
      team1: matchTeam1.trim(),
      team2: matchTeam2.trim(),
      matchTime: new Date(matchTime).toISOString(),
      pointsRequired: parseInt(matchPoints || '15', 10),
    };

    try {
      setSavingMatch(true);
      if (editingMatch?.id) {
        await adminMatchesAPI.updateMatch(editingMatch.id, payload);
      } else {
        await adminMatchesAPI.createMatch(payload);
      }
      await fetchExtraData();
      setMatchModalVisible(false);
      showStatusModal('success', 'Match saved', 'Upcoming match saved successfully.');
    } catch (error) {
      console.error('Failed to save match:', error);
      showStatusModal('error', 'Save failed', 'Failed to save match. Please try again.');
    } finally {
      setSavingMatch(false);
    }
  };

  const handleDeleteMatch = async (matchId) => {
    try {
      setSavingMatch(true);
      await adminMatchesAPI.deleteMatch(matchId);
      await fetchExtraData();
      showStatusModal('success', 'Match deleted', 'Upcoming match deleted successfully.');
    } catch (error) {
      console.error('Failed to delete match:', error);
      showStatusModal('error', 'Delete failed', 'Failed to delete match. Please try again.');
    } finally {
      setSavingMatch(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        await Promise.all([fetchDashboardStats(), fetchExtraData()]);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // Refetch recent notifications when a new one is sent (e.g. from NotificationsPanel)
  useEffect(() => {
    if (refreshTrigger != null && refreshTrigger > 0) {
      fetchExtraData();
    }
  }, [refreshTrigger]);

  const onRefresh = () => {
    setRefreshing(true);
    Promise.all([fetchDashboardStats(), fetchExtraData()]).finally(() =>
      setRefreshing(false),
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#7c3aed" />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  return (
    <ScrollView 
      style={styles.container} 
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }>
      {/* Stats Cards */}
      <View style={styles.statsContainer}>
        {stats.map((stat, index) => {
          const isUserCard = stat.title === 'Total Users' || stat.title === 'Premium Users';
          const CardWrapper = isUserCard && onNavigate ? TouchableOpacity : View;
          const cardProps = isUserCard && onNavigate 
            ? { 
                activeOpacity: 0.8, 
                onPress: () => onNavigate('users') 
              } 
            : {};
          
          return (
            <CardWrapper key={index} {...cardProps}>
              <LinearGradient
                colors={stat.gradient}
                style={styles.statCard}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}>
                <View style={styles.statHeader}>
                  <Text style={styles.statTitle} numberOfLines={2}>{stat.title}</Text>
                  <View style={styles.statIconContainer}>
                    <Icon name={stat.icon} size={20} color="rgba(255, 255, 255, 0.8)" />
                  </View>
                </View>
                <Text style={styles.statValue}>{stat.value}</Text>
                <View style={styles.statFooter}>
                  <Text style={styles.statChange}>{stat.change}</Text>
                  <Text style={styles.statSubtitle}>{stat.subtitle}</Text>
                </View>
                {isUserCard && onNavigate && (
                  <View style={styles.clickableIndicator}>
                    <Icon name="chevron-right" size={16} color="rgba(255, 255, 255, 0.6)" />
                  </View>
                )}
              </LinearGradient>
            </CardWrapper>
          );
        })}
      </View>

      {/* Football Carousel */}
      <View style={styles.chartCard}>
        <View style={styles.carouselHeader}>
          <View style={styles.carouselTitleRow}>
            <Icon name="soccer" size={20} color="#10b981" />
            <Text style={styles.chartTitle}>Football Carousel</Text>
          </View>
          <TouchableOpacity
            style={styles.carouselAddButton}
            onPress={() => openNewSlideModal('football')}
            activeOpacity={0.8}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <AntDesign name="plus" size={16} color="#fff" />
            <Text style={styles.carouselAddButtonText}>Add Slide</Text>
          </TouchableOpacity>
        </View>
        {footballCarouselSlides.length === 0 ? (
          <Text style={styles.emptyCarouselText}>
            No football slides yet. Tap "Add Slide" to create your first one.
          </Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carouselList}>
            {footballCarouselSlides.map((slide) => (
              <View key={slide.id} style={styles.carouselCardWrapper}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => openEditSlideModal(slide)}
                  style={styles.carouselCardTouchable}>
                  <LinearGradient
                    colors={slide.gradient}
                    style={styles.carouselCard}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}>
                    {slide.badge && (
                      <View style={styles.carouselBadge}>
                        <Text style={styles.carouselBadgeText}>{slide.badge}</Text>
                      </View>
                    )}
                    <Text style={styles.carouselTitle}>{slide.title}</Text>
                    {slide.subtitle && (
                      <Text style={styles.carouselSubtitle}>{slide.subtitle}</Text>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.carouselDeleteButton}
                  onPress={() => handleDeleteSlide(slide.id)}
                  activeOpacity={0.7}>
                  <Icon name="delete" size={16} color="#ef4444" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Movies Carousel */}
      <View style={styles.chartCard}>
        <View style={styles.carouselHeader}>
          <View style={styles.carouselTitleRow}>
            <Icon name="movie" size={20} color="#7c3aed" />
            <Text style={styles.chartTitle}>Movies Carousel</Text>
          </View>
          <TouchableOpacity
            style={styles.carouselAddButton}
            onPress={() => openNewSlideModal('movies')}
            activeOpacity={0.8}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <AntDesign name="plus" size={16} color="#fff" />
            <Text style={styles.carouselAddButtonText}>Add Slide</Text>
          </TouchableOpacity>
        </View>
        {moviesCarouselSlides.length === 0 ? (
          <Text style={styles.emptyCarouselText}>
            No movies slides yet. Tap "Add Slide" to create your first one.
          </Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carouselList}>
            {moviesCarouselSlides.map((slide) => (
              <View key={slide.id} style={styles.carouselCardWrapper}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => openEditSlideModal(slide)}
                  style={styles.carouselCardTouchable}>
                  <LinearGradient
                    colors={slide.gradient}
                    style={styles.carouselCard}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}>
                    {slide.badge && (
                      <View style={styles.carouselBadge}>
                        <Text style={styles.carouselBadgeText}>{slide.badge}</Text>
                      </View>
                    )}
                    <Text style={styles.carouselTitle}>{slide.title}</Text>
                    {slide.subtitle && (
                      <Text style={styles.carouselSubtitle}>{slide.subtitle}</Text>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.carouselDeleteButton}
                  onPress={() => handleDeleteSlide(slide.id)}
                  activeOpacity={0.7}>
                  <Icon name="delete" size={16} color="#ef4444" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Upcoming Matches */}
      <View style={styles.chartCard}>
        <View style={styles.carouselHeader}>
          <View style={styles.carouselTitleRow}>
            <Icon name="calendar-clock" size={20} color="#f59e0b" />
            <Text style={styles.chartTitle}>Upcoming Matches</Text>
          </View>
          <TouchableOpacity
            style={styles.carouselAddButton}
            onPress={openNewMatchModal}
            activeOpacity={0.8}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <AntDesign name="plus" size={16} color="#fff" />
            <Text style={styles.carouselAddButtonText}>Add Match</Text>
          </TouchableOpacity>
        </View>
        {upcomingMatches.length === 0 ? (
          <Text style={styles.emptyCarouselText}>
            No upcoming matches yet. Tap "Add Match" to create your first one.
          </Text>
        ) : (
          <View style={styles.matchesList}>
            {upcomingMatches.map((match) => {
              const matchDate = new Date(match.match_time);
              const timeStr = matchDate.toLocaleString('sw-TZ', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              });
              return (
                <View key={match.id} style={styles.matchItem}>
                  <View style={styles.matchContent}>
                    <Text style={styles.matchLeague}>{match.league}</Text>
                    <Text style={styles.matchTeams}>
                      {match.team1} vs {match.team2}
                    </Text>
                    <Text style={styles.matchTime}>{timeStr}</Text>
                    <Text style={styles.matchPoints}>{match.points_required} points</Text>
                  </View>
                  <View style={styles.matchActions}>
                    <TouchableOpacity
                      style={styles.matchEditButton}
                      onPress={() => openEditMatchModal(match)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Icon name="pencil" size={16} color="#3b82f6" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.matchDeleteButton}
                      onPress={() => handleDeleteMatch(match.id)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Icon name="delete" size={16} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Carousel & Most Watched Channels */}
      <View style={styles.chartsRow}>

        {/* Most Watched Channels */}
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Most Watched Channels</Text>
          <View style={styles.topContentList}>
            {mostWatchedChannels.map((item, index) => (
              <View key={index} style={styles.topContentItem}>
                <LinearGradient
                  colors={item.gradient}
                  style={styles.topContentIcon}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}>
                  <Icon name={item.icon} size={24} color="#fff" />
                </LinearGradient>
                <View style={styles.topContentInfo}>
                  <Text style={styles.topContentTitle}>{item.title}</Text>
                  <Text style={styles.topContentViews}>{item.views}</Text>
                </View>
                <Text style={styles.topContentChange}>{item.change}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* Recent Notifications */}
      <View style={styles.activityCard}>
        <Text style={styles.activityTitle}>Recent Notifications</Text>
        <View style={styles.activityList}>
          {recentNotifications.map((notification, index) => (
            <View key={index} style={styles.activityItem}>
              <View style={[styles.activityDot, { backgroundColor: notification.color }]} />
              <View style={styles.activityContent}>
                <Text style={styles.activityItemTitle}>{notification.title}</Text>
                <Text style={styles.activityDescription}>{notification.description}</Text>
                <Text style={styles.activityClicks}>{notification.clicks}</Text>
              </View>
              <Text style={styles.activityTime}>{notification.time}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Carousel Slide Modal */}
      <Modal
        visible={slideModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSlideModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <View style={styles.modalHeaderIconWrap}>
                  <Icon name="image-multiple" size={22} color="#a78bfa" />
                </View>
                <View>
                  <Text style={styles.modalTitle}>
                    {editingSlide ? 'Edit slide' : 'Add carousel slide'}
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    {editingSlide ? 'Update slide content' : 'New slide for the home carousel'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setSlideModalVisible(false)}
                style={styles.modalCloseButton}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Icon name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.formCard}>
                <Text style={styles.formCardTitle}>Category & content</Text>
                <Text style={styles.inputLabel}>Category *</Text>
                <View style={styles.categorySelector}>
                  <TouchableOpacity
                    style={[styles.categoryButton, slideCategory === 'football' && styles.categoryButtonActive]}
                    onPress={() => setSlideCategory('football')}>
                    <Icon name="soccer" size={18} color={slideCategory === 'football' ? '#fff' : '#9ca3af'} />
                    <Text style={[styles.categoryButtonText, slideCategory === 'football' && styles.categoryButtonTextActive]}>Football</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.categoryButton, slideCategory === 'movies' && styles.categoryButtonActive]}
                    onPress={() => setSlideCategory('movies')}>
                    <Icon name="movie" size={18} color={slideCategory === 'movies' ? '#fff' : '#9ca3af'} />
                    <Text style={[styles.categoryButtonText, slideCategory === 'movies' && styles.categoryButtonTextActive]}>Movies</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.categoryButton, slideCategory === 'habari' && styles.categoryButtonActive]}
                    onPress={() => setSlideCategory('habari')}>
                    <Icon name="newspaper-variant" size={18} color={slideCategory === 'habari' ? '#fff' : '#9ca3af'} />
                    <Text style={[styles.categoryButtonText, slideCategory === 'habari' && styles.categoryButtonTextActive]}>Habari</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.inputLabel}>Title *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. MAN UTD vs LIVERPOOL"
                  placeholderTextColor="#6b7280"
                  value={slideTitle}
                  onChangeText={setSlideTitle}
                />
                <Text style={styles.inputLabel}>Subtitle</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Premier League"
                  placeholderTextColor="#6b7280"
                  value={slideSubtitle}
                  onChangeText={setSlideSubtitle}
                />
                <Text style={styles.inputLabel}>Badge (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. LIVE"
                  placeholderTextColor="#6b7280"
                  value={slideBadge}
                  onChangeText={setSlideBadge}
                />
              </View>

              <View style={styles.formCard}>
                <Text style={styles.formCardTitle}>Media</Text>
                <Text style={styles.inputLabel}>Image URL *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="https://example.com/slide.jpg"
                  placeholderTextColor="#6b7280"
                  value={slideImageUrl}
                  onChangeText={setSlideImageUrl}
                  autoCapitalize="none"
                />
                <Text style={styles.inputLabel}>Video URL (Watch Now link)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="https://example.com/video.mp4"
                  placeholderTextColor="#6b7280"
                  value={slideVideoUrl}
                  onChangeText={setSlideVideoUrl}
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.formCard}>
                <Text style={styles.formCardTitle}>Overlay & display</Text>
                <Text style={styles.inputLabel}>Gradient preset</Text>
                <View style={styles.gradientPresetsRow}>
                  {[
                    ['#14532d', '#166534', '#000000'],
                    ['#1d4ed8', '#1e293b', '#000000'],
                    ['#7c3aed', '#4c1d95', '#000000'],
                    ['#db2777', '#9d174d', '#000000'],
                    ['#0f766e', '#134e4a', '#000000'],
                    ['#f97316', '#ea580c', '#000000'],
                  ].map((colors, idx) => {
                    const isSelected =
                      gradientStart === colors[0] && gradientMid === colors[1] && gradientEnd === colors[2];
                    return (
                      <TouchableOpacity
                        key={idx}
                        style={[styles.gradientPreset, isSelected && styles.gradientPresetSelected]}
                        onPress={() => {
                          setGradientStart(colors[0]);
                          setGradientMid(colors[1]);
                          setGradientEnd(colors[2]);
                        }}>
                        <LinearGradient
                          colors={colors}
                          style={styles.gradientPresetInner}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.inputLabel}>Info text</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Today 19:00"
                  placeholderTextColor="#6b7280"
                  value={slideInfoText}
                  onChangeText={setSlideInfoText}
                />
                <Text style={styles.inputLabel}>Info icon (AntDesign name)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="clockcircleo"
                  placeholderTextColor="#6b7280"
                  value={slideInfoIcon}
                  onChangeText={setSlideInfoIcon}
                  autoCapitalize="none"
                />
                <Text style={styles.inputLabel}>Sort order</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor="#6b7280"
                  value={slideSortOrder}
                  onChangeText={setSlideSortOrder}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setSlideModalVisible(false)}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveButton, savingSlide && { opacity: 0.7 }]}
                  onPress={savingSlide ? undefined : handleSaveSlide}
                  disabled={savingSlide}>
                  {savingSlide ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveButtonText}>{editingSlide ? 'Save' : 'Add slide'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      {/* Match Modal */}
      <Modal
        visible={matchModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setMatchModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <View style={styles.modalHeaderIconWrap}>
                  <Icon name="soccer" size={22} color="#a78bfa" />
                </View>
                <View>
                  <Text style={styles.modalTitle}>
                    {editingMatch ? 'Edit match' : 'Add upcoming match'}
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    {editingMatch ? 'Update match details' : 'Show on Football app home'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setMatchModalVisible(false)}
                style={styles.modalCloseButton}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Icon name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.formCard}>
                <Text style={styles.formCardTitle}>Match details</Text>
                <Text style={styles.inputLabel}>League *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Premier League"
                  placeholderTextColor="#6b7280"
                  value={matchLeague}
                  onChangeText={setMatchLeague}
                />
                <Text style={styles.inputLabel}>Team 1 *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Arsenal"
                  placeholderTextColor="#6b7280"
                  value={matchTeam1}
                  onChangeText={setMatchTeam1}
                />
                <Text style={styles.inputLabel}>Team 2 *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Chelsea"
                  placeholderTextColor="#6b7280"
                  value={matchTeam2}
                  onChangeText={setMatchTeam2}
                />
                <Text style={styles.inputLabel}>Date & time *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="2024-02-20T19:00"
                  placeholderTextColor="#6b7280"
                  value={matchTime}
                  onChangeText={setMatchTime}
                />
                <Text style={styles.inputLabel}>Points required</Text>
                <TextInput
                  style={styles.input}
                  placeholder="15"
                  placeholderTextColor="#6b7280"
                  value={matchPoints}
                  onChangeText={setMatchPoints}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setMatchModalVisible(false)}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveButton, savingMatch && { opacity: 0.7 }]}
                  onPress={savingMatch ? undefined : handleSaveMatch}
                  disabled={savingMatch}>
                  {savingMatch ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveButtonText}>{editingMatch ? 'Save' : 'Add match'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      {/* Status Modal */}
      <Modal
        visible={statusModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusModalVisible(false)}>
        <View style={styles.statusModalOverlay}>
          <View style={styles.statusModalContent}>
            <Text style={styles.statusModalTitle}>{statusModalTitle}</Text>
            <Text style={styles.statusModalMessage}>{statusModalMessage}</Text>
            <TouchableOpacity
              style={styles.statusModalButton}
              onPress={() => setStatusModalVisible(false)}>
              <Text style={styles.statusModalButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    position: 'relative',
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
  statIconContainer: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  statValue: {
    fontSize: 32,
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
  statSubtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  clickableIndicator: {
    position: 'absolute',
    top: 12,
    right: 12,
    opacity: 0.7,
  },
  chartsRow: {
    gap: 16,
    marginBottom: 24,
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
  emptyCarouselText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  carouselList: {
    flexDirection: 'row',
    gap: 12,
  },
  carouselCardWrapper: {
    position: 'relative',
    marginRight: 12,
  },
  carouselCardTouchable: {
    width: 200,
  },
  carouselCard: {
    width: 200,
    borderRadius: 16,
    padding: 16,
  },
  carouselDeleteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 20,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  carouselBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    marginBottom: 8,
  },
  carouselBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#e5e7eb',
    textTransform: 'uppercase',
  },
  carouselTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  carouselSubtitle: {
    fontSize: 13,
    color: '#e5e7eb',
  },
  carouselHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  carouselTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  carouselAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#7c3aed',
  },
  carouselAddButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'rgba(17, 24, 39, 0.98)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: 24,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(55, 65, 81, 0.6)',
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  modalHeaderIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 2,
  },
  modalCloseButton: {
    padding: 8,
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  formCard: {
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.5)',
  },
  formCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#e5e7eb',
    marginBottom: 16,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#d1d5db',
    marginTop: 14,
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#fff',
  },
  gradientPresetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  gradientPreset: {
    width: 44,
    height: 28,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 2,
    overflow: 'hidden',
  },
  gradientPresetSelected: {
    borderColor: '#a855f7',
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  gradientPresetInner: {
    flex: 1,
    borderRadius: 8,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 8,
    marginBottom: 24,
  },
  cancelButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#4b5563',
    backgroundColor: 'transparent',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#d1d5db',
  },
  saveButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  statusModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  statusModalContent: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#020617',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#4b5563',
  },
  statusModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  statusModalMessage: {
    fontSize: 14,
    color: '#e5e7eb',
    marginBottom: 16,
  },
  statusModalButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#7c3aed',
  },
  statusModalButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  topContentList: {
    gap: 16,
  },
  topContentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  topContentIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topContentInfo: {
    flex: 1,
  },
  topContentTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  topContentViews: {
    fontSize: 13,
    color: '#9ca3af',
  },
  topContentChange: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#10b981',
  },
  activityCard: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 16,
  },
  activityTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  activityList: {
    gap: 16,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  activityContent: {
    flex: 1,
  },
  activityItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  activityDescription: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 4,
  },
  activityClicks: {
    fontSize: 12,
    color: '#10b981',
    fontWeight: '600',
    marginTop: 4,
  },
  activityTime: {
    fontSize: 11,
    color: '#6b7280',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#9ca3af',
  },
  carouselTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categorySelector: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
    marginBottom: 4,
  },
  categoryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
  },
  categoryButtonActive: {
    borderColor: '#7c3aed',
    backgroundColor: 'rgba(124, 58, 237, 0.25)',
  },
  categoryButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9ca3af',
  },
  categoryButtonTextActive: {
    color: '#fff',
  },
  matchesList: {
    gap: 12,
  },
  matchItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  matchContent: {
    flex: 1,
  },
  matchLeague: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9ca3af',
    marginBottom: 4,
  },
  matchTeams: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  matchTime: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 2,
  },
  matchPoints: {
    fontSize: 11,
    color: '#f59e0b',
    fontWeight: '600',
  },
  matchActions: {
    flexDirection: 'row',
    gap: 8,
  },
  matchEditButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#1e3a8a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchDeleteButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#7f1d1d',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default DashboardSection;
