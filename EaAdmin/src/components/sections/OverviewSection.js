import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { dashboardAPI, adminChannelsAPI, adminUsersAPI } from '../../config/api';
import colors from '../../theme/colors';
import {
  Card,
  SectionTitle,
  Stat,
  Row,
  Divider,
  Bar,
  Badge,
  Empty,
  compact,
  formatTsh,
  timeAgo,
  toast,
} from '../ui/kit';
import ChannelThumb from '../ui/ChannelThumb';

const QuickAction = ({ icon, label, onPress, busy }) => (
  <TouchableOpacity
    style={styles.action}
    activeOpacity={0.8}
    onPress={onPress}
    disabled={busy}>
    <View style={styles.actionIcon}>
      <Icon name={busy ? 'timer-sand' : icon} size={20} color={colors.accent} />
    </View>
    <Text style={styles.actionLabel} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

const statusTone = (s) => {
  const v = String(s || '').toLowerCase();
  if (v.includes('complete') || v.includes('success')) return 'success';
  if (v.includes('fail') || v.includes('cancel')) return 'danger';
  return 'warning';
};

const OverviewSection = ({ refreshKey, onNavigate, onNotify }) => {
  const [stats, setStats] = useState(null);
  const [channels, setChannels] = useState([]);
  const [payments, setPayments] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [reminding, setReminding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, ch, tx] = await Promise.all([
        dashboardAPI.getStats(),
        adminChannelsAPI.getChannels().catch(() => []),
        dashboardAPI.getTransactions(8).catch(() => ({ transactions: [] })),
      ]);
      setStats(s);
      setChannels(Array.isArray(ch) ? ch : []);
      setPayments(Array.isArray(tx?.transactions) ? tx.transactions : []);
    } catch (e) {
      console.warn('Overview load failed', e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const remindExpired = () => {
    Alert.alert(
      'Remind expired users?',
      'Sends a renewal reminder to everyone whose subscription has expired.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            setReminding(true);
            try {
              const res = await adminUsersAPI.remindExpiredSubscriptions({ force: true });
              toast(
                res?.ok === false
                  ? res.message || 'Push not configured'
                  : `Reminder sent · ${res?.sent ?? 0} delivered`,
              );
            } catch (e) {
              toast(e?.message || 'Could not send');
            } finally {
              setReminding(false);
            }
          },
        },
      ],
    );
  };

  const topChannels = [...channels]
    .filter((c) => c.is_active !== false)
    .sort((a, b) => (Number(b.view_count) || 0) - (Number(a.view_count) || 0))
    .slice(0, 5);
  const maxViews = Math.max(1, ...topChannels.map((c) => Number(c.view_count) || 0));

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
      <Card style={styles.hero}>
        <Text style={styles.heroLabel}>Revenue today</Text>
        <Text style={styles.heroValue}>{formatTsh(stats?.todayRevenue ?? stats?.revenue ?? 0)}</Text>
        <Text style={styles.heroSub}>
          {stats?.completedPaymentsToday ?? 0} payments today · {formatTsh(stats?.allTimeRevenue ?? 0)} all time
        </Text>
      </Card>

      <View style={styles.grid}>
        <Stat label="Total users" value={compact(stats?.totalUsers)} icon="account-group-outline" />
        <Stat label="Premium" value={compact(stats?.premiumUsers)} icon="crown-outline" />
      </View>
      <View style={[styles.grid, { marginTop: 10 }]}>
        <Stat label="New today" value={compact(stats?.todayInstalls)} icon="account-plus-outline" />
        <Stat label="Expired" value={compact(stats?.expiredSubscriptions)} icon="timer-off-outline" />
      </View>

      <SectionTitle title="Quick actions" />
      <View style={styles.actions}>
        <QuickAction icon="bell-ring-outline" label="Notify all" onPress={onNotify} />
        <QuickAction
          icon="account-clock-outline"
          label="Remind expired"
          onPress={remindExpired}
          busy={reminding}
        />
        <QuickAction icon="plus" label="Channels" onPress={() => onNavigate('channels')} />
        <QuickAction icon="home-edit-outline" label="Home" onPress={() => onNavigate('home')} />
      </View>

      <SectionTitle title="Top channels" action="All" onAction={() => onNavigate('channels')} />
      <Card padded={false}>
        {topChannels.length === 0 ? (
          <Empty icon="television-off" title="No channels yet" />
        ) : (
          topChannels.map((ch, i) => {
            const views = Number(ch.view_count) || 0;
            return (
              <View key={ch.id}>
                {i > 0 ? <Divider /> : null}
                <Row style={styles.listRow}>
                  <ChannelThumb
                    channel={ch}
                    emoji={ch.thumbnail_emoji}
                    size={38}
                    radius={10}
                    fallbackColor={colors.accent}
                  />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {ch.name}
                      </Text>
                      <Text style={styles.rowValue}>{compact(views)}</Text>
                    </Row>
                    <View style={{ marginTop: 7 }}>
                      <Bar pct={(views / maxViews) * 100} />
                    </View>
                  </View>
                </Row>
              </View>
            );
          })
        )}
      </Card>

      <SectionTitle title="Recent payments" action="Users" onAction={() => onNavigate('users')} />
      <Card padded={false}>
        {payments.length === 0 ? (
          <Empty icon="cash-remove" title="No payments yet" />
        ) : (
          payments.map((tx, i) => (
            <View key={`${tx.id}-${i}`}>
              {i > 0 ? <Divider /> : null}
              <Row style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {tx.userExternalId || `User #${tx.userId}`}
                  </Text>
                  <Text style={styles.rowSub}>
                    {timeAgo(tx.completedAt || tx.createdAt)}
                    {tx.userNumber ? ` · ${tx.userNumber}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={styles.rowValue}>
                    {tx.amountFormatted || formatTsh(tx.amountTsh)}
                  </Text>
                  <Badge label={tx.statusLabel || tx.status || 'pending'} tone={statusTone(tx.status)} />
                </View>
              </Row>
            </View>
          ))
        )}
      </Card>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  page: { padding: 16, paddingTop: 4 },
  hero: { paddingVertical: 20, marginBottom: 10 },
  heroLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  heroValue: {
    color: colors.accent,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1,
    marginTop: 6,
  },
  heroSub: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
  grid: { flexDirection: 'row', gap: 10 },
  actions: { flexDirection: 'row', gap: 10 },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  listRow: { paddingHorizontal: 14, paddingVertical: 12 },
  rowTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  rowSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  rowValue: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
});

export default OverviewSection;
