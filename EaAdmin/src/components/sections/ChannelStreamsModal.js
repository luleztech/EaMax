import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Switch,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminChannelsAPI } from '../../config/api';

const emptyStreamForm = () => ({
  streamUrl: '',
  streamAlias: '',
  drmType: 'NONE',
  drmClearKey: '',
  licenseUrl: '',
  isActive: true,
});

const ChannelStreamsModal = ({ visible, channel, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [streams, setStreams] = useState([]);
  const [editingPriority, setEditingPriority] = useState(null);
  const [form, setForm] = useState(emptyStreamForm());

  const load = useCallback(async () => {
    if (!channel?.id) return;
    setLoading(true);
    try {
      const data = await adminChannelsAPI.getChannelStreams(channel.id);
      setStreams(Array.isArray(data?.streams) ? data.streams : []);
    } catch (e) {
      Alert.alert('Hitilafu', e?.message || 'Imeshindwa kupakia streams');
    } finally {
      setLoading(false);
    }
  }, [channel?.id]);

  useEffect(() => {
    if (visible && channel?.id) {
      load();
      setEditingPriority(null);
      setForm(emptyStreamForm());
    }
  }, [visible, channel?.id, load]);

  const openEdit = (stream, priority) => {
    setEditingPriority(priority);
    setForm({
      streamUrl: stream?.url || '',
      streamAlias: stream?.streamAlias || '',
      drmType: (stream?.drmType || 'NONE').toUpperCase(),
      drmClearKey: stream?.drmClearKey || '',
      licenseUrl: stream?.licenseUrl || '',
      isActive: stream?.isActive !== false,
    });
  };

  const handleSave = async () => {
    if (editingPriority == null || !channel?.id) return;
    if (!form.streamUrl.trim() && !form.streamAlias.trim()) {
      Alert.alert('Thibitisha', 'Weka stream URL au alias');
      return;
    }
    setSaving(true);
    try {
      await adminChannelsAPI.updateChannelStream(channel.id, editingPriority, {
        streamUrl: form.streamUrl.trim() || null,
        streamAlias: form.streamAlias.trim() || null,
        drmType: form.drmType,
        drmClearKey: form.drmClearKey.trim() || null,
        licenseUrl: form.licenseUrl.trim() || null,
        isActive: form.isActive,
      });
      setEditingPriority(null);
      await load();
      Alert.alert('Imefaulu', 'Stream imehifadhiwa');
    } catch (e) {
      Alert.alert('Imeshindwa', e?.message || 'Haijahifadhiwa');
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  const sorted = [...streams].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  const rows = sorted.length
    ? sorted
    : [
        { priority: 0, url: channel?.stream_url || '', drmType: 'NONE', isActive: true },
      ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Backup Streams</Text>
              {channel?.name ? (
                <Text style={styles.subtitle}>{channel.name}</Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={24} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color="#a855f7" />
            </View>
          ) : (
            <ScrollView style={styles.scroll}>
              {rows.map((stream) => {
                const priority = stream.priority ?? 0;
                const isEditing = editingPriority === priority;
                return (
                  <View key={`stream-${priority}`} style={styles.streamRow}>
                    <View style={styles.streamTop}>
                      <View style={styles.priorityBadge}>
                        <Text style={styles.priorityText}>P{priority}</Text>
                      </View>
                      <Text style={styles.streamUrl} numberOfLines={2}>
                        {stream.url || stream.stream_url || '(empty)'}
                      </Text>
                      {!isEditing ? (
                        <TouchableOpacity onPress={() => openEdit(stream, priority)}>
                          <Icon name="pencil-outline" size={20} color="#60a5fa" />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    {isEditing ? (
                      <View style={styles.form}>
                        <Text style={styles.label}>Stream URL</Text>
                        <TextInput
                          style={styles.input}
                          value={form.streamUrl}
                          onChangeText={(v) => setForm((f) => ({ ...f, streamUrl: v }))}
                          placeholder="https://..."
                          placeholderTextColor="#6b7280"
                          autoCapitalize="none"
                        />
                        <Text style={styles.label}>Alias (hiari)</Text>
                        <TextInput
                          style={styles.input}
                          value={form.streamAlias}
                          onChangeText={(v) => setForm((f) => ({ ...f, streamAlias: v }))}
                          placeholderTextColor="#6b7280"
                          autoCapitalize="none"
                        />
                        <Text style={styles.label}>DRM type</Text>
                        <View style={styles.chipRow}>
                          {['NONE', 'CLEARKEY', 'WIDEVINE', 'PLAYREADY'].map((t) => (
                            <TouchableOpacity
                              key={t}
                              style={[styles.chip, form.drmType === t && styles.chipActive]}
                              onPress={() => setForm((f) => ({ ...f, drmType: t }))}>
                              <Text style={[styles.chipText, form.drmType === t && styles.chipTextActive]}>{t}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <Text style={styles.label}>License URL</Text>
                        <TextInput
                          style={styles.input}
                          value={form.licenseUrl}
                          onChangeText={(v) => setForm((f) => ({ ...f, licenseUrl: v }))}
                          placeholderTextColor="#6b7280"
                          autoCapitalize="none"
                        />
                        <Text style={styles.label}>ClearKey</Text>
                        <TextInput
                          style={styles.input}
                          value={form.drmClearKey}
                          onChangeText={(v) => setForm((f) => ({ ...f, drmClearKey: v }))}
                          placeholderTextColor="#6b7280"
                          autoCapitalize="none"
                        />
                        <View style={styles.switchRow}>
                          <Text style={styles.switchLabel}>Active</Text>
                          <Switch
                            value={form.isActive}
                            onValueChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                            trackColor={{ false: '#374151', true: '#7c3aed' }}
                          />
                        </View>
                        <View style={styles.actions}>
                          <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditingPriority(null)}>
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
                      </View>
                    ) : null}
                  </View>
                );
              })}

              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => {
                  const nextPriority = rows.length
                    ? Math.max(...rows.map((r) => Number(r.priority) || 0)) + 1
                    : 1;
                  openEdit({}, nextPriority);
                }}>
                <Icon name="plus" size={18} color="#c4b5fd" />
                <Text style={styles.addText}>Ongeza backup stream</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: '#0c1220',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '88%',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.12)',
    padding: 18,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  headerText: { flex: 1, paddingRight: 12 },
  title: { color: '#f4f7fb', fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { color: '#9aa8bd', fontSize: 12, marginTop: 4 },
  center: { padding: 40, alignItems: 'center' },
  scroll: { maxHeight: 520 },
  streamRow: {
    backgroundColor: 'rgba(17,24,39,0.9)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 12,
    marginBottom: 10,
  },
  streamTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  priorityBadge: {
    backgroundColor: '#312e81',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  priorityText: { color: '#c4b5fd', fontSize: 11, fontWeight: '800' },
  streamUrl: { flex: 1, color: '#e5e7eb', fontSize: 12 },
  form: { marginTop: 12 },
  label: { color: '#9ca3af', fontSize: 11, fontWeight: '600', marginBottom: 4, marginTop: 8 },
  input: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#374151',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1f2937',
  },
  chipActive: { backgroundColor: '#7c3aed' },
  chipText: { color: '#9ca3af', fontSize: 11, fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  switchLabel: { color: '#e5e7eb', fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
  },
  cancelText: { color: '#d1d5db', fontWeight: '700' },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
  },
  saveText: { color: '#fff', fontWeight: '800' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    borderStyle: 'dashed',
    marginTop: 4,
    marginBottom: 20,
  },
  addText: { color: '#c4b5fd', fontWeight: '700' },
});

export default ChannelStreamsModal;
