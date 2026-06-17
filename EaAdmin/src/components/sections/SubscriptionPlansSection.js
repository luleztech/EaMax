import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminSubscriptionPlansAPI } from '../../config/api';

const PERIOD_OPTIONS = [
  { days: 7, label: 'Wiki (7 siku)' },
  { days: 14, label: 'Wiki 2 (14 siku)' },
  { days: 30, label: 'Mwezi (30 siku)' },
  { days: 90, label: 'Miezi 3 (90 siku)' },
  { days: 180, label: 'Miezi 6 (180 siku)' },
  { days: 365, label: 'Mwaka (365 siku)' },
];

const formatTzs = (n) => {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US');
};

const planTitle = (plan) =>
  plan?.nameSw?.trim() || plan?.durationLabelSw?.trim() || plan?.slug || 'Kifurushi';

const previewPriceLine = (amount, days) => {
  const price = formatTzs(amount);
  if (days === 7) return `Tsh.${price}/= wiki moja`;
  if (days === 14) return `Tsh.${price}/= wiki mbili`;
  if (days === 30) return `Tsh.${price}/= mwezi mmoja`;
  if (days === 90) return `Tsh.${price}/= miezi mitatu`;
  if (days === 180) return `Tsh.${price}/= miezi sita`;
  if (days === 365) return `Tsh.${price}/= mwaka mmoja`;
  return `Tsh.${price}/= ${days} siku`;
};

const SubscriptionPlansSection = () => {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('edit');
  const [editing, setEditing] = useState(null);
  const [nameSw, setNameSw] = useState('');
  const [amount, setAmount] = useState('');
  const [durationDays, setDurationDays] = useState(7);
  const [isActive, setIsActive] = useState(true);
  const [isPopular, setIsPopular] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await adminSubscriptionPlansAPI.list();
      const rows = Array.isArray(data?.plans) ? data.plans : [];
      setPlans(
        rows.sort(
          (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0),
        ),
      );
    } catch (e) {
      Alert.alert('Hitilafu', e?.message || 'Imeshindwa kupakia vifurushi');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setModalMode('create');
    setEditing(null);
    setNameSw('');
    setAmount('');
    setDurationDays(7);
    setIsActive(true);
    setIsPopular(false);
    setModalOpen(true);
  };

  const openEdit = (plan) => {
    setModalMode('edit');
    setEditing(plan);
    setNameSw(plan.nameSw || '');
    setAmount(String(plan.priceTzs ?? ''));
    setDurationDays(Number(plan.durationDays) || 7);
    setIsActive(plan.isActive !== false);
    setIsPopular(plan.isPopular === true);
    setModalOpen(true);
  };

  const preview = useMemo(() => {
    const price = Number(amount) || 0;
    if (!(price > 0)) return '';
    return previewPriceLine(price, durationDays);
  }, [amount, durationDays]);

  const handleSave = async () => {
    const priceTzs = Number(amount);
    if (!nameSw.trim()) {
      Alert.alert('Thibitisha', 'Weka jina la kifurushi');
      return;
    }
    if (!(priceTzs > 0)) {
      Alert.alert('Thibitisha', 'Weka kiasi halali (TZS)');
      return;
    }
    if (!(durationDays > 0)) {
      Alert.alert('Thibitisha', 'Chagua kipindi');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        nameSw: nameSw.trim(),
        priceTzs,
        durationDays,
        isActive,
        isPopular,
      };
      if (modalMode === 'create') {
        await adminSubscriptionPlansAPI.create(payload);
      } else if (editing?.slug) {
        await adminSubscriptionPlansAPI.update(editing.slug, payload);
      }
      setModalOpen(false);
      await load();
      Alert.alert(
        'Imefaulu',
        modalMode === 'create'
          ? 'Kifurushi kipya kimeongezwa. Watumiaji wataona mara moja.'
          : 'Vifurushi vimesasishwa. Watumiaji wataona mara moja.',
      );
    } catch (e) {
      Alert.alert('Imeshindwa', e?.message || 'Haijahifadhiwa');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!editing?.slug) return;
    Alert.alert(
      'Futa kifurushi',
      `Una uhakika unataka kufuta "${planTitle(editing)}"?`,
      [
        { text: 'Ghairi', style: 'cancel' },
        {
          text: 'Futa',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await adminSubscriptionPlansAPI.remove(editing.slug);
              setModalOpen(false);
              await load();
              Alert.alert('Imefaulu', 'Kifurushi kimefutwa.');
            } catch (e) {
              Alert.alert('Imeshindwa', e?.message || 'Imeshindwa kufuta');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#a855f7" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor="#a855f7"
          />
        }>
        {plans.map((plan) => (
          <TouchableOpacity
            key={plan.slug}
            style={styles.planCard}
            activeOpacity={0.85}
            onPress={() => openEdit(plan)}>
            <View style={styles.planTop}>
              <View style={styles.planBadges}>
                <View style={styles.slugBadge}>
                  <Text style={styles.slugText}>{planTitle(plan).toUpperCase()}</Text>
                </View>
                {plan.isPopular ? (
                  <View style={styles.popularBadge}>
                    <Text style={styles.popularText}>INAYOPENDWA</Text>
                  </View>
                ) : null}
                {!plan.isActive ? (
                  <View style={styles.inactiveBadge}>
                    <Text style={styles.inactiveText}>IMEZIMWA</Text>
                  </View>
                ) : null}
              </View>
              <Icon name="pencil-outline" size={20} color="#9ca3af" />
            </View>
            <Text style={styles.priceLine}>
              {plan.priceLineSw || previewPriceLine(plan.priceTzs, plan.durationDays)}
            </Text>
            <Text style={styles.planMeta}>
              Tsh {formatTzs(plan.priceTzs)} · {plan.durationDays} siku
            </Text>
          </TouchableOpacity>
        ))}

        {plans.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Hakuna vifurushi. Ongeza kifurushi cha kwanza.</Text>
          </View>
        ) : null}
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={openCreate} activeOpacity={0.9}>
        <Icon name="plus" size={26} color="#fff" />
      </TouchableOpacity>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {modalMode === 'create' ? 'Ongeza kifurushi' : planTitle(editing)}
            </Text>

            <Text style={styles.label}>Jina</Text>
            <TextInput
              style={styles.input}
              value={nameSw}
              onChangeText={setNameSw}
              placeholder="Miezi 3, Mwaka, Wiki..."
              placeholderTextColor="#6b7280"
            />

            <Text style={styles.label}>Kiasi (TZS)</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="2000"
              placeholderTextColor="#6b7280"
            />

            <Text style={styles.label}>Kipindi</Text>
            <View style={styles.periodRow}>
              {PERIOD_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.days}
                  style={[
                    styles.periodChip,
                    durationDays === opt.days && styles.periodChipActive,
                  ]}
                  onPress={() => setDurationDays(opt.days)}>
                  <Text
                    style={[
                      styles.periodChipText,
                      durationDays === opt.days && styles.periodChipTextActive,
                    ]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {preview ? (
              <View style={styles.previewBox}>
                <Text style={styles.previewLabel}>Itaonekana kwenye app:</Text>
                <Text style={styles.previewText}>{preview}</Text>
              </View>
            ) : null}

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Inatumika</Text>
              <Switch
                value={isActive}
                onValueChange={setIsActive}
                trackColor={{ false: '#374151', true: '#7c3aed' }}
              />
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Inayopendwa</Text>
              <Switch
                value={isPopular}
                onValueChange={setIsPopular}
                trackColor={{ false: '#374151', true: '#7c3aed' }}
              />
            </View>

            <View style={styles.modalActions}>
              {modalMode === 'edit' && plans.length > 1 ? (
                <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} disabled={saving}>
                  <Icon name="delete-outline" size={20} color="#fca5a5" />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalOpen(false)} disabled={saving}>
                <Text style={styles.cancelText}>Ghairi</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Hifadhi</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  scrollContent: { padding: 16, paddingBottom: 100 },
  planCard: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 16,
    marginBottom: 12,
  },
  planTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  planBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1 },
  slugBadge: { backgroundColor: '#312e81', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  slugText: { color: '#c4b5fd', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  popularBadge: { backgroundColor: '#065f46', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  popularText: { color: '#6ee7b7', fontSize: 10, fontWeight: '800' },
  inactiveBadge: { backgroundColor: '#374151', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  inactiveText: { color: '#d1d5db', fontSize: 10, fontWeight: '800' },
  priceLine: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 6 },
  planMeta: { color: '#9ca3af', fontSize: 13 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#6b7280', textAlign: 'center' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1f2937',
    maxHeight: '92%',
  },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 16 },
  label: { color: '#9ca3af', fontSize: 12, fontWeight: '600', marginBottom: 8, marginTop: 4 },
  input: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  periodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  periodChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#0f172a',
  },
  periodChipActive: {
    borderColor: '#7c3aed',
    backgroundColor: 'rgba(124, 58, 237, 0.2)',
  },
  periodChipText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  periodChipTextActive: { color: '#fff' },
  previewBox: {
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.35)',
    padding: 14,
    marginBottom: 12,
  },
  previewLabel: { color: '#c4b5fd', fontSize: 11, fontWeight: '700', marginBottom: 6 },
  previewText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  switchLabel: { color: '#e5e7eb', fontSize: 14, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16, alignItems: 'center' },
  deleteBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    backgroundColor: 'rgba(127, 29, 29, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
  },
  cancelText: { color: '#d1d5db', fontWeight: '700' },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
  },
  saveText: { color: '#fff', fontWeight: '800' },
});

export default SubscriptionPlansSection;
