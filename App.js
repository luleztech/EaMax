/**
 * Streaming Apps - Football & Movies
 * React Native App
 */

import React, { useEffect } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import mobileAds from 'react-native-google-mobile-ads';
import { preloadRewardedAd } from './src/config/ads';
import StreamingApp from './src/components/StreamingApp';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  useEffect(() => {
    // Initialize AdMob SDK once at app start so rewarded ads can load
    mobileAds()
      .initialize()
      .then(adapterStatuses => {
        console.log('[AdMob] Initialized', adapterStatuses?.length ?? 0, 'adapters');
        // Delay preload so the first screen paints first (avoids grey screen if ad SDK misbehaves)
        setTimeout(() => preloadRewardedAd(), 1500);
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
