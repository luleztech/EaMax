import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { dashboardAPI, adminChannelsAPI, adminControlAPI } from '../../config/api';
import colors from '../../theme/colors';
import { Card, SectionTitle, Stat, Row, Chip, Bar, Divider, Empty, compact, formatTsh } from '../ui/kit';

const PLATFORMS = [
  { key: 'football', label: 'Football', icon: 'soccer' },
  { key: 'movies', label: 'Movies', icon: 'movie-open-outline' },
  { key: 'habari', label: 'News', icon: 'newspaper-variant-outline' },
];

const buildMix = (channels) => {
  const totals = { football: 0, movies: 0, habari: 0, other: 0 };
  (channels || []).forEach((ch) => {
    const cat = String(ch.category || 'football').toLowerCase();
    const v = Number(ch.view_count ?? ch.viewCount) || 0;
    if (cat === 'football') totals.football += v;
    else if (cat === 'habari') totals.habari += v;
    else totals.movies += v; // tamthilia / filamu / wanyama / katuni / sayansi are all "movies app"
  });
  const sum = totals.football + totals.movies + totals.habari;
  return PLATFORMS.map((p) => ({
    ...p,
    views: totals[p.key],
    pct: sum > 0 ? Math.round((totals[p.key] / sum) * 100) : 0,
  })).sort((a, b) => b.views - a.views);
};

const AnalyticsSection = ({ isActive }) => {
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState(null);
  const [channels, setChannels] = useState([]);
  const [playback, setPlayback] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const wasActive = useRef(false);

  const load = useCallback(async () => {
    try {
      const [s, ch, pb] = await Promise.all([
        dashboardAPI.getStats(),
        adminChannelsAPI.getChannels().catch(() => []),
        adminControlAPI.getPlaybackAnalytics(days).catch(() => null),
      ]);
      setStats(s);
      setChannels(Array.isArray(ch) ? ch : []);
      setPlayback(pb?.summary || null);
    } catch (e) {
      console.warn('Stats load failed', e);
    } finally {
      setRefreshing(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (isActive && !wasActive.current) load();
    wasActive.current = !!isActive;
  }, [isActive, load]);

  const mix = buildMix(channels);
  const top = [...channels]
    .sort((a, b) => (Number(b.view_count) || 0) - (Number(a.view_count) || 0))
    .slice(0, 8);
  const maxViews = Math.max(1, ...top.map((c) => Number(c.view_count) || 0));

  const opens = Number(playback?.channelOpens) || 0;
  const failures = Number(playback?.streamFailures) || 0;
  const failRate = opens > 0 ? ((failures / opens) * 100).toFixed(1) : '0.0';
  const n = stats?.notifications || {};

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.page}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={colors.accent}
        />
      }>
      <View style={styles.grid}>
        <Stat label="Total users" value={compact(stats?.totalUsers)} icon="account-group-outline" />
        <Stat
          label="New today"
          value={compact(stats?.todayInstalls)}
          hint={stats?.installChange}
          icon="account-plus-outline"
        />
      </View>
      <View style={[styles.grid, { marginTop: 10 }]}>
        <Stat
          label="Revenue today"
          value={formatTsh(stats?.todayRevenue ?? 0)}
          hint={stats?.revenueChange}
          icon="cash"
        />
        <Stat
          label="Ads watched"
          value={compact(stats?.adsWatched)}
          hint={stats?.adsChange}
          icon="play-box-outline"
        />
      </View>

      <View style={styles.rangeRow}>
        <Text style={styles.rangeTitle}>Playback</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="7 days" active={days === 7} onPress={() => setDays(7)} />
          <Chip label="30 days" active={days === 30} onPress={() => setDays(30)} />
        </View>
      </View>
      {playback ? (
        <>
          <View style={styles.grid}>
            <Stat label="Channel opens" value={compact(opens)} />
            <Stat label="Failures" value={compact(failures)} hint={`${failRate}% of opens`} />
          </View>
          <View style={[styles.grid, { marginTop: 10 }]}>
            <Stat label="Crashes" value={compact(playback.playerCrashes)} />
            <Stat
              label="Watch time"
              value={`${compact(Math.round((playback.totalWatchSeconds || 0) / 3600))}h`}
            />
          </View>
        </>
      ) : (
        <Card>
          <Empty icon="chart-line-variant" title="No playback data yet" />
        </Card>
      )}

      <SectionTitle title="Where people watch" />
      <Card>
        {mix.map((p, i) => (
          <View key={p.key} style={i > 0 ? { marginTop: 16 } : null}>
            <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={styles.rowTitle}>{p.label}</Text>
              <Text style={styles.rowValue}>
                {p.pct}% · {compact(p.views)}
              </Text>
            </Row>
            <Bar pct={p.pct} height={8} />
          </View>
        ))}
      </Card>

      <SectionTitle title="Top channels" />
      <Card padded={false}>
        {top.length === 0 ? (
          <Empty icon="television-off" title="No channels" />
        ) : (
          top.map((ch, i) => {
            const v = Number(ch.view_count) || 0;
            return (
              <View key={ch.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.topRow}>
                  <Text style={styles.rank}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {ch.name}
                      </Text>
                      <Text style={styles.rowValue}>{compact(v)}</Text>
                    </Row>
                    <View style={{ marginTop: 7 }}>
                      <Bar pct={(v / maxViews) * 100} />
                    </View>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </Card>

      <SectionTitle title="Notifications" />
      <View style={styles.grid}>
        <Stat label="Sent" value={compact(n.sent)} />
        <Stat label="Delivered" value={compact(n.delivered)} hint={n.deliveryRate} />
        <Stat label="Clicks" value={compact(n.clicks)} />
      </View>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  page: { padding: 16, paddingTop: 4 },
  grid: { flexDirection: 'row', gap: 10 },
  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 22,
    marginBottom: 10,
  },
  rangeTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  rowTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  rowValue: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  topRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  rank: { color: colors.textMuted, fontSize: 13, fontWeight: '800', width: 16, textAlign: 'center' },
});

export default AnalyticsSection;
