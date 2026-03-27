import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Switch,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminSettingsAPI, adminStreamAliasesAPI, adminChannelsAPI } from '../../config/api';
import LinearGradient from 'react-native-linear-gradient';

const SettingsSection = () => {
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [channelsPremiumOnly, setChannelsPremiumOnly] = useState(false);
  const [channelsPremiumOnlyLoading, setChannelsPremiumOnlyLoading] = useState(true);
  const [channelsPremiumOnlySaving, setChannelsPremiumOnlySaving] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [statusModalTitle, setStatusModalTitle] = useState('');
  const [statusModalMessage, setStatusModalMessage] = useState('');
  const [aliases, setAliases] = useState([]);
  const [aliasesLoading, setAliasesLoading] = useState(true);
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [editingAlias, setEditingAlias] = useState(null);
  const [aliasKey, setAliasKey] = useState('');
  const [aliasChannelName, setAliasChannelName] = useState('');
  const [aliasChannelId, setAliasChannelId] = useState(null);
  const [aliasSaving, setAliasSaving] = useState(false);
  const [deleteAliasConfirm, setDeleteAliasConfirm] = useState(null);
  const [aliasDeleting, setAliasDeleting] = useState(false);
  const [aliasScreenVisible, setAliasScreenVisible] = useState(false);
  const [allChannels, setAllChannels] = useState([]);

  const showStatusModal = (title, message) => {
    setStatusModalTitle(title);
    setStatusModalMessage(message);
    setStatusModalVisible(true);
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [whatsappRes, premiumRes, aliasRes, channelsRes] = await Promise.all([
          adminSettingsAPI.getWhatsAppNumber(),
          adminSettingsAPI.getChannelsPremiumOnly().catch(() => ({ channelsPremiumOnly: false })),
          adminStreamAliasesAPI.list().catch(() => []),
          adminChannelsAPI.getChannels().catch(() => []),
        ]);
        if (whatsappRes.number) setWhatsappNumber(whatsappRes.number);
        setChannelsPremiumOnly(!!premiumRes.channelsPremiumOnly);
        setAliases(Array.isArray(aliasRes) ? aliasRes : []);
        setAllChannels(Array.isArray(channelsRes) ? channelsRes : []);
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setLoading(false);
        setChannelsPremiumOnlyLoading(false);
        setAliasesLoading(false);
      }
    };
    loadSettings();
  }, []);

  const openAliasModal = (row = null) => {
    setEditingAlias(row);
    setAliasKey(row?.alias ? String(row.alias) : '');
    setAliasChannelName(row?.channel_name ? String(row.channel_name) : '');
    setAliasChannelId(row?.channel_id != null ? Number(row.channel_id) : null);
    setAliasModalVisible(true);
  };

  const handleSaveAlias = async () => {
    if (!aliasKey.trim()) {
      showStatusModal('Missing alias', 'Please enter alias key (e.g. supersport1).');
      return;
    }
    const typed = String(aliasChannelName || '').trim();
    if (!typed) {
      showStatusModal('Missing channel', 'Please enter channel name for this alias.');
      return;
    }
    const picked =
      allChannels.find((c) => c.id === aliasChannelId) ||
      allChannels.find((c) => String(c.name || '').toLowerCase() === typed.toLowerCase());
    if (!picked || !picked.id) {
      showStatusModal('Channel not found', 'Select a valid existing channel name.');
      return;
    }
    try {
      setAliasSaving(true);
      const saved = await adminStreamAliasesAPI.upsert({
        alias: aliasKey.trim(),
        channelId: Number(picked.id),
      });
      const savedRow = {
        ...saved,
        channel_id: saved.channel_id ?? Number(picked.id),
        channel_name: picked.name ?? saved.channel_name ?? null,
      };
      setAliases((prev) => {
        const next = Array.isArray(prev) ? [...prev] : [];
        const idx = next.findIndex((x) => String(x.alias) === String(savedRow.alias));
        if (idx >= 0) next[idx] = savedRow;
        else next.unshift(savedRow);
        return next;
      });
      setAliasModalVisible(false);
      setEditingAlias(null);
      setAliasKey('');
      setAliasChannelName('');
      setAliasChannelId(null);
      showStatusModal('Alias saved', 'Alias mapping saved successfully.');
    } catch (e) {
      console.error('Alias save failed:', e);
      showStatusModal('Save failed', 'Failed to save alias. Please try again.');
    } finally {
      setAliasSaving(false);
    }
  };

  const handleDeleteAlias = async (alias) => {
    if (!alias || aliasDeleting) return;
    try {
      setAliasDeleting(true);
      await adminStreamAliasesAPI.remove(String(alias));
      setAliases((prev) => (Array.isArray(prev) ? prev.filter((x) => String(x.alias) !== String(alias)) : []));
      setDeleteAliasConfirm(null);
      showStatusModal('Alias deleted', 'Alias removed successfully.');
    } catch (e) {
      console.error('Alias delete failed:', e);
      showStatusModal('Delete failed', 'Failed to delete alias. Please try again.');
    } finally {
      setAliasDeleting(false);
    }
  };

  const handleAliasToggle = async (row, value) => {
    if (!row || aliasSaving) return;
    const alias = String(row.alias || '');
    if (!alias) return;
    const prev = !!row.is_active;
    setAliases((items) =>
      (Array.isArray(items) ? items : []).map((x) =>
        String(x.alias) === alias ? { ...x, is_active: !!value } : x
      )
    );
    try {
      await adminStreamAliasesAPI.setActive(alias, !!value);
    } catch (e) {
      setAliases((items) =>
        (Array.isArray(items) ? items : []).map((x) =>
          String(x.alias) === alias ? { ...x, is_active: prev } : x
        )
      );
      showStatusModal('Update failed', 'Failed to update alias status. Please try again.');
    }
  };

  const handleSaveNumber = async () => {
    if (!whatsappNumber.trim()) {
      showStatusModal('Missing number', 'Please enter a WhatsApp number.');
      return;
    }
    try {
      setSaving(true);
      await adminSettingsAPI.updateWhatsAppNumber(whatsappNumber.trim());
      showStatusModal(
        'Number saved',
        'WhatsApp number saved successfully.');
    } catch (error) {
      console.error('Failed to save WhatsApp number:', error);
      showStatusModal(
        'Save failed',
        'Failed to save WhatsApp number. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleChannelsPremiumOnlyToggle = async (value) => {
    if (channelsPremiumOnlySaving) return;
    const previous = channelsPremiumOnly;
    setChannelsPremiumOnly(value);
    try {
      setChannelsPremiumOnlySaving(true);
      await adminSettingsAPI.updateChannelsPremiumOnly(value);
      showStatusModal(
        'Setting saved',
        value
          ? 'Channels are now premium only. Users must pay to watch; no ads or points.'
          : 'Channels can use points or be free. Users can watch ads to earn points.',
      );
    } catch (error) {
      console.error('Failed to update channels premium-only:', error);
      setChannelsPremiumOnly(previous);
      showStatusModal(
        'Update failed',
        'Failed to update channels access mode. Please try again.',
      );
    } finally {
      setChannelsPremiumOnlySaving(false);
    }
  };

  return (
    <>
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.settingsCard}>
        <View style={styles.headerSection}>
          <Text style={styles.settingsTitle}>WhatsApp Contact</Text>
        </View>
        <Text style={styles.settingsDescription}>
          Manage WhatsApp contact numbers for customer support
        </Text>

        <View style={styles.contactsList}>
          <View style={styles.contactItem}>
            <View style={styles.contactHeader}>
              <View style={styles.contactIconContainer}>
                <Icon name="whatsapp" size={24} color="#25D366" />
              </View>
              <View style={styles.contactInfo}>
                <Text style={styles.singleLabel}>WhatsApp Support</Text>
              </View>
            </View>
            <View style={styles.contactNumberContainer}>
              <Icon name="phone" size={18} color="#9ca3af" />
              <TextInput
                style={styles.contactNumberInput}
                value={whatsappNumber}
                onChangeText={setWhatsappNumber}
                placeholder="+255 123 456 789"
                placeholderTextColor="#6b7280"
                keyboardType="phone-pad"
              />
            </View>
            <TouchableOpacity
              style={styles.saveButton}
              onPress={saving ? undefined : handleSaveNumber}
              disabled={loading || saving}>
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Icon name="content-save" size={18} color="#fff" />
                  <Text style={styles.saveButtonText}>Save</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.settingsCard}>
        <View style={styles.headerSection}>
          <Text style={styles.settingsTitle}>Alias settings</Text>
        </View>
        <Text style={styles.settingsDescription}>
          Open a dedicated aliases screen to manage alias keys, status, and channel mappings.
        </Text>
        <TouchableOpacity style={styles.aliasOpenButton} onPress={() => setAliasScreenVisible(true)}>
          <Icon name="link-variant" size={20} color="#fff" />
          <Text style={styles.aliasOpenButtonText}>Open Alias Management</Text>
          <Icon name="chevron-right" size={20} color="#e9d5ff" />
        </TouchableOpacity>
      </View>

      <View style={styles.settingsCard}>
        <View style={styles.headerSection}>
          <Text style={styles.settingsTitle}>Channels access</Text>
        </View>
        <Text style={styles.settingsDescription}>
          Ikiwa ON ni malipo pekee na ikiwa OFF ni matangazo na bure
        </Text>
        <View style={styles.contactItem}>
          <View style={styles.contactHeader}>
            <View style={styles.contactIconContainer}>
              <Icon name="lock-outline" size={24} color="#a855f7" />
            </View>
            <View style={styles.contactInfo}>
              <Text style={styles.singleLabel}>Malipo </Text>
              <Text style={styles.channelsToggleHint}>
                {channelsPremiumOnly ? 'Malipo' : 'matangazo'}
              </Text>
            </View>
            {channelsPremiumOnlySaving ? (
              <ActivityIndicator size="small" color="#a855f7" />
            ) : (
              <Switch
                value={channelsPremiumOnly}
                onValueChange={handleChannelsPremiumOnlyToggle}
                disabled={channelsPremiumOnlyLoading}
                trackColor={{ false: '#374151', true: '#7c3aed' }}
                thumbColor="#fff"
              />
            )}
          </View>
        </View>
      </View>
      </ScrollView>

      {/* Alias full screen */}
      <Modal
        visible={aliasScreenVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setAliasScreenVisible(false)}>
        <View style={styles.aliasScreenRoot}>
          <LinearGradient
            colors={['#03141e', '#051827', '#020617']}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <View style={styles.aliasHeader}>
            <TouchableOpacity onPress={() => setAliasScreenVisible(false)} style={styles.aliasHeaderIconButton}>
              <Icon name="arrow-left" size={22} color="#d1d5db" />
            </TouchableOpacity>
            <View style={styles.aliasHeaderTitleWrap}>
              <View style={styles.aliasHeaderIconWrap}>
                <Icon name="link-variant" size={18} color="#34d399" />
              </View>
              <Text style={styles.aliasHeaderTitle}>Aliases</Text>
            </View>
          </View>

          <ScrollView style={styles.aliasBody} showsVerticalScrollIndicator={false}>
            <View style={styles.aliasSectionHeaderRow}>
              <Text style={styles.aliasSectionTitle}>Aliases Management</Text>
              <TouchableOpacity style={styles.aliasAddButton} onPress={() => openAliasModal(null)}>
                <Icon name="plus" size={18} color="#fff" />
                <Text style={styles.aliasAddButtonText}>Add Alias</Text>
              </TouchableOpacity>
            </View>

            {aliasesLoading ? (
              <View style={styles.aliasCard}>
                <ActivityIndicator size="small" color="#22d3ee" />
                <Text style={[styles.channelsToggleHint, { marginTop: 10 }]}>Loading aliases...</Text>
              </View>
            ) : aliases.length === 0 ? (
              <View style={styles.aliasCard}>
                <Text style={styles.singleLabel}>No aliases yet</Text>
                <Text style={[styles.channelsToggleHint, { marginTop: 6 }]}>
                  Tap "Add Alias" to create alias mapping.
                </Text>
              </View>
            ) : (
              aliases.map((a) => (
                <View key={String(a.alias)} style={styles.aliasCard}>
                  <View style={styles.aliasCardHeader}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.aliasName}>{String(a.alias)}</Text>
                      <Text style={styles.aliasMeta}>Channel ID: {a.channel_id != null ? String(a.channel_id) : '-'}</Text>
                      <Text style={styles.aliasMeta}>Channel: {a.channel_name ? String(a.channel_name) : 'Not linked'}</Text>
                    </View>
                    <Switch
                      value={!!a.is_active}
                      onValueChange={(v) => handleAliasToggle(a, v)}
                      trackColor={{ false: '#374151', true: '#14b8a6' }}
                      thumbColor="#fff"
                    />
                    <TouchableOpacity
                      style={styles.aliasDeleteIconBtn}
                      onPress={() => setDeleteAliasConfirm(a)}>
                      <Icon name="delete" size={22} color="#f87171" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Add/Edit Alias Modal */}
      <Modal
        visible={aliasModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAliasModalVisible(false)}>
        <View style={styles.statusModalOverlay}>
          <View style={styles.statusModalContent}>
            <Text style={styles.statusModalTitle}>
              {editingAlias ? 'Edit alias' : 'Add alias'}
            </Text>
            <View style={{ width: '100%', gap: 10, marginTop: 10 }}>
              <Text style={styles.singleLabel}>Alias key</Text>
              <TextInput
                style={[styles.contactNumberInput, styles.aliasModalInput]}
                value={aliasKey}
                onChangeText={setAliasKey}
                placeholder="e.g. ss1"
                placeholderTextColor="#94a3b8"
                selectionColor="#a855f7"
                cursorColor="#a855f7"
                color="#ffffff"
                autoCapitalize="none"
              />
              <Text style={[styles.singleLabel, { marginTop: 8 }]}>Channel Name</Text>
              <TextInput
                style={[styles.contactNumberInput, styles.aliasModalInput]}
                value={aliasChannelName}
                onChangeText={(v) => {
                  setAliasChannelName(v);
                  setAliasChannelId(null);
                }}
                placeholder="Type channel name..."
                placeholderTextColor="#94a3b8"
                selectionColor="#a855f7"
                cursorColor="#a855f7"
                color="#ffffff"
              />
              <Text style={styles.channelsToggleHint}>
                Alias points to an existing channel name.
              </Text>
              {allChannels.length > 0 && String(aliasChannelName || '').trim() ? (
                <View style={{ marginTop: 8, maxHeight: 140 }}>
                  <ScrollView nestedScrollEnabled>
                    {allChannels
                      .filter((c) => String(c.name || '').toLowerCase().includes(String(aliasChannelName || '').toLowerCase()))
                      .slice(0, 8)
                      .map((c) => (
                        <TouchableOpacity
                          key={String(c.id)}
                          style={{
                            paddingVertical: 8,
                            paddingHorizontal: 10,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: '#374151',
                            marginBottom: 6,
                            backgroundColor: aliasChannelId === c.id ? 'rgba(124,58,237,0.25)' : 'rgba(3,7,18,0.6)',
                          }}
                          onPress={() => {
                            setAliasChannelName(String(c.name || ''));
                            setAliasChannelId(Number(c.id));
                          }}>
                          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
                            {String(c.name || '')}
                          </Text>
                          <Text style={{ color: '#9ca3af', fontSize: 12 }}>
                            ID: {String(c.id)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                </View>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.statusModalButton, { flex: 1, backgroundColor: '#374151' }]}
                onPress={() => setAliasModalVisible(false)}>
                <Text style={styles.statusModalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusModalButton, { flex: 1 }]}
                onPress={aliasSaving ? undefined : handleSaveAlias}
                disabled={aliasSaving}>
                {aliasSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.statusModalButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Alias Confirm */}
      <Modal
        visible={!!deleteAliasConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteAliasConfirm(null)}>
        <View style={styles.statusModalOverlay}>
          <View style={styles.statusModalContent}>
            <Text style={styles.statusModalTitle}>Delete alias</Text>
            <Text style={styles.statusModalMessage}>
              Delete alias "{String(deleteAliasConfirm?.alias || '')}"?
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.statusModalButton, { flex: 1, backgroundColor: '#374151' }]}
                onPress={() => setDeleteAliasConfirm(null)}>
                <Text style={styles.statusModalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusModalButton, { flex: 1, backgroundColor: '#ef4444' }]}
                onPress={() => handleDeleteAlias(deleteAliasConfirm?.alias)}
                disabled={aliasDeleting}>
                {aliasDeleting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.statusModalButtonText}>Delete</Text>
                )}
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
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingBottom: 100,
  },
  settingsCard: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 16,
  },
  headerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  settingsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  settingsDescription: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 24,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#7c3aed',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  aliasOpenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  aliasOpenButtonText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  contactsList: {
    gap: 16,
  },
  contactItem: {
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#374151',
  },
  contactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  contactIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(37, 211, 102, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactInfo: {
    flex: 1,
  },
  contactLabelInput: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    paddingVertical: 4,
  },
  deleteContactButton: {
    padding: 4,
  },
  contactNumberContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(3, 7, 18, 0.8)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#374151',
  },
  contactNumberInput: {
    flex: 1,
    fontSize: 15,
    color: '#fff',
  },
  aliasModalInput: {
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ffffff',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#7c3aed',
    paddingVertical: 10,
    borderRadius: 10,
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  singleLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  channelsToggleHint: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 2,
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
  aliasScreenRoot: {
    flex: 1,
    backgroundColor: '#020617',
  },
  aliasHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.5)',
    backgroundColor: 'rgba(2, 6, 23, 0.55)',
  },
  aliasHeaderIconButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    marginRight: 10,
  },
  aliasHeaderTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  aliasHeaderIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(20, 184, 166, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aliasHeaderTitle: {
    fontSize: 30,
    color: '#fff',
    fontWeight: '700',
  },
  aliasBody: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  aliasSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  aliasSectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  aliasAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#14b8a6',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  aliasAddButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  aliasCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.55)',
    padding: 14,
    marginBottom: 10,
  },
  aliasCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  aliasName: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '700',
  },
  aliasMeta: {
    color: '#cbd5e1',
    fontSize: 16,
    marginTop: 3,
  },
  aliasDeleteIconBtn: {
    marginLeft: 10,
    padding: 4,
  },
});

export default SettingsSection;
