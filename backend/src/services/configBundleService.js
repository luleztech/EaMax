const config = require('../config/appVersionConfig');
const { compareSemver } = require('../middleware/appVersion');
const { query } = require('../db');
const { getActivePlans } = require('./subscriptionPlansService');
const { getGlobalPlayerConfig } = require('./playerConfigService');
const { mapRow: mapEmergencyRow } = require('./emergencyControlsService');
const {
  getSectionLabels,
  getFeatureFlagsExtra,
  getAdRewardPoints,
} = require('./platformSettingsService');

async function getAppSetting(key, fallback = null) {
  try {
    const result = await query(
      'SELECT value FROM app_settings WHERE key = $1 LIMIT 1',
      [key],
    );
    if (!result.rows.length) return fallback;
    return result.rows[0].value;
  } catch (_) {
    return fallback;
  }
}

async function getChannelsPremiumOnly() {
  const raw = await getAppSetting('channels_premium_only', 'false');
  return String(raw).toLowerCase() === 'true';
}

async function getPaymentProvider() {
  return (await getAppSetting('payment_provider', 'zeno')) || 'zeno';
}

async function getWhatsappNumber() {
  return await getAppSetting('whatsapp_number', null);
}

async function getEmergencyControls() {
  try {
    const result = await query(
      `SELECT maintenance_mode, maintenance_message_sw, disable_payments,
              disable_channels, disabled_channel_ids, disabled_features
         FROM emergency_controls WHERE id = 1 LIMIT 1`,
    );
    const row = result.rows[0];
    const mapped = mapEmergencyRow(row);
    if (!row) {
      return {
        ...mapped,
        maintenanceMode: mapped.maintenanceMode || config.maintenanceMode,
      };
    }
    return {
      ...mapped,
      maintenanceMode: mapped.maintenanceMode || config.maintenanceMode,
    };
  } catch (_) {
    return mapEmergencyRow(null);
  }
}

async function getConfigVersion() {
  try {
    const result = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM subscription_plans WHERE updated_at > NOW() - INTERVAL '1 year') AS plans,
         (SELECT EXTRACT(EPOCH FROM MAX(updated_at))::bigint FROM subscription_plans) AS plans_ts,
         (SELECT EXTRACT(EPOCH FROM updated_at)::bigint FROM player_config_global WHERE id = 1) AS player_ts,
         (SELECT EXTRACT(EPOCH FROM updated_at)::bigint FROM emergency_controls WHERE id = 1) AS emergency_ts,
         (SELECT EXTRACT(EPOCH FROM MAX(updated_at))::bigint FROM app_settings) AS settings_ts`,
    );
    const row = result.rows[0] || {};
    return Number(row.plans_ts || 0) + Number(row.player_ts || 0)
      + Number(row.emergency_ts || 0) + Number(row.settings_ts || 0);
  } catch (_) {
    return Date.now();
  }
}

function buildAppVersionBlock(clientVersion, emergency) {
  const belowMinimum =
    clientVersion !== null &&
    compareSemver(clientVersion, config.minimumSupportedVersion) < 0;
  const belowLatest =
    clientVersion !== null &&
    compareSemver(clientVersion, config.latestVersion) < 0;

  return {
    minimumSupportedVersion: config.minimumSupportedVersion,
    latestVersion: config.latestVersion,
    forceUpdate: (config.forceUpdate && belowLatest) || belowMinimum,
    maintenanceMode: emergency.maintenanceMode,
    maintenanceMessage: emergency.maintenanceMessageSw || config.maintenanceMessage,
    playStoreUrl: config.playStoreUrl,
    updateTitle: config.updateTitle,
    updateMessage: config.updateMessage,
  };
}

/**
 * Assembles the full remote config bundle for mobile clients.
 */
async function buildConfigBundle({ clientVersion = null, platform = 'android' } = {}) {
  const [
    plans,
    playerConfig,
    emergency,
    channelsPremiumOnly,
    paymentProvider,
    whatsapp,
    sectionLabels,
    configVersion,
    featureExtra,
    adRewardPoints,
  ] = await Promise.all([
    getActivePlans(),
    getGlobalPlayerConfig(),
    getEmergencyControls(),
    getChannelsPremiumOnly(),
    getPaymentProvider(),
    getWhatsappNumber(),
    getSectionLabels(),
    getConfigVersion(),
    getFeatureFlagsExtra(),
    getAdRewardPoints(),
  ]);

  const appVersion = buildAppVersionBlock(clientVersion, emergency);

  return {
    configVersion,
    platform,
    appVersion,
    maintenance: {
      enabled: appVersion.maintenanceMode,
      message: appVersion.maintenanceMessage,
    },
    featureFlags: {
      channelsPremiumOnly,
      paymentsEnabled: !emergency.disablePayments,
      channelsEnabled: !emergency.disableChannels,
      adsEnabled: featureExtra.adsEnabled,
      ratibaTab: featureExtra.ratibaTab,
    },
    playerConfig,
    paymentConfig: {
      provider: paymentProvider,
      currency: 'TZS',
      whatsappNumber: whatsapp,
      plans: plans.map((p) => ({
        slug: p.slug,
        nameSw: p.nameSw,
        nameEn: p.nameEn,
        priceTzs: p.priceTzs,
        durationDays: p.durationDays,
        durationLabelSw: p.durationLabelSw,
        priceLineSw: p.priceLineSw,
        isPopular: p.isPopular,
        badgeText: p.badgeText,
      })),
    },
    subscription: {
      graceOfflineHours: 72,
    },
    sectionLabels,
    emergency: {
      disabledChannelIds: emergency.disabledChannelIds,
      disabledFeatures: emergency.disabledFeatures,
    },
    ads: {
      rewardPoints: adRewardPoints,
    },
  };
}

module.exports = {
  buildConfigBundle,
  getEmergencyControls,
};
