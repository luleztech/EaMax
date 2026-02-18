# Firebase Cloud Messaging (FCM) Setup Guide

This guide will help you set up Firebase Cloud Messaging for push notifications in the EaMax app.

## Prerequisites

1. A Firebase project (create one at https://console.firebase.google.com/)
2. Android app registered in Firebase Console
3. iOS app registered in Firebase Console (if supporting iOS)

## Android Setup

### Step 1: Download google-services.json

1. Go to Firebase Console → Project Settings
2. Under "Your apps", select your Android app (or add one if you haven't)
3. Download the `google-services.json` file
4. Place it in: `android/app/google-services.json`

### Step 2: Configure Backend

1. Go to Firebase Console → Project Settings → Service Accounts
2. Click "Generate new private key"
3. Download the JSON file
4. Set the environment variable `FIREBASE_SERVICE_ACCOUNT_KEY` in your backend:
   - For Railway: Add it as a secret/environment variable
   - The value should be the entire JSON content as a string (you may need to escape it)


Example:
```bash
export FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"your-project",...}'
```

Or in Railway dashboard:
- Go to your service → Variables
- Add: `FIREBASE_SERVICE_ACCOUNT_KEY` = `{paste the entire JSON content}`

### Step 3: Rebuild the App

After adding `google-services.json`, rebuild the Android app:

```bash
cd android
./gradlew clean
cd ..
npx react-native run-android
```

## iOS Setup (if supporting iOS)

1. Download `GoogleService-Info.plist` from Firebase Console
2. Place it in: `ios/GoogleService-Info.plist`
3. Open Xcode and add the file to your project
4. Rebuild the iOS app

## Testing

1. Run the app and log in
2. The app will automatically request notification permissions
3. The FCM token will be registered with the backend
4. Send a test notification from the admin panel

## Troubleshooting

### "Firebase Admin not initialized" error
- Make sure `FIREBASE_SERVICE_ACCOUNT_KEY` is set in your backend environment
- Check that the JSON is valid and properly escaped

### Notifications not appearing
- Check that notification permissions are granted
- Verify `google-services.json` is in the correct location
- Check device logs for FCM token registration
- Ensure the app is not in "Do Not Disturb" mode

### Build errors
- Make sure `google-services.json` exists in `android/app/`
- Clean and rebuild: `cd android && ./gradlew clean && cd .. && npx react-native run-android`
