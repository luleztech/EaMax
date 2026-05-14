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
  Platform,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsAPI, paymentsAPI } from '../config/api';

const ACCENT = '#22c55e';
const ACCENT_DARK = '#16a34a';

/** Tanzanian GSM prefixes — must match backend `payments.js` */
const TZ_MOBILE_PREFIXES = ['061', '062', '063', '065', '067', '068', '069', '071', '074', '075', '076', '077', '078', '079'];

/** Align with backend `mapPaymentGatewayUserError` for any raw gateway strings still shown in the client. */
function mapPaymentGatewayErrorToSwahili(message) {
  const m = String(message || '');
  const l = m.toLowerCase();
  if (
    l.includes('user not found') ||
    l.includes('could not resolve user') ||
    (l.includes('not found') && l.includes('user'))
  ) {
    return 'Akaunti haijasawirishwa kwenye seva. Fungua Wasifu kisha jaribu tena.';
  }
  if (
    /\b9009\b/.test(l) ||
    /\b(?:not enough|insufficient funds?|insufficient balance|low balance|balance of customer is not enough)\b/i.test(
      l,
    ) ||
    /\bhaiatoshi\b|\bhalitoshi\b|\bhatoshi\b|\bhaatoshi\b/i.test(l) ||
    /\bsi\s+la\s+kutosha\b/i.test(l) ||
    /\bsalio\s+(?:dogo|chache)\b/i.test(l)
  ) {
    return 'Salio la wallet yako si la kutosha kwa kiasi hiki. Ongeza pesa kwenye akaunti yako ya simu, kisha ujaribu tena.';
  }
  if (
    l.includes('upstream') ||
    l.includes('no response from upstream') ||
    l.includes('malipo hayajatumika') ||
    l.includes('hayajatumika')
  ) {
    return 'Mtandao wa pesa ulikawia kuthibitisha ombi. Hakikisha una mtandao mzuri wa simu na salio la kutosha, kisha ujaribu tena.';
  }
  return m;
}

/** Normalize user input to local TZ format (0…). Returns { local } or { error: 'international' | 'invalid' } */
function normalizeTzPhoneToLocal(raw) {
  let s = String(raw || '').replace(/\s+/g, '');
  if (!s) return { error: 'invalid', local: null };
  if (s.startsWith('+')) {
    if (!s.startsWith('+255')) return { error: 'international', local: null };
    s = `0${s.slice(4)}`;
  } else if (s.startsWith('00255')) {
    s = `0${s.slice(5)}`;
  } else if (s.startsWith('255') && s.length >= 12) {
    s = `0${s.slice(3)}`;
  }
  if (!/^\d+$/.test(s)) return { error: 'invalid', local: null };
  return { error: null, local: s };
}

const PaymentsScreen = ({ accentColor = ACCENT, bottomPadding = 0, onPaymentSuccess }) => {
  const [selectedBundle, setSelectedBundle] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState(null);
  const [userId, setUserId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [statusModalTitle, setStatusModalTitle] = useState('');
  const [statusModalMessage, setStatusModalMessage] = useState('');
  const [statusIsSuccess, setStatusIsSuccess] = useState(true);
  const [pollingOrderId, setPollingOrderId] = useState(null);
  const [pollingIntervalId, setPollingIntervalId] = useState(null);
  const [consecutiveOrderNotFound, setConsecutiveOrderNotFound] = useState(0);
  const [simulating, setSimulating] = useState(false);
  const [lastPaymentSuccess, setLastPaymentSuccess] = useState(false);

  const bundles = [
    { id: 'week', name: 'Kwa Wiki', price: '2,000', duration: '7 siku', value: 2000, popular: false },
    { id: 'month', name: 'Mwezi', price: '5,000', duration: '30 siku', value: 5000, popular: true },
    { id: 'year', name: 'Miezi 3', price: '12,000', duration: 'miezi 3', value: 12000, popular: false },
  ];

  // When success modal closes, trigger one more refresh to be absolutely sure
  useEffect(() => {
    if (lastPaymentSuccess && !statusModalVisible) {
      console.log('[Payment] Modal closed after success, triggering final refresh...');
      if (onPaymentSuccess) {
        Promise.resolve(onPaymentSuccess()).catch(err => {
          console.warn('Final refresh callback error:', err);
        });
      }
      setLastPaymentSuccess(false);
    }
  }, [statusModalVisible, lastPaymentSuccess, onPaymentSuccess]);

  useEffect(() => {
    const loadWhatsApp = async () => {
      try {
        const data = await settingsAPI.getWhatsAppNumber();
        if (data.number) setWhatsappNumber(data.number.replace(/\s+/g, ''));
      } catch (error) {
        console.error('Failed to load WhatsApp number:', error);
      }
    };
    loadWhatsApp();

    const loadUserId = async () => {
      try {
        let storedId = await AsyncStorage.getItem('userId');
        if (!storedId) {
          const legacyId = await AsyncStorage.getItem('@eamax:userId');
          if (legacyId) {
            storedId = legacyId;
            await AsyncStorage.setItem('userId', legacyId);
          }
        }
        if (storedId) setUserId(storedId);
      } catch (e) {
        console.error('Failed to load user id for payments:', e);
      }
    };
    loadUserId();

    // When opening Payments screen, if there was a pending payment (e.g. user paid and left), check once so we can refresh to Premium
    const checkPendingPayment = async () => {
      try {
        const pending = await AsyncStorage.getItem('pendingPaymentOrderId');
        if (!pending || !pending.trim()) return;
        const res = await paymentsAPI.checkPaymentStatus(pending.trim());
        const status = res?.status || res?.raw?.data?.[0]?.payment_status;
        if (String(status).toUpperCase() === 'COMPLETED') {
          await AsyncStorage.removeItem('pendingPaymentOrderId');
          if (onPaymentSuccess) await Promise.resolve(onPaymentSuccess());
        } else {
          setPollingOrderId(pending.trim());
        }
      } catch (_) {}
    };
    checkPendingPayment();

    // Cleanup polling on unmount
    return () => {
      if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
      }
    };
  }, [pollingIntervalId, onPaymentSuccess]);

  // Poll for payment status if we have an order ID
  useEffect(() => {
    if (!pollingOrderId) {
      setConsecutiveOrderNotFound(0);
      return;
    }

    const pollPaymentStatus = async () => {
      try {
        console.log(`[Payment] Checking status for order: ${pollingOrderId}`);
        const response = await paymentsAPI.checkPaymentStatus(pollingOrderId);
        const paymentStatus = String(
          response?.status || response?.raw?.data?.[0]?.payment_status || '',
        ).toUpperCase();
        if (paymentStatus === 'COMPLETED') {
          // Payment successful! Backend has already applied unlock + premium + revenue
          clearInterval(pollingIntervalId);
          setPollingIntervalId(null);
          setPollingOrderId(null);
          setConsecutiveOrderNotFound(0);
          await AsyncStorage.removeItem('pendingPaymentOrderId');

          console.log('[Payment] Payment COMPLETED! Triggering immediate upgrade...');

          // Call onPaymentSuccess IMMEDIATELY without delay for instant upgrade
          if (onPaymentSuccess) {
            try {
              console.log('[Payment] Calling onPaymentSuccess callback immediately');
              await Promise.resolve(onPaymentSuccess());
              setLastPaymentSuccess(true);
            } catch (e) {
              console.warn('Payment success callback error:', e);
            }
          }

          // Show success modal with auto-close
          showStatusModal(
            'Habari Njema!',
            'Malipo yako yamefaulu! Umebadilisha kuwa Premium. Sasa una access kwenye chaneli zote.',
            true,
          );

          // Auto-close modal after 2 seconds so user sees the upgrade immediately
          setTimeout(() => {
            setStatusModalVisible(false);
          }, 2000);
        }
      } catch (error) {
        console.error('Error checking payment status:', error);
        // Check if it's an "order not found" error - this is expected initially
        const isOrderNotFound = error.message?.includes('no order found') || 
                               error.message?.includes('order not found') ||
                               error.message?.includes('not found');
        
        if (isOrderNotFound) {
          console.log(`[Payment] Order ${pollingOrderId} not found yet, continuing to poll...`);
          setConsecutiveOrderNotFound(prev => {
            const newCount = prev + 1;
            console.log(`[Payment] Consecutive order not found: ${newCount}`);
            
            // If we've had too many consecutive "order not found" errors, stop polling
            if (newCount >= 12) {
              console.error('[Payment] Too many consecutive "order not found" errors, stopping polling');
              clearInterval(pollingIntervalId);
              setPollingIntervalId(null);
              setPollingOrderId(null);
              setConsecutiveOrderNotFound(0);

              showStatusModal(
                'Malipo hayajathibitishwa',
                'Hatukuweza kuthibitisha ombi la malipo kwa muda mfupi. Jaribu tena na mtandao mzuri wa simu.',
                false,
              );
            }
            return newCount;
          });
        } else {
          // Only log as error for unexpected errors, continue polling for "order not found"
          console.warn('Unexpected error checking payment status (continuing to poll):', error.message);
        }
        // Continue polling even if there's an error (including "order not found")
      }
    };

    // Start polling after a short delay so we catch COMPLETED quickly (user may complete payment on phone within seconds)
    const timeoutId = setTimeout(() => {
      setConsecutiveOrderNotFound(0); // Reset counter when starting polling
      let pollCount = 0;
      const maxPolls = 30; // ~1 min @ 2s — aligns with app UX; webhook still completes if user pays late

      const interval = setInterval(async () => {
        pollCount += 1;
        await pollPaymentStatus();

        // Stop polling after max attempts
        if (pollCount >= maxPolls) {
          clearInterval(interval);
          setPollingIntervalId(null);
          setPollingOrderId(null);
        }
      }, 2000); // Poll every 2 seconds

      setPollingIntervalId(interval);
    }, 500); // Start polling quickly after STK is sent

    return () => {
      clearTimeout(timeoutId);
      if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
      }
      setConsecutiveOrderNotFound(0);
    };
  }, [pollingOrderId, onPaymentSuccess, pollingIntervalId]);

  const showStatusModal = (title, message, isSuccess = true) => {
    setStatusModalTitle(title);
    setStatusModalMessage(message);
    setStatusIsSuccess(isSuccess);
    setStatusModalVisible(true);
  };

  const handleOpenWhatsApp = () => {
    if (!whatsappNumber) {
      showStatusModal(
        'Hakuna namba ya WhatsApp',
        'Tafadhali wasiliana na admin kuongeza namba ya WhatsApp kwenye sehemu ya Settings.',
        false,
      );
      return;
    }
    const phone = whatsappNumber.startsWith('+') ? whatsappNumber.slice(1) : whatsappNumber;
    Linking.openURL(`https://wa.me/${phone}`).catch(() => {
      showStatusModal('Tatizo', 'Imeshindwa kufungua WhatsApp kwenye kifaa chako.', false);
    });
  };

  const handleSendRequest = async () => {
    if (!selectedBundle) {
      showStatusModal('Chagua bundle', 'Tafadhali chagua bundle unayotaka kulipa.', false);
      return;
    }
    const validPrefixes = ['061', '062', '063', '065', '067', '068', '069', '071', '074', '075', '076', '077', '078', '079'];
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const isValidFormat = /^0[0-9]{8,9}$/.test(cleanPhone);
    const hasValidPrefix = validPrefixes.some(prefix => cleanPhone.startsWith(prefix));

    if (!phoneNumber || !isValidFormat || !hasValidPrefix) {
      showStatusModal(
        'Nambari ya simu',
        'Tafadhali ingiza nambari ya simu sahihi ya Tanzania (mfano: 0612345678, 0632345678, 0712345678, 0742345678, 0782345678).',
        false,
      );
      return;
    }
    if (!userId) {
      showStatusModal(
        'Tatizo la akaunti',
        'Hatukuweza kutambua akaunti yako. Fungua tena sehemu ya wasifu (Profile) kisha ujaribu tena.',
        false,
      );
      return;
    }

    const bundle = bundles.find(b => b.id === selectedBundle);
    try {
      setSubmitting(true);
      const result = await paymentsAPI.startPayment({
        externalId: userId,
        bundle: bundle.id,
        amount: bundle.value,
        phone: cleanPhone,
        email: `${userId}@eamax.app`,
        name: userId,
      });

      setPollingOrderId(result.orderId);
      await AsyncStorage.setItem('pendingPaymentOrderId', result.orderId);

      showStatusModal(
        'Ombi limetumwa',
        result.message ||
          `Ombi lako la malipo la Tsh.${bundle.price} kwa ${bundle.name} limetumwa kwa nambari ${cleanPhone}. Tafadhali fuata maelekezo utakayopokea kwenye simu yako.`,
        true,
      );
      setSelectedBundle(null);
      setPhoneNumber('');
    } catch (error) {
      console.error('Failed to start payment:', error);
      const mapped = mapPaymentGatewayErrorToSwahili(error?.message);
      showStatusModal(
        'Malipo yameshindikana',
        mapped && mapped.trim()
          ? mapped
          : 'Imeshindikana kutuma ombi la malipo. Jaribu tena baadae.',
        false,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSimulateSuccess = async () => {
    if (!pollingOrderId || simulating) return;
    setSimulating(true);
    try {
      await paymentsAPI.completePaymentForTesting(pollingOrderId);
      if (pollingIntervalId) clearInterval(pollingIntervalId);
      setPollingIntervalId(null);
      setPollingOrderId(null);
      AsyncStorage.removeItem('pendingPaymentOrderId');
      showStatusModal(
        'Habari Njema!',
        'Malipo yamefanikiwa (jaribio). Umebadilisha kuwa Premium. Chaneli zote sasa zimefunguliwa.',
        true,
      );
      if (onPaymentSuccess) await Promise.resolve(onPaymentSuccess());
    } catch (e) {
      console.error('Simulate success failed:', e);
      showStatusModal(
        'Tatizo',
        e?.message || 'Imeshindikana kukamilisha. Hakikisha backend iko deployed.',
        false,
      );
    } finally {
      setSimulating(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#030712', '#0f172a', '#020617']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 48 + bottomPadding }]}
        showsVerticalScrollIndicator={false}>
        {/* Hero header */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <LinearGradient
              colors={[`${accentColor}40`, `${accentColor}15`]}
              style={styles.heroIconGradient}>
              <Icon name="credit-card-outline" size={36} color={accentColor} />
            </LinearGradient>
          </View>
          <Text style={styles.heroTitle}>Fanya Malipo</Text>
          <Text style={styles.heroSubtitle}>
            Chagua muda, ingiza nambari ya simu. Utapokea ombi kwenye simu yako.
          </Text>
        </View>

        {/* Trust strip */}
        <View style={styles.trustStrip}>
          <View style={styles.trustItem}>
            <Icon name="shield-check" size={18} color="#10b981" />
            <Text style={styles.trustText}>Salama</Text>
          </View>
          <View style={styles.trustDivider} />
          <View style={styles.trustItem}>
            <Icon name="cellphone-check" size={18} color="#10b981" />
            <Text style={styles.trustText}>M-Pesa, Airtel,Tigo na Halopesa</Text>
          </View>
        </View>

        {/* Bundle section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Chagua muda</Text>
          <View style={styles.bundlesRow}>
            {bundles.map((bundle) => {
              const isSelected = selectedBundle === bundle.id;
              return (
                <TouchableOpacity
                  key={bundle.id}
                  activeOpacity={0.85}
                  onPress={() => setSelectedBundle(bundle.id)}
                  style={[styles.bundleCard, isSelected && styles.bundleCardSelected]}>
                  {bundle.popular && (
                    <View style={styles.popularBadge}>
                      <Text style={styles.popularBadgeText}>Inayopendwa</Text>
                    </View>
                  )}
                  {isSelected && (
                    <View style={styles.bundleCheck}>
                      <AntDesign name="check" size={14} color="#fff" />
                    </View>
                  )}
                  <Text style={[styles.bundleName, isSelected && styles.bundleNameSelected]}>
                    {bundle.name}
                  </Text>
                  <Text style={styles.bundlePrice}>Tsh. {bundle.price}</Text>
                  <Text style={styles.bundleDuration}>{bundle.duration}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Phone input */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Namba yako ya simu (Tanzania)</Text>
          <View style={styles.inputWrap}>
            <View style={styles.inputPrefix}>
              <Text style={styles.inputPrefixText}>+255</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Weka namba yako ya simu"
              placeholderTextColor="#64748b"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              maxLength={15}
            />
          </View>
          <Text style={styles.inputHint}>
            Nambari ya Tanzania pekee: anza kwa 0 (mfano 0712345678) au bandika +255712345678 — ombi litatumwa kwa muundo wa ndani (0…).
          </Text>
          {(phoneNumber.startsWith('061') || phoneNumber.startsWith('062') || phoneNumber.startsWith('063')) && (
            <Text style={[styles.inputHint, styles.halotelHint]}>
              Halotel: Hakikisha Halopesa iko active. Piga 150*88# kukagua.
            </Text>
          )}
          {(phoneNumber.startsWith('067') || phoneNumber.startsWith('077')) && (
            <Text style={[styles.inputHint, styles.halotelHint]}>
              Tigo: Hakikisha akaunti ya Tigo Pesa iko tayari kupokea ombi la malipo.
            </Text>
          )}
        </View>

        {/* CTA */}
        <TouchableOpacity
          activeOpacity={0.9}
          style={[
            styles.ctaWrap,
            (!selectedBundle || !phoneNumber || submitting) && styles.ctaDisabled,
          ]}
          onPress={submitting ? undefined : handleSendRequest}
          disabled={!selectedBundle || !phoneNumber || submitting}>
          <LinearGradient
            colors={selectedBundle && phoneNumber && !submitting ? [ACCENT, ACCENT_DARK] : ['#475569', '#334155']}
            style={styles.ctaGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}>
            {submitting ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.ctaText}>Inatuma...</Text>
              </>
            ) : (
              <>
                <Icon name="send-circle-outline" size={22} color="#fff" />
                <Text style={styles.ctaText}>Tuma ombi la malipo</Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Only in development/debug: simulate payment success for testing without real ZenoPay (hidden in release) */}
        {__DEV__ && pollingOrderId ? (
          <TouchableOpacity
            style={styles.simulateBtn}
            onPress={handleSimulateSuccess}
            disabled={simulating}>
            {simulating ? (
              <ActivityIndicator size="small" color="#64748b" />
            ) : (
              <Text style={styles.simulateBtnText}>Test: Mark as paid (unlock Premium now)</Text>
            )}
          </TouchableOpacity>
        ) : null}

        {/* Info + WhatsApp */}
        <View style={styles.footerInfo}>
          <View style={styles.footerRow}>
            <Icon name="information-outline" size={18} color="#64748b" />
            <Text style={styles.footerRowText}>
              Utapokea ombi kwenye simu. Fuata maelekezo ili kukamilisha.
            </Text>
          </View>
          <TouchableOpacity style={styles.whatsappRow} onPress={handleOpenWhatsApp} activeOpacity={0.8}>
            <View style={styles.whatsappIconWrap}>
              <Icon name="whatsapp" size={22} color="#fff" />
            </View>
            <View style={styles.whatsappTextWrap}>
              <Text style={styles.whatsappTitle}>Msaada zaidi?</Text>
              <Text style={styles.whatsappSubtitle}>Tuandikie kwenye WhatsApp</Text>
            </View>
            <AntDesign name="right" size={16} color="#22c55e" />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={submitting} transparent animationType="fade">
        <View style={styles.sendingOverlay} pointerEvents="box-none">
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.sendingTitle}>Tunatuma ombi la malipo…</Text>
          <Text style={styles.sendingHint}>Subiri kidogo — mtandao unaweza kuchukua sekunde chache.</Text>
        </View>
      </Modal>

      {/* Status modal */}
      <Modal
        visible={statusModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusModalVisible(false)}>
        <TouchableOpacity
          activeOpacity={1}
          style={styles.modalOverlay}
          onPress={() => setStatusModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.modalCard}>
            <View style={[styles.modalIconWrap, statusIsSuccess ? styles.modalIconSuccess : styles.modalIconError]}>
              <Icon
                name={statusIsSuccess ? 'check-circle' : 'alert-circle'}
                size={44}
                color={statusIsSuccess ? '#22c55e' : '#f59e0b'}
              />
            </View>
            <Text style={styles.modalTitle}>{statusModalTitle}</Text>
            <Text style={styles.modalMessage}>{statusModalMessage}</Text>
            <TouchableOpacity
              style={[styles.modalBtn, statusIsSuccess && styles.modalBtnSuccess]}
              onPress={() => setStatusModalVisible(false)}>
              <Text style={styles.modalBtnText}>Sawa</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
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
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 24,
  },
  heroIconWrap: {
    marginBottom: 16,
  },
  heroIconGradient: {
    width: 72,
    height: 72,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 15,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  trustStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  trustItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trustText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#10b981',
  },
  trustDivider: {
    width: 1,
    height: 18,
    backgroundColor: 'rgba(16, 185, 129, 0.4)',
    marginHorizontal: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  bundlesRow: {
    flexDirection: 'row',
    gap: 10,
  },
  bundleCard: {
    flex: 1,
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    borderRadius: 16,
    padding: 16,
    paddingTop: 14,
    borderWidth: 2,
    borderColor: 'rgba(71, 85, 105, 0.4)',
    ...Platform.select({
      android: { elevation: 2 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4 },
    }),
  },
  bundleCardSelected: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
  },
  bundleCardPopular: {
    paddingTop: 28,
  },
  popularBadge: {
    position: 'absolute',
    top: -1,
    left: 0,
    right: 0,
    backgroundColor: '#22c55e',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingVertical: 4,
    alignItems: 'center',
  },
  popularBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  bundleCheck: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bundleName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#e2e8f0',
    marginBottom: 6,
  },
  bundleNameSelected: {
    color: '#fff',
  },
  bundlePrice: {
    fontSize: 18,
    fontWeight: '800',
    color: '#22c55e',
    marginBottom: 2,
  },
  bundleDuration: {
    fontSize: 12,
    color: '#64748b',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(71, 85, 105, 0.4)',
    overflow: 'hidden',
  },
  inputPrefix: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    backgroundColor: 'rgba(51, 65, 85, 0.5)',
  },
  inputPrefixText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#94a3b8',
  },
  input: {
    flex: 1,
    height: 52,
    paddingHorizontal: 14,
    color: '#fff',
    fontSize: 16,
  },
  inputHint: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 8,
    marginLeft: 4,
  },
  halotelHint: {
    marginTop: 12,
    color: '#fbbf24',
  },
  ctaWrap: {
    marginTop: 8,
    marginBottom: 32,
    borderRadius: 14,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 4 },
      ios: { shadowColor: '#22c55e', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
    }),
  },
  ctaDisabled: {
    opacity: 0.7,
  },
  ctaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  simulateBtn: {
    marginBottom: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(100, 116, 139, 0.25)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(100, 116, 139, 0.4)',
    alignItems: 'center',
  },
  simulateBtnText: {
    fontSize: 13,
    color: '#94a3b8',
  },
  footerInfo: {
    gap: 14,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  footerRowText: {
    flex: 1,
    fontSize: 13,
    color: '#64748b',
    lineHeight: 20,
  },
  whatsappRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.25)',
  },
  whatsappIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  whatsappTextWrap: {
    flex: 1,
  },
  whatsappTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  whatsappSubtitle: {
    fontSize: 13,
    color: '#22c55e',
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sendingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },
  sendingTitle: {
    marginTop: 18,
    fontSize: 17,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
  },
  sendingHint: {
    marginTop: 8,
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(71, 85, 105, 0.5)',
  },
  modalIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalIconSuccess: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
  },
  modalIconError: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  modalBtn: {
    backgroundColor: '#334155',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  modalBtnSuccess: {
    backgroundColor: '#22c55e',
  },
  modalBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});

export default PaymentsScreen;
