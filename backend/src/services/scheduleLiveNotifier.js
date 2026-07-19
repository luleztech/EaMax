const { query } = require('../db');
const { sendPushNotificationToMultiple } = require('./firebase');

/** EAT wall-clock instant as ms, treating timestamptz UTC fields as EAT numbers. */
const wallClockMsFromRow = (dateTime) => {
  const d = dateTime instanceof Date ? dateTime : new Date(dateTime);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds() || 0,
  );
};

const eatWallNowMs = () => Date.now() + 3 * 60 * 60 * 1000;

/**
 * When a Ratiba event's EAT time is reached:
 * - flip live=true
 * - FCM notify only users who enabled the bell for that item
 */
const processDueScheduleLiveNotifications = async () => {
  let due;
  try {
    due = await query(
      `SELECT id, title, subtitle, channel, channel_id, image_url, date_time, live
         FROM schedule_items
        WHERE active = TRUE
          AND live_notified_at IS NULL
          AND date_time IS NOT NULL
          AND date_time <= (now() + interval '3 hours')
          AND date_time >= (now() - interval '6 hours')
        ORDER BY date_time ASC
        LIMIT 40`,
    );
  } catch (err) {
    if (err && (err.code === '42P01' || /live_notified_at/i.test(String(err.message || '')))) {
      return { processed: 0, skipped: true };
    }
    throw err;
  }

  const nowMs = eatWallNowMs();
  let processed = 0;

  for (const row of due.rows) {
    const eventMs = wallClockMsFromRow(row.date_time);
    if (eventMs == null || eventMs > nowMs) continue;
    // Don't notify more than 2h after start
    if (nowMs - eventMs > 2 * 60 * 60 * 1000) {
      await query(
        `UPDATE schedule_items
            SET live = TRUE, live_notified_at = now(), updated_at = now()
          WHERE id = $1 AND live_notified_at IS NULL`,
        [row.id],
      );
      continue;
    }

    const rem = await query(
      `SELECT r.external_id, u.fcm_token
         FROM schedule_reminders r
         JOIN users u ON u.external_id = r.external_id
        WHERE r.schedule_id = $1
          AND u.fcm_token IS NOT NULL
          AND TRIM(u.fcm_token) <> ''
          AND COALESCE(u.blocked, FALSE) = FALSE`,
      [row.id],
    );

    const tokens = [...new Set(rem.rows.map((r) => String(r.fcm_token || '').trim()).filter(Boolean))];
    const title = '🔴 LIVE sasa';
    const body = row.title
      ? `${row.title} imeanza — fungua EaMax kutazama`
      : 'Kipindi chako cha Ratiba kimeanza';

    if (tokens.length > 0) {
      try {
        await sendPushNotificationToMultiple(tokens, title, body, {
          type: 'schedule_live',
          scheduleId: String(row.id),
          channelId: row.channel_id != null ? String(row.channel_id) : '',
          title: String(row.title || ''),
        });
      } catch (err) {
        console.warn('[ScheduleLive] FCM failed for', row.id, err.message || err);
      }
    }

    await query(
      `UPDATE schedule_items
          SET live = TRUE, live_notified_at = now(), updated_at = now()
        WHERE id = $1`,
      [row.id],
    );
    processed += 1;
  }

  return { processed };
};

module.exports = {
  processDueScheduleLiveNotifications,
  wallClockMsFromRow,
  eatWallNowMs,
};
