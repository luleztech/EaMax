# Testing Push Notifications

## Prerequisites

1. ✅ Firebase project set up
2. ✅ `google-services.json` placed in `android/app/`
3. ✅ `FIREBASE_SERVICE_ACCOUNT_KEY` set in Railway backend
4. ✅ App rebuilt after adding `google-services.json`
5. ✅ App installed on device/emulator

## Step-by-Step Testing

### 1. Start the User App

```bash
npx react-native run-android
```

### 2. Check Notification Permission

- When the app starts, it should automatically request notification permissions
- Grant permission if prompted
- Check device logs for: `"FCM Token: ..."` - this confirms FCM is working

### 3. Verify FCM Token Registration

- Open the app and navigate to Profile screen
- Check device logs (using `adb logcat` or React Native debugger)
- Look for: `"FCM token registered successfully"`

### 4. Test Notification from Admin Panel

1. Open the Admin app (EaAdmin)
2. Click the bell icon (🔔) in the top right
3. Fill in the notification form:
   - **Category:** Select "Kabumbu" or "Movies"
   - **Title:** Enter a test title (e.g., "Test Notification")
   - **Message:** Enter a test message (e.g., "This is a test notification")
   - **Type:** Select "Send Now"
4. Click "Send Now"
5. Wait for success message

### 5. Check Notification Display

The notification should appear in the status bar in these scenarios:

#### A. App in Foreground (Open)
- Notification should appear at the top of the screen
- Should show title and message
- Should have sound (if device not muted)

#### B. App in Background (Minimized)
- Notification should appear in the status bar
- Swipe down to see full notification
- Should have sound (if device not muted)

#### C. App Closed (Killed)
- Notification should appear in the status bar
- Swipe down to see full notification
- Tapping notification should open the app
- Should have sound (if device not muted)

## Troubleshooting

### "Internal server error" or "Error sending notification" in Admin

If the Admin app shows an error when you tap **Send Now**:

1. **Railway environment variables (required):**
   - **ADMIN_API_KEY** – Must be set and must match the key in EaAdmin (`EaAdmin/src/config/api.js` or your env). If missing, the API returns 500.
   - **FIREBASE_SERVICE_ACCOUNT_KEY** – Must be the **full JSON** of your Firebase service account key (one line, no line breaks). If missing or invalid, push won’t send but the notification is still saved.

2. **Check Railway logs:**
   - Railway project → your backend service → **Deployments** → **View Logs**.
   - Look for: `Firebase Admin initialized successfully` (Firebase OK).
   - Look for: `Notifications INSERT failed` or `POST /notifications error` (DB or code error).
   - Look for: `Push send error (notification still saved)` (Firebase/FCM issue; notification is still created).

3. **Database:** Ensure the `notifications` table exists (run `backend/sql/schema.sql` on your Railway Postgres if needed).

4. **EaAdmin API key:** The value in EaAdmin’s `X-Admin-Key` header must exactly match Railway’s `ADMIN_API_KEY`.

### Notification Not Appearing

1. **Check FCM Token:**
   ```bash
   adb logcat | grep "FCM Token"
   ```
   - Should see a token string
   - If not, check Firebase setup

2. **Check Backend Logs:**
   - Check Railway logs for "Firebase Admin initialized successfully"
   - Check for any errors when sending notification

3. **Check Device Settings:**
   - Go to Settings → Apps → EaMax → Notifications
   - Ensure notifications are enabled
   - Check "Show on lock screen" if needed

4. **Check Do Not Disturb:**
   - Ensure device is not in "Do Not Disturb" mode
   - Check notification settings

5. **Verify Firebase Setup:**
   - Check that `google-services.json` is in `android/app/`
   - Verify `FIREBASE_SERVICE_ACCOUNT_KEY` is set in Railway
   - Check Firebase Console → Cloud Messaging for sent notifications

### Notification Appears But No Sound

- Check device volume
- Check app notification settings
- Verify notification channel has sound enabled (should be automatic)

### Notification Not Showing in Status Bar

- Check Android notification settings for the app
- Ensure notification importance is set to "High" (should be automatic)
- Try restarting the app

## Expected Behavior

✅ **Success Indicators:**
- FCM token appears in logs
- Admin panel shows "Notification sent successfully"
- Notification appears in status bar (all app states)
- Notification has sound
- Notification shows title and message
- Tapping notification opens the app (if closed)

❌ **Failure Indicators:**
- No FCM token in logs
- "Firebase Admin not initialized" in backend logs
- Admin panel shows error message
- No notification appears
- Notification appears but no sound

## Testing Checklist

- [ ] App requests notification permission on first launch
- [ ] FCM token appears in logs
- [ ] FCM token registered with backend (check logs)
- [ ] Admin panel can send notification
- [ ] Notification appears when app is **foreground**
- [ ] Notification appears when app is **background**
- [ ] Notification appears when app is **closed**
- [ ] Notification shows in status bar
- [ ] Notification has sound
- [ ] Tapping notification opens app (if closed)
- [ ] Multiple notifications work correctly

## Advanced Testing

### Test Multiple Users

1. Install app on multiple devices/emulators
2. Each device should get its own FCM token
3. Send notification from admin panel
4. All devices should receive the notification

### Test Scheduled Notifications

1. In admin panel, select "Schedule" type
2. Set date and time (format: YYYY-MM-DD and HH:MM)
3. Schedule notification
4. Wait for scheduled time
5. Notification should appear automatically

### Test Different Categories

- Send notification with category "kabumbu"
- Send notification with category "movies"
- Send notification with category "habari"
- All should work the same way

## Logs to Monitor

**User App Logs:**
```
FCM Token: [token]
FCM token registered successfully
Foreground notification received: [message]
Background notification received: [message]
```

**Backend Logs (Railway):**
```
Firebase Admin initialized successfully
Sending push notifications to [X] users
Push notification sent successfully
```

## Quick Test Command

```bash
# Monitor logs while testing
adb logcat | grep -E "FCM|notification|Notifee"
```
