const { query } = require('../db');

const DEFAULT_SECTION_LABELS = {
  football: {
    channelsTitle: 'Football Channels',
    channelsSubtitle: 'Chagua channel unayotaka kuangalia',
    viewAll: 'View all',
    upcomingMatchesTitle: 'Upcoming Matches',
    viewAllMatches: 'View All',
  },
  movies: {
    viewAll: 'View all',
    searchSectionTitle: 'Machaguo mbalimbali',
    categoryTamthilia: 'Tamthilia',
    categoryWanyama: 'Wanyama',
    categoryKatuni: 'Katuni',
    categoryHabari: 'Habari',
    categorySayansi: 'Sayansi',
    categoryMovies: 'Movies',
  },
};

async function ensureAppSettingsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getSetting(key, fallback = null) {
  try {
    await ensureAppSettingsTable();
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

async function setSetting(key, value) {
  await ensureAppSettingsTable();
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, String(value)],
  );
}

async function getSectionLabels() {
  const raw = await getSetting('section_labels', null);
  if (!raw) return { ...DEFAULT_SECTION_LABELS };
  try {
    const parsed = JSON.parse(raw);
    return {
      football: { ...DEFAULT_SECTION_LABELS.football, ...(parsed.football || {}) },
      movies: { ...DEFAULT_SECTION_LABELS.movies, ...(parsed.movies || {}) },
    };
  } catch (_) {
    return { ...DEFAULT_SECTION_LABELS };
  }
}

async function updateSectionLabels(labels) {
  const current = await getSectionLabels();
  const next = {
    football: { ...current.football, ...(labels.football || {}) },
    movies: { ...current.movies, ...(labels.movies || {}) },
  };
  await setSetting('section_labels', JSON.stringify(next));
  return next;
}

async function getFeatureFlagsExtra() {
  const adsRaw = await getSetting('feature_ads_enabled', 'true');
  const ratibaRaw = await getSetting('feature_ratiba_tab', 'true');
  return {
    adsEnabled: String(adsRaw).toLowerCase() !== 'false',
    ratibaTab: String(ratibaRaw).toLowerCase() !== 'false',
  };
}

async function updateFeatureFlagsExtra(patch) {
  if (patch.adsEnabled !== undefined) {
    await setSetting('feature_ads_enabled', patch.adsEnabled ? 'true' : 'false');
  }
  if (patch.ratibaTab !== undefined) {
    await setSetting('feature_ratiba_tab', patch.ratibaTab ? 'true' : 'false');
  }
  return getFeatureFlagsExtra();
}

async function getAdRewardPoints() {
  const raw = await getSetting('ad_reward_points', null);
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  return Number(process.env.AD_REWARD_POINTS || 20);
}

async function updateAdRewardPoints(points) {
  const n = Math.round(Number(points));
  if (!Number.isFinite(n) || n <= 0 || n > 500) {
    throw new Error('Ad reward points must be between 1 and 500');
  }
  await setSetting('ad_reward_points', String(n));
  return n;
}

module.exports = {
  DEFAULT_SECTION_LABELS,
  getSectionLabels,
  updateSectionLabels,
  getFeatureFlagsExtra,
  updateFeatureFlagsExtra,
  getAdRewardPoints,
  updateAdRewardPoints,
};
