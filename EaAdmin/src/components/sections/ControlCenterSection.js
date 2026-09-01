import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Switch,
  RefreshControl,
  Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminControlAPI } from '../../config/api';
import { GLOBAL_PLAYER_ENGINES, normalizePlayerEngine } from '../../constants/playerEngines';

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#0c1220',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.12)',
    marginBottom: 16,
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    color: '#9aa8bd',
    marginBottom: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    color: '#e5e7eb',
    marginRight: 12,
  },
  fieldLabel: {
    fontSize: 14,
    color: '#d1d5db',
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    backgroundColor: 'rgba(3, 7, 18, 0.8)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#374151',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 12,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inputHalf: {
    flex: 1,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#14b8a6',
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 8,
  },
  saveBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
});

const ToggleRow = ({ label, value, onChange, disabled }) => (
  <View style={cardStyles.row}>
    <Text style={cardStyles.rowLabel}>{label}</Text>
    {disabled ? (
      <ActivityIndicator size="small" color="#a855f7" />
    ) : (
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#374151', true: '#7c3aed' }}
        thumbColor="#fff"
      />
    )}
  </View>
);

const ControlCenterSection = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingPlayer, setSavingPlayer] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [statusModalTitle, setStatusModalTitle] = useState('');
  const [statusModalMessage, setStatusModalMessage] = useState('');

  const [playerConfig, setPlayerConfig] = useState({
    preferredEngine: 'auto',
    reconnectEnabled: true,
    autoPlay: true,
    defaultQuality: '480p',
    defaultLanguage: 'sw',
    failoverToWebview: true,
    hardwareAcceleration: true,
    softwareDecodeFallback: true,
    backgroundPlayback: false,
    resumePlayback: true,
  });

  const [emergency, setEmergency] = useState({
    maintenanceMode: false,
    maintenanceMessageSw: '',
    disablePayments: false,
    disableChannels: false,
    disabledChannelIds: '',
  });
  const [savingEmergency, setSavingEmergency] = useState(false);

  const showStatus = (title, message) => {
    setStatusModalTitle(title);
    setStatusModalMessage(message);
    setStatusModalVisible(true);
  };

  const load = useCallback(async () => {
    try {
      const [playerRes, emergencyRes] = await Promise.all([
        adminControlAPI.getPlayerConfig(),
        adminControlAPI.getEmergencyControls(),
      ]);
      const pc = playerRes?.config || {};
      setPlayerConfig({
        preferredEngine: normalizePlayerEngine(pc.preferredEngine) === 'default'
          ? 'auto'
          : normalizePlayerEngine(pc.preferredEngine),
        reconnectEnabled: pc.reconnectEnabled !== false,
        autoPlay: pc.autoPlay !== false,
        defaultQuality: pc.defaultQuality || '480p',
        defaultLanguage: pc.defaultLanguage === 'en' ? 'en' : 'sw',
        failoverToWebview: pc.failoverToWebview !== false,
        hardwareAcceleration: pc.hardwareAcceleration !== false,
        softwareDecodeFallback: pc.softwareDecodeFallback !== false,
        backgroundPlayback: pc.backgroundPlayback === true,
        resumePlayback: pc.resumePlayback !== false,
      });
      const ec = emergencyRes?.controls || {};
      setEmergency({
        maintenanceMode: ec.maintenanceMode === true,
        maintenanceMessageSw: ec.maintenanceMessageSw || '',
        disablePayments: ec.disablePayments === true,
        disableChannels: ec.disableChannels === true,
        disabledChannelIds: Array.isArray(ec.disabledChannelIds)
          ? ec.disabledChannelIds.join(', ')
          : '',
      });
    } catch (e) {
      showStatus('Hitilafu', e?.message || 'Imeshindwa kupakia');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const savePlayer = async () => {
    setSavingPlayer(true);
    try {
      await adminControlAPI.updatePlayerConfig({
        preferredEngine: playerConfig.preferredEngine || 'auto',
        reconnectEnabled: playerConfig.reconnectEnabled,
        autoPlay: playerConfig.autoPlay,
        defaultQuality: playerConfig.defaultQuality || '480p',
        defaultLanguage: playerConfig.defaultLanguage === 'en' ? 'en' : 'sw',
        languagesAllowed: ['sw', 'en'],
        failoverToWebview: playerConfig.failoverToWebview,
        hardwareAcceleration: playerConfig.hardwareAcceleration,
        softwareDecodeFallback: playerConfig.softwareDecodeFallback,
        backgroundPlayback: playerConfig.backgroundPlayback,
        resumePlayback: playerConfig.resumePlayback,
      });
      showStatus('Imefanikiwa', 'Player imehifadhiwa. Watumiaji wataitumia mara moja.');
    } catch (e) {
      showStatus('Hitilafu', e?.message || 'Imeshindwa kuhifadhi');
    } finally {
      setSavingPlayer(false);
    }
  };

  const saveEmergency = async () => {
    setSavingEmergency(true);
    try {
      const ids = emergency.disabledChannelIds
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      await adminControlAPI.updateEmergencyControls({
        maintenanceMode: emergency.maintenanceMode,
        maintenanceMessageSw: emergency.maintenanceMessageSw,
        disablePayments: emergency.disablePayments,
        disableChannels: emergency.disableChannels,
        disabledChannelIds: ids,
      });
      showStatus('Imefanikiwa', 'Emergency controls zimehifadhiwa.');
    } catch (e) {
      showStatus('Hitilafu', e?.message || 'Imeshindwa kuhifadhi');
    } finally {
      setSavingEmergency(false);
    }
  };

  const activeEngine = GLOBAL_PLAYER_ENGINES.find(
    (e) => e.id === playerConfig.preferredEngine,
  ) || GLOBAL_PLAYER_ENGINES[0];

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor="#7c3aed"
          />
        }>
        <View style={cardStyles.card}>
          <Text style={cardStyles.title}>Player</Text>
          <View style={styles.activeBanner}>
            <Icon name={activeEngine.icon} size={22} color="#c4b5fd" />
            <View style={styles.activeBannerText}>
              <Text style={styles.activeLabel}>Inatumika sasa</Text>
              <Text style={styles.activeName}>{activeEngine.label}</Text>
            </View>
          </View>

          <Text style={cardStyles.fieldLabel}>Chagua player</Text>
          {GLOBAL_PLAYER_ENGINES.map((engine) => {
            const selected = playerConfig.preferredEngine === engine.id;
            return (
              <TouchableOpacity
                key={engine.id}
                style={[styles.engineCard, selected && styles.engineCardActive]}
                onPress={() => setPlayerConfig((p) => ({ ...p, preferredEngine: engine.id }))}
                activeOpacity={0.85}>
                <View style={styles.engineCardTop}>
                  <View style={[styles.engineIconWrap, selected && styles.engineIconWrapActive]}>
                    <Icon name={engine.icon} size={22} color={selected ? '#fff' : '#9ca3af'} />
                  </View>
                  <View style={styles.engineCardBody}>
                    <Text style={[styles.engineName, selected && styles.engineNameActive]}>
                      {engine.label}
                    </Text>
                  </View>
                  {selected ? (
                    <Icon name="check-circle" size={22} color="#a78bfa" />
                  ) : (
                    <Icon name="circle-outline" size={22} color="#4b5563" />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}

          <Text style={[cardStyles.fieldLabel, { marginTop: 16 }]}>Default quality</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {['auto', '240p', '360p', '480p', '720p', '1080p'].map((q) => (
              <TouchableOpacity
                key={q}
                style={[
                  styles.chip,
                  playerConfig.defaultQuality === q && styles.chipActive,
                ]}
                onPress={() => setPlayerConfig((p) => ({ ...p, defaultQuality: q }))}>
                <Text
                  style={[
                    styles.chipText,
                    playerConfig.defaultQuality === q && styles.chipTextActive,
                  ]}>
                  {q}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={cardStyles.fieldLabel}>Default language</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {[
              { id: 'sw', label: 'Swahili' },
              { id: 'en', label: 'English' },
            ].map((lang) => (
              <TouchableOpacity
                key={lang.id}
                style={[
                  styles.chip,
                  playerConfig.defaultLanguage === lang.id && styles.chipActive,
                ]}
                onPress={() => setPlayerConfig((p) => ({ ...p, defaultLanguage: lang.id }))}>
                <Text
                  style={[
                    styles.chipText,
                    playerConfig.defaultLanguage === lang.id && styles.chipTextActive,
                  ]}>
                  {lang.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <ToggleRow
            label="Hardware acceleration"
            value={playerConfig.hardwareAcceleration}
            onChange={(v) => setPlayerConfig((p) => ({ ...p, hardwareAcceleration: v }))}
          />

          <ToggleRow
            label="Software decode fallback"
            value={playerConfig.softwareDecodeFallback}
            onChange={(v) => setPlayerConfig((p) => ({ ...p, softwareDecodeFallback: v }))}
          />

          <ToggleRow
            label="Resume playback"
            value={playerConfig.resumePlayback}
            onChange={(v) => setPlayerConfig((p) => ({ ...p, resumePlayback: v }))}
          />

          <ToggleRow
            label="Background playback"
            value={playerConfig.backgroundPlayback}
            onChange={(v) => setPlayerConfig((p) => ({ ...p, backgroundPlayback: v }))}
          />

          <ToggleRow
            label="Reconnect / retry on error"
            value={playerConfig.reconnectEnabled}
            onChange={(v) => setPlayerConfig((p) => ({ ...p, reconnectEnabled: v }))}
          />

          <ToggleRow
            label="Auto-play on start"
            value={playerConfig.autoPlay}
            onChange={(v) => setPlayerConfig((p) => ({ ...p, autoPlay: v }))}
          />

          <ToggleRow
            label="Failover to WebView"
            value={playerConfig.failoverToWebview}
            onChange={(v) => setPlayerConfig((p) => ({ ...p, failoverToWebview: v }))}
          />

          <TouchableOpacity style={cardStyles.saveBtn} onPress={savePlayer} disabled={savingPlayer}>
            {savingPlayer ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Icon name="play-circle" size={18} color="#fff" />
                <Text style={cardStyles.saveBtnText}>Hifadhi player</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={cardStyles.card}>
          <Text style={cardStyles.title}>Emergency controls</Text>
          <ToggleRow
            label="Maintenance mode"
            value={emergency.maintenanceMode}
            onChange={(v) => setEmergency((p) => ({ ...p, maintenanceMode: v }))}
          />
          <Text style={cardStyles.fieldLabel}>Maintenance message (Swahili)</Text>
          <TextInput
            style={cardStyles.input}
            value={emergency.maintenanceMessageSw}
            onChangeText={(v) => setEmergency((p) => ({ ...p, maintenanceMessageSw: v }))}
            placeholder="Programu iko chini ya matengenezo..."
            placeholderTextColor="#6b7280"
          />
          <ToggleRow
            label="Disable payments"
            value={emergency.disablePayments}
            onChange={(v) => setEmergency((p) => ({ ...p, disablePayments: v }))}
          />
          <ToggleRow
            label="Disable all channels"
            value={emergency.disableChannels}
            onChange={(v) => setEmergency((p) => ({ ...p, disableChannels: v }))}
          />
          <Text style={cardStyles.fieldLabel}>Disabled channel IDs (comma-separated)</Text>
          <TextInput
            style={cardStyles.input}
            value={emergency.disabledChannelIds}
            onChangeText={(v) => setEmergency((p) => ({ ...p, disabledChannelIds: v }))}
            placeholder="12, 45, 78"
            placeholderTextColor="#6b7280"
            keyboardType="numbers-and-punctuation"
          />
          <TouchableOpacity
            style={cardStyles.saveBtn}
            onPress={saveEmergency}
            disabled={savingEmergency}>
            {savingEmergency ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Icon name="shield-alert" size={18} color="#fff" />
                <Text style={cardStyles.saveBtnText}>Hifadhi emergency</Text>
              </>
            )}
          </TouchableOpacity>
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
              <Text style={styles.statusModalButtonText}>Sawa</Text>
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
  container: {
    flex: 1,
    padding: 16,
    paddingBottom: 100,
  },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    padding: 14,
    marginBottom: 16,
  },
  activeBannerText: {
    flex: 1,
  },
  activeLabel: {
    color: '#c4b5fd',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  activeName: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
    marginTop: 2,
  },
  engineCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: 'rgba(3, 7, 18, 0.65)',
    padding: 12,
    marginBottom: 8,
  },
  engineCardActive: {
    borderColor: '#7c3aed',
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
  },
  engineCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  engineIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
  },
  engineIconWrapActive: {
    backgroundColor: '#7c3aed',
  },
  engineCardBody: {
    flex: 1,
  },
  engineName: {
    color: '#e5e7eb',
    fontSize: 15,
    fontWeight: '700',
  },
  engineNameActive: {
    color: '#fff',
  },
  engineFormats: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 3,
    lineHeight: 15,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: 'rgba(3, 7, 18, 0.8)',
  },
  chipActive: {
    borderColor: '#7c3aed',
    backgroundColor: 'rgba(124, 58, 237, 0.25)',
  },
  chipText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  chipTextActive: {
    color: '#fff',
  },
  statusModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  statusModalContent: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  statusModalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  statusModalMessage: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  statusModalButton: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  statusModalButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },
});

export default ControlCenterSection;
