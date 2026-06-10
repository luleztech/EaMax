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

const PRIORITY_LABELS = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low' };

const TYPES = [
  { id: 'picha', label: 'Picha', icon: 'image-outline', color: '#60a5fa' },
  { id: 'ujumbe', label: 'Ujumbe', icon: 'message-text-outline', color: '#a78bfa' },
  { id: 'tangazo', label: 'Tangazo', icon: 'bullhorn-outline', color: '#fbbf24' },
  { id: 'ofa', label: 'Ofa', icon: 'tag-heart-outline', color: '#34d399' },
];

const STYLES = [
  { id: 'dark_glass', label: 'Dark Glass' },
  { id: 'gold', label: 'Gold' },
  { id: 'premium_blue', label: 'Premium Blue' },
  { id: 'red_alert', label: 'Red Alert' },
  { id: 'green_success', label: 'Green' },
];

const SHOW_MODES = [
  { id: 'every_launch', label: 'Kila ufunguaji' },
  { id: 'daily', label: 'Mara kwa siku' },
  { id: 'once', label: 'Mara moja' },
];

const TARGETS = [
  { id: 'all', label: 'Wote' },
  { id: 'free', label: 'Bure tu' },
  { id: 'premium', label: 'Premium' },
];

const normalizeType = (t) => {
  const m = { image: 'picha', text: 'ujumbe', announcement: 'tangazo', force_update: 'tangazo' };
  return m[t] || t || 'ujumbe';
};

const typeMeta = (id) => TYPES.find((t) => t.id === id) || TYPES[1];

const emptyForm = () => ({
  title: '',
  description: '',
  imageUrl: '',
  buttonText: 'Fungua',
  buttonUrl: '',
  type: 'ujumbe',
  priority: 3,
  isActive: true,
  showMode: 'every_launch',
  targetAudience: 'all',
  targetMaxVersion: '',
  targetMinVersion: '',
  backgroundStyle: 'dark_glass',
  offerAmountTsh: '1700',
  offerPeriodDays: '7',
  offerCountdownMinutes: '10',
});

const PromotionSection = () => {
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
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
      Alert.alert('Hitilafu', e?.message || 'Imeshindwa kupakia');
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
    const type = normalizeType(item.type);
    setForm({
      title: item.title || '',
      description: item.description || '',
      imageUrl: item.imageUrl || '',
      buttonText: item.buttonText || 'Fungua',
      buttonUrl: item.buttonUrl || '',
      type,
      priority: item.priority || 3,
      isActive: item.isActive !== false,
      showMode: item.showMode || 'daily',
      targetAudience: (() => {
        if (type === 'ofa') return 'free';
        const t = item.targetAudience || 'all';
        if (t === 'android' || t === 'version') return 'all';
        return t;
      })(),
      targetMaxVersion: item.targetMaxVersion || '',
      targetMinVersion: item.targetMinVersion || '',
      backgroundStyle: item.backgroundStyle || 'dark_glass',
      offerAmountTsh: String(item.offerAmountTsh ?? 1700),
      offerPeriodDays: String(item.offerPeriodDays ?? 7),
      offerCountdownMinutes: String(item.offerCountdownMinutes ?? 10),
    });
    setModalOpen(true);
  };

  const buildPayload = () => {
    const type = form.type;
    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      imageUrl: type === 'picha' ? form.imageUrl.trim() || null : null,
      buttonText: type === 'tangazo' ? form.buttonText.trim() || 'Fungua' : '',
      buttonUrl: type === 'tangazo' ? form.buttonUrl.trim() || null : null,
      type,
      priority: Number(form.priority) || 3,
      isActive: !!form.isActive,
      showMode: form.showMode,
      targetAudience: type === 'ofa' ? 'free' : form.targetAudience,
      targetMaxVersion: null,
      targetMinVersion: form.targetMinVersion.trim() || null,
      backgroundStyle: form.backgroundStyle,
    };
    if (type === 'ofa') {
      payload.offerAmountTsh = Number(form.offerAmountTsh) || 0;
      payload.offerPeriodDays = Number(form.offerPeriodDays) || 0;
      payload.offerCountdownMinutes = Number(form.offerCountdownMinutes) || 0;
    }
    return payload;
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      Alert.alert('Thibitisha', 'Kichwa kinahitajika');
      return;
    }
    if (form.type === 'picha' && !form.imageUrl.trim()) {
      Alert.alert('Thibitisha', 'Weka URL ya picha');
      return;
    }
    if (form.type === 'ofa') {
      if (!(Number(form.offerAmountTsh) > 0)) {
        Alert.alert('Thibitisha', 'Weka bei ya ofa (TZS)');
        return;
      }
      if (!(Number(form.offerPeriodDays) > 0)) {
        Alert.alert('Thibitisha', 'Weka muda wa usajili (siku)');
        return;
      }
      if (!(Number(form.offerCountdownMinutes) > 0)) {
        Alert.alert('Thibitisha', 'Weka muda wa kuhesabu ofa (dakika)');
        return;
      }
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
      Alert.alert('Imeshindwa', e?.message || 'Haijahifadhiwa');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (item) => {
    Alert.alert('Futa', `Futa "${item.title}"?`, [
      { text: 'Ghairi', style: 'cancel' },
      {
        text: 'Futa',
        style: 'destructive',
        onPress: async () => {
          try {
            await adminPromotionsAPI.remove(item.id);
            await load();
          } catch (e) {
            Alert.alert('Hitilafu', e?.message || 'Imeshindwa');
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
      Alert.alert('Hitilafu', e?.message || 'Imeshindwa');
    }
  };

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const onTypeSelect = (id) => {
    setField('type', id);
    if (id === 'ofa') {
      setForm((f) => ({
        ...f,
        type: id,
        targetAudience: 'free',
        showMode: 'every_launch',
        priority: 1,
      }));
    }
    setTypePickerOpen(false);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#a78bfa" />
      </View>
    );
  }

  const selectedType = typeMeta(form.type);

  return (
    <View style={styles.wrap}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
        contentContainerStyle={styles.scroll}>
        <View style={styles.statsRow}>
          <StatCard label="Views" value={stats?.totalViews} icon="eye-outline" color="#60a5fa" />
          <StatCard label="Bofya" value={stats?.totalClicks} icon="cursor-default-click" color="#34d399" />
        </View>
        <View style={styles.statsRow}>
          <StatCard label="Hai" value={stats?.activePromotions} icon="lightning-bolt" color="#fbbf24" />
          <StatCard label="CTR" value={`${stats?.ctrPercent ?? 0}%`} icon="chart-line" color="#a78bfa" />
        </View>

        <TouchableOpacity style={styles.createBtn} onPress={openCreate} activeOpacity={0.85}>
          <LinearGradient colors={['#7c3aed', '#5b21b6']} style={styles.createGrad}>
            <Icon name="plus-circle-outline" size={22} color="#fff" />
            <Text style={styles.createText}>Tengeneza tangazo</Text>
          </LinearGradient>
        </TouchableOpacity>

        {items.length === 0 ? (
          <Text style={styles.empty}>Hakuna matangazo bado.</Text>
        ) : (
          items.map((item) => {
            const t = typeMeta(normalizeType(item.type));
            return (
              <View key={String(item.id)} style={styles.card}>
                <View style={[styles.typeBadge, { backgroundColor: `${t.color}22` }]}>
                  <Icon name={t.icon} size={18} color={t.color} />
                  <Text style={[styles.typeBadgeText, { color: t.color }]}>{t.label}</Text>
                </View>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Text style={styles.cardMeta}>
                      {PRIORITY_LABELS[item.priority] || 'Medium'} · {item.showMode}
                    </Text>
                    <Text style={styles.cardStats}>
                      {item.viewsCount}  · {item.clicksCount} bofya
                    </Text>
                    {item.type === 'ofa' && item.offerAmountTsh ? (
                      <Text style={styles.offerLine}>
                        Tsh {item.offerAmountTsh} · siku {item.offerPeriodDays}
                      </Text>
                    ) : null}
                  </View>
                  <Switch
                    value={!!item.isActive}
                    onValueChange={() => handleToggle(item)}
                    trackColor={{ true: '#7c3aed' }}
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
            );
          })
        )}
      </ScrollView>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>{editing ? 'Hariri' : 'Tangazo jipya'}</Text>

              <Text style={styles.label}>Aina</Text>
              <TouchableOpacity
                style={styles.typeSelect}
                onPress={() => setTypePickerOpen(true)}
                activeOpacity={0.85}>
                <View style={[styles.typeSelectIcon, { backgroundColor: `${selectedType.color}33` }]}>
                  <Icon name={selectedType.icon} size={22} color={selectedType.color} />
                </View>
                <Text style={styles.typeSelectLabel}>{selectedType.label}</Text>
                <Icon name="chevron-down" size={22} color="#9ca3af" />
              </TouchableOpacity>

              <Field label="Kichwa *" value={form.title} onChangeText={(v) => setField('title', v)} />
              <Field
                label="Maelezo"
                value={form.description}
                onChangeText={(v) => setField('description', v)}
                multiline
              />

              {form.type === 'picha' ? (
                <Field
                  label="URL ya picha"
                  value={form.imageUrl}
                  onChangeText={(v) => setField('imageUrl', v)}
                  placeholder="https://..."
                />
              ) : null}

              {form.type === 'tangazo' ? (
                <>
                  <Field label="Maandishi ya kitufe" value={form.buttonText} onChangeText={(v) => setField('buttonText', v)} />
                  <Field
                    label="Kiungo (Play Store / tovuti)"
                    value={form.buttonUrl}
                    onChangeText={(v) => setField('buttonUrl', v)}
                    placeholder="https://..."
                  />
                </>
              ) : null}

              {form.type === 'ofa' ? (
                <View style={styles.ofaBox}>
                  <Text style={styles.ofaTitle}>Mipangilio ya ofa</Text>
                  <Field
                    label="Bei (TZS)"
                    value={form.offerAmountTsh}
                    onChangeText={(v) => setField('offerAmountTsh', v.replace(/\D/g, ''))}
                    keyboardType="numeric"
                    placeholder="1700"
                  />
                  <Field
                    label="Muda wa usajili (siku)"
                    value={form.offerPeriodDays}
                    onChangeText={(v) => setField('offerPeriodDays', v.replace(/\D/g, ''))}
                    keyboardType="numeric"
                    placeholder="7 = wiki moja"
                  />
                  <Field
                    label="Muda wa kuhesabu ofa (dakika)"
                    value={form.offerCountdownMinutes}
                    onChangeText={(v) => setField('offerCountdownMinutes', v.replace(/\D/g, ''))}
                    keyboardType="numeric"
                    placeholder="10"
                  />
                  <Text style={styles.ofaHint}>
                    Watumiaji wa bure wataona ofa na kuhesabu muda. Pokea Ofa inatuma ombi la malipo.
                  </Text>
                </View>
              ) : null}

              {form.type !== 'ofa' ? (
                <>
                  <Text style={styles.label}>Muonekano</Text>
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

              <Text style={styles.label}>Kipaumbele</Text>
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

              <Text style={styles.label}>Onyesha</Text>
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

              {form.type !== 'ofa' ? (
                <>
                  <Text style={styles.label}>Lengo</Text>
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
                </>
              ) : (
                <Text style={styles.ofaHint}>Ofa inaonyeshwa kwa watumiaji wa bure pekee.</Text>
              )}

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Imewashwa</Text>
                <Switch value={form.isActive} onValueChange={(v) => setField('isActive', v)} />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalOpen(false)}>
                  <Text style={styles.cancelText}>Ghairi</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveText}>Hifadhi</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={typePickerOpen} transparent animationType="fade">
        <TouchableOpacity
          style={styles.pickerBackdrop}
          activeOpacity={1}
          onPress={() => setTypePickerOpen(false)}>
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>Chagua aina</Text>
            {TYPES.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[styles.pickerRow, form.type === t.id && styles.pickerRowActive]}
                onPress={() => onTypeSelect(t.id)}>
                <Icon name={t.icon} size={24} color={t.color} />
                <Text style={styles.pickerRowText}>{t.label}</Text>
                {form.type === t.id ? <Icon name="check" size={20} color="#a78bfa" /> : null}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const StatCard = ({ label, value, icon, color }) => (
  <View style={[styles.statCard, { borderColor: `${color}44` }]}>
    <Icon name={icon} size={20} color={color} />
    <Text style={styles.statValue}>
      {typeof value === 'number' ? Number(value).toLocaleString() : value ?? '0'}
    </Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const Field = ({ label, value, onChangeText, multiline, placeholder, keyboardType }) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      style={[styles.input, multiline && styles.inputMulti]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#6b7280"
      multiline={multiline}
      keyboardType={keyboardType}
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
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 10,
  },
  typeBadgeText: { fontSize: 12, fontWeight: '700' },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  cardTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  cardMeta: { color: '#9ca3af', fontSize: 12, marginTop: 4 },
  cardStats: { color: '#6b7280', fontSize: 11, marginTop: 6 },
  offerLine: { color: '#34d399', fontSize: 12, marginTop: 6, fontWeight: '600' },
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
  modalTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 8 },
  label: { color: '#9ca3af', fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 8 },
  typeSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  typeSelectIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeSelectLabel: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '700' },
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
  ofaBox: {
    backgroundColor: '#052e16',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#166534',
  },
  ofaTitle: { color: '#34d399', fontWeight: '800', fontSize: 15, marginBottom: 8 },
  ofaHint: { color: '#6b7280', fontSize: 12, marginBottom: 12, lineHeight: 18 },
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
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  pickerSheet: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#374151',
  },
  pickerTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  pickerRowActive: { backgroundColor: '#1f2937' },
  pickerRowText: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '600' },
});

export default PromotionSection;
