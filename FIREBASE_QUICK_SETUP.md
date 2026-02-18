# Firebase Quick Setup Guide

## Step 1: Register App in Firebase Console

**Android Package Name:** `com.eamax`

**App Nickname (optional):** EaMax (or any name you prefer)

1. Go to https://console.firebase.google.com/
2. Select your project (or create a new one)
3. Click "Add app" → Select Android icon
4. Enter:
   - **Android package name:** `com.eamax`
   - **App nickname (optional):** EaMax
5. Click "Register app"

## Step 2: Download google-services.json

1. After registering, Firebase will show you a download button for `google-services.json`
2. **Download the file**
3. **Place it here:** `android/app/google-services.json`

   ```bash
   # The file should be at this exact location:
   android/app/google-services.json
   ```

## Step 3: Firebase SDK (Already Added ✅)

The Firebase SDK is already configured in your project:
- ✅ `@react-native-firebase/app` - Installed
- ✅ `@react-native-firebase/messaging` - Installed
- ✅ `@notifee/react-native` - Installed
- ✅ Google Services plugin added to `android/build.gradle`
- ✅ Plugin applied in `android/app/build.gradle`

**No action needed for Step 3!**

## Step 4: Next Steps

### A. Get Firebase Service Account Key (for Backend)

1. In Firebase Console, go to **Project Settings** (gear icon)
2. Click on **Service Accounts** tab
3. Click **Generate new private key**
4. Download the JSON file
5. **Add to Railway (or your backend hosting):**
   - Go to your Railway project → Variables
   - Add new variable:
     - **Name:** `FIREBASE_SERVICE_ACCOUNT_KEY`
     - **Value:** Copy the entire contents of the downloaded JSON file and paste it as a string
   - Save

### B. Rebuild Your Android App

After placing `google-services.json` in `android/app/`, rebuild:

```bash
cd android
./gradlew clean
cd ..
npx react-native run-android
```

### C. Test Notifications

1. Run the app on your device/emulator
2. The app will automatically request notification permissions
3. Check logs for: "FCM Token: ..." (means it's working!)
4. Create a test notification from the admin panel
5. You should receive the notification even when the app is minimized!

## Troubleshooting

### "google-services.json not found"
- Make sure the file is at: `android/app/google-services.json`
- Check file name spelling (must be exactly `google-services.json`)

### "Firebase Admin not initialized"
- Check that `FIREBASE_SERVICE_ACCOUNT_KEY` is set in Railway
- Make sure the JSON is valid (copy entire file contents)

### Build errors after adding google-services.json
- Clean build: `cd android && ./gradlew clean`
- Rebuild: `npx react-native run-android`

### Notifications not appearing
- Check device notification permissions in Settings
- Verify FCM token is registered (check app logs)
- Make sure app is not in "Do Not Disturb" mode

## Verification Checklist

- [ ] `google-services.json` placed in `android/app/`
- [ ] `FIREBASE_SERVICE_ACCOUNT_KEY` set in Railway backend
- [ ] App rebuilt after adding google-services.json
- [ ] Notification permissions granted in app
- [ ] FCM token appears in logs when app starts
- [ ] Test notification sent from admin panel works
