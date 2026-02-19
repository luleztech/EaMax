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

#### D. User Was Offline (Pro: offline → online delivery)
- Backend sends with **high priority** and **28-day TTL**; FCM queues messages when the device is offline.
- As soon as the device has internet again (Wi‑Fi or mobile data), FCM delivers pending notifications.
- Works with the app **minimized** or in the background; the notification appears in the status bar when delivered.
- No collapse key is used, so **each notification** is delivered (not replaced by a newer one).

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

### Notification Not Appearing (still not received)

1. **Same Firebase project**
   - Backend `FIREBASE_SERVICE_ACCOUNT_KEY` and the app’s `android/app/google-services.json` must be from the **same Firebase project**. If not, FCM tokens from the app are invalid for the backend and pushes never arrive.
   - In Firebase Console → Project settings, confirm the Android app package name matches your app (e.g. `com.eamax`).

2. **Token in database**
   - In Railway → Postgres → **Data** → `users` table, check that the test user’s row has **`fcm_token`** and **`fcm_token_updated_at`** filled (not NULL).
   - If they are NULL, the app never registered the token. See step 3.

3. **App logs (logcat)**
   - Run: `adb logcat | grep -E "FCM|notification|Notifee"`
   - You should see: `[FCM] Token registered successfully with backend` (and earlier `FCM Token: ...`).
   - If you see `[FCM] Register token failed:` or `Could not get FCM token`, fix that first (user not found, no permission, or wrong Firebase config).
   - If you see `Notification permission not granted`, allow notifications in device Settings → Apps → EaMax → Notifications.

4. **Rebuild and reinstall the user app**
   - After any change to `google-services.json`, notification code, or AndroidManifest, do a full rebuild and reinstall on the device, then open the app and allow notifications.

5. **Backend has tokens when sending**
   - When you tap “Send Now”, the backend selects users where `fcm_token IS NOT NULL`. If all are NULL, no push is sent. Fix token registration (steps 2–3) first.

6. **Device:** Settings → Apps → EaMax → Notifications enabled; not in Do Not Disturb.
7. **Firebase:** Same project for app and backend; Cloud Messaging for delivery stats.

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
