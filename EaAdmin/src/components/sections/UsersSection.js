import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Alert, ActivityIndicator } from 'react-native';
import { adminUsersAPI, dashboardAPI } from '../../config/api';
import colors from '../../theme/colors';
import {
  Sheet,
  Button,
  Chip,
  ChipRow,
  SearchBar,
  Field,
  Input,
  Badge,
  Avatar,
  Empty,
  Loading,
  Row as KitRow,
  compact,
  timeAgo,
  toast,
} from '../ui/kit';

const PAGE = 50;
const UNITS = ['hours', 'days', 'weeks', 'months'];
const PRESETS = [
  { label: '+1 day', n: 1, unit: 'days' },
  { label: '+7 days', n: 7, unit: 'days' },
  { label: '+30 days', n: 30, unit: 'days' },
];

const statusOf = (u) => {
  if (u.blocked === true || u.blocked === 't' || u.blocked === 1) return 'Blocked';
  const exp = u.premium_expires_at ? new Date(u.premium_expires_at) : null;
  const now = new Date();
  if (u.is_premium === true && (!exp || exp > now)) return 'Premium';
  if (exp && exp <= now) return 'Expired';
  return 'Free';
};
const toneOf = (s) =>
  s === 'Premium' ? 'accent' : s === 'Blocked' ? 'danger' : s === 'Expired' ? 'warning' : 'neutral';

const initialsOf = (u) => {
  const id = String(u.external_id || u.externalId || `U${u.id}`);
  const parts = id.split('-');
  return (parts[1] || id).slice(0, 2);
};

const formatDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const UserRow = React.memo(({ user, onPress }) => {
  const status = statusOf(user);
  const exp = user.premium_expires_at;
  return (
    <TouchableOpacity activeOpacity={0.8} style={styles.userRow} onPress={() => onPress(user)}>
      <Avatar text={initialsOf(user)} />
      <View style={{ flex: 1 }}>
        <Text style={styles.userName} numberOfLines={1}>
          {user.external_id || `User-${user.id}`}
        </Text>
        <Text style={styles.userSub} numberOfLines={1}>
          Joined {timeAgo(user.created_at) || '—'}
          {exp && status !== 'Free' ? ` · until ${formatDate(exp)}` : ''}
        </Text>
      </View>
      <Badge label={status} tone={toneOf(status)} />
    </TouchableOpacity>
  );
});

const UsersSection = () => {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [customN, setCustomN] = useState('');
  const [customUnit, setCustomUnit] = useState('days');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDays, setBulkDays] = useState('7');
  const [bulkMode, setBulkMode] = useState('all');
  const [bulkCount, setBulkCount] = useState(null);
  const [reminding, setReminding] = useState(false);
  const gen = useRef(0);
  const endReached = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await dashboardAPI.getStats());
    } catch (_) {}
  }, []);

  const loadFirst = useCallback(async () => {
    const g = ++gen.current;
    endReached.current = false;
    try {
      const res = await dashboardAPI.getUsers(PAGE, 0, filter, debounced);
      if (g !== gen.current) return;
      const list = Array.isArray(res?.users) ? res.users : [];
      setUsers(list);
      setTotal(Number(res?.total) || list.length);
      if (list.length < PAGE) endReached.current = true;
    } catch (e) {
      if (g === gen.current) toast('Could not load users');
    } finally {
      if (g === gen.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filter, debounced]);

  useEffect(() => {
    setLoading(true);
    loadFirst();
  }, [loadFirst]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || endReached.current) return;
    const g = gen.current;
    setLoadingMore(true);
    try {
      const res = await dashboardAPI.getUsers(PAGE, users.length, filter, debounced);
      if (g !== gen.current) return;
      const list = Array.isArray(res?.users) ? res.users : [];
      if (list.length < PAGE) endReached.current = true;
      setUsers((prev) => {
        const seen = new Set(prev.map((u) => u.id));
        return [...prev, ...list.filter((u) => !seen.has(u.id))];
      });
    } catch (_) {
      endReached.current = true;
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loading, users.length, filter, debounced]);

  const refreshAll = () => {
    setRefreshing(true);
    loadFirst();
    loadStats();
  };

  const afterChange = () => {
    loadFirst();
    loadStats();
  };

  const filters = useMemo(
    () => [
      { id: 'all', label: 'All', count: stats?.totalUsers },
      { id: 'premium', label: 'Premium', count: stats?.premiumUsers },
      { id: 'free', label: 'Free', count: stats?.freeUsers },
      { id: 'expired', label: 'Expired', count: stats?.expiredSubscriptions },
      { id: 'blocked', label: 'Blocked', count: stats?.blockedUsers },
    ],
    [stats],
  );

  const grant = async (n, unit) => {
    const duration = Math.floor(Number(n));
    if (!selected || !Number.isFinite(duration) || duration <= 0) return toast('Enter a valid number');
    setBusy(true);
    try {
      await adminUsersAPI.giveSpecialAccess(Number(selected.id), duration, unit);
      toast(`Added ${duration} ${unit}`);
      setSelected(null);
      setCustomN('');
      afterChange();
    } catch (e) {
      toast(String(e?.message || 'Could not grant access').slice(0, 100));
    } finally {
      setBusy(false);
    }
  };

  const setBlocked = async (blocked) => {
    if (!selected) return;
    setBusy(true);
    try {
      await adminUsersAPI.blockUser(selected.id, blocked);
      toast(blocked ? 'User blocked' : 'User unblocked');
      setSelected(null);
      afterChange();
    } catch (e) {
      toast('Could not update user');
    } finally {
      setBusy(false);
    }
  };

  const remindOne = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await adminUsersAPI.remindExpiredSubscriptions({ userId: selected.id, force: true });
      toast(res?.sent > 0 ? 'Reminder sent' : res?.message || 'No push delivered');
      if (res?.sent > 0) setSelected(null);
    } catch (e) {
      toast('Could not send reminder');
    } finally {
      setBusy(false);
    }
  };

  const remindAllExpired = () => {
    Alert.alert('Remind all expired users?', 'Sends a renewal reminder to every expired subscriber.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send',
        onPress: async () => {
          setReminding(true);
          try {
            const res = await adminUsersAPI.remindExpiredSubscriptions({ force: true });
            toast(res?.ok === false ? res.message || 'Push unavailable' : `Sent · ${res?.sent ?? 0} delivered`);
          } catch (e) {
            toast('Could not send reminders');
          } finally {
            setReminding(false);
          }
        },
      },
    ]);
  };

  const bulkPayload = (dryRun) => {
    const payload = dryRun ? { dryRun: true } : {};
    if (bulkMode === 'before') {
      const d = Math.floor(Number(bulkDays));
      if (!Number.isFinite(d) || d <= 0) return null;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - d);
      payload.joinedBefore = cutoff.toISOString();
    }
    return payload;
  };

  const previewBulk = async () => {
    const payload = bulkPayload(true);
    if (!payload) return toast('Enter a valid number of days');
    setBusy(true);
    try {
      const res = await adminUsersAPI.bulkDowngradeUsers(payload);
      setBulkCount(Number(res?.affectedCount) || 0);
    } catch (e) {
      toast('Preview failed');
    } finally {
      setBusy(false);
    }
  };

  const runBulk = async () => {
    const payload = bulkPayload(false);
    if (!payload) return;
    setBusy(true);
    try {
      const res = await adminUsersAPI.bulkDowngradeUsers(payload);
      toast(`${res?.downgradedCount ?? 0} users moved to Free`);
      setBulkOpen(false);
      setBulkCount(null);
      afterChange();
    } catch (e) {
      toast('Downgrade failed');
    } finally {
      setBusy(false);
    }
  };

  const status = selected ? statusOf(selected) : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.head}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search by user ID" />
        <View style={{ marginTop: 12 }}>
          <ChipRow>
            {filters.map((f) => (
              <Chip
                key={f.id}
                label={f.label}
                count={f.count != null ? compact(f.count) : undefined}
                active={filter === f.id}
                onPress={() => setFilter(f.id)}
              />
            ))}
          </ChipRow>
        </View>
        <KitRow style={styles.toolbar}>
          <Text style={styles.total}>{compact(total)} users</Text>
          <View style={{ flex: 1 }} />
          <Button
            small
            variant="secondary"
            icon="account-clock-outline"
            label="Remind expired"
            onPress={remindAllExpired}
            loading={reminding}
          />
          <Button
            small
            variant="ghost"
            icon="account-arrow-down-outline"
            onPress={() => {
              setBulkCount(null);
              setBulkOpen(true);
            }}
          />
        </KitRow>
      </View>

      {loading ? (
        <Loading />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => String(u.id)}
          renderItem={({ item }) => <UserRow user={item} onPress={setSelected} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          initialNumToRender={14}
          windowSize={9}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.accent} />
          }
          ListEmptyComponent={<Empty icon="account-search-outline" title="No users found" />}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.accent} style={{ margin: 16 }} /> : null
          }
        />
      )}

      <Sheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.external_id || `User-${selected?.id}`}>
        {selected ? (
          <>
            <View style={styles.infoGrid}>
              <View style={styles.infoCell}>
                <Text style={styles.infoLabel}>Status</Text>
                <Badge label={status} tone={toneOf(status)} />
              </View>
              <View style={styles.infoCell}>
                <Text style={styles.infoLabel}>Premium until</Text>
                <Text style={styles.infoValue}>{formatDate(selected.premium_expires_at)}</Text>
              </View>
              <View style={styles.infoCell}>
                <Text style={styles.infoLabel}>Joined</Text>
                <Text style={styles.infoValue}>{formatDate(selected.created_at)}</Text>
              </View>
              <View style={styles.infoCell}>
                <Text style={styles.infoLabel}>Phone</Text>
                <Text style={styles.infoValue} numberOfLines={1}>
                  {selected.payment_phones || selected.paymentPhones || '—'}
                </Text>
              </View>
            </View>

            <Text style={styles.groupTitle}>Give premium access</Text>
            <View style={styles.presetRow}>
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  small
                  variant="secondary"
                  label={p.label}
                  disabled={busy}
                  style={{ flex: 1 }}
                  onPress={() => grant(p.n, p.unit)}
                />
              ))}
            </View>
            <View style={styles.customRow}>
              <Input
                style={{ flex: 1 }}
                value={customN}
                onChangeText={(v) => setCustomN(v.replace(/[^0-9]/g, ''))}
                placeholder="Custom amount"
                keyboardType="number-pad"
              />
              <Button label="Add" onPress={() => grant(customN, customUnit)} loading={busy} style={{ width: 84 }} />
            </View>
            <View style={{ marginTop: 10 }}>
              <ChipRow>
                {UNITS.map((u) => (
                  <Chip key={u} label={u} active={customUnit === u} onPress={() => setCustomUnit(u)} />
                ))}
              </ChipRow>
            </View>

            <Text style={styles.groupTitle}>Actions</Text>
            {status === 'Expired' || status === 'Free' ? (
              <Button
                variant="secondary"
                icon="bell-ring-outline"
                label="Send renewal reminder"
                onPress={remindOne}
                disabled={busy}
                style={{ marginBottom: 10 }}
              />
            ) : null}
            {status === 'Blocked' ? (
              <Button
                variant="secondary"
                icon="lock-open-outline"
                label="Unblock user"
                onPress={() => setBlocked(false)}
                disabled={busy}
              />
            ) : (
              <Button
                variant="danger"
                icon="block-helper"
                label="Block user"
                onPress={() =>
                  Alert.alert('Block user?', 'They lose access and their subscription is cleared.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Block', style: 'destructive', onPress: () => setBlocked(true) },
                  ])
                }
                disabled={busy}
              />
            )}
          </>
        ) : null}
      </Sheet>

      <Sheet
        visible={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Reset premium to Free"
        footer={
          bulkCount == null ? (
            <Button label="Preview" onPress={previewBulk} loading={busy} style={{ flex: 1 }} />
          ) : (
            <>
              <Button variant="secondary" label="Back" onPress={() => setBulkCount(null)} />
              <Button
                variant="danger"
                label={`Downgrade ${bulkCount}`}
                onPress={runBulk}
                loading={busy}
                disabled={bulkCount === 0}
                style={{ flex: 1 }}
              />
            </>
          )
        }>
        <Text style={styles.bulkText}>
          Clears premium for many users at once. You will see how many are affected before anything changes.
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          <Chip label="All premium users" active={bulkMode === 'all'} onPress={() => setBulkMode('all')} />
          <Chip label="Joined before…" active={bulkMode === 'before'} onPress={() => setBulkMode('before')} />
        </View>
        {bulkMode === 'before' ? (
          <Field label="Joined more than (days) ago">
            <Input
              value={bulkDays}
              onChangeText={(v) => setBulkDays(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
            />
          </Field>
        ) : null}
        {bulkCount != null ? (
          <Text style={styles.bulkResult}>{bulkCount} user(s) will be moved to Free.</Text>
        ) : null}
      </Sheet>
    </View>
  );
};

const styles = StyleSheet.create({
  head: { paddingHorizontal: 16, paddingBottom: 6 },
  toolbar: { marginTop: 12, gap: 8 },
  total: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userName: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  userSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoCell: {
    width: '48%',
    flexGrow: 1,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'flex-start',
    gap: 6,
  },
  infoLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  infoValue: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  groupTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 22,
    marginBottom: 10,
  },
  presetRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  customRow: { flexDirection: 'row', gap: 8 },
  bulkText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 16 },
  bulkResult: { color: colors.warning, fontSize: 14, fontWeight: '600', marginTop: 4 },
});

export default UsersSection;
