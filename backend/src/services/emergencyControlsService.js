const { query } = require('../db');
const config = require('../config/appVersionConfig');

async function getEmergencyControlsRow() {
  try {
    const result = await query(
      `SELECT maintenance_mode, maintenance_message_sw, disable_payments,
              disable_channels, disabled_channel_ids, disabled_features, updated_at
         FROM emergency_controls WHERE id = 1 LIMIT 1`,
    );
    return result.rows[0] || null;
  } catch (_) {
    return null;
  }
}

function mapRow(row) {
  if (!row) {
    return {
      maintenanceMode: config.maintenanceMode,
      maintenanceMessageSw: config.maintenanceMessage,
      disablePayments: false,
      disableChannels: false,
      disabledChannelIds: [],
      disabledFeatures: [],
    };
  }
  return {
    maintenanceMode: row.maintenance_mode === true,
    maintenanceMessageSw: row.maintenance_message_sw || config.maintenanceMessage,
    disablePayments: row.disable_payments === true,
    disableChannels: row.disable_channels === true,
    disabledChannelIds: Array.isArray(row.disabled_channel_ids)
      ? row.disabled_channel_ids.map(Number).filter((n) => n > 0)
      : [],
    disabledFeatures: Array.isArray(row.disabled_features) ? row.disabled_features : [],
  };
}

async function getEmergencyControlsAdmin() {
  return mapRow(await getEmergencyControlsRow());
}

async function updateEmergencyControls(patch) {
  const current = await getEmergencyControlsAdmin();
  const next = {
    maintenanceMode: patch.maintenanceMode ?? current.maintenanceMode,
    maintenanceMessageSw: patch.maintenanceMessageSw ?? current.maintenanceMessageSw,
    disablePayments: patch.disablePayments ?? current.disablePayments,
    disableChannels: patch.disableChannels ?? current.disableChannels,
    disabledChannelIds: patch.disabledChannelIds ?? current.disabledChannelIds,
    disabledFeatures: patch.disabledFeatures ?? current.disabledFeatures,
  };

  await query(
    `INSERT INTO emergency_controls
       (id, maintenance_mode, maintenance_message_sw, disable_payments,
        disable_channels, disabled_channel_ids, disabled_features, updated_at)
     VALUES (1,$1,$2,$3,$4,$5::int[],$6::text[],NOW())
     ON CONFLICT (id) DO UPDATE SET
       maintenance_mode = EXCLUDED.maintenance_mode,
       maintenance_message_sw = EXCLUDED.maintenance_message_sw,
       disable_payments = EXCLUDED.disable_payments,
       disable_channels = EXCLUDED.disable_channels,
       disabled_channel_ids = EXCLUDED.disabled_channel_ids,
       disabled_features = EXCLUDED.disabled_features,
       updated_at = NOW()`,
    [
      next.maintenanceMode,
      next.maintenanceMessageSw,
      next.disablePayments,
      next.disableChannels,
      next.disabledChannelIds,
      next.disabledFeatures,
    ],
  );

  return next;
}

module.exports = {
  getEmergencyControlsAdmin,
  updateEmergencyControls,
  mapRow,
};
