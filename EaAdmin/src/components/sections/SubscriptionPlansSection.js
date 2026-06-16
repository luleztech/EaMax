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
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminSubscriptionPlansAPI } from '../../config/api';

const emptyForm = () => ({
  nameSw: '',
  nameEn: '',
  priceTzs: '',
  durationDays: '',
  durationLabelSw: '',
  priceLineSw: '',
  isActive: true,
  isPopular: false,
  sortOrder: '0',
  badgeText: '',
});

const formatTzs = (n) => {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US');
};

const SubscriptionPlansSection = () => {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await adminSubscriptionPlansAPI.list();
      const rows = Array.isArray(data?.plans) ? data.plans : [];
      setPlans(rows);
    } catch (e) {
      Alert.alert('Hitilafu', e?.message || 'Imeshindwa kupakia mipango');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = (plan) => {
    setEditing(plan);
    setForm({
      nameSw: plan.nameSw || '',
      nameEn: plan.nameEn || '',
      priceTzs: String(plan.priceTzs ?? ''),
      durationDays: String(plan.durationDays ?? ''),
      durationLabelSw: plan.durationLabelSw || '',
      priceLineSw: plan.priceLineSw || '',
      isActive: plan.isActive !== false,
      isPopular: plan.isPopular === true,
      sortOrder: String(plan.sortOrder ?? 0),
      badgeText: plan.badgeText || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!editing?.slug) return;
    if (!form.nameSw.trim()) {
      Alert.alert('Thibitisha', 'Jina (Kiswahili) linahitajika');
      return;
    }
    const priceTzs = Number(form.priceTzs);
    const durationDays = Number(form.durationDays);
    if (!(priceTzs > 0)) {
      Alert.alert('Thibitisha', 'Weka bei halali (TZS)');
      return;
    }
    if (!(durationDays > 0)) {
      Alert.alert('Thibitisha', 'Weka muda halali (siku)');
      return;
    }
    setSaving(true);
    try {
      await adminSubscriptionPlansAPI.update(editing.slug, {
        nameSw: form.nameSw.trim(),
        nameEn: form.nameEn.trim() || null,
        priceTzs,
        durationDays,
        durationLabelSw: form.durationLabelSw.trim() || null,
        priceLineSw: form.priceLineSw.trim() || null,
        isActive: !!form.isActive,
        isPopular: !!form.isPopular,
        sortOrder: Number(form.sortOrder) || 0,
        badgeText: form.badgeText.trim() || null,
      });
      setModalOpen(false);
      await load();
      Alert.alert('Imefaulu', 'Mpango umesasishwa. App itapata bei mpya baada ya kufungua tena.');
    } catch (e) {
      Alert.alert('Imeshindwa', e?.message || 'Haijahifadhiwa');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#a855f7" />
        <Text style={styles.loadingText}>Inapakia mipango ya malipo…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#a855f7" />
        }>
        <View style={styles.headerCard}>
          <Icon name="cash-multiple" size={28} color="#a855f7" />
          <View style={styles.headerText}>
            <Text style={styles.title}>Mipango ya Malipo</Text>
            <Text style={styles.subtitle}>
              Bei na muda wa usajili — inaonekana kwenye app ya wateja mara moja baada ya kuhifadhi.
            </Text>
          </View>
        </View>

        {plans.map((plan) => (
          <TouchableOpacity
            key={plan.slug}
            style={styles.planCard}
            activeOpacity={0.85}
            onPress={() => openEdit(plan)}>
            <View style={styles.planTop}>
              <View style={styles.planBadges}>
                <View style={styles.slugBadge}>
                  <Text style={styles.slugText}>{plan.slug}</Text>
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
            <Text style={styles.priceLine}>{plan.priceLineSw || `Tsh ${formatTzs(plan.priceTzs)}`}</Text>
            <Text style={styles.planMeta}>
              {plan.nameSw} · {plan.durationLabelSw || `${plan.durationDays} siku`} · Tsh {formatTzs(plan.priceTzs)}
            </Text>
          </TouchableOpacity>
        ))}

        {plans.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Hakuna mipango iliyopatikana.</Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Hariri mpango: {editing?.slug ?? ''}
            </Text>
            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Jina (SW)</Text>
              <TextInput style={styles.input} value={form.nameSw} onChangeText={(v) => setForm((f) => ({ ...f, nameSw: v }))} placeholderTextColor="#6b7280" />
              <Text style={styles.label}>Jina (EN)</Text>
              <TextInput style={styles.input} value={form.nameEn} onChangeText={(v) => setForm((f) => ({ ...f, nameEn: v }))} placeholderTextColor="#6b7280" />
              <Text style={styles.label}>Bei (TZS)</Text>
              <TextInput style={styles.input} value={form.priceTzs} onChangeText={(v) => setForm((f) => ({ ...f, priceTzs: v.replace(/[^0-9]/g, '') }))} keyboardType="number-pad" placeholderTextColor="#6b7280" />
              <Text style={styles.label}>Muda (siku)</Text>
              <TextInput style={styles.input} value={form.durationDays} onChangeText={(v) => setForm((f) => ({ ...f, durationDays: v.replace(/[^0-9]/g, '') }))} keyboardType="number-pad" placeholderTextColor="#6b7280" />
              <Text style={styles.label}>Lebo ya muda (SW)</Text>
              <TextInput style={styles.input} value={form.durationLabelSw} onChangeText={(v) => setForm((f) => ({ ...f, durationLabelSw: v }))} placeholder="7 siku" placeholderTextColor="#6b7280" />
              <Text style={styles.label}>Mstari wa bei (SW)</Text>
              <TextInput style={styles.input} value={form.priceLineSw} onChangeText={(v) => setForm((f) => ({ ...f, priceLineSw: v }))} placeholder="Tsh.2,000/= wiki moja" placeholderTextColor="#6b7280" />
              <Text style={styles.label}>Badge (hiari)</Text>
              <TextInput style={styles.input} value={form.badgeText} onChangeText={(v) => setForm((f) => ({ ...f, badgeText: v }))} placeholderTextColor="#6b7280" />
              <Text style={styles.label}>Mpangilio (sort order)</Text>
              <TextInput style={styles.input} value={form.sortOrder} onChangeText={(v) => setForm((f) => ({ ...f, sortOrder: v.replace(/[^0-9-]/g, '') }))} keyboardType="number-pad" placeholderTextColor="#6b7280" />
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Inatumika (active)</Text>
                <Switch value={form.isActive} onValueChange={(v) => setForm((f) => ({ ...f, isActive: v }))} trackColor={{ false: '#374151', true: '#7c3aed' }} />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Inayopendwa (popular)</Text>
                <Switch value={form.isPopular} onValueChange={(v) => setForm((f) => ({ ...f, isPopular: v }))} trackColor={{ false: '#374151', true: '#7c3aed' }} />
              </View>
            </ScrollView>
            <View style={styles.modalActions}>
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
  loadingText: { color: '#9ca3af', marginTop: 12, fontSize: 14 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 18,
    marginBottom: 16,
  },
  headerText: { flex: 1 },
  title: { color: '#f9fafb', fontSize: 20, fontWeight: '800' },
  subtitle: { color: '#9ca3af', fontSize: 13, marginTop: 6, lineHeight: 18 },
  planCard: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 16,
    marginBottom: 12,
  },
  planTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  planBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slugBadge: { backgroundColor: '#312e81', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  slugText: { color: '#c4b5fd', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  popularBadge: { backgroundColor: '#065f46', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  popularText: { color: '#6ee7b7', fontSize: 10, fontWeight: '800' },
  inactiveBadge: { backgroundColor: '#374151', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  inactiveText: { color: '#d1d5db', fontSize: 10, fontWeight: '800' },
  priceLine: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 6 },
  planMeta: { color: '#9ca3af', fontSize: 13 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#6b7280' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    padding: 20,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 16 },
  modalScroll: { maxHeight: 420 },
  label: { color: '#9ca3af', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  switchLabel: { color: '#e5e7eb', fontSize: 14, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
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
