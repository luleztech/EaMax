import React, { useState, useEffect, useRef } from 'react';
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
  ImageBackground,
  Animated,
  Easing,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import {
  dashboardAPI,
  adminChannelsAPI,
  adminNotificationsAPI,
  adminCarouselAPI,
  adminScheduleAPI,
} from '../../config/api';

const KPI_COUNT = 3;

/** Tanzania wall-clock as Z ISO (numbers travel as entered — Leotena convention). */
const tzIsoString = (localInput) => {
  const m = String(localInput || '').match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00.000Z`;
  const d = new Date(localInput);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:00.000Z`;
};

const eatWallClockInput = (iso) => {
  if (!iso) return '';
  const s = String(iso);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
  return '';
};

const formatTsh = (n) => {
  const v = Math.round(Number(n) || 0);
  return `TSh ${v.toLocaleString('en-US')}`;
};

const { width } = Dimensions.get('window');

const DashboardSection = ({ refreshTrigger }) => {
  const [stats, setStats] = useState([
    {
      title: 'Daily installs',
      value: '0',
      change: '+0%',
      subtitle: 'New accounts today',
      gradient: ['#06b6d4', '#0284c7'],
      icon: 'trending-up',
    },
    {
      title: 'Revenue',
      value: 'TSh 0',
      change: '+0%',
      subtitle: '0 completed leo',
      gradient: ['#7c3aed', '#5b21b6'],
      icon: 'cash-multiple',
    },
    {
      title: 'Ads watched',
      value: '0',
      change: '+0%',
      subtitle: 'This month',
      gradient: ['#f97316', '#c2410c'],
      icon: 'eye-check',
    },
  ]);

  const heroAnim = useRef(new Animated.Value(0)).current;
  const cardAnims = useRef(Array.from({ length: KPI_COUNT }, () => new Animated.Value(0))).current;
  const hasPlayedIntro = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mostWatchedChannels, setMostWatchedChannels] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [transactionsSummary, setTransactionsSummary] = useState(null);
  const [transactionsTodayDate, setTransactionsTodayDate] = useState(null);
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [allNotifications, setAllNotifications] = useState([]);
  const [notificationsHistoryVisible, setNotificationsHistoryVisible] = useState(false);
  const [footballCarouselSlides, setFootballCarouselSlides] = useState([]);
  const [moviesCarouselSlides, setMoviesCarouselSlides] = useState([]);
  const [carouselTab, setCarouselTab] = useState('football');
  const [upcomingMatches, setUpcomingMatches] = useState([]);
  const [channelOptions, setChannelOptions] = useState([]);
  const [slideModalVisible, setSlideModalVisible] = useState(false);
  const [slideCategory, setSlideCategory] = useState('football'); // Track which carousel we're editing
  const [editingSlide, setEditingSlide] = useState(null);
  const [matchModalVisible, setMatchModalVisible] = useState(false);
  const [editingMatch, setEditingMatch] = useState(null);
  const [scheduleIsMatch, setScheduleIsMatch] = useState(true);
  const [matchTitle, setMatchTitle] = useState('');
  const [matchLeague, setMatchLeague] = useState('');
  const [matchTeam1, setMatchTeam1] = useState('');
  const [matchTeam2, setMatchTeam2] = useState('');
  const [matchChannel, setMatchChannel] = useState('');
  const [matchChannelId, setMatchChannelId] = useState(null);
  const [matchImageUrl, setMatchImageUrl] = useState('');
  const [matchTime, setMatchTime] = useState('');
  const [matchLive, setMatchLive] = useState(false);
  const [matchActive, setMatchActive] = useState(true);
  const [savingMatch, setSavingMatch] = useState(false);
  const [slideTitle, setSlideTitle] = useState('');
  const [slideSubtitle, setSlideSubtitle] = useState('');
  const [slideBadge, setSlideBadge] = useState('');
  const [gradientStart, setGradientStart] = useState('#14532d');
  const [gradientMid, setGradientMid] = useState('#111827');
  const [gradientEnd, setGradientEnd] = useState('#000000');
  const [slideImageUrl, setSlideImageUrl] = useState('');
  const [slideInfoText, setSlideInfoText] = useState('');
  const [slideInfoIcon, setSlideInfoIcon] = useState('clockcircleo');
  const [slideSortOrder, setSlideSortOrder] = useState('0');
  const [savingSlide, setSavingSlide] = useState(false);
  const [deleteConfirmSlide, setDeleteConfirmSlide] = useState(null);
  const [deletingSlide, setDeletingSlide] = useState(false);
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

  // Fetch dashboard stats from backend (KPIs only: installs, revenue, ads)
  const fetchDashboardStats = async () => {
    try {
      let data;
      try {
        data = await dashboardAPI.getStats();
      } catch (err) {
        console.error('Dashboard stats request failed:', err);
        showStatusModal(
          'error',
          'Overview',
          'Could not load dashboard numbers. Check API URL, admin key, and network.',
        );
        return;
      }

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
      setStats([
        {
          title: 'Daily installs',
          value: formatNumber(data.todayInstalls || 0),
          change: data.installChange || '+0%',
          subtitle: 'New accounts today',
          gradient: ['#06b6d4', '#0284c7'],
          icon: 'trending-up',
        },
        {
          title: 'Revenue',
          value: formatTsh(data.todayRevenue ?? data.revenue ?? 0),
          change: data.revenueChange || '+0%',
          subtitle: `${data.completedPaymentsToday ?? data.completedPaymentsTotal ?? 0} completed leo`,
          gradient: ['#7c3aed', '#5b21b6'],
          icon: 'cash-multiple',
        },
        {
          title: 'Ads watched',
          value: formatNumber(data.adsWatched || 0),
          change: data.adsChange || '+0%',
          subtitle: 'This month',
          gradient: ['#f97316', '#c2410c'],
          icon: 'eye-check',
        },
      ]);
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
    }
  };

  // Fetch top channels, recent notifications, carousels, and schedule
  const fetchExtraData = async () => {
    try {
      const [channels, notifications, footballSlides, moviesSlides, schedule, txRes] =
        await Promise.all([
          adminChannelsAPI.getChannels(),
          adminNotificationsAPI.getNotifications(100),
          adminCarouselAPI.getSlides('football'),
          adminCarouselAPI.getSlides('movies'),
          adminScheduleAPI.getSchedule().catch(() => []),
          dashboardAPI.getTransactions(40).catch(() => ({ transactions: [], summary: null })),
        ]);

      setChannelOptions(
        (channels || [])
          .filter((ch) => ch.is_active !== false)
          .map((ch) => ({ id: ch.id, name: ch.name }))
          .filter((ch) => ch.name),
      );

      const top = channels
        .filter((ch) => ch.is_active)
        .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
        .slice(0, 5)
        .map((ch, index) => ({
          title: ch.name,
          views: typeof ch.view_count === 'number' ? `${ch.view_count} views` : (ch.view_count != null ? `${ch.view_count} views` : '0 views'),
          change: typeof ch.view_count === 'number' && ch.view_count > 0 ? '—' : '—',
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
      setTransactions(Array.isArray(txRes?.transactions) ? txRes.transactions : []);
      setTransactionsSummary(txRes?.summary || null);
      setTransactionsTodayDate(txRes?.todayDate || null);

      const formatDateTime = (iso) =>
        iso
          ? new Date(iso).toLocaleString('sw-TZ', {
              hour: '2-digit',
              minute: '2-digit',
              day: '2-digit',
              month: 'short',
            })
          : '';
      const mapped = (notifications || []).map((n) => {
        const isScheduled = n.type === 'scheduled' && n.scheduled_for && !n.sent_at;
        const sentCount = Number(n.sent_count || 0);
        const deliveredCount = Number(n.delivered_count || 0);
        const clicksCount = Number(n.clicks || 0);
        const ctr = deliveredCount > 0 ? ((clicksCount / deliveredCount) * 100).toFixed(1) : '0.0';
        return {
          title: n.title,
          description: n.message,
          clicks:
            isScheduled
              ? '—'
              : `${clicksCount} clicks • ${deliveredCount}/${sentCount} delivered • CTR ${ctr}%`,
          time: isScheduled
            ? `Scheduled ${formatDateTime(n.scheduled_for)}`
            : n.sent_at
              ? `Sent ${formatDateTime(n.sent_at)}`
              : '',
          color:
            n.category === 'kabumbu'
              ? '#10b981'
              : n.category === 'movies'
              ? '#7c3aed'
              : '#3b82f6',
          isScheduled,
        };
      });
      const sentOnly = mapped.filter((n) => !n.isScheduled);
      setRecentNotifications(sentOnly.slice(0, 5));
      setAllNotifications(mapped);

      const mapSlides = (slides) =>
        (slides || []).map((s) => ({
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
      const sortedSchedule = (schedule || [])
        .slice()
        .sort((a, b) => String(a.dateTime || '').localeCompare(String(b.dateTime || '')));
      setUpcomingMatches(sortedSchedule.slice(0, 20));
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
    if (!slideImageUrl.trim()) {
      showStatusModal('error', 'Missing image', 'Please enter carousel image URL.');
      return;
    }

    const payload = {
      title: slideTitle.trim() ? slideTitle.trim() : null,
      subtitle: slideSubtitle.trim() || undefined,
      badge: slideBadge.trim() || undefined,
      imageUrl: slideImageUrl.trim(),
      videoUrl: '',
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
      const message = error?.message || 'Failed to save slide. Please try again.';
      showStatusModal('error', 'Save failed', message);
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
    setScheduleIsMatch(true);
    setMatchTitle('');
    setMatchLeague('');
    setMatchTeam1('');
    setMatchTeam2('');
    setMatchChannel(channelOptions[0]?.name || '');
    setMatchChannelId(channelOptions[0]?.id ?? null);
    setMatchImageUrl('');
    setMatchTime('');
    setMatchLive(false);
    setMatchActive(true);
    setMatchModalVisible(true);
  };

  const openEditMatchModal = (item) => {
    setEditingMatch(item);
    const isMatch = Boolean(item.team1 && item.team2);
    setScheduleIsMatch(isMatch);
    setMatchTitle(item.title || '');
    setMatchLeague(item.subtitle || '');
    setMatchTeam1(item.team1 || '');
    setMatchTeam2(item.team2 || '');
    const cid = item.channelId ?? item.channel_id ?? null;
    const byId = channelOptions.find((c) => c.id === cid);
    const byName = channelOptions.find((c) => c.name === item.channel);
    setMatchChannelId(byId?.id ?? byName?.id ?? cid);
    setMatchChannel(byId?.name || byName?.name || item.channel || '');
    setMatchImageUrl(item.imageUrl || item.image_url || '');
    setMatchTime(eatWallClockInput(item.dateTime));
    setMatchLive(!!item.live);
    setMatchActive(item.active !== false);
    setMatchModalVisible(true);
  };

  const handleSaveMatch = async () => {
    if (!matchTime.trim()) {
      showStatusModal('error', 'Missing fields', 'Please set date & time (EAT).');
      return;
    }
    if (scheduleIsMatch) {
      if (!matchTeam1.trim() || !matchTeam2.trim()) {
        showStatusModal('error', 'Missing fields', 'Please enter both teams.');
        return;
      }
    } else if (!matchTitle.trim()) {
      showStatusModal('error', 'Missing fields', 'Please enter a programme title.');
      return;
    }
    if (!matchChannelId && !matchChannel.trim()) {
      showStatusModal('error', 'Channel required', 'Select the channel that will go LIVE for this event.');
      return;
    }

    const title = scheduleIsMatch
      ? `${matchTeam1.trim()} vs ${matchTeam2.trim()}`
      : matchTitle.trim();
    const payload = {
      dateTime: tzIsoString(matchTime.trim()),
      title,
      subtitle: matchLeague.trim(),
      channel: matchChannel.trim(),
      channelId: matchChannelId ? Number(matchChannelId) : null,
      imageUrl: matchImageUrl.trim(),
      team1: scheduleIsMatch ? matchTeam1.trim() : '',
      team2: scheduleIsMatch ? matchTeam2.trim() : '',
      icon: scheduleIsMatch ? 'sports_soccer_rounded' : 'live_tv_rounded',
      live: !!matchLive,
      active: !!matchActive,
      gradient: scheduleIsMatch ? ['#E8002D', '#7F1D1D'] : ['#1D4A82', '#2C6DB5'],
    };

    try {
      setSavingMatch(true);
      if (editingMatch?.id) {
        await adminScheduleAPI.updateItem(editingMatch.id, payload);
      } else {
        await adminScheduleAPI.createItem(payload);
      }
      await fetchExtraData();
      setMatchModalVisible(false);
      showStatusModal('success', 'Ratiba saved', 'Schedule item saved and will show in the app Ratiba tab.');
    } catch (error) {
      console.error('Failed to save schedule item:', error);
      const detail = String(error?.message || '').trim();
      showStatusModal(
        'error',
        'Save failed',
        detail && detail !== 'Failed to save schedule item. Please try again.'
          ? detail
          : 'Failed to save schedule item. Please try again.',
      );
    } finally {
      setSavingMatch(false);
    }
  };

  const handleDeleteMatch = async (matchId) => {
    try {
      setSavingMatch(true);
      await adminScheduleAPI.deleteItem(matchId);
      await fetchExtraData();
      showStatusModal('success', 'Deleted', 'Schedule item deleted successfully.');
    } catch (error) {
      console.error('Failed to delete schedule item:', error);
      showStatusModal('error', 'Delete failed', 'Failed to delete schedule item. Please try again.');
    } finally {
      setSavingMatch(false);
    }
  };

  const handleToggleScheduleActive = async (item) => {
    try {
      await adminScheduleAPI.toggleActive(item.id);
      await fetchExtraData();
    } catch (error) {
      console.error('Failed to toggle schedule active:', error);
      showStatusModal('error', 'Update failed', 'Could not update active status.');
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

    const interval = setInterval(() => {
      fetchDashboardStats();
      dashboardAPI
        .getTransactions(40)
        .then((txRes) => {
          setTransactions(Array.isArray(txRes?.transactions) ? txRes.transactions : []);
          setTransactionsSummary(txRes?.summary || null);
          setTransactionsTodayDate(txRes?.todayDate || null);
        })
        .catch(() => {});
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (hasPlayedIntro.current) return;
    hasPlayedIntro.current = true;
    heroAnim.setValue(0);
    cardAnims.forEach((a) => a.setValue(0));
    Animated.timing(heroAnim, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    Animated.stagger(
      85,
      cardAnims.map((a) =>
        Animated.spring(a, {
          toValue: 1,
          useNativeDriver: true,
          tension: 64,
          friction: 12,
        }),
      ),
    ).start();
  }, [loading]);

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
      <LinearGradient
        colors={['rgba(124, 58, 237, 0.12)', 'rgba(3, 7, 18, 0)', 'rgba(6, 182, 212, 0.06)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.overviewHeroGradient}>
        <Animated.View
          style={{
            opacity: heroAnim,
            transform: [
              {
                translateY: heroAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [14, 0],
                }),
              },
            ],
          }}>
          <View style={styles.overviewHeroTop}>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.livePillText}>Live</Text>
            </View>
            <Text style={styles.overviewHeroTitle}>Overview</Text>
          </View>
        </Animated.View>

        <View style={styles.statsRowPro}>
          {stats.map((stat, index) => {
            const a = cardAnims[index] || cardAnims[0];
            return (
              <Animated.View
                key={stat.title}
                style={[
                  styles.statTileWrap,
                  {
                    opacity: a,
                    transform: [
                      {
                        translateY: a.interpolate({
                          inputRange: [0, 1],
                          outputRange: [22, 0],
                        }),
                      },
                      {
                        scale: a.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.94, 1],
                        }),
                      },
                    ],
                  },
                ]}>
                <LinearGradient
                  colors={stat.gradient}
                  style={styles.statTile}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}>
                  <View style={styles.statTileInner}>
                    <View style={styles.statTileIconBg}>
                      <Icon name={stat.icon} size={22} color="#fff" />
                    </View>
                    <Text style={styles.statTileLabel} numberOfLines={2}>
                      {stat.title}
                    </Text>
                    <Text style={styles.statTileValue} numberOfLines={1} adjustsFontSizeToFit>
                      {stat.value}
                    </Text>
                    <View style={styles.statTileMeta}>
                      <Text style={styles.statTileChange}>{stat.change}</Text>
                      <Text style={styles.statTileSub} numberOfLines={1}>
                        {stat.subtitle}
                      </Text>
                    </View>
                  </View>
                </LinearGradient>
              </Animated.View>
            );
          })}
        </View>
      </LinearGradient>

      {/* Home Carousels — Football + Movies grouped */}
      <View style={styles.carouselHubCard}>
        <LinearGradient
          colors={['rgba(124, 58, 237, 0.14)', 'rgba(17, 24, 39, 0.95)']}
          style={styles.carouselHubGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}>
          <View style={styles.carouselHubHeader}>
            <View>
              <Text style={styles.carouselHubTitle}>Home Carousels</Text>
            </View>
            <TouchableOpacity
              style={styles.carouselAddButton}
              onPress={() => openNewSlideModal(carouselTab)}
              activeOpacity={0.8}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <AntDesign name="plus" size={16} color="#fff" />
              <Text style={styles.carouselAddButtonText}>Add slide</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.carouselTabRow}>
            <TouchableOpacity
              style={[styles.carouselTab, carouselTab === 'football' && styles.carouselTabActiveFootball]}
              onPress={() => setCarouselTab('football')}
              activeOpacity={0.85}>
              <Icon name="soccer" size={18} color={carouselTab === 'football' ? '#fff' : '#6ee7b7'} />
              <Text style={[styles.carouselTabText, carouselTab === 'football' && styles.carouselTabTextActive]}>
                Football
              </Text>
              <View style={styles.carouselTabCount}>
                <Text style={styles.carouselTabCountText}>{footballCarouselSlides.length}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.carouselTab, carouselTab === 'movies' && styles.carouselTabActiveMovies]}
              onPress={() => setCarouselTab('movies')}
              activeOpacity={0.85}>
              <Icon name="movie" size={18} color={carouselTab === 'movies' ? '#fff' : '#c4b5fd'} />
              <Text style={[styles.carouselTabText, carouselTab === 'movies' && styles.carouselTabTextActive]}>
                Movies
              </Text>
              <View style={[styles.carouselTabCount, styles.carouselTabCountMovies]}>
                <Text style={styles.carouselTabCountText}>{moviesCarouselSlides.length}</Text>
              </View>
            </TouchableOpacity>
          </View>

          {(() => {
            const activeSlides = carouselTab === 'football' ? footballCarouselSlides : moviesCarouselSlides;
            const emptyLabel =
              carouselTab === 'football'
                ? 'No football slides yet. Tap "Add slide" to create one.'
                : 'No movies slides yet. Tap "Add slide" to create one.';
            const defaultGradient =
              carouselTab === 'football'
                ? ['#14532d', '#111827', '#000000']
                : ['#4c1d95', '#111827', '#000000'];

            if (activeSlides.length === 0) {
              return <Text style={styles.emptyCarouselText}>{emptyLabel}</Text>;
            }

            return (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.slideCardScrollContent}>
                {activeSlides.map((slide) => (
                  <View key={slide.id} style={styles.slideCardPro}>
                    <ImageBackground
                      source={(slide.image_url || slide.imageUrl) ? { uri: slide.image_url || slide.imageUrl } : undefined}
                      style={styles.slideCardImagePro}
                      imageStyle={styles.slideCardImageBg}>
                      <LinearGradient
                        colors={slide.gradient || defaultGradient}
                        style={styles.slideCardOverlay}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}>
                        <View style={styles.slideCardTopRow}>
                          <View style={styles.slideCardCategoryPill}>
                            <Icon
                              name={carouselTab === 'football' ? 'soccer' : 'movie'}
                              size={12}
                              color="#fff"
                            />
                            <Text style={styles.slideCardCategoryPillText}>
                              {carouselTab === 'football' ? 'Football' : 'Movies'}
                            </Text>
                          </View>
                          {slide.badge ? (
                            <View style={styles.slideCardBadge}>
                              <Text style={styles.slideCardBadgeText}>{slide.badge}</Text>
                            </View>
                          ) : null}
                        </View>
                        <View style={styles.slideCardTextWrap}>
                          {slide.title ? (
                            <Text style={styles.slideCardTitle} numberOfLines={2}>{slide.title}</Text>
                          ) : null}
                          {slide.subtitle ? (
                            <Text style={styles.slideCardSubtitle} numberOfLines={1}>{slide.subtitle}</Text>
                          ) : null}
                        </View>
                      </LinearGradient>
                    </ImageBackground>
                    <View style={styles.slideCardBodyPro}>
                      <TouchableOpacity
                        style={styles.slideCardEditBtn}
                        onPress={() => openEditSlideModal(slide)}
                        activeOpacity={0.7}>
                        <Icon name="pencil" size={18} color="#3b82f6" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.slideCardDeleteBtn}
                        onPress={() => setDeleteConfirmSlide(slide)}
                        activeOpacity={0.7}>
                        <Icon name="delete" size={18} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </ScrollView>
            );
          })()}
        </LinearGradient>
      </View>

      {/* Upcoming schedule (Ratiba) */}
      <View style={styles.chartCard}>
        <View style={styles.carouselHeader}>
          <View style={styles.carouselTitleRow}>
            <Icon name="calendar-clock" size={20} color="#f59e0b" />
            <Text style={styles.chartTitle}>Ratiba</Text>
          </View>
          <TouchableOpacity
            style={styles.carouselAddButton}
            onPress={openNewMatchModal}
            activeOpacity={0.8}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <AntDesign name="plus" size={16} color="#fff" />
            <Text style={styles.carouselAddButtonText}>Ongeza</Text>
          </TouchableOpacity>
        </View>
        {upcomingMatches.length === 0 ? (
          <Text style={styles.emptyCarouselText}>
            Hakuna vipindi. Tap "Ongeza" to add a programme or match (shows in app Ratiba tab).
          </Text>
        ) : (
          <View style={styles.matchesList}>
            {upcomingMatches.map((item) => {
              const isMatch = Boolean(item.team1 && item.team2);
              const timeStr = item.dateTime
                ? String(item.dateTime).replace('T', ' ').slice(0, 16)
                : '';
              const img = item.imageUrl || item.image_url || '';
              const subtitleParts = [
                isMatch ? 'MECHI' : 'KIPINDI',
                item.channel,
                item.subtitle,
                timeStr,
              ].filter(Boolean);
              return (
                <View key={item.id} style={[styles.matchItem, item.active === false && { opacity: 0.55 }]}>
                  {img ? (
                    <ImageBackground
                      source={{ uri: img }}
                      style={styles.ratibaThumb}
                      imageStyle={{ borderRadius: 12 }}>
                      <View style={styles.ratibaThumbOverlay} />
                    </ImageBackground>
                  ) : (
                    <LinearGradient
                      colors={item.gradient || ['#1D4A82', '#2C6DB5']}
                      style={styles.ratibaThumb}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}>
                      <Icon name={isMatch ? 'soccer' : 'television-play'} size={22} color="#fff" />
                    </LinearGradient>
                  )}
                  <View style={[styles.matchContent, { flex: 1 }]}>
                    <Text style={styles.matchLeague}>{subtitleParts.join(' · ')}</Text>
                    <Text style={styles.matchTeams}>{item.title}</Text>
                    {item.live ? <Text style={styles.matchPoints}>LIVE</Text> : null}
                  </View>
                  <View style={styles.matchActions}>
                    <TouchableOpacity
                      style={styles.matchEditButton}
                      onPress={() => handleToggleScheduleActive(item)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Icon
                        name={item.active === false ? 'eye-off-outline' : 'eye-outline'}
                        size={16}
                        color={item.active === false ? '#9ca3af' : '#34d399'}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.matchEditButton}
                      onPress={() => openEditMatchModal(item)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Icon name="pencil" size={16} color="#3b82f6" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.matchDeleteButton}
                      onPress={() => handleDeleteMatch(item.id)}
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

        {/* Caught transactions — live from database */}
        <View style={styles.transactionsCard}>
          <View style={styles.transactionsHeader}>
            <View style={styles.transactionsTitleRow}>
              <View style={styles.transactionsIconWrap}>
                <Icon name="receipt-text-check" size={22} color="#34d399" />
              </View>
              <View>
                <Text style={styles.transactionsTitle}>Caught Transactions</Text>
                <Text style={styles.transactionsSubtitle}>
                  Leo pekee
                  {transactionsTodayDate ? ` · ${transactionsTodayDate}` : ''}
                  {transactionsSummary?.revenueToday != null
                    ? ` · ${formatTsh(transactionsSummary.revenueToday)}`
                    : ''}
                </Text>
              </View>
            </View>
            {transactionsSummary ? (
              <View style={styles.txSummaryPills}>
                <View style={[styles.txSummaryPill, styles.txPillSuccess]}>
                  <Text style={styles.txSummaryPillText}>{transactionsSummary.completed} ok</Text>
                </View>
                <View style={[styles.txSummaryPill, styles.txPillPending]}>
                  <Text style={styles.txSummaryPillText}>{transactionsSummary.pending} pend</Text>
                </View>
              </View>
            ) : null}
          </View>

          <View style={styles.txTableHead}>
            <Text style={[styles.txHeadCell, styles.txColUser]}>User</Text>
            <Text style={[styles.txHeadCell, styles.txColPhone]}>Number</Text>
            <Text style={[styles.txHeadCell, styles.txColTxn]}>Txn ID</Text>
            <Text style={[styles.txHeadCell, styles.txColAmount]}>Amount</Text>
            <Text style={[styles.txHeadCell, styles.txColStatus]}>Status</Text>
          </View>

          {transactions.length === 0 ? (
            <View style={styles.txEmpty}>
              <Icon name="cash-remove" size={36} color="#4b5563" />
              <Text style={styles.txEmptyText}>Hakuna miamala leo</Text>
            </View>
          ) : (
            <View style={styles.txList}>
              {transactions.map((tx, index) => {
                const statusKey = tx.status || 'pending';
                const statusStyle =
                  statusKey === 'completed'
                    ? styles.txStatusSuccess
                    : statusKey === 'failed'
                      ? styles.txStatusFailed
                      : statusKey === 'cancelled'
                        ? styles.txStatusCancelled
                        : styles.txStatusPending;
                const statusIcon =
                  statusKey === 'completed'
                    ? 'check-circle'
                    : statusKey === 'failed'
                      ? 'close-circle'
                      : statusKey === 'cancelled'
                        ? 'minus-circle'
                        : 'clock-outline';
                const when = tx.completedAt || tx.createdAt;
                const timeLabel = when
                  ? new Date(when).toLocaleString('sw-TZ', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '';

                return (
                  <View
                    key={`${tx.id}-${index}`}
                    style={[
                      styles.txRow,
                      index === transactions.length - 1 && styles.txRowLast,
                    ]}>
                    <View style={styles.txColUser}>
                      <Text style={styles.txUserId} numberOfLines={1}>
                        #{tx.userId}
                      </Text>
                      <Text style={styles.txUserExt} numberOfLines={1}>
                        {tx.userExternalId || '—'}
                      </Text>
                    </View>
                    <Text style={[styles.txCell, styles.txColPhone]} numberOfLines={1}>
                      {tx.userNumber || '—'}
                    </Text>
                    <Text style={[styles.txCell, styles.txColTxn]} numberOfLines={1}>
                      {tx.transactionId || '—'}
                    </Text>
                    <Text style={[styles.txAmount, styles.txColAmount]} numberOfLines={1}>
                      {tx.amountFormatted || `TSh ${tx.amountTsh ?? 0}`}
                    </Text>
                    <View style={styles.txColStatus}>
                      <View style={[styles.txStatusBadge, statusStyle]}>
                        <Icon name={statusIcon} size={12} color="#fff" />
                        <Text style={styles.txStatusText}>
                          {tx.statusLabel || statusKey}
                        </Text>
                      </View>
                      {timeLabel ? (
                        <Text style={styles.txTime} numberOfLines={1}>
                          {timeLabel}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </View>

      {/* Recent Notifications (last 5 sent only) */}
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
        <TouchableOpacity
          style={styles.viewAllNotificationsButton}
          onPress={() => setNotificationsHistoryVisible(true)}
          activeOpacity={0.8}>
          <Text style={styles.viewAllNotificationsButtonText}>View all</Text>
          <Icon name="chevron-right" size={18} color="#a855f7" />
        </TouchableOpacity>
      </View>

      {/* Notifications History Modal */}
      <Modal
        visible={notificationsHistoryVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setNotificationsHistoryVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <View style={styles.modalHeaderIconWrap}>
                  <Icon name="bell" size={22} color="#a78bfa" />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Notifications history</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setNotificationsHistoryVisible(false)}
                style={styles.modalCloseButton}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Icon name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.activityList}>
                {allNotifications.length === 0 ? (
                  <Text style={styles.notificationsHistoryEmpty}>No notifications yet</Text>
                ) : (
                  allNotifications.map((notification, index) => (
                    <View key={index} style={styles.activityItem}>
                      <View style={[styles.activityDot, { backgroundColor: notification.color }]} />
                      <View style={styles.activityContent}>
                        <Text style={styles.activityItemTitle}>{notification.title}</Text>
                        <Text style={styles.activityDescription}>{notification.description}</Text>
                        <Text style={styles.activityClicks}>{notification.clicks}</Text>
                      </View>
                      <Text style={styles.activityTime}>{notification.time}</Text>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

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
                <Text style={styles.inputLabel}>Title (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. MAN UTD vs LIVERPOOL — leave empty if no title"
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
                  placeholder="https://example.com/slide.jpg au .gif"
                  placeholderTextColor="#6b7280"
                  value={slideImageUrl}
                  onChangeText={setSlideImageUrl}
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
      {/* Schedule / Ratiba Modal */}
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
                  <Icon name="calendar-clock" size={22} color="#a78bfa" />
                </View>
                <View>
                  <Text style={styles.modalTitle}>
                    {editingMatch ? 'Hariri kipindi' : 'Kipindi kipya'}
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
                <Text style={styles.formCardTitle}>Aina</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                  <TouchableOpacity
                    style={[
                      styles.carouselAddButton,
                      { flex: 1, justifyContent: 'center', backgroundColor: !scheduleIsMatch ? '#3b82f6' : '#374151' },
                    ]}
                    onPress={() => setScheduleIsMatch(false)}>
                    <Text style={styles.carouselAddButtonText}>Kipindi / Filamu</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.carouselAddButton,
                      { flex: 1, justifyContent: 'center', backgroundColor: scheduleIsMatch ? '#3b82f6' : '#374151' },
                    ]}
                    onPress={() => setScheduleIsMatch(true)}>
                    <Text style={styles.carouselAddButtonText}>Mechi</Text>
                  </TouchableOpacity>
                </View>

                {scheduleIsMatch ? (
                  <>
                    <Text style={styles.inputLabel}>Timu ya 1 *</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Simba"
                      placeholderTextColor="#6b7280"
                      value={matchTeam1}
                      onChangeText={setMatchTeam1}
                    />
                    <Text style={styles.inputLabel}>Timu ya 2 *</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Yanga"
                      placeholderTextColor="#6b7280"
                      value={matchTeam2}
                      onChangeText={setMatchTeam2}
                    />
                    <Text style={styles.inputLabel}>Ligi / Maelezo</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Ligi Kuu"
                      placeholderTextColor="#6b7280"
                      value={matchLeague}
                      onChangeText={setMatchLeague}
                    />
                  </>
                ) : (
                  <>
                    <Text style={styles.inputLabel}>Kichwa *</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Habari za Jioni"
                      placeholderTextColor="#6b7280"
                      value={matchTitle}
                      onChangeText={setMatchTitle}
                    />
                    <Text style={styles.inputLabel}>Maelezo</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Maelezo mafupi"
                      placeholderTextColor="#6b7280"
                      value={matchLeague}
                      onChangeText={setMatchLeague}
                    />
                  </>
                )}

                <Text style={styles.inputLabel}>Kituo litakalo LIVE *</Text>
                {channelOptions.length === 0 ? (
                  <Text style={[styles.emptyCarouselText, { marginBottom: 10 }]}>
                    Hakuna vituo — ongeza channel kwanza.
                  </Text>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                    {channelOptions.map((ch) => {
                      const selected = matchChannelId === ch.id || matchChannel === ch.name;
                      return (
                        <TouchableOpacity
                          key={ch.id}
                          onPress={() => {
                            setMatchChannelId(ch.id);
                            setMatchChannel(ch.name);
                          }}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderRadius: 10,
                            backgroundColor: selected ? '#3b82f6' : '#374151',
                          }}>
                          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>{ch.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                <Text style={styles.inputLabel}>Picha ya event (URL)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="https://…/event-poster.jpg"
                  placeholderTextColor="#6b7280"
                  value={matchImageUrl}
                  onChangeText={setMatchImageUrl}
                  autoCapitalize="none"
                />
                {!!matchImageUrl.trim() && (
                  <ImageBackground
                    source={{ uri: matchImageUrl.trim() }}
                    style={{ height: 120, borderRadius: 14, marginBottom: 12, overflow: 'hidden' }}
                    imageStyle={{ borderRadius: 14 }}>
                    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' }} />
                  </ImageBackground>
                )}

                <Text style={styles.inputLabel}>Tarehe & saa (EAT) *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="2026-07-20T19:00"
                  placeholderTextColor="#6b7280"
                  value={matchTime}
                  onChangeText={setMatchTime}
                />
                <Text style={[styles.emptyCarouselText, { marginTop: -6, marginBottom: 10 }]}>
                  Use Tanzania wall-clock time (EAT). Example: 2026-07-20T19:00
                </Text>

                <TouchableOpacity
                  onPress={() => setMatchLive((v) => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 }}>
                  <Icon name={matchLive ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={matchLive ? '#34d399' : '#9ca3af'} />
                  <Text style={{ color: '#e5e7eb', fontWeight: '600' }}>LIVE</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setMatchActive((v) => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 }}>
                  <Icon name={matchActive ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={matchActive ? '#34d399' : '#9ca3af'} />
                  <Text style={{ color: '#e5e7eb', fontWeight: '600' }}>Hai (visible in app)</Text>
                </TouchableOpacity>
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
                    <Text style={styles.saveButtonText}>{editingMatch ? 'Hifadhi' : 'Ongeza'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      {/* Delete Carousel Slide Confirmation Modal */}
      <Modal
        visible={!!deleteConfirmSlide}
        transparent
        animationType="fade"
        onRequestClose={() => !deletingSlide && setDeleteConfirmSlide(null)}>
        <View style={styles.deleteConfirmOverlay}>
          <View style={styles.deleteConfirmCard}>
            <View style={styles.deleteConfirmIconWrap}>
              <Icon name="delete-alert" size={40} color="#fef2f2" />
            </View>
            <Text style={styles.deleteConfirmTitle}>Delete carousel slide?</Text>
            <Text style={styles.deleteConfirmMessage}>
              This will permanently remove "{deleteConfirmSlide?.title || 'this slide'}" from the carousel. This action cannot be undone.
            </Text>
            <View style={styles.deleteConfirmActionsRow}>
              <TouchableOpacity
                style={styles.deleteConfirmCancel}
                onPress={() => setDeleteConfirmSlide(null)}
                disabled={deletingSlide}>
                <Text style={styles.deleteConfirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.deleteConfirmDelete, deletingSlide && styles.deleteConfirmDeleteDisabled]}
                onPress={() => deleteConfirmSlide && handleDeleteSlide(deleteConfirmSlide.id)}
                disabled={deletingSlide}>
                <Icon name="delete" size={18} color="#fff" />
                <Text style={styles.deleteConfirmDeleteText}>
                  {deletingSlide ? 'Deleting...' : 'Delete'}
                </Text>
              </TouchableOpacity>
            </View>
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
  overviewHeroGradient: {
    borderRadius: 20,
    paddingBottom: 8,
    marginBottom: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.45)',
  },
  overviewHeroTop: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 8,
  },
  overviewHeroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: -0.5,
    marginTop: 10,
  },
  overviewHeroSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 6,
    lineHeight: 18,
  },
  livePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.35)',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#34d399',
  },
  livePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6ee7b7',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  statsRowPro: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 14,
    flexWrap: 'wrap',
  },
  statTileWrap: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: (width - 64) / 3,
    maxWidth: '100%',
  },
  statTile: {
    borderRadius: 16,
    padding: 0,
    overflow: 'hidden',
    minHeight: 148,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  statTileInner: {
    padding: 14,
    flex: 1,
  },
  statTileIconBg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  statTileLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.88)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  statTileValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.3,
    marginBottom: 10,
  },
  statTileMeta: {
    gap: 4,
  },
  statTileChange: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.92)',
  },
  statTileSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.75)',
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
  slideCardScrollContent: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 4,
    paddingRight: 4,
  },
  slideCard: {
    width: 180,
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    overflow: 'hidden',
  },
  slideCardImage: {
    height: 140,
    position: 'relative',
  },
  slideCardImageBg: {
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
  },
  slideCardOverlay: {
    flex: 1,
    padding: 12,
    justifyContent: 'flex-end',
  },
  slideCardBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    marginBottom: 8,
  },
  slideCardBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#e5e7eb',
    textTransform: 'uppercase',
  },
  slideCardTextWrap: {
    marginTop: 'auto',
  },
  slideCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 2,
  },
  slideCardSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.9)',
  },
  slideCardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(31, 41, 55, 0.6)',
  },
  slideCardCategory: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '500',
  },
  slideCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  slideCardEditBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  slideCardDeleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
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
  carouselHubCard: {
    marginBottom: 16,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.35)',
  },
  carouselHubGradient: {
    padding: 16,
  },
  carouselHubHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  carouselHubTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: -0.3,
  },
  carouselHubSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
    lineHeight: 17,
    maxWidth: width * 0.55,
  },
  carouselTabRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  carouselTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
  },
  carouselTabActiveFootball: {
    borderColor: 'rgba(16, 185, 129, 0.55)',
    backgroundColor: 'rgba(6, 78, 59, 0.45)',
  },
  carouselTabActiveMovies: {
    borderColor: 'rgba(168, 85, 247, 0.55)',
    backgroundColor: 'rgba(76, 29, 149, 0.4)',
  },
  carouselTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  carouselTabTextActive: {
    color: '#fff',
  },
  carouselTabCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(16, 185, 129, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  carouselTabCountMovies: {
    backgroundColor: 'rgba(124, 58, 237, 0.45)',
  },
  carouselTabCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  slideCardPro: {
    width: 196,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.8)',
    overflow: 'hidden',
  },
  slideCardImagePro: {
    height: 148,
  },
  slideCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  slideCardCategoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  slideCardCategoryPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#e5e7eb',
    textTransform: 'uppercase',
  },
  slideCardBodyPro: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(31, 41, 55, 0.75)',
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
  deleteConfirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  deleteConfirmCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  deleteConfirmIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  deleteConfirmTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 10,
    textAlign: 'center',
  },
  deleteConfirmMessage: {
    fontSize: 15,
    color: '#cbd5e1',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  deleteConfirmActionsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    justifyContent: 'flex-end',
  },
  deleteConfirmCancel: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: 'rgba(71, 85, 105, 0.6)',
    borderWidth: 1,
    borderColor: '#475569',
  },
  deleteConfirmCancelText: {
    color: '#e2e8f0',
    fontWeight: '600',
    fontSize: 15,
  },
  deleteConfirmDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#dc2626',
    borderWidth: 1,
    borderColor: '#b91c1c',
  },
  deleteConfirmDeleteDisabled: {
    opacity: 0.7,
  },
  deleteConfirmDeleteText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
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
  transactionsCard: {
    backgroundColor: 'rgba(17, 24, 39, 0.9)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    overflow: 'hidden',
    marginTop: 0,
  },
  transactionsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    gap: 10,
  },
  transactionsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  transactionsIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  transactionsTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: -0.2,
  },
  transactionsSubtitle: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  txSummaryPills: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  txSummaryPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  txPillSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  txPillPending: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  txSummaryPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#e5e7eb',
  },
  txTableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(31, 41, 55, 0.65)',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  txHeadCell: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  txColUser: {
    width: '18%',
    minWidth: 52,
  },
  txColPhone: {
    width: '22%',
    minWidth: 64,
  },
  txColTxn: {
    flex: 1,
    minWidth: 56,
  },
  txColAmount: {
    width: '20%',
    minWidth: 72,
    textAlign: 'right',
  },
  txColStatus: {
    width: '22%',
    minWidth: 76,
    alignItems: 'flex-end',
  },
  txList: {},
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(31, 41, 55, 0.8)',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  txRowLast: {
    borderBottomWidth: 0,
  },
  txCell: {
    fontSize: 11,
    color: '#d1d5db',
  },
  txUserId: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f8fafc',
  },
  txUserExt: {
    fontSize: 9,
    color: '#6b7280',
    marginTop: 2,
  },
  txAmount: {
    fontSize: 11,
    fontWeight: '700',
    color: '#a78bfa',
    textAlign: 'right',
  },
  txStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-end',
  },
  txStatusSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.85)',
  },
  txStatusPending: {
    backgroundColor: 'rgba(245, 158, 11, 0.85)',
  },
  txStatusFailed: {
    backgroundColor: 'rgba(239, 68, 68, 0.85)',
  },
  txStatusCancelled: {
    backgroundColor: 'rgba(107, 114, 128, 0.85)',
  },
  txStatusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    textTransform: 'capitalize',
  },
  txTime: {
    fontSize: 9,
    color: '#6b7280',
    marginTop: 4,
    textAlign: 'right',
  },
  txEmpty: {
    padding: 32,
    alignItems: 'center',
    gap: 10,
  },
  txEmptyText: {
    fontSize: 14,
    color: '#9ca3af',
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
  viewAllNotificationsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.4)',
    borderRadius: 12,
    backgroundColor: 'rgba(168, 85, 247, 0.08)',
  },
  viewAllNotificationsButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#a855f7',
  },
  notificationsHistoryEmpty: {
    fontSize: 15,
    color: '#9ca3af',
    textAlign: 'center',
    paddingVertical: 24,
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
    gap: 12,
  },
  ratibaThumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ratibaThumbOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.15)',
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
