import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Switch, Alert, RefreshControl } from 'react-native';
import { TouchableOpacity as GHTouchable } from 'react-native-gesture-handler';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminChannelsAPI } from '../../config/api';
import { channelArtworkUrl } from '../../utils/mediaUrl';
import colors from '../../theme/colors';
import ChannelThumb from '../ui/ChannelThumb';
import ChannelStreamsModal from './ChannelStreamsModal';
import {
  Sheet,
  Button,
  Chip,
  ChipRow,
  SearchBar,
  Field,
  Input,
  Badge,
  Empty,
  Loading,
  toast,
} from '../ui/kit';

/** Sections mirror the user app: free channels first, then one tab per category. */
const SECTIONS = [
  { key: 'bure', label: 'Free', server: 'bure' },
  { key: 'football', label: 'Football', server: 'football', color: '#10b981' },
  { key: 'habari', label: 'News', server: 'habari', color: '#ef4444' },
  { key: 'tamthilia', label: 'Drama', server: 'tamthilia', color: '#ec4899' },
  { key: 'movies', label: 'Movies', server: 'movies', color: '#3b82f6' },
  { key: 'wanyama', label: 'Animals', server: 'wanyama', color: '#22c55e' },
  { key: 'katuni', label: 'Cartoons', server: 'katuni', color: '#f59e0b' },
  { key: 'sayansi', label: 'Science', server: 'sayansi', color: '#8b5cf6' },
];
const CATEGORY_OPTIONS = SECTIONS.filter((s) => s.key !== 'bure');
const DRM_OPTIONS = ['NONE', 'CLEARKEY', 'WIDEVINE', 'PLAYREADY'];

const isFree = (ch) => !!(ch?.unlock_to_free === true || ch?.unlockToFree === true);
const sectionOf = (ch) => {
  if (isFree(ch)) return 'bure';
  const cat = String(ch?.category || 'football').toLowerCase();
  return SECTIONS.some((s) => s.key === cat) ? cat : 'other';
};
// sort_order 0 is a valid position (first) – never treat it as "missing".
const orderValue = (c) => {
  const v = c.sort_order;
  return v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? Number(c.id) : Number(v);
};
const sortByOrder = (list) => [...list].sort((a, b) => orderValue(a) - orderValue(b) || a.id - b.id);
const categoryLabel = (key) => CATEGORY_OPTIONS.find((c) => c.key === key)?.label || key;
const drmOf = (ch) => String(ch?.drm_type ?? ch?.drmType ?? 'NONE').toUpperCase();

const emptyForm = (category = 'football', free = false) => ({
  name: '',
  category,
  streamUrl: '',
  thumbnailUrl: '',
  thumbnailEmoji: '',
  useEmoji: false,
  drmType: 'NONE',
  drmClearKey: '',
  isActive: true,
  unlockToFree: free,
  pointsRequired: '0',
});

const formFromChannel = (ch) => ({
  name: ch.name || '',
  category: ch.category || 'football',
  streamUrl: ch.stream_url || '',
  thumbnailUrl: channelArtworkUrl(ch) || ch.thumbnail_url || '',
  thumbnailEmoji: ch.thumbnail_emoji || '',
  useEmoji: !!ch.thumbnail_emoji,
  drmType: ['CLEARKEY', 'WIDEVINE', 'PLAYREADY'].includes(drmOf(ch)) ? drmOf(ch) : 'NONE',
  drmClearKey: String(ch.drm_clear_key ?? ch.drmClearKey ?? ''),
  isActive: typeof ch.is_active === 'boolean' ? ch.is_active : true,
  unlockToFree: isFree(ch),
  pointsRequired: String(ch.points_required ?? ch.pointsRequired ?? 0),
});

const Row = React.memo(({ item, drag, isActive, canDrag, onEdit, onToggle }) => {
  const drm = drmOf(item);
  const free = isFree(item);
  return (
    <ScaleDecorator activeScale={1.02}>
      <GHTouchable
        activeOpacity={0.85}
        onPress={() => onEdit(item)}
        onLongPress={canDrag ? drag : undefined}
        delayLongPress={220}
        disabled={isActive}
        style={[styles.row, isActive && styles.rowDragging, item.is_active === false && { opacity: 0.55 }]}>
        {canDrag ? (
          <GHTouchable onPressIn={drag} hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }} style={styles.handle}>
            <Icon name="drag-vertical" size={26} color={colors.textMuted} />
          </GHTouchable>
        ) : (
          <View style={{ width: 8 }} />
        )}
        <ChannelThumb
          channel={item}
          emoji={item.thumbnail_emoji}
          size={46}
          radius={12}
          fallbackColor={colors.accent}
        />
        <View style={styles.rowBody}>
          <Text style={styles.rowName} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={styles.rowMeta}>
            <Text style={styles.rowMetaText}>{categoryLabel(item.category)}</Text>
            {free ? <Badge label="Free" tone="accent" /> : null}
            {drm !== 'NONE' ? <Badge label={drm} /> : null}
          </View>
        </View>
        <Switch
          value={item.is_active !== false}
          onValueChange={(v) => onToggle(item, v)}
          trackColor={{ false: colors.borderStrong, true: colors.accentDim }}
          thumbColor={item.is_active !== false ? colors.accent : colors.textMuted}
        />
      </GHTouchable>
    </ScaleDecorator>
  );
});

const ChannelsSection = () => {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [section, setSection] = useState(null);
  const [query, setQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [streamsChannel, setStreamsChannel] = useState(null);
  const saveQueue = useRef(Promise.resolve());
  const channelsRef = useRef([]);
  channelsRef.current = channels;

  const load = useCallback(async () => {
    try {
      const data = await adminChannelsAPI.getChannels();
      setChannels(sortByOrder(Array.isArray(data) ? data : []));
    } catch (e) {
      toast('Could not load channels');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c = {};
    channels.forEach((ch) => {
      const k = sectionOf(ch);
      c[k] = (c[k] || 0) + 1;
    });
    return c;
  }, [channels]);

  // Default to the first section that has channels.
  useEffect(() => {
    if (section == null && channels.length) {
      const first = SECTIONS.find((s) => counts[s.key]);
      setSection(first ? first.key : 'football');
    }
  }, [channels.length, counts, section]);

  const searching = query.trim().length > 0;
  const visible = useMemo(() => {
    if (searching) {
      const q = query.trim().toLowerCase();
      return channels.filter((c) => String(c.name || '').toLowerCase().includes(q));
    }
    return channels.filter((c) => sectionOf(c) === section);
  }, [channels, section, query, searching]);

  const sectionDef = SECTIONS.find((s) => s.key === section);
  const canDrag = !searching && !!sectionDef && visible.length > 1;

  const persistOrder = useCallback(
    (serverSection, ids) => {
      saveQueue.current = saveQueue.current.then(async () => {
        try {
          const all = channelsRef.current.map((c) => c.id);
          await adminChannelsAPI.reorderChannels(ids, { section: serverSection, fullOrderIds: all });
          toast('Order saved');
        } catch (e) {
          toast('Could not save order – restored');
          await load();
        }
      });
    },
    [load],
  );

  const onDragEnd = useCallback(
    ({ data }) => {
      if (!sectionDef) return;
      const prev = channelsRef.current;
      // Put the reordered section back into the same slots of the global list.
      const slots = [];
      prev.forEach((c, i) => {
        if (sectionOf(c) === section) slots.push(i);
      });
      const next = [...prev];
      slots.forEach((slot, i) => {
        next[slot] = data[i];
      });
      setChannels(next);
      persistOrder(sectionDef.server, data.map((c) => c.id));
    },
    [section, sectionDef, persistOrder],
  );

  const toggleActive = useCallback(async (ch, value) => {
    setChannels((prev) => prev.map((c) => (c.id === ch.id ? { ...c, is_active: value } : c)));
    try {
      await adminChannelsAPI.updateChannel(ch.id, { isActive: value });
    } catch (e) {
      setChannels((prev) => prev.map((c) => (c.id === ch.id ? { ...c, is_active: !value } : c)));
      toast('Could not update channel');
    }
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm(sectionDef && sectionDef.key !== 'bure' ? sectionDef.key : 'football', section === 'bure'));
    setSheetOpen(true);
  };

  const openEdit = useCallback((ch) => {
    setEditing(ch);
    setForm(formFromChannel(ch));
    setSheetOpen(true);
  }, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    const f = form;
    if (!f.name.trim()) return toast('Enter a channel name');
    if (!f.streamUrl.trim()) return toast('Enter the stream URL');
    if (f.useEmoji ? !f.thumbnailEmoji.trim() : !f.thumbnailUrl.trim()) {
      return toast(f.useEmoji ? 'Enter an emoji' : 'Enter a thumbnail URL');
    }
    if (f.drmType === 'CLEARKEY' && !f.drmClearKey.trim()) return toast('ClearKey needs kid:key');

    const points = parseInt(f.pointsRequired || '0', 10);
    const payload = {
      name: f.name.trim(),
      category: f.category,
      streamUrl: f.streamUrl.trim(),
      color: CATEGORY_OPTIONS.find((c) => c.key === f.category)?.color || '#7c3aed',
      isActive: f.isActive,
      drmType: f.drmType,
      drmClearKey: f.drmType === 'CLEARKEY' ? f.drmClearKey.trim() : null,
      pointsRequired: Number.isNaN(points) ? 0 : Math.max(0, points),
      unlockToFree: !!f.unlockToFree,
    };
    if (f.useEmoji) {
      payload.thumbnailEmoji = f.thumbnailEmoji.trim();
      if (editing) payload.thumbnailUrl = null;
    } else {
      payload.thumbnailUrl = f.thumbnailUrl.trim();
      if (editing) payload.thumbnailEmoji = null;
    }
    if (editing) payload.streamAlias = null;

    setSaving(true);
    try {
      if (editing) await adminChannelsAPI.updateChannel(editing.id, payload);
      else await adminChannelsAPI.createChannel(payload);
      toast(editing ? 'Channel updated' : 'Channel added');
      setSheetOpen(false);
      await load();
    } catch (e) {
      toast(String(e?.message || 'Save failed').slice(0, 100));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!editing) return;
    Alert.alert('Delete channel?', `"${editing.name}" will be removed for all users.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await adminChannelsAPI.deleteChannel(editing.id);
            setChannels((prev) => prev.filter((c) => c.id !== editing.id));
            setSheetOpen(false);
            toast('Channel deleted');
          } catch (e) {
            toast('Could not delete');
          }
        },
      },
    ]);
  };

  const renderItem = useCallback(
    ({ item, drag, isActive }) => (
      <Row
        item={item}
        drag={drag}
        isActive={isActive}
        canDrag={canDrag}
        onEdit={openEdit}
        onToggle={toggleActive}
      />
    ),
    [canDrag, openEdit, toggleActive],
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.head}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <SearchBar
            style={{ flex: 1 }}
            value={query}
            onChangeText={setQuery}
            placeholder="Search channels"
          />
          <Button icon="plus" label="Add" onPress={openNew} style={styles.addBtn} />
        </View>
        {!searching ? (
          <View style={{ marginTop: 12 }}>
            <ChipRow>
              {SECTIONS.map((s) => (
                <Chip
                  key={s.key}
                  label={s.label}
                  count={counts[s.key] || 0}
                  active={section === s.key}
                  onPress={() => setSection(s.key)}
                />
              ))}
              {counts.other ? (
                <Chip
                  label="Other"
                  count={counts.other}
                  active={section === 'other'}
                  onPress={() => setSection('other')}
                />
              ) : null}
            </ChipRow>
          </View>
        ) : null}
        {canDrag ? (
          <Text style={styles.hint}>
            <Icon name="gesture-tap-hold" size={12} color={colors.textMuted} /> Hold a channel or use the handle, then drag. Saved automatically.
          </Text>
        ) : null}
      </View>

      {loading ? (
        <Loading />
      ) : (
        <DraggableFlatList
          data={visible}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          onDragEnd={onDragEnd}
          activationDistance={12}
          autoscrollThreshold={80}
          autoscrollSpeed={160}
          containerStyle={{ flex: 1 }}
          contentContainerStyle={styles.list}
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
          }
          ListEmptyComponent={
            <Empty
              icon="television-off"
              title={searching ? 'No matches' : 'No channels here'}
              sub={searching ? undefined : 'Tap Add to create one'}
            />
          }
        />
      )}

      <Sheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editing ? 'Edit channel' : 'New channel'}
        full
        footer={
          <>
            {editing ? (
              <>
                <Button
                  variant="secondary"
                  icon="playlist-edit"
                  onPress={() => {
                    setSheetOpen(false);
                    setStreamsChannel(editing);
                  }}
                />
                <Button variant="danger" icon="trash-can-outline" onPress={confirmDelete} />
              </>
            ) : null}
            <Button label="Save" onPress={save} loading={saving} style={{ flex: 1 }} />
          </>
        }>
        <Field label="Name">
          <Input value={form.name} onChangeText={(v) => set({ name: v })} placeholder="Channel name" autoCapitalize="words" />
        </Field>

        <Field label="Section">
          <ChipRow>
            {CATEGORY_OPTIONS.map((c) => (
              <Chip
                key={c.key}
                label={c.label}
                active={form.category === c.key}
                onPress={() => set({ category: c.key })}
              />
            ))}
          </ChipRow>
        </Field>

        <Field label="Stream URL">
          <Input
            value={form.streamUrl}
            onChangeText={(v) => set({ streamUrl: v })}
            placeholder="https://…"
            keyboardType="url"
          />
        </Field>

        <Field label="Thumbnail">
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <Chip label="Image URL" active={!form.useEmoji} onPress={() => set({ useEmoji: false })} />
            <Chip label="Emoji" active={form.useEmoji} onPress={() => set({ useEmoji: true })} />
          </View>
          {form.useEmoji ? (
            <Input
              value={form.thumbnailEmoji}
              onChangeText={(v) => set({ thumbnailEmoji: v })}
              placeholder="⚽"
              maxLength={8}
            />
          ) : (
            <Input
              value={form.thumbnailUrl}
              onChangeText={(v) => set({ thumbnailUrl: v })}
              placeholder="https://…"
              keyboardType="url"
            />
          )}
        </Field>

        <Field label="DRM">
          <ChipRow>
            {DRM_OPTIONS.map((d) => (
              <Chip
                key={d}
                label={d === 'NONE' ? 'None' : d}
                active={form.drmType === d}
                onPress={() => set({ drmType: d })}
              />
            ))}
          </ChipRow>
        </Field>
        {form.drmType === 'CLEARKEY' ? (
          <Field label="ClearKey" hint="kid:key, hex">
            <Input
              value={form.drmClearKey}
              onChangeText={(v) => set({ drmClearKey: v })}
              placeholder="kid:key"
            />
          </Field>
        ) : null}

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>Free for everyone</Text>
            <Text style={styles.switchSub}>Shown in the free section</Text>
          </View>
          <Switch
            value={form.unlockToFree}
            onValueChange={(v) => set({ unlockToFree: v })}
            trackColor={{ false: colors.borderStrong, true: colors.accentDim }}
            thumbColor={form.unlockToFree ? colors.accent : colors.textMuted}
          />
        </View>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>Active</Text>
            <Text style={styles.switchSub}>Hidden from users when off</Text>
          </View>
          <Switch
            value={form.isActive}
            onValueChange={(v) => set({ isActive: v })}
            trackColor={{ false: colors.borderStrong, true: colors.accentDim }}
            thumbColor={form.isActive ? colors.accent : colors.textMuted}
          />
        </View>

        <Field label="Points to unlock">
          <Input
            value={form.pointsRequired}
            onChangeText={(v) => set({ pointsRequired: v.replace(/[^0-9]/g, '') })}
            keyboardType="number-pad"
          />
        </Field>
      </Sheet>

      <ChannelStreamsModal
        visible={!!streamsChannel}
        channel={streamsChannel}
        onClose={() => {
          setStreamsChannel(null);
          load();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  head: { paddingHorizontal: 16, paddingBottom: 8 },
  addBtn: { height: 44, paddingHorizontal: 14 },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 10 },
  list: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingRight: 12,
    paddingLeft: 4,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowDragging: { borderColor: colors.accent, backgroundColor: colors.panelMuted },
  handle: { paddingHorizontal: 2, paddingVertical: 8 },
  rowBody: { flex: 1 },
  rowName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  rowMetaText: { color: colors.textMuted, fontSize: 12 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 6,
  },
  switchTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  switchSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});

export default ChannelsSection;
