const { query } = require('../db');

/** Fallback when DB table is empty — matches legacy PLAN_CONFIG. */
const DEFAULT_PLANS = [
  {
    slug: 'week',
    name_sw: 'Kwa Wiki',
    name_en: 'Weekly',
    price_tzs: 2000,
    duration_days: 7,
    duration_label_sw: '7 siku',
    price_line_sw: 'Tsh.2,000/= wiki moja',
    is_active: true,
    is_popular: false,
    sort_order: 0,
    badge_text: null,
  },
  {
    slug: 'month',
    name_sw: 'Mwezi',
    name_en: 'Monthly',
    price_tzs: 5000,
    duration_days: 30,
    duration_label_sw: '30 siku',
    price_line_sw: 'Tsh.5,000/= mwezi mmoja',
    is_active: true,
    is_popular: true,
    sort_order: 1,
    badge_text: null,
  },
  {
    slug: 'year',
    name_sw: 'Miezi 3',
    name_en: 'Quarter',
    price_tzs: 12000,
    duration_days: 90,
    duration_label_sw: 'miezi 3',
    price_line_sw: 'Tsh.12,000/= miezi mitatu',
    is_active: true,
    is_popular: false,
    sort_order: 2,
    badge_text: null,
  },
];

function mapRow(row) {
  if (!row) return null;
  return {
    slug: row.slug,
    nameSw: row.name_sw,
    nameEn: row.name_en,
    priceTzs: Number(row.price_tzs),
    durationDays: Number(row.duration_days),
    durationLabelSw: row.duration_label_sw,
    priceLineSw: row.price_line_sw,
    isActive: row.is_active !== false,
    isPopular: row.is_popular === true,
    sortOrder: Number(row.sort_order) || 0,
    badgeText: row.badge_text,
  };
}

async function getActivePlans() {
  try {
    const result = await query(
      `SELECT slug, name_sw, name_en, price_tzs, duration_days, duration_label_sw,
              price_line_sw, is_active, is_popular, sort_order, badge_text
         FROM subscription_plans
        WHERE is_active = TRUE
        ORDER BY sort_order ASC, id ASC`,
    );
    if (result.rows.length === 0) return DEFAULT_PLANS.map((p) => mapRow(p));
    return result.rows.map(mapRow);
  } catch (_) {
    return DEFAULT_PLANS.map((p) => mapRow(p));
  }
}

async function getPlanBySlug(slug) {
  const key = String(slug || '').toLowerCase();
  if (!key || key.startsWith('offer:')) return null;
  try {
    const result = await query(
      `SELECT slug, name_sw, name_en, price_tzs, duration_days, duration_label_sw,
              price_line_sw, is_active, is_popular, sort_order, badge_text
         FROM subscription_plans
        WHERE slug = $1 AND is_active = TRUE
        LIMIT 1`,
      [key],
    );
    if (result.rows.length) return mapRow(result.rows[0]);
  } catch (_) {
    /* fall through */
  }
  const fallback = DEFAULT_PLANS.find((p) => p.slug === key);
  return fallback ? mapRow(fallback) : null;
}

/** Legacy payments.js interval string e.g. '7 days'. */
function intervalForPlan(plan) {
  if (!plan) return null;
  const days = Number(plan.durationDays ?? plan.duration_days);
  if (!Number.isFinite(days) || days <= 0) return null;
  return `${days} days`;
}

async function resolvePremiumInterval(planKey) {
  const key = String(planKey || '').toLowerCase();
  if (key.startsWith('offer:')) {
    const days = parseInt(key.split(':')[1], 10);
    if (Number.isFinite(days) && days > 0 && days <= 366) return `${days} days`;
    return null;
  }
  const plan = await getPlanBySlug(key);
  return intervalForPlan(plan);
}

/** Amount + interval for payment start validation. */
async function getPlanPaymentInfo(slug) {
  const plan = await getPlanBySlug(slug);
  if (!plan) return null;
  return {
    amount: plan.priceTzs,
    interval: intervalForPlan(plan),
    slug: plan.slug,
  };
}

async function listAllPlansAdmin() {
  try {
    const result = await query(
      `SELECT slug, name_sw, name_en, price_tzs, duration_days, duration_label_sw,
              price_line_sw, is_active, is_popular, sort_order, badge_text, updated_at
         FROM subscription_plans
        ORDER BY sort_order ASC, id ASC`,
    );
    if (result.rows.length === 0) return DEFAULT_PLANS.map((p) => mapRow(p));
    return result.rows.map(mapRow);
  } catch (_) {
    return DEFAULT_PLANS.map((p) => mapRow(p));
  }
}

async function upsertPlanAdmin(slug, data) {
  const result = await query(
    `INSERT INTO subscription_plans
       (slug, name_sw, name_en, price_tzs, duration_days, duration_label_sw,
        price_line_sw, is_active, is_popular, sort_order, badge_text, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (slug) DO UPDATE SET
       name_sw = EXCLUDED.name_sw,
       name_en = EXCLUDED.name_en,
       price_tzs = EXCLUDED.price_tzs,
       duration_days = EXCLUDED.duration_days,
       duration_label_sw = EXCLUDED.duration_label_sw,
       price_line_sw = EXCLUDED.price_line_sw,
       is_active = EXCLUDED.is_active,
       is_popular = EXCLUDED.is_popular,
       sort_order = EXCLUDED.sort_order,
       badge_text = EXCLUDED.badge_text,
       updated_at = NOW()
     RETURNING slug, name_sw, name_en, price_tzs, duration_days, duration_label_sw,
               price_line_sw, is_active, is_popular, sort_order, badge_text`,
    [
      slug,
      data.nameSw,
      data.nameEn || null,
      data.priceTzs,
      data.durationDays,
      data.durationLabelSw || null,
      data.priceLineSw || null,
      data.isActive !== false,
      data.isPopular === true,
      Number(data.sortOrder) || 0,
      data.badgeText || null,
    ],
  );
  return mapRow(result.rows[0]);
}

module.exports = {
  DEFAULT_PLANS,
  getActivePlans,
  getPlanBySlug,
  getPlanPaymentInfo,
  resolvePremiumInterval,
  intervalForPlan,
  listAllPlansAdmin,
  upsertPlanAdmin,
};
