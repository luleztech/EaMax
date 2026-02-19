/**
 * AdMob configuration.
 * Set USE_TEST_ADS = false for production (real ads).
 * Test IDs load instantly and always fill so you can verify the flow.
 */

// Your AdMob App ID (also set in AndroidManifest.xml)
export const ADMOB_APP_ID_ANDROID = 'ca-app-pub-5619803043988422~7913784347';

// Your production Rewarded video ad unit ID
export const ADMOB_REWARDED_VIDEO_UNIT_ID_ANDROID = 'ca-app-pub-5619803043988422/7188294959';

// Google's test rewarded ID – always loads, use for development or when production has no fill
export const TEST_REWARDED_ID = 'ca-app-pub-3940256099942544/5224354917';

// Toggle: true = test ads (reliable), false = your real ads
export const USE_TEST_ADS = true;

export const REWARDED_AD_UNIT_ID = USE_TEST_ADS
  ? TEST_REWARDED_ID
  : ADMOB_REWARDED_VIDEO_UNIT_ID_ANDROID;

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
      requestNonPersonalizedAdsOnly: false 
    });
    
    ad.addAdEventListener(RewardedAdEventType.LOADED, () => { 
      console.log('[ads] Preloaded ad loaded successfully');
      preloadedRewarded = ad; 
    });
    
    ad.addAdEventListener(AdEventType.ERROR, (error) => { 
      console.warn('[ads] Preload failed:', error);
      preloadedRewarded = null; 
    });
    
    ad.load();
    console.log('[ads] Preloading ad with ID:', REWARDED_AD_UNIT_ID);
  } catch (e) {
    console.warn('[ads] preloadRewardedAd failed:', e?.message ?? e);
  }
}