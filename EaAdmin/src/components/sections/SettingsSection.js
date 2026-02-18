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
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminSettingsAPI } from '../../config/api';

const SettingsSection = () => {
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [statusModalTitle, setStatusModalTitle] = useState('');
  const [statusModalMessage, setStatusModalMessage] = useState('');

  const showStatusModal = (title, message) => {
    setStatusModalTitle(title);
    setStatusModalMessage(message);
    setStatusModalVisible(true);
  };

  useEffect(() => {
    const loadNumber = async () => {
      try {
        const data = await adminSettingsAPI.getWhatsAppNumber();
        if (data.number) {
          setWhatsappNumber(data.number);
        }
      } catch (error) {
        console.error('Failed to load WhatsApp number:', error);
      } finally {
        setLoading(false);
      }
    };
    loadNumber();
  }, []);

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
      </ScrollView>

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
});

export default SettingsSection;
