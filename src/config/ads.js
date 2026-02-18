/**
 * AdMob configuration.
 * Set your real IDs from AdMob console:
 * - App ID: AdMob → App settings → App ID (ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY)
 * - Rewarded video: AdMob → Ads → Rewarded → Ad unit ID (ca-app-pub-XXXXXXXXXXXXXXXX/ZZZZZZZZZZ)
 * Also set the App ID in android/app/src/main/AndroidManifest.xml (meta-data com.google.android.gms.ads.APPLICATION_ID).
 */

// Your AdMob App ID (also set in AndroidManifest.xml)
export const ADMOB_APP_ID_ANDROID = 'ca-app-pub-3940256099942544~3347511713';

// Your Rewarded video ad unit ID (earn 20 points per watch)
export const ADMOB_REWARDED_VIDEO_UNIT_ID_ANDROID = 'ca-app-pub-3940256099942544/5224354917';

// Used when showing rewarded ads (production uses your IDs above)
export const REWARDED_AD_UNIT_ID = ADMOB_REWARDED_VIDEO_UNIT_ID_ANDROID;
