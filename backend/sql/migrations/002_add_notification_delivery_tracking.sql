-- Migration: Add notification delivery tracking
-- This allows tracking how many devices received notifications vs just sent

-- Add columns to track sent and delivered counts
ALTER TABLE notifications 
  ADD COLUMN IF NOT EXISTS sent_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivered_count INTEGER NOT NULL DEFAULT 0;

-- Create table to track individual notification deliveries (for debugging and analytics)
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id SERIAL PRIMARY KEY,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  failed BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  UNIQUE(notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notification ON notification_deliveries(notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user ON notification_deliveries(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_delivered ON notification_deliveries(delivered_at);

-- Add comment explaining the columns
COMMENT ON COLUMN notifications.sent_count IS 'Number of FCM tokens the notification was sent to';
COMMENT ON COLUMN notifications.delivered_count IS 'Number of devices that confirmed receiving the notification';
