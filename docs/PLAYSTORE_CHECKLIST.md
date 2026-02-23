# Play Store checklist – EaMax user app

Use this before uploading the **user app** (React Native) to Google Play.

## 1. Build AAB (Android App Bundle)

From project root:

```bash
npm run build:android:bundle
```

Or:

```bash
cd android && ./gradlew bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

## 2. Release signing (required for Play Store)

The app is set up to use **eamax-release.keystore** in `android/app/`. You only need to add credentials.

### One-time: add `keystore.properties`

1. In `android/app/`, copy the example and add your keystore passwords and alias:

   ```bash
   cd android/app
   cp keystore.properties.example keystore.properties
   ```

2. Edit `keystore.properties` and set:
   - **storePassword** – password for the keystore
   - **keyPassword** – password for the key (often same as storePassword)
   - **keyAlias** – alias you used when creating the keystore (e.g. `eamax` or `mykey`)

   `keystore.properties` is gitignored; never commit it.

### Build with release signing

From project root:

```bash
npm run build:android:bundle
```

If `keystore.properties` exists and is correct, the AAB will be signed with **eamax-release.keystore**. Then upload `android/app/build/outputs/bundle/release/app-release.aab` to Play Console.

## 3. App configuration (already set)

| Item | Value |
|------|--------|
| **applicationId** | `com.eamax` |
| **versionCode** | 1 (increase for each Play Store upload) |
| **versionName** | 1.0 |
| **targetSdkVersion** | 36 |
| **minSdkVersion** | 24 |
| **App name** | EaMax (`strings.xml`) |

Bump `versionCode` (and optionally `versionName`) in `android/app/build.gradle` for every new upload.

## 4. Permissions (current)

- `INTERNET` – network
- `POST_NOTIFICATIONS` – FCM / push (Android 13+)

No extra permissions needed for a basic streaming + ads + payments app.

## 5. Play Console

- Create app (if not done): [Play Console](https://play.google.com/console) → Create app.
- Fill store listing: short description, full description, screenshots, icon, feature graphic.
- Set content rating (questionnaire).
- Set target audience and privacy policy URL if required.
- Enable Google Play App Signing (recommended): use the upload key (your release keystore) and let Google manage the app signing key.

## 6. Quick checklist

- [ ] Release keystore created and backed up
- [ ] Env vars set (or secure properties) for release signing
- [ ] `npm run build:android:bundle` produces AAB
- [ ] AAB signed with release key (not debug)
- [ ] `versionCode` set and incremented for this upload
- [ ] Store listing and assets ready
- [ ] Content rating and policy done
