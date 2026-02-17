import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Linking,
  Modal,
  ActivityIndicator,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsAPI, paymentsAPI } from '../config/api';

const PaymentsScreen = ({ accentColor = '#4ade80' }) => {
  const [selectedBundle, setSelectedBundle] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState(null);
  const [userId, setUserId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [statusModalTitle, setStatusModalTitle] = useState('');
  const [statusModalMessage, setStatusModalMessage] = useState('');

  const bundles = [
    { id: 'week', name: 'Kwa Wiki', price: '3,000', duration: '7 siku', value: 3000 },
    { id: 'month', name: 'Mwezi', price: '8,000', duration: '30 siku', value: 8000 },
    { id: 'year', name: 'Mwaka', price: '15,000', duration: '365 siku', value: 15000 },
  ];

  useEffect(() => {
    const loadWhatsApp = async () => {
      try {
        const data = await settingsAPI.getWhatsAppNumber();
        if (data.number) {
          // Normalize: remove spaces
          setWhatsappNumber(data.number.replace(/\s+/g, ''));
        }
      } catch (error) {
        console.error('Failed to load WhatsApp number:', error);
      }
    };
    loadWhatsApp();

    const loadUserId = async () => {
      try {
        // Primary key used by ProfileScreen
        let storedId = await AsyncStorage.getItem('userId');

        // Fallback for any older key we might have used
        if (!storedId) {
          const legacyId = await AsyncStorage.getItem('@eamax:userId');
          if (legacyId) {
            storedId = legacyId;
            await AsyncStorage.setItem('userId', legacyId);
          }
        }

        if (storedId) {
          setUserId(storedId);
        }
      } catch (e) {
        console.error('Failed to load user id for payments:', e);
      }
    };
    loadUserId();
  }, []);

  const showStatusModal = (title, message) => {
    setStatusModalTitle(title);
    setStatusModalMessage(message);
    setStatusModalVisible(true);
  };

  const handleSendRequest = async () => {
    if (!selectedBundle) {
      showStatusModal('Chagua bundle', 'Tafadhali chagua bundle unayotaka kulipa.');
      return;
    }
    // Validate Tanzanian phone number
    // Valid prefixes: Halotel (061, 062), Mixx by Yas (065, 071), Airtel (068, 069, 078), Vodacom (074, 075, 076, 079)
    const validPrefixes = ['061', '062', '065', '068', '069', '071', '074', '075', '076', '078', '079'];
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const isValidFormat = /^0[0-9]{8,9}$/.test(cleanPhone);
    const hasValidPrefix = validPrefixes.some(prefix => cleanPhone.startsWith(prefix));
    
    if (!phoneNumber || !isValidFormat || !hasValidPrefix) {
      showStatusModal(
        'Nambari ya simu',
        'Tafadhali ingiza nambari ya simu sahihi ya Tanzania (mfano: 0612345678, 0712345678, 0742345678, 0782345678).',
      );
      return;
    }
    if (!userId) {
      showStatusModal(
        'Tatizo la akaunti',
        'Hatukuweza kutambua akaunti yako. Fungua tena sehemu ya wasifu (Profile) kisha ujaribu tena.',
      );
      return;
    }

    const bundle = bundles.find(b => b.id === selectedBundle);

    try {
      setSubmitting(true);
      // Clean phone number (remove spaces) before sending
      const cleanPhone = phoneNumber.replace(/\s+/g, '');
      const result = await paymentsAPI.startZenoPayment({
        externalId: userId,
        bundle: bundle.id,
        phone: cleanPhone,
        email: `${userId}@eamax.app`,
        name: userId,
      });

      showStatusModal(
        'Ombi limetumwa',
        result.message ||
          `Ombi lako la malipo la Tsh.${bundle.price} kwa ${bundle.name} limetumwa kwa nambari ${phoneNumber}. Tafadhali fuata maelekezo utakayopokea kwenye simu yako.`,
      );

      setSelectedBundle(null);
      setPhoneNumber('');
    } catch (error) {
      console.error('Failed to start payment:', error);
      showStatusModal(
        'Malipo yameshindikana',
        error?.message || 'Imeshindikana kutuma ombi la malipo. Jaribu tena baadae.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenWhatsApp = () => {
    if (!whatsappNumber) {
      showStatusModal(
        'Hakuna namba ya WhatsApp',
        'Tafadhali wasiliana na admin kuongeza namba ya WhatsApp kwenye sehemu ya Settings.',
      );
      return;
    }
    const phone = whatsappNumber.startsWith('+')
      ? whatsappNumber.slice(1)
      : whatsappNumber;
    const url = `https://wa.me/${phone}`;
    Linking.openURL(url).catch(() => {
      showStatusModal('Tatizo', 'Imeshindwa kufungua WhatsApp kwenye kifaa chako.');
    });
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#030712', '#111827', '#000000']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header Section */}
        <View style={styles.headerSection}>
          <View style={[styles.iconContainer, { backgroundColor: `${accentColor}20` }]}>
            <Icon name="wallet" size={32} color={accentColor} />
          </View>
          <Text style={styles.headerTitle}>Malipo</Text>
          <Text style={styles.headerSubtitle}>Chagua bundle na ingiza nambari ya simu</Text>
        </View>

        {/* Safety Message */}
        <View style={styles.safetyCard}>
          <View style={styles.safetyHeader}>
            <Icon name="shield-check" size={20} color="#10b981" />
            <Text style={styles.safetyTitle}>Salama na Hakuna Malipo ya Kiotomatiki</Text>
          </View>
          <Text style={styles.safetyText}>
            Malipo yako ni salama kabisa. Hakuna malipo ya kiotomatiki yatakayofanyika. 
            Utapokea ombi kwenye simu yako na utahitaji kuthibitisha malipo mwenyewe.
          </Text>
          <View style={styles.networksInfo}>
            <Icon name="check-circle" size={16} color="#10b981" />
            <Text style={styles.networksInfoText}>
              Inasapoti mitandao yote: Vodacom M-Pesa, Mixx by Yas, Airtel Money, na Halopesa
            </Text>
          </View>
        </View>

        {/* Bundle Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Chagua Bundle</Text>
          <View style={styles.bundlesContainer}>
            {bundles.map((bundle) => (
              <TouchableOpacity
                key={bundle.id}
                style={[
                  styles.bundleCard,
                  selectedBundle === bundle.id && [
                    styles.bundleCardActive,
                    { borderColor: accentColor },
                  ],
                ]}
                onPress={() => setSelectedBundle(bundle.id)}>
                {selectedBundle === bundle.id && (
                  <View style={[styles.checkBadge, { backgroundColor: accentColor }]}>
                    <AntDesign name="check" size={16} color="#fff" />
                  </View>
                )}
                <Text style={styles.bundleName}>{bundle.name}</Text>
                <Text style={styles.bundlePrice}>Tsh. {bundle.price}</Text>
                <Text style={styles.bundleDuration}>{bundle.duration}</Text>
                {selectedBundle === bundle.id && (
                  <View style={[styles.selectedIndicator, { backgroundColor: accentColor }]} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Phone Number Input */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ingiza Nambari ya Simu</Text>
          <View style={styles.inputContainer}>
            <Icon name="phone" size={20} color="#9ca3af" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="0612345678, 0712345678, 0742345678..."
              placeholderTextColor="#6b7280"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              maxLength={12}
            />
          </View>
          <Text style={styles.inputHint}>
            Ingiza nambari ya simu yako (Halotel: 061/062, Mixx: 065/071, Airtel: 068/069/078, Vodacom: 074/075/076/079)
          </Text>
        </View>

        {/* Send Request Button */}
        <TouchableOpacity
          style={[
            styles.sendButton,
            ((!selectedBundle || !phoneNumber) && styles.sendButtonDisabled) ||
              (submitting && styles.sendButtonDisabled),
            { backgroundColor: accentColor },
          ]}
          onPress={submitting ? undefined : handleSendRequest}
          disabled={!selectedBundle || !phoneNumber || submitting}>
          {submitting ? (
            <>
              <Icon name="clock-outline" size={20} color="#fff" />
              <Text style={styles.sendButtonText}>Inatuma ombi...</Text>
            </>
          ) : (
            <>
              <Icon name="send" size={20} color="#fff" />
              <Text style={styles.sendButtonText}>Tuma Ombi la Malipo</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Info Section */}
        <View style={styles.infoSection}>
          <View style={styles.infoRow}>
            <Icon name="information" size={18} color="#9ca3af" />
            <Text style={styles.infoText}>
              Utapokea ombi kwenye simu yako. Fuata maelekezo ili kukamilisha malipo.
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Icon name="lock" size={18} color="#9ca3af" />
            <Text style={styles.infoText}>
              Taarifa zako ni salama na hazitashirikiwa na mtu yeyote.
            </Text>
          </View>
          <TouchableOpacity style={styles.infoRow} onPress={handleOpenWhatsApp}>
            <Icon name="whatsapp" size={18} color="#22c55e" />
            <Text style={[styles.infoText, styles.whatsappText]}>
              Msaada zaidi? Bofya hapa tuandikie WhatsApp
            </Text>
          </TouchableOpacity>
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
              <Text style={styles.statusModalButtonText}>Sawa</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
  },
  scrollView: {
    flex: 1,
    paddingBottom: 100,
  },
  headerSection: {
    alignItems: 'center',
    padding: 24,
    paddingTop: 32,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
  },
  safetyCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  safetyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  safetyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#10b981',
  },
  safetyText: {
    fontSize: 14,
    color: '#d1d5db',
    lineHeight: 20,
    marginBottom: 12,
  },
  networksInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(16, 185, 129, 0.2)',
  },
  networksInfoText: {
    flex: 1,
    fontSize: 13,
    color: '#10b981',
    lineHeight: 18,
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  bundlesContainer: {
    gap: 10,
  },
  bundleCard: {
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 2,
    borderColor: 'rgba(55, 65, 81, 0.5)',
    position: 'relative',
  },
  bundleCardActive: {
    borderWidth: 2,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
  },
  checkBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bundleName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
  },
  bundlePrice: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#4ade80',
    marginBottom: 2,
  },
  bundleDuration: {
    fontSize: 12,
    color: '#9ca3af',
  },
  selectedIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.5)',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    height: 50,
    color: '#fff',
    fontSize: 16,
  },
  inputHint: {
    fontSize: 12,
    color: '#6b7280',
    marginLeft: 4,
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 24,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  infoSection: {
    paddingHorizontal: 16,
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#9ca3af',
    lineHeight: 18,
  },
  whatsappText: {
    color: '#22c55e',
    fontWeight: '600',
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
    backgroundColor: '#22c55e',
  },
  statusModalButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
});

export default PaymentsScreen;
