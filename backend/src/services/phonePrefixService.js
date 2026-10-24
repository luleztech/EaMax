const { query } = require('../db');

/**
 * Tanzanian mobile prefixes learned from payers.
 *
 * When a number's prefix is not in the built-in table, the app asks the payer which
 * network it belongs to and sends that as `network`. Each answer is a vote; the
 * network with the most votes for a prefix is published in the config bundle so
 * every app detects it next time.
 *
 * Stored in app_settings as JSON: { "064": { "halopesa": 3, "mpesa": 1 } }.
 */

const SETTING_KEY = 'learned_phone_prefixes';
const NETWORKS = ['mpesa', 'tigo', 'airtel', 'halopesa'];
const CACHE_TTL_MS = 60 * 1000;

const BUILT_IN = {
  '061': 'halopesa', '062': 'halopesa', '063': 'halopesa',
  '065': 'tigo', '067': 'tigo', '070': 'tigo', '071': 'tigo', '077': 'tigo',
  '068': 'airtel', '069': 'airtel', '078': 'airtel',
  '066': 'mpesa', '074': 'mpesa', '075': 'mpesa', '076': 'mpesa', '079': 'mpesa',
};

let votes = {};
let loadedAt = 0;
let loading = null;
let writeChain = Promise.resolve();

const isMobilePrefix = (prefix) => /^0[67]\d$/.test(String(prefix || ''));

const normalizeNetworkKey = (raw) => {
  const k = String(raw || '').trim().toLowerCase();
  if (k === 'vodacom' || k === 'mpesa' || k === 'm-pesa') return 'mpesa';
  if (k === 'tigo' || k === 'mixx' || k === 'yas') return 'tigo';
  if (k === 'airtel') return 'airtel';
  if (k === 'halopesa' || k === 'halotel') return 'halopesa';
  return null;
};

const winner = (tally) => {
  let best = null;
  let bestCount = 0;
  for (const net of NETWORKS) {
    const n = Number(tally?.[net]) || 0;
    if (n > bestCount) {
      best = net;
      bestCount = n;
    }
  }
  return best;
};

async function loadVotes(force = false) {
  if (!force && Date.now() - loadedAt < CACHE_TTL_MS) return votes;
  if (loading) return loading;
  loading = (async () => {
    try {
      const r = await query('SELECT value FROM app_settings WHERE key = $1 LIMIT 1', [SETTING_KEY]);
      const parsed = r.rows.length ? JSON.parse(r.rows[0].value) : {};
      votes = parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      // Keep the last good copy if the DB or JSON is unavailable.
    }
    loadedAt = Date.now();
    loading = null;
    return votes;
  })();
  return loading;
}

/** `{ "064": "halopesa" }` — majority network per learned prefix. */
async function getLearnedPrefixes() {
  const all = await loadVotes();
  const out = {};
  for (const [prefix, tally] of Object.entries(all)) {
    if (BUILT_IN[prefix] || !isMobilePrefix(prefix)) continue;
    const net = winner(tally);
    if (net) out[prefix] = net;
  }
  return out;
}

/** Sync lookup from the in-memory copy (used for labels on the hot payment path). */
function learnedNetworkSync(local0) {
  const prefix = String(local0 || '').slice(0, 3);
  if (BUILT_IN[prefix]) return BUILT_IN[prefix];
  return winner(votes[prefix]);
}

function isKnownPrefixSync(local0) {
  return Boolean(learnedNetworkSync(local0));
}

/**
 * Count one payer's answer. Memory updates immediately so labels on the same request
 * resolve; the DB write is serialized and never blocks the caller.
 */
function recordPrefixVote(local0, networkRaw) {
  const prefix = String(local0 || '').slice(0, 3);
  const net = normalizeNetworkKey(networkRaw);
  if (!net || !isMobilePrefix(prefix) || BUILT_IN[prefix]) return;

  votes[prefix] = { ...(votes[prefix] || {}), [net]: (Number(votes[prefix]?.[net]) || 0) + 1 };

  writeChain = writeChain
    .then(async () => {
      const fresh = await loadVotes(true);
      const tally = { ...(fresh[prefix] || {}) };
      tally[net] = (Number(tally[net]) || 0) + 1;
      const next = { ...fresh, [prefix]: tally };
      await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [SETTING_KEY, JSON.stringify(next)],
      );
      votes = next;
      loadedAt = Date.now();
      console.log('[PhonePrefix] learned vote', { prefix, network: net, tally });
    })
    .catch((e) => {
      console.warn('[PhonePrefix] vote not saved', e?.message || e);
    });
}

module.exports = {
  BUILT_IN_PREFIXES: BUILT_IN,
  normalizeNetworkKey,
  loadVotes,
  getLearnedPrefixes,
  learnedNetworkSync,
  isKnownPrefixSync,
  recordPrefixVote,
};
