const express = require('express');
const { query } = require('../db');

const router = express.Router();

const GRADIENT_PALETTE = [
  ['E8002D', '7F1D1D'],
  ['16A34A', '14532D'],
  ['2563EB', '1E3A8A'],
  ['F59E0B', '92400E'],
  ['7C3AED', '4C1D95'],
  ['1D4A82', '2C6DB5'],
];

/** Serialize a schedule row (Leotena-compatible + EaMax channel/image). */
const serializeSchedule = (row) => {
  const start = String(row.gradient_start || '1D4A82').replace(/^#/, '');
  const end = String(row.gradient_end || '2C6DB5').replace(/^#/, '');
  const dt = row.date_time instanceof Date ? row.date_time : new Date(row.date_time);
  const channelId = row.channel_id != null ? Number(row.channel_id) : null;
  return {
    id: row.id,
    dateTime: dt.toISOString(),
    title: row.title || '',
    subtitle: row.subtitle || '',
    channel: row.channel || row.channel_name || '',
    channelId: Number.isFinite(channelId) ? channelId : null,
    channel_id: Number.isFinite(channelId) ? channelId : null,
    imageUrl: row.image_url || '',
    image_url: row.image_url || '',
    team1: row.team1 || '',
    team2: row.team2 || '',
    icon: row.icon || 'live_tv_rounded',
    live: row.live === true,
    active: row.active !== false,
    gradient: [`#${start}`, `#${end}`],
  };
};

const serializeLegacyMatch = (row, index = 0) => {
  const [start, end] = GRADIENT_PALETTE[index % GRADIENT_PALETTE.length];
  const dt = row.match_time instanceof Date ? row.match_time : new Date(row.match_time);
  const team1 = row.team1 || '';
  const team2 = row.team2 || '';
  return {
    id: `match-${row.id}`,
    dateTime: dt.toISOString(),
    title: team1 && team2 ? `${team1} vs ${team2}` : (row.league || 'Mechi'),
    subtitle: row.league || '',
    channel: '',
    channelId: null,
    channel_id: null,
    imageUrl: '',
    image_url: '',
    team1,
    team2,
    icon: 'sports_soccer_rounded',
    live: false,
    active: row.is_active !== false,
    gradient: [`#${start}`, `#${end}`],
  };
};

const scheduleSelect = `
  SELECT s.id, s.date_time, s.title, s.subtitle, s.channel, s.channel_id, s.image_url,
         s.team1, s.team2, s.icon, s.live, s.active, s.gradient_start, s.gradient_end,
         c.name AS channel_name
    FROM schedule_items s
    LEFT JOIN channels c ON c.id = s.channel_id
`;

// Public: active schedule items for the Ratiba tab
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `${scheduleSelect}
        WHERE s.active = TRUE
        ORDER BY s.date_time ASC NULLS LAST, s.id ASC
        LIMIT 200`,
    );

    if (result.rows.length > 0) {
      return res.json(result.rows.map(serializeSchedule));
    }

    const legacy = await query(
      `SELECT id, league, team1, team2, match_time, is_active
         FROM upcoming_matches
        WHERE is_active = TRUE
        ORDER BY match_time ASC NULLS LAST, id DESC
        LIMIT 100`,
    );
    return res.json(legacy.rows.map((row, i) => serializeLegacyMatch(row, i)));
  } catch (err) {
    if (err && (err.code === '42P01' || /schedule_items|image_url|channel_id/i.test(String(err.message || '')))) {
      try {
        const legacy = await query(
          `SELECT id, league, team1, team2, match_time, is_active
             FROM upcoming_matches
            WHERE is_active = TRUE
            ORDER BY match_time ASC NULLS LAST, id DESC
            LIMIT 100`,
        );
        return res.json(legacy.rows.map((row, i) => serializeLegacyMatch(row, i)));
      } catch (legacyErr) {
        return next(legacyErr);
      }
    }
    return next(err);
  }
});

// Register / unregister per-user bell reminder (FCM when event goes live).
router.post('/:id/remind', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const externalId = String(req.body?.externalId || req.body?.external_id || '').trim();
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid schedule id' });
    }
    if (!externalId) {
      return res.status(400).json({ error: 'externalId is required' });
    }

    const exists = await query(
      `SELECT id FROM schedule_items WHERE id = $1 AND active = TRUE LIMIT 1`,
      [id],
    );
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Schedule item not found' });
    }

    await query(
      `INSERT INTO schedule_reminders (schedule_id, external_id)
       VALUES ($1, $2)
       ON CONFLICT (schedule_id, external_id) DO NOTHING`,
      [id, externalId],
    );
    return res.json({ ok: true, reminded: true, scheduleId: id });
  } catch (err) {
    if (err && err.code === '42P01') {
      return res.status(503).json({ error: 'Reminders not available yet' });
    }
    return next(err);
  }
});

router.delete('/:id/remind', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const externalId = String(
      req.body?.externalId || req.body?.external_id || req.query?.externalId || '',
    ).trim();
    if (!Number.isFinite(id) || id <= 0 || !externalId) {
      return res.status(400).json({ error: 'schedule id and externalId required' });
    }
    await query(
      `DELETE FROM schedule_reminders WHERE schedule_id = $1 AND external_id = $2`,
      [id, externalId],
    );
    return res.json({ ok: true, reminded: false, scheduleId: id });
  } catch (err) {
    if (err && err.code === '42P01') {
      return res.json({ ok: true, reminded: false });
    }
    return next(err);
  }
});

module.exports = router;
module.exports.serializeSchedule = serializeSchedule;
