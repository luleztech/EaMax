import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Switch,
  Alert,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminPromotionsAPI } from '../../config/api';

const PRIORITY_LABELS = {
  1: 'Critical',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

const TYPES = [
  { id: 'image', label: 'Image', icon: 'image-outline' },
  { id: 'text', label: 'Text', icon: 'format-text' },
  { id: 'announcement', label: 'Announcement', icon: 'bullhorn-outline' },
  { id: 'force_update', label: 'Force Update', icon: 'update' },
];

const STYLES = [
  { id: 'dark_glass', label: 'Dark Glass' },
  { id: 'gold', label: 'Gold Premium' },
  { id: 'premium_blue', label: 'Premium Blue' },
  { id: 'red_alert', label: 'Red Alert' },
  { id: 'green_success', label: 'Green Success' },
];

const SHOW_MODES = [
  { id: 'every_launch', label: 'Every launch' },
  { id: 'daily', label: 'Once per day' },
  { id: 'once', label: 'Show once' },
];

const TARGETS = [
  { id: 'all', label: 'All users' },
  { id: 'free', label: 'Free users' },
  { id: 'premium', label: 'Premium users' },
  { id: 'android', label: 'Android only' },
  { id: 'version', label: 'Version targeting' },
];

const emptyForm = () => ({
  title: '',
  description: '',
  imageUrl: '',
  buttonText: 'Watch Now',
  buttonUrl: '',
  type: 'text',
  priority: 3,
  isActive: true,
  showMode: 'daily',
  startAt: '',
  endAt: '',
  targetAudience: 'all',
  targetMaxVersion: '',
  targetMinVersion: '',
  backgroundStyle: 'dark_glass',
  forceUpdate: false,
  minRequiredVersion: '',
});

const PromotionSection = () => {
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([
        adminPromotionsAPI.getStats(),
        adminPromotionsAPI.list(),
      ]);
      setStats(s || {});
      setItems(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error('Promotions load:', e);
      Alert.alert('Error', e?.message || 'Failed to load promotions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      title: item.title || '',
      description: item.description || '',
      imageUrl: item.imageUrl || '',
      buttonText: item.buttonText || 'Learn More',
      buttonUrl: item.buttonUrl || '',
      type: item.type || 'text',
      priority: item.priority || 3,
      isActive: item.isActive !== false,
      showMode: item.showMode || 'daily',
      startAt: item.startAt ? String(item.startAt).slice(0, 16) : '',
      endAt: item.endAt ? String(item.endAt).slice(0, 16) : '',
      targetAudience: item.targetAudience || 'all',
      targetMaxVersion: item.targetMaxVersion || '',
      targetMinVersion: item.targetMinVersion || '',
      backgroundStyle: item.backgroundStyle || 'dark_glass',
      forceUpdate: !!item.forceUpdate,
      minRequiredVersion: item.minRequiredVersion || '',
    });
    setModalOpen(true);
  };

  const buildPayload = () => ({
    title: form.title.trim(),
    description: form.description.trim(),
    imageUrl: form.imageUrl.trim() || null,
    buttonText: form.buttonText.trim() || 'Learn More',
    buttonUrl: form.buttonUrl.trim() || null,
    type: form.type,
    priority: Number(form.priority) || 3,
    isActive: !!form.isActive,
    showMode: form.showMode,
    startAt: form.startAt.trim() || null,
    endAt: form.endAt.trim() || null,
    targetAudience: form.targetAudience,
    targetMaxVersion:
      form.targetAudience === 'version' ? form.targetMaxVersion.trim() || null : null,
    targetMinVersion: form.targetMinVersion.trim() || null,
    backgroundStyle: form.backgroundStyle,
    forceUpdate: form.type === 'force_update' ? true : !!form.forceUpdate,
    minRequiredVersion: form.minRequiredVersion.trim() || null,
  });

  const handleSave = async () => {
    if (!form.title.trim()) {
      Alert.alert('Validation', 'Title is required');
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      if (editing?.id) {
        await adminPromotionsAPI.update(editing.id, payload);
      } else {
        await adminPromotionsAPI.create(payload);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      Alert.alert('Save failed', e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (item) => {
    Alert.alert('Delete promotion', `Remove "${item.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await adminPromotionsAPI.remove(item.id);
            await load();
          } catch (e) {
            Alert.alert('Error', e?.message || 'Delete failed');
          }
        },
      },
    ]);
  };

  const handleToggle = async (item) => {
    try {
      await adminPromotionsAPI.toggle(item.id, !item.isActive);
      await load();
    } catch (e) {
      Alert.alert('Error', e?.message || 'Toggle failed');
    }
  };

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#a78bfa" />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={styles.scroll}>
        <View style={styles.statsRow}>
          <StatCard label="Views" value={stats?.totalViews} icon="eye-outline" color="#60a5fa" />
          <StatCard label="Clicks" value={stats?.totalClicks} icon="cursor-default-click" color="#34d399" />
        </View>
        <View style={styles.statsRow}>
          <StatCard label="Active" value={stats?.activePromotions} icon="lightning-bolt" color="#fbbf24" />
          <StatCard label="Expired" value={stats?.expiredPromotions} icon="clock-alert-outline" color="#f87171" />
        </View>
        {stats?.ctrPercent != null ? (
          <Text style={styles.ctrText}>CTR {stats.ctrPercent}% across all promotions</Text>
        ) : null}

        <TouchableOpacity style={styles.createBtn} onPress={openCreate} activeOpacity={0.85}>
          <LinearGradient colors={['#8b5cf6', '#6d28d9']} style={styles.createGrad}>
            <Icon name="plus" size={22} color="#fff" />
            <Text style={styles.createText}>Create Promotion</Text>
          </LinearGradient>
        </TouchableOpacity>

        {items.length === 0 ? (
          <Text style={styles.empty}>No promotions yet. Create your first campaign.</Text>
        ) : (
          items.map((item) => (
            <View key={String(item.id)} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardMeta}>
                    {PRIORITY_LABELS[item.priority] || 'Medium'} · {item.type} · {item.showMode}
                  </Text>
                  <Text style={styles.cardStats}>
                    {item.viewsCount} views · {item.clicksCount} clicks · {item.closeCount} closes
                  </Text>
                </View>
                <Switch
                  value={!!item.isActive}
                  onValueChange={() => handleToggle(item)}
                  trackColor={{ true: '#8b5cf6' }}
                />
              </View>
              <View style={styles.cardActions}>
                <TouchableOpacity onPress={() => openEdit(item)} style={styles.iconBtn}>
                  <Icon name="pencil-outline" size={20} color="#a78bfa" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(item)} style={styles.iconBtn}>
                  <Icon name="delete-outline" size={20} color="#f87171" />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>{editing ? 'Edit Promotion' : 'New Promotion'}</Text>

              <Label>Type</Label>
              <View style={styles.chipRow}>
                {TYPES.map((t) => (
                  <Chip
                    key={t.id}
                    label={t.label}
                    active={form.type === t.id}
                    onPress={() => {
                      setField('type', t.id);
                      if (t.id === 'force_update') {
                        setField('forceUpdate', true);
                        setField('showMode', 'every_launch');
                        setField('priority', 1);
                      }
                    }}
                  />
                ))}
              </View>

              <Field label="Title *" value={form.title} onChangeText={(v) => setField('title', v)} />
              <Field
                label="Description"
                value={form.description}
                onChangeText={(v) => setField('description', v)}
                multiline
              />
              {form.type === 'image' ? (
                <Field
                  label="Image URL (PNG/JPG/WEBP)"
                  value={form.imageUrl}
                  onChangeText={(v) => setField('imageUrl', v)}
                  placeholder="https://..."
                />
              ) : null}

              <Field label="Button text" value={form.buttonText} onChangeText={(v) => setField('buttonText', v)} />
              <Field
                label="Button URL (Play Store / link)"
                value={form.buttonUrl}
                onChangeText={(v) => setField('buttonUrl', v)}
                placeholder="https://..."
              />

              <Label>Priority</Label>
              <View style={styles.chipRow}>
                {[1, 2, 3, 4].map((p) => (
                  <Chip
                    key={p}
                    label={PRIORITY_LABELS[p]}
                    active={form.priority === p}
                    onPress={() => setField('priority', p)}
                  />
                ))}
              </View>

              <Label>Show mode</Label>
              <View style={styles.chipRow}>
                {SHOW_MODES.map((m) => (
                  <Chip
                    key={m.id}
                    label={m.label}
                    active={form.showMode === m.id}
                    onPress={() => setField('showMode', m.id)}
                  />
                ))}
              </View>

              <Label>Target audience</Label>
              <View style={styles.chipRow}>
                {TARGETS.map((t) => (
                  <Chip
                    key={t.id}
                    label={t.label}
                    active={form.targetAudience === t.id}
                    onPress={() => setField('targetAudience', t.id)}
                  />
                ))}
              </View>

              {form.targetAudience === 'version' ? (
                <Field
                  label="Max app version (show if user ≤ this version)"
                  value={form.targetMaxVersion}
                  onChangeText={(v) => setField('targetMaxVersion', v)}
                  placeholder="1.3.7"
                />
              ) : null}

              {form.type === 'text' || form.type === 'announcement' ? (
                <>
                  <Label>Background style</Label>
                  <View style={styles.chipRow}>
                    {STYLES.map((s) => (
                      <Chip
                        key={s.id}
                        label={s.label}
                        active={form.backgroundStyle === s.id}
                        onPress={() => setField('backgroundStyle', s.id)}
                      />
                    ))}
                  </View>
                </>
              ) : null}

              {form.type === 'force_update' ? (
                <Field
                  label="Minimum required version"
                  value={form.minRequiredVersion}
                  onChangeText={(v) => setField('minRequiredVersion', v)}
                  placeholder="1.3.8"
                />
              ) : null}

              <Field
                label="Start (ISO, optional)"
                value={form.startAt}
                onChangeText={(v) => setField('startAt', v)}
                placeholder="2026-06-01T08:00"
              />
              <Field
                label="End (ISO, optional)"
                value={form.endAt}
                onChangeText={(v) => setField('endAt', v)}
                placeholder="2026-12-31T23:59"
              />

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Active</Text>
                <Switch value={form.isActive} onValueChange={(v) => setField('isActive', v)} />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalOpen(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const StatCard = ({ label, value, icon, color }) => (
  <View style={[styles.statCard, { borderColor: `${color}44` }]}>
    <Icon name={icon} size={20} color={color} />
    <Text style={styles.statValue}>{Number(value || 0).toLocaleString()}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const Label = ({ children }) => <Text style={styles.label}>{children}</Text>;

const Field = ({ label, value, onChangeText, multiline, placeholder }) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      style={[styles.input, multiline && styles.inputMulti]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#6b7280"
      multiline={multiline}
    />
  </View>
);

const Chip = ({ label, active, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.chip, active && styles.chipActive]}
    activeOpacity={0.8}>
    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  statCard: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  statValue: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 8 },
  statLabel: { color: '#9ca3af', fontSize: 12, marginTop: 4 },
  ctrText: { color: '#a78bfa', fontSize: 13, marginBottom: 16, textAlign: 'center' },
  createBtn: { marginBottom: 20, borderRadius: 14, overflow: 'hidden' },
  createGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  createText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 24 },
  card: {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  cardTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  cardMeta: { color: '#9ca3af', fontSize: 12, marginTop: 4 },
  cardStats: { color: '#6b7280', fontSize: 11, marginTop: 6 },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 8 },
  iconBtn: { padding: 8 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    padding: 20,
  },
  modalTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 16 },
  label: { color: '#9ca3af', fontSize: 13, fontWeight: '600', marginTop: 12, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1f2937',
  },
  chipActive: { backgroundColor: '#6d28d9' },
  chipText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  field: { marginBottom: 12 },
  fieldLabel: { color: '#d1d5db', fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: '#111827',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#374151',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 12,
  },
  switchLabel: { color: '#fff', fontSize: 16 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 16, marginBottom: 24 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#1f2937',
    alignItems: 'center',
  },
  cancelText: { color: '#9ca3af', fontWeight: '700' },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
  },
  saveText: { color: '#fff', fontWeight: '800' },
});

export default PromotionSection;
