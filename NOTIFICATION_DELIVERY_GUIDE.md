# Notification Delivery System - Complete Guide

## Overview

This notification system ensures that **all users receive notifications**, even if they haven't opened the app for days or are offline when the notification is sent. It also tracks real delivery metrics showing how many users actually received the notification on their devices.

## Key Features

### 1. **Offline Delivery Support**
- Notifications are sent with **28-day TTL (Time To Live)**
- FCM stores notifications and delivers them when the device comes online
- Works even if user hasn't opened the app for days

### 2. **Delivery Tracking**
- **sent_count**: Number of FCM tokens the notification was sent to
- **delivered_count**: Number of devices that confirmed receiving the notification
- Real-time tracking of delivery vs. clicks

### 3. **Background Delivery Confirmation**
- App confirms delivery even when running in background
- Updates happen automatically when notification arrives on device
- No user interaction required for delivery confirmation

## Database Schema

### notifications table (updated)
```sql
- sent_count: INTEGER (number of devices notification was sent to)
- delivered_count: INTEGER (number of devices that confirmed receipt)
- clicks: INTEGER (number of times users clicked the notification)
```

### notification_deliveries table (new)
```sql
- notification_id: References notifications(id)
- user_id: References users(id)
- fcm_token: TEXT (the FCM token used)
- sent_at: TIMESTAMPTZ (when we sent to FCM)
- delivered_at: TIMESTAMPTZ (when device confirmed receipt)
- failed: BOOLEAN (if delivery failed)
- error_message: TEXT (error details if failed)
```

## Setup Instructions

### 1. Run Database Migration

```bash
cd backend
node scripts/run-notification-migration.js
```

This will:
- Add `sent_count` and `delivered_count` columns to notifications table
- Create `notification_deliveries` table for detailed tracking

### 2. Verify Firebase Configuration

The backend is already configured with:
- **28-day TTL** for offline delivery
- **High priority** for Android
- **No collapse key** (all notifications delivered, not replaced)

Configuration is in `backend/src/services/firebase.js`:
```javascript
const FCM_TTL_MS = 28 * 24 * 60 * 60 * 1000; // 28 days
```

### 3. Mobile App Updates

The mobile app now:
- Confirms delivery when notification arrives (foreground or background)
- Tracks delivery via `/api/notifications/:id/delivered` endpoint
- Uses `externalId` to identify the user

## How It Works

### Sending Notifications

1. Admin creates notification in EaAdmin panel
2. Backend queries all active users with FCM tokens (excludes blocked/uninstalled)
3. Backend sends to all tokens via Firebase Cloud Messaging
4. Records sent attempt in `notification_deliveries` table
5. Updates `sent_count` in notifications table

### Delivery Confirmation Flow

**Scenario 1: User is online (app in foreground/background)**
```
1. FCM delivers notification immediately
2. App receives notification
3. App displays notification to user
4. App calls /api/notifications/:id/delivered
5. Backend updates delivered_at in notification_deliveries
6. Backend increments delivered_count in notifications
```

**Scenario 2: User is offline**
```
1. FCM stores notification (up to 28 days)
2. When device comes online:
   - FCM delivers notification
   - App receives it (even if not opened)
   - App confirms delivery automatically
   - Backend updates delivery status
```

**Scenario 3: User hasn't opened app for days**
```
1. FCM stores notification
2. When device connects to internet:
   - Notification delivered to notification tray
   - App's background handler confirms delivery
   - No need to open app
3. User sees notification in tray
4. When user opens app or taps notification:
   - Click is recorded
```

## API Endpoints

### GET /api/notifications
Returns notifications with delivery stats:
```json
{
  "id": 123,
  "title": "New Match Live",
  "message": "Man United vs Liverpool",
  "sent_count": 1500,
  "delivered_count": 1450,
  "clicks": 320,
  "sent_at": "2026-03-10T20:00:00Z"
}
```

### POST /api/notifications/:id/delivered
Confirms delivery (called by mobile app):
```json
{
  "externalId": "user_abc123"
}
```

Response:
```json
{
  "id": 123,
  "delivered_count": 1451
}
```

### POST /api/notifications/:id/click
Records click (existing endpoint, unchanged)

## Admin Panel View

The admin will see in the notifications list:

```
Title: Man United vs Liverpool
Sent to: 1,500 devices
Delivered: 1,450 devices (96.7%)
Clicks: 320 (21.3% of delivered)
```

This shows:
- **Sent**: How many FCM tokens we sent to
- **Delivered**: How many devices confirmed receipt
- **Clicks**: How many users actually opened the notification

## Testing Offline Delivery

### Test Case 1: Airplane Mode
```bash
1. Turn on airplane mode on test device
2. Send notification from admin panel
3. Wait 30 seconds
4. Turn off airplane mode
5. Notification should appear immediately
6. Check backend - delivered_count should increment
```

### Test Case 2: App Not Opened for Days
```bash
1. Don't open app for 2-3 days
2. Send notification from admin panel
3. Notification should appear in notification tray
4. delivered_count increments (even without opening app)
5. Open app - click count increments
```

### Test Case 3: Force-closed App
```bash
1. Force close app completely (swipe away from recent apps)
2. Send notification
3. Notification should still arrive
4. Delivery confirmation should still work
```

## Troubleshooting

### Low Delivery Rate

**Problem**: sent_count is 1000 but delivered_count is only 200

**Possible causes**:
1. Invalid/expired FCM tokens
2. Users uninstalled app but still in database
3. Network issues on user devices
4. Firebase service issues

**Solutions**:
- Check `notification_deliveries` table for failed deliveries
- Remove invalid tokens from users table
- Verify Firebase Admin SDK is properly initialized

### Delivery Not Confirmed

**Problem**: Notification arrives but delivered_count doesn't increment

**Check**:
1. Mobile app has latest code with delivery confirmation
2. `/api/notifications/:id/delivered` endpoint is working
3. Check app logs for confirmation errors
4. Verify externalId is being passed correctly

### Scheduled Notifications Not Sending

**Problem**: Scheduled notifications stuck in pending

**Solution**:
Run the background service:
```bash
cd backend
node index.js
```

This processes scheduled notifications every minute.

## Performance Considerations

### Batch Inserts
The system uses batch SQL inserts for delivery records:
```javascript
INSERT INTO notification_deliveries (notification_id, user_id, fcm_token)
VALUES ($1, $2, $3), ($4, $5, $6), ... 
```

This is efficient even for thousands of users.

### Token Deduplication
Before sending, the system deduplicates FCM tokens so each device receives exactly one notification, even if a user has multiple accounts.

### Background Confirmation
Delivery confirmation happens in the background without blocking the UI or requiring user interaction.

## Security

- Delivery confirmation endpoint is public (no auth required)
- Only records delivery, doesn't expose user data
- Uses external_id instead of internal user_id in API
- No sensitive data in FCM payload

## Monitoring

Track these metrics in your admin panel:
- **Delivery rate**: delivered_count / sent_count
- **Click-through rate**: clicks / delivered_count
- **Time to delivery**: delivered_at - sent_at
- **Failed deliveries**: Count where failed = true

## Future Enhancements

Possible improvements:
1. Retry failed deliveries automatically
2. Remove invalid tokens after N failures
3. A/B testing for notification content
4. Delivery time optimization (send when users are active)
5. Rich notifications with images/actions
