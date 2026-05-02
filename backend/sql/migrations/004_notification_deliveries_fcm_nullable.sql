-- Allow topic/client-tracked deliveries without a stored token (Flutter reports delivered).
ALTER TABLE notification_deliveries
  ALTER COLUMN fcm_token DROP NOT NULL;
