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

function formatTzs(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US');
}

/** Auto-generate Swahili/English labels from slug + amount + period (days). */
function buildPlanDisplayFields(slug, priceTzs, durationDays, nameSwOverride) {
  const key = String(slug || '').toLowerCase();
  const days = Number(durationDays) || 0;
  const priceFmt = formatTzs(priceTzs);

  let nameSw = 'Mpango';
  let nameEn = 'Plan';
  let durationLabelSw = `${days} siku`;
  let periodPhrase = `${days} siku`;

  if (days === 7) {
    durationLabelSw = '7 siku';
    periodPhrase = 'wiki moja';
    if (key === 'week') {
      nameSw = 'Kwa Wiki';
      nameEn = 'Weekly';
    }
  } else if (days === 14) {
    durationLabelSw = 'wiki 2';
    periodPhrase = 'wiki mbili';
  } else if (days === 30) {
    durationLabelSw = '30 siku';
    periodPhrase = 'mwezi mmoja';
    if (key === 'month') {
      nameSw = 'Mwezi';
      nameEn = 'Monthly';
    }
  } else if (days === 90) {
    durationLabelSw = 'miezi 3';
    periodPhrase = 'miezi mitatu';
    if (key === 'year' || key === 'quarter') {
      nameSw = 'Miezi 3';
      nameEn = 'Quarter';
    }
  } else if (days === 180) {
    durationLabelSw = 'miezi 6';
    periodPhrase = 'miezi sita';
  } else if (days === 365) {
    durationLabelSw = 'mwaka 1';
    periodPhrase = 'mwaka mmoja';
    if (key === 'year' || key === 'mwaka') {
      nameSw = 'Mwaka';
      nameEn = 'Yearly';
    }
  } else if (days === 1) {
    durationLabelSw = 'siku 1';
    periodPhrase = 'siku moja';
  }

  if (nameSwOverride && String(nameSwOverride).trim()) {
    nameSw = String(nameSwOverride).trim();
    nameEn = String(nameSwOverride).trim();
  }

  const priceLineSw = `Tsh.${priceFmt}/= ${periodPhrase}`;

  return { nameSw, nameEn, durationLabelSw, priceLineSw };
}

function slugifyPlanName(name) {
  const base = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  return base || 'plan';
}

async function nextPlanSortOrder() {
  try {
    const result = await query(
      `SELECT COALESCE(MAX(sort_order), -1)::int AS max_order FROM subscription_plans`,
    );
    return Number(result.rows?.[0]?.max_order ?? -1) + 1;
  } catch (_) {
    return DEFAULT_PLANS.length;
  }
}

async function clearPopularExcept(slug) {
  await query(
    `UPDATE subscription_plans SET is_popular = FALSE, updated_at = NOW()
      WHERE slug <> $1 AND is_popular = TRUE`,
    [slug],
  ).catch(() => {});
}

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

async function ensureDefaultPlansSeeded() {
  try {
    const countResult = await query(
      `SELECT COUNT(*)::int AS count FROM subscription_plans`,
    );
    if (Number(countResult.rows?.[0]?.count || 0) > 0) return;

    for (const p of DEFAULT_PLANS) {
      const display = buildPlanDisplayFields(
        p.slug,
        p.price_tzs,
        p.duration_days,
        p.name_sw,
      );
      await query(
        `INSERT INTO subscription_plans
           (slug, name_sw, name_en, price_tzs, duration_days, duration_label_sw,
            price_line_sw, is_active, is_popular, sort_order, badge_text, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (slug) DO NOTHING`,
        [
          p.slug,
          display.nameSw,
          display.nameEn,
          p.price_tzs,
          p.duration_days,
          display.durationLabelSw,
          display.priceLineSw,
          p.is_active !== false,
          p.is_popular === true,
          p.sort_order,
          p.badge_text,
        ],
      );
    }
  } catch (_) {
    // Table may not exist yet on older deployments.
  }
}

async function listAllPlansAdmin() {
  try {
    await ensureDefaultPlansSeeded();
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
  const key = String(slug || '').toLowerCase();
  const priceTzs = Number(data.priceTzs);
  const durationDays = Number(data.durationDays);
  const display = buildPlanDisplayFields(
    key,
    priceTzs,
    durationDays,
    data.nameSw,
  );

  let existing = null;
  try {
    const existingResult = await query(
      `SELECT is_active, is_popular, sort_order, badge_text
         FROM subscription_plans
        WHERE slug = $1
        LIMIT 1`,
      [key],
    );
    existing = existingResult.rows[0] || null;
  } catch (_) {
    existing = null;
  }
  const fallback = DEFAULT_PLANS.find((p) => p.slug === key);
  const isNew = !existing;

  const isActive = data.isActive !== undefined
    ? data.isActive !== false
    : (isNew ? true : existing.is_active !== false);
  const isPopular = data.isPopular !== undefined
    ? data.isPopular === true
    : (isNew
      ? fallback?.is_popular === true
      : (existing.is_popular === true || fallback?.is_popular === true));
  let sortOrder;
  if (data.sortOrder !== undefined) {
    sortOrder = Number(data.sortOrder) || 0;
  } else if (existing) {
    sortOrder = Number(existing.sort_order) || 0;
  } else if (fallback) {
    sortOrder = Number(fallback.sort_order) || 0;
  } else {
    sortOrder = await nextPlanSortOrder();
  }
  const badgeText = data.badgeText !== undefined
    ? (data.badgeText || null)
    : (existing?.badge_text || fallback?.badge_text || null);

  if (isPopular) {
    await clearPopularExcept(key);
  }

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
      key,
      display.nameSw,
      display.nameEn,
      priceTzs,
      durationDays,
      display.durationLabelSw,
      display.priceLineSw,
      isActive,
      isPopular,
      sortOrder,
      badgeText,
    ],
  );
  return mapRow(result.rows[0]);
}

async function createPlanAdmin(data) {
  const priceTzs = Number(data.priceTzs);
  const durationDays = Number(data.durationDays);
  if (!(priceTzs > 0) || !(durationDays > 0)) {
    const err = new Error('Invalid price or duration');
    err.statusCode = 400;
    throw err;
  }

  let key = data.slug ? String(data.slug).toLowerCase().trim() : slugifyPlanName(data.nameSw);
  if (!/^[a-z0-9_]{2,32}$/.test(key)) {
    const err = new Error('Invalid plan slug');
    err.statusCode = 400;
    throw err;
  }

  const taken = await query(
    `SELECT slug FROM subscription_plans WHERE slug = $1 LIMIT 1`,
    [key],
  );
  if (taken.rows?.length) {
    key = `${key}_${Date.now().toString(36).slice(-4)}`.slice(0, 32);
  }

  const display = buildPlanDisplayFields(key, priceTzs, durationDays, data.nameSw);
  const sortOrder = data.sortOrder !== undefined
    ? Number(data.sortOrder) || 0
    : await nextPlanSortOrder();
  const isActive = data.isActive !== false;
  const isPopular = data.isPopular === true;

  if (isPopular) {
    await clearPopularExcept(key);
  }

  const result = await query(
    `INSERT INTO subscription_plans
       (slug, name_sw, name_en, price_tzs, duration_days, duration_label_sw,
        price_line_sw, is_active, is_popular, sort_order, badge_text, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     RETURNING slug, name_sw, name_en, price_tzs, duration_days, duration_label_sw,
               price_line_sw, is_active, is_popular, sort_order, badge_text`,
    [
      key,
      display.nameSw,
      display.nameEn,
      priceTzs,
      durationDays,
      display.durationLabelSw,
      display.priceLineSw,
      isActive,
      isPopular,
      sortOrder,
      data.badgeText || null,
    ],
  );
  return mapRow(result.rows[0]);
}

async function deletePlanAdmin(slug) {
  const key = String(slug || '').toLowerCase().trim();
  if (!key) {
    const err = new Error('Missing plan slug');
    err.statusCode = 400;
    throw err;
  }
  const activeCount = await query(
    `SELECT COUNT(*)::int AS count FROM subscription_plans WHERE is_active = TRUE`,
  );
  if (Number(activeCount.rows?.[0]?.count || 0) <= 1) {
    const err = new Error('Cannot delete the last active plan');
    err.statusCode = 400;
    throw err;
  }
  const result = await query(
    `DELETE FROM subscription_plans WHERE slug = $1 RETURNING slug`,
    [key],
  );
  if (!result.rows?.length) {
    const err = new Error('Plan not found');
    err.statusCode = 404;
    throw err;
  }
  return { slug: result.rows[0].slug, deleted: true };
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
  createPlanAdmin,
  deletePlanAdmin,
  buildPlanDisplayFields,
  formatTzs,
  slugifyPlanName,
};
