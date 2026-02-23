/**
 * Streaming Apps - Football & Movies
 * React Native App
 */

import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import mobileAds from 'react-native-google-mobile-ads';
import { preloadRewardedAd } from './src/config/ads';
import StreamingApp from './src/components/StreamingApp';
import { lockToPortrait, lockToPortraitWhenAppActive } from './src/utils/orientation';

function App() {
  useEffect(() => {
    lockToPortrait();
    const cleanup = lockToPortraitWhenAppActive();
    return cleanup;
  }, []);

  useEffect(() => {
    // Initialize AdMob SDK once at app start so rewarded ads can load
    mobileAds()
      .initialize()
      .then(adapterStatuses => {
        console.log('[AdMob] Initialized', adapterStatuses?.length ?? 0, 'adapters');
        // Preload after UI and native Activity are ready (avoids null-activity error)
        // Using requestIdleCallback or setTimeout instead of deprecated InteractionManager
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(() => {
            setTimeout(() => preloadRewardedAd(), 800);
          });
        } else {
          setTimeout(() => preloadRewardedAd(), 1000);
        }
      })
      .catch(e => {
        console.warn('[AdMob] Initialize failed:', e?.message ?? e);
      });
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#030712" />
      <StreamingApp />
    </SafeAreaProvider>
  );
}

export default App;
