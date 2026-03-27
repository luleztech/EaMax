# EaMax deploy

## Backend (Railway)

- Backend is at `https://eamax-production.up.railway.app`.
- **Deploy:** Push to `main` on GitHub. If the Railway project is linked to this repo with root directory `backend/`, Railway will build and deploy automatically.
- Ensure in Railway: `DATABASE_URL`, `ADMIN_API_KEY`, `PORT`, `FIREBASE_SERVICE_ACCOUNT_KEY`, and any payment webhook / env vars are set.

## Main app (EaMax Android)

1. **Release build (APK):**
   ```bash
   npm run build:android
   ```
   Output: `android/app/build/outputs/apk/release/app-release.apk`

2. **Release bundle (AAB, for Play Store):**
   ```bash
   npm run build:android:bundle
   ```
   Output: `android/app/build/outputs/bundle/release/app-release.aab`

3. Put your release keystore in `android/app/` and set `MYAPP_RELEASE_STORE_*` in `android/gradle.properties` (or sign in CI). Then upload the AAB to Google Play Console.

4. **Deobfuscation file (mapping.txt):** After building the bundle, upload the mapping file to Play Console so crash reports are readable. Path: `android/app/build/outputs/mapping/release/mapping.txt`. In Play Console → Your app → Release → App bundle explorer → select the version → Deobfuscation file → Upload.

5. **Optional:** Ensure `android/app/google-services.json` is present (Firebase). Replace AdMob test IDs in `src/config/ads.js` with production IDs before release.

## EaAdmin app

EaAdmin is in the `EaAdmin/` submodule. To deploy its updates:

1. **If EaAdmin has its own Git repo:**
   ```bash
   cd EaAdmin
   git add -A && git commit -m "Your message" && git push
   ```
2. **Build Android release:**
   ```bash
   cd EaAdmin/android && ./gradlew assembleRelease
   ```
3. **Update main repo to point to new EaAdmin commit (if using submodule):**
   ```bash
   cd /path/to/EaMax
   git add EaAdmin && git commit -m "Update EaAdmin ref" && git push
   ```

## One-shot “deploy everything updated”

- Backend: already deployed when you pushed `main` (Railway auto-deploy).
- Main app: run `npm run build:android` or `npm run build:android:bundle`, then upload to Play Store.
- EaAdmin: commit/push EaAdmin repo if needed, then build and distribute internally or via Play Store.
