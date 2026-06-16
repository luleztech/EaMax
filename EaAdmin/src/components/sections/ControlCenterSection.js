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
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    color: '#e5e7eb',
    marginRight: 12,
  },
  rowHint: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
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
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#7c3aed',
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 4,
  },
  saveBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  badge: {
    fontSize: 11,
    color: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
});

const ToggleRow = ({ label, hint, value, onChange, disabled }) => (
  <View style={cardStyles.row}>
    <View style={{ flex: 1 }}>
      <Text style={cardStyles.rowLabel}>{label}</Text>
      {hint ? <Text style={cardStyles.rowHint}>{hint}</Text> : null}
    </View>
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
  const [savingEmergency, setSavingEmergency] = useState(false);
  const [savingPlayer, setSavingPlayer] = useState(false);
  const [savingFlags, setSavingFlags] = useState(false);
  const [savingAds, setSavingAds] = useState(false);

  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [disablePayments, setDisablePayments] = useState(false);
  const [disableChannels, setDisableChannels] = useState(false);
  const [disabledChannelIdsText, setDisabledChannelIdsText] = useState('');

  const [playerConfig, setPlayerConfig] = useState({
    retryMax: '4',
    retryDelayMs: '1200',
    bufferMinMs: '1500',
    bufferMaxMs: '30000',
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
        retryMax: String(pc.retryMax ?? 4),
        retryDelayMs: String(pc.retryDelayMs ?? 1200),
        bufferMinMs: String(pc.bufferMinMs ?? 1500),
        bufferMaxMs: String(pc.bufferMaxMs ?? 30000),
        failoverToWebview: pc.failoverToWebview !== false,
      });

      setAdsEnabled(flagsRes.adsEnabled !== false);
      setRatibaTab(flagsRes.ratibaTab !== false);
      setAdRewardPoints(String(adsRes.rewardPoints ?? 20));
    } catch (e) {
      Alert.alert('Hitilafu', e?.message || 'Imeshindwa kupakia mipangilio');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveEmergency = async () => {
    setSavingEmergency(true);
    try {
      await adminControlAPI.updateEmergencyControls({
        maintenanceMode,
        maintenanceMessageSw: maintenanceMessage.trim(),
        disablePayments,
        disableChannels,
        disabledChannelIds: parseChannelIds(disabledChannelIdsText),
      });
      Alert.alert('Imefanikiwa', 'Mipangilio ya dharura imehifadhiwa. Wateja wataona mabadiliko bila kusasisha app.');
    } catch (e) {
      Alert.alert('Hitilafu', e?.message || 'Imeshindwa kuhifadhi');
    } finally {
      setSavingEmergency(false);
    }
  };

  const savePlayer = async () => {
    setSavingPlayer(true);
    try {
      await adminControlAPI.updatePlayerConfig({
        retryMax: Number(playerConfig.retryMax) || 4,
        retryDelayMs: Number(playerConfig.retryDelayMs) || 1200,
        bufferMinMs: Number(playerConfig.bufferMinMs) || 1500,
        bufferMaxMs: Number(playerConfig.bufferMaxMs) || 30000,
        failoverToWebview: playerConfig.failoverToWebview,
      });
      Alert.alert('Imefanikiwa', 'Mipangilio ya player imehifadhiwa.');
    } catch (e) {
      Alert.alert('Hitilafu', e?.message || 'Imeshindwa kuhifadhi');
    } finally {
      setSavingPlayer(false);
    }
  };

  const saveFlags = async () => {
    setSavingFlags(true);
    try {
      await adminControlAPI.updateFeatureFlags({ adsEnabled, ratibaTab });
      Alert.alert('Imefanikiwa', 'Feature flags zimehifadhiwa.');
    } catch (e) {
      Alert.alert('Hitilafu', e?.message || 'Imeshindwa kuhifadhi');
    } finally {
      setSavingFlags(false);
    }
  };

  const saveAdPoints = async () => {
    const pts = Number(adRewardPoints);
    if (!(pts > 0)) {
      Alert.alert('Thibitisha', 'Weka pointi halali');
      return;
    }
    setSavingAds(true);
    try {
      await adminControlAPI.updateAdRewardPoints(pts);
      Alert.alert('Imefanikiwa', `Pointi za tangazo: ${pts}`);
    } catch (e) {
      Alert.alert('Hitilafu', e?.message || 'Imeshindwa kuhifadhi');
    } finally {
      setSavingAds(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#7c3aed" />
        <Text style={styles.loadingText}>Inapakia kituo cha udhibiti...</Text>
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
      <Text style={cardStyles.badge}>Server-driven · hakuna APK mpya inahitajika</Text>

      <View style={cardStyles.card}>
        <Text style={cardStyles.title}>Dharura &amp; Matengenezo</Text>
        <Text style={cardStyles.subtitle}>
          Zima app kwa wateja wote, au zima malipo/channels kwa muda.
        </Text>

        <ToggleRow
          label="Maintenance mode"
          hint="Wateja wataona skrini ya matengenezo (bila kusasisha app)"
          value={maintenanceMode}
          onChange={setMaintenanceMode}
        />
        <Text style={cardStyles.rowLabel}>Ujumbe wa matengenezo</Text>
        <TextInput
          style={cardStyles.input}
          value={maintenanceMessage}
          onChangeText={setMaintenanceMessage}
          placeholder="Tunaendelea na matengenezo..."
          placeholderTextColor="#6b7280"
          multiline
        />

        <ToggleRow
          label="Zima malipo"
          hint="Kuzuia malipo ya premium kwa muda"
          value={disablePayments}
          onChange={setDisablePayments}
        />
        <ToggleRow
          label="Zima channels"
          hint="Kuzuia kufungua channels kwa muda"
          value={disableChannels}
          onChange={setDisableChannels}
        />

        <Text style={[cardStyles.rowLabel, { marginTop: 8 }]}>Channel IDs zilizozimwa</Text>
        <Text style={cardStyles.rowHint}>Mfano: 48, 12, 7 — wateja hawataweza kufungua hizi</Text>
        <TextInput
          style={cardStyles.input}
          value={disabledChannelIdsText}
          onChangeText={setDisabledChannelIdsText}
          placeholder="48, 12"
          placeholderTextColor="#6b7280"
          keyboardType="numbers-and-punctuation"
        />

        <TouchableOpacity style={cardStyles.saveBtn} onPress={saveEmergency} disabled={savingEmergency}>
          {savingEmergency ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Icon name="content-save" size={18} color="#fff" />
              <Text style={cardStyles.saveBtnText}>Hifadhi dharura</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={cardStyles.card}>
        <Text style={cardStyles.title}>Player (server)</Text>
        <Text style={cardStyles.subtitle}>Retry, buffer, na failover — inaendeshwa na server</Text>

        <Text style={cardStyles.rowLabel}>Retry max</Text>
        <TextInput
          style={cardStyles.input}
          value={playerConfig.retryMax}
          onChangeText={(v) => setPlayerConfig((p) => ({ ...p, retryMax: v }))}
          keyboardType="number-pad"
        />
        <Text style={cardStyles.rowLabel}>Retry delay (ms)</Text>
        <TextInput
          style={cardStyles.input}
          value={playerConfig.retryDelayMs}
          onChangeText={(v) => setPlayerConfig((p) => ({ ...p, retryDelayMs: v }))}
          keyboardType="number-pad"
        />
        <Text style={cardStyles.rowLabel}>Buffer min (ms)</Text>
        <TextInput
          style={cardStyles.input}
          value={playerConfig.bufferMinMs}
          onChangeText={(v) => setPlayerConfig((p) => ({ ...p, bufferMinMs: v }))}
          keyboardType="number-pad"
        />
        <Text style={cardStyles.rowLabel}>Buffer max (ms)</Text>
        <TextInput
          style={cardStyles.input}
          value={playerConfig.bufferMaxMs}
          onChangeText={(v) => setPlayerConfig((p) => ({ ...p, bufferMaxMs: v }))}
          keyboardType="number-pad"
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
        <Text style={cardStyles.title}>Feature flags</Text>
        <Text style={cardStyles.subtitle}>Matangazo na tab ya Ratiba</Text>

        <ToggleRow label="Matangazo (ads)" value={adsEnabled} onChange={setAdsEnabled} disabled={savingFlags} />
        <ToggleRow label="Tab ya Ratiba" value={ratibaTab} onChange={setRatibaTab} disabled={savingFlags} />

        <TouchableOpacity style={cardStyles.saveBtn} onPress={saveFlags} disabled={savingFlags}>
          {savingFlags ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Icon name="flag" size={18} color="#fff" />
              <Text style={cardStyles.saveBtnText}>Hifadhi flags</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={cardStyles.card}>
        <Text style={cardStyles.title}>Pointi za tangazo</Text>
        <Text style={cardStyles.subtitle}>Pointi wateja wanapata baada ya kutazama tangazo</Text>
        <TextInput
          style={cardStyles.input}
          value={adRewardPoints}
          onChangeText={setAdRewardPoints}
          keyboardType="number-pad"
        />
        <TouchableOpacity style={cardStyles.saveBtn} onPress={saveAdPoints} disabled={savingAds}>
          {savingAds ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Icon name="star" size={18} color="#fff" />
              <Text style={cardStyles.saveBtnText}>Hifadhi pointi</Text>
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
});

export default ControlCenterSection;
