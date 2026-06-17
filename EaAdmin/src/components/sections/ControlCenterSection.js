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
  Alert,
  RefreshControl,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminControlAPI } from '../../config/api';

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 14,
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
    backgroundColor: '#7c3aed',
    paddingVertical: 13,
    borderRadius: 10,
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
  const [savingApp, setSavingApp] = useState(false);
  const [savingPlayer, setSavingPlayer] = useState(false);

  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [disablePayments, setDisablePayments] = useState(false);
  const [disableChannels, setDisableChannels] = useState(false);
  const [disabledChannelIdsText, setDisabledChannelIdsText] = useState('');

  const [playerConfig, setPlayerConfig] = useState({
    preferredEngine: 'auto',
    retryMax: '4',
    retryDelayMs: '1200',
    bufferMinMs: '800',
    bufferMaxMs: '12000',
    reconnectEnabled: true,
    autoPlay: true,
    defaultQuality: '360p',
    failoverToWebview: true,
  });

  const [adsEnabled, setAdsEnabled] = useState(true);
  const [ratibaTab, setRatibaTab] = useState(true);
  const [adRewardPoints, setAdRewardPoints] = useState('20');

  const parseChannelIds = (text) =>
    String(text || '')
      .split(/[,\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

  const load = useCallback(async () => {
    try {
      const [emergencyRes, playerRes, flagsRes, adsRes] = await Promise.all([
        adminControlAPI.getEmergencyControls(),
        adminControlAPI.getPlayerConfig(),
        adminControlAPI.getFeatureFlags().catch(() => ({ adsEnabled: true, ratibaTab: true })),
        adminControlAPI.getAdRewardPoints().catch(() => ({ rewardPoints: 20 })),
      ]);

      const c = emergencyRes?.controls || {};
      setMaintenanceMode(!!c.maintenanceMode);
      setMaintenanceMessage(c.maintenanceMessageSw || '');
      setDisablePayments(!!c.disablePayments);
      setDisableChannels(!!c.disableChannels);
      setDisabledChannelIdsText((c.disabledChannelIds || []).join(', '));

      const pc = playerRes?.config || {};
      setPlayerConfig({
        preferredEngine: pc.preferredEngine || 'auto',
        retryMax: String(pc.retryMax ?? 4),
        retryDelayMs: String(pc.retryDelayMs ?? 1200),
        bufferMinMs: String(pc.bufferMinMs ?? 800),
        bufferMaxMs: String(pc.bufferMaxMs ?? 12000),
        reconnectEnabled: pc.reconnectEnabled !== false,
        autoPlay: pc.autoPlay !== false,
        defaultQuality: pc.defaultQuality || '360p',
        failoverToWebview: pc.failoverToWebview !== false,
      });

      setAdsEnabled(flagsRes.adsEnabled !== false);
      setRatibaTab(flagsRes.ratibaTab !== false);
      setAdRewardPoints(String(adsRes.rewardPoints ?? 20));
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

  const saveApp = async () => {
    const pts = Number(adRewardPoints);
    if (!(pts > 0)) {
      Alert.alert('Thibitisha', 'Weka pointi halali');
      return;
    }
    setSavingApp(true);
    try {
      await Promise.all([
        adminControlAPI.updateEmergencyControls({
          maintenanceMode,
          maintenanceMessageSw: maintenanceMessage.trim(),
          disablePayments,
          disableChannels,
          disabledChannelIds: parseChannelIds(disabledChannelIdsText),
        }),
        adminControlAPI.updateFeatureFlags({ adsEnabled, ratibaTab }),
        adminControlAPI.updateAdRewardPoints(pts),
      ]);
      Alert.alert('Imefanikiwa', 'Mipangilio imehifadhiwa.');
    } catch (e) {
      Alert.alert('Hitilafu', e?.message || 'Imeshindwa kuhifadhi');
    } finally {
      setSavingApp(false);
    }
  };

  const savePlayer = async () => {
    const minBuf = Number(playerConfig.bufferMinMs) || 800;
    const maxBuf = Number(playerConfig.bufferMaxMs) || 12000;
    if (maxBuf < minBuf + 500) {
      Alert.alert('Thibitisha', 'Buffer max lazima iwe kubwa kuliko buffer min angalau 500ms');
      return;
    }
    setSavingPlayer(true);
    try {
      await adminControlAPI.updatePlayerConfig({
        preferredEngine: playerConfig.preferredEngine || 'auto',
        retryMax: Number(playerConfig.retryMax) || 4,
        retryDelayMs: Number(playerConfig.retryDelayMs) || 1200,
        bufferMinMs: minBuf,
        bufferMaxMs: maxBuf,
        reconnectEnabled: playerConfig.reconnectEnabled,
        autoPlay: playerConfig.autoPlay,
        defaultQuality: playerConfig.defaultQuality || '360p',
        failoverToWebview: playerConfig.failoverToWebview,
      });
      Alert.alert('Imefanikiwa', 'Player imehifadhiwa.');
    } catch (e) {
      Alert.alert('Hitilafu', e?.message || 'Imeshindwa kuhifadhi');
    } finally {
      setSavingPlayer(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#7c3aed" />
      }>
      <View style={cardStyles.card}>
        <Text style={cardStyles.title}>App &amp; Features</Text>

        <ToggleRow label="Maintenance mode" value={maintenanceMode} onChange={setMaintenanceMode} />
        <Text style={cardStyles.fieldLabel}>Ujumbe wa matengenezo</Text>
        <TextInput
          style={cardStyles.input}
          value={maintenanceMessage}
          onChangeText={setMaintenanceMessage}
          placeholder="Tunaendelea na matengenezo..."
          placeholderTextColor="#6b7280"
          multiline
        />

        <ToggleRow label="Zima malipo" value={disablePayments} onChange={setDisablePayments} />
        <ToggleRow label="Zima channels" value={disableChannels} onChange={setDisableChannels} />

        <Text style={cardStyles.fieldLabel}>Channel IDs zilizozimwa</Text>
        <TextInput
          style={cardStyles.input}
          value={disabledChannelIdsText}
          onChangeText={setDisabledChannelIdsText}
          placeholder="48, 12, 7"
          placeholderTextColor="#6b7280"
          keyboardType="numbers-and-punctuation"
        />

        <ToggleRow label="Matangazo" value={adsEnabled} onChange={setAdsEnabled} disabled={savingApp} />
        <ToggleRow label="Tab ya Ratiba" value={ratibaTab} onChange={setRatibaTab} disabled={savingApp} />

        <Text style={cardStyles.fieldLabel}>Pointi kwa tangazo</Text>
        <TextInput
          style={cardStyles.input}
          value={adRewardPoints}
          onChangeText={setAdRewardPoints}
          keyboardType="number-pad"
        />

        <TouchableOpacity style={cardStyles.saveBtn} onPress={saveApp} disabled={savingApp}>
          {savingApp ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Icon name="content-save" size={18} color="#fff" />
              <Text style={cardStyles.saveBtnText}>Hifadhi</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={cardStyles.card}>
        <Text style={cardStyles.title}>Player</Text>

        <Text style={cardStyles.fieldLabel}>Preferred engine</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {['auto', 'exo', 'webview'].map((engine) => (
            <TouchableOpacity
              key={engine}
              style={[
                styles.chip,
                playerConfig.preferredEngine === engine && styles.chipActive,
              ]}
              onPress={() => setPlayerConfig((p) => ({ ...p, preferredEngine: engine }))}>
              <Text
                style={[
                  styles.chipText,
                  playerConfig.preferredEngine === engine && styles.chipTextActive,
                ]}>
                {engine}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={cardStyles.fieldLabel}>Default quality</Text>
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

        <View style={cardStyles.inputRow}>
          <View style={cardStyles.inputHalf}>
            <Text style={cardStyles.fieldLabel}>Retry max</Text>
            <TextInput
              style={cardStyles.input}
              value={playerConfig.retryMax}
              onChangeText={(v) => setPlayerConfig((p) => ({ ...p, retryMax: v }))}
              keyboardType="number-pad"
            />
          </View>
          <View style={cardStyles.inputHalf}>
            <Text style={cardStyles.fieldLabel}>Retry delay (ms)</Text>
            <TextInput
              style={cardStyles.input}
              value={playerConfig.retryDelayMs}
              onChangeText={(v) => setPlayerConfig((p) => ({ ...p, retryDelayMs: v }))}
              keyboardType="number-pad"
            />
          </View>
        </View>

        <View style={cardStyles.inputRow}>
          <View style={cardStyles.inputHalf}>
            <Text style={cardStyles.fieldLabel}>Buffer min (ms)</Text>
            <TextInput
              style={cardStyles.input}
              value={playerConfig.bufferMinMs}
              onChangeText={(v) => setPlayerConfig((p) => ({ ...p, bufferMinMs: v }))}
              keyboardType="number-pad"
            />
          </View>
          <View style={cardStyles.inputHalf}>
            <Text style={cardStyles.fieldLabel}>Buffer max (ms)</Text>
            <TextInput
              style={cardStyles.input}
              value={playerConfig.bufferMaxMs}
              onChangeText={(v) => setPlayerConfig((p) => ({ ...p, bufferMaxMs: v }))}
              keyboardType="number-pad"
            />
          </View>
        </View>

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
    </ScrollView>
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
});

export default ControlCenterSection;
