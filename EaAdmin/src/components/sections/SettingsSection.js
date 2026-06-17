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
import { adminSettingsAPI } from '../../config/api';

const SettingsSection = () => {
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [channelsPremiumOnly, setChannelsPremiumOnly] = useState(false);
  const [channelsPremiumOnlyLoading, setChannelsPremiumOnlyLoading] = useState(true);
  const [channelsPremiumOnlySaving, setChannelsPremiumOnlySaving] = useState(false);
  const [paymentProvider, setPaymentProvider] = useState('zeno');
  const [paymentProviderLoading, setPaymentProviderLoading] = useState(true);
  const [paymentProviderSaving, setPaymentProviderSaving] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [statusModalTitle, setStatusModalTitle] = useState('');
  const [statusModalMessage, setStatusModalMessage] = useState('');

  const showStatusModal = (title, message) => {
    setStatusModalTitle(title);
    setStatusModalMessage(message);
    setStatusModalVisible(true);
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [whatsappRes, premiumRes, providerRes] = await Promise.all([
          adminSettingsAPI.getWhatsAppNumber(),
          adminSettingsAPI.getChannelsPremiumOnly().catch(() => ({ channelsPremiumOnly: false })),
          adminSettingsAPI.getPaymentProvider().catch(() => ({ paymentProvider: 'zeno' })),
        ]);
        if (whatsappRes.number) setWhatsappNumber(whatsappRes.number);
        setChannelsPremiumOnly(!!premiumRes.channelsPremiumOnly);
        setPaymentProvider(providerRes.paymentProvider || 'zeno');
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setLoading(false);
        setChannelsPremiumOnlyLoading(false);
        setPaymentProviderLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleSaveNumber = async () => {
    if (!whatsappNumber.trim()) {
      showStatusModal('Missing number', 'Please enter a WhatsApp number.');
      return;
    }
    try {
      setSaving(true);
      await adminSettingsAPI.updateWhatsAppNumber(whatsappNumber.trim());
      showStatusModal('Number saved', 'WhatsApp number saved successfully.');
    } catch (error) {
      console.error('Failed to save WhatsApp number:', error);
      showStatusModal('Save failed', 'Failed to save WhatsApp number. Please try again.');
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
          ? 'Premium-only mode: payments required for channels.'
          : 'Standard mode: points and ads apply where configured.',
      );
    } catch (error) {
      console.error('Failed to update channels premium-only:', error);
      setChannelsPremiumOnly(previous);
      showStatusModal('Update failed', 'Could not update access mode. Try again.');
    } finally {
      setChannelsPremiumOnlySaving(false);
    }
  };

  const handlePaymentProviderSelect = async (next) => {
    if (paymentProviderSaving || next === paymentProvider) return;
    const previous = paymentProvider;
    setPaymentProvider(next);
    try {
      setPaymentProviderSaving(true);
      await adminSettingsAPI.updatePaymentProvider(next);
      showStatusModal(
        'Setting saved',
        next === 'sonicpesa'
          ? 'Payment provider switched to SonicPesa.'
          : 'Payment provider switched to ZenoPay.',
      );
    } catch (error) {
      console.error('Failed to update payment provider:', error);
      setPaymentProvider(previous);
      showStatusModal('Update failed', 'Could not update payment provider. Try again.');
    } finally {
      setPaymentProviderSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#7c3aed" />
        <Text style={styles.loadingText}>Loading settings...</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.settingsCard}>
          <View style={styles.headerSection}>
            <Text style={styles.settingsTitle}>WhatsApp</Text>
          </View>

          <View style={styles.contactsList}>
            <View style={styles.contactItem}>
              <View style={styles.contactHeader}>
                <View style={styles.contactIconContainer}>
                  <Icon name="whatsapp" size={24} color="#25D366" />
                </View>
                <View style={styles.contactInfo}>
                  <Text style={styles.singleLabel}>Support number</Text>
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
            <Text style={styles.settingsTitle}>Channels access</Text>
          </View>
          <View style={styles.contactItem}>
            <View style={styles.contactHeader}>
              <View style={styles.contactIconContainer}>
                <Icon name="lock-outline" size={24} color="#a855f7" />
              </View>
              <View style={styles.contactInfo}>
                <Text style={styles.singleLabel}>Premium only</Text>
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

        <View style={styles.settingsCard}>
          <View style={styles.headerSection}>
            <Text style={styles.settingsTitle}>Payment provider</Text>
          </View>
          <View style={styles.contactItem}>
            <View style={styles.contactHeader}>
              <View style={styles.contactIconContainer}>
                <Icon name="credit-card-outline" size={24} color="#22c55e" />
              </View>
              <View style={styles.contactInfo}>
                <Text style={styles.singleLabel}>Active provider</Text>
              </View>
              {paymentProviderSaving ? (
                <ActivityIndicator size="small" color="#22c55e" />
              ) : null}
            </View>
            <View style={styles.providerPickRow}>
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={paymentProviderLoading || paymentProviderSaving}
                onPress={() => handlePaymentProviderSelect('zeno')}
                style={[
                  styles.providerChip,
                  paymentProvider === 'zeno' && styles.providerChipSelected,
                ]}>
                <Text
                  style={[
                    styles.providerChipText,
                    paymentProvider === 'zeno' && styles.providerChipTextSelected,
                  ]}>
                  ZenoPay
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={paymentProviderLoading || paymentProviderSaving}
                onPress={() => handlePaymentProviderSelect('sonicpesa')}
                style={[
                  styles.providerChip,
                  paymentProvider === 'sonicpesa' && styles.providerChipSelected,
                ]}>
                <Text
                  style={[
                    styles.providerChipText,
                    paymentProvider === 'sonicpesa' && styles.providerChipTextSelected,
                  ]}>
                  SonicPesa
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>

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
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#9ca3af',
  },
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
  singleLabelSmall: {
    fontSize: 13,
    color: '#cbd5e1',
    marginTop: 4,
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
  providerPickRow: {
    flexDirection: 'row',
    marginTop: 4,
    marginHorizontal: -4,
  },
  providerChip: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4b5563',
    backgroundColor: 'rgba(3, 7, 18, 0.6)',
    alignItems: 'center',
  },
  providerChipSelected: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
  },
  providerChipText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#9ca3af',
  },
  providerChipTextSelected: {
    color: '#fff',
  },
});

export default SettingsSection;
