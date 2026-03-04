/**
 * AdMob configuration – production rewarded ads only.
 */

// Your AdMob App ID (also set in AndroidManifest.xml)
export const ADMOB_APP_ID_ANDROID = 'ca-app-pub-5619803043988422~7913784347';

// Production Rewarded video ad unit ID
export const ADMOB_REWARDED_VIDEO_UNIT_ID_ANDROID = 'ca-app-pub-5619803043988422/7188294959';

export const REWARDED_AD_UNIT_ID = ADMOB_REWARDED_VIDEO_UNIT_ID_ANDROID;

// Optional: preload one rewarded ad so the first tap shows instantly. Call from App after SDK init.
let preloadedRewarded = null;

export function getPreloadedRewardedAd() {
  const ad = preloadedRewarded;
  preloadedRewarded = null;
  return ad;
}

export function preloadRewardedAd() {
  try {
    if (!REWARDED_AD_UNIT_ID) return;
    const { RewardedAd, RewardedAdEventType, AdEventType } = require('react-native-google-mobile-ads');
    const ad = RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID, {
      requestNonPersonalizedAdsOnly: false,
    });

    ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
      preloadedRewarded = ad;
    });

    ad.addAdEventListener(AdEventType.ERROR, () => {
      preloadedRewarded = null;
    });

    ad.load();
  } catch (e) {
    console.warn('[ads] preloadRewardedAd failed:', e?.message ?? e);
  }
}
