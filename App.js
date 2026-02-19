/**
 * Streaming Apps - Football & Movies
 * React Native App
 */

import React, { useEffect } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import StreamingApp from './src/components/StreamingApp';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  useEffect(() => {
    let cancelled = false;
    const initAds = async () => {
      try {
        const { default: MobileAds } = await import('react-native-google-mobile-ads');
        const adapterStatuses = await MobileAds().initialize();
        if (!cancelled) {
          console.log('[AdMob] Initialized', adapterStatuses?.length ?? 0, 'adapters');
        }
      } catch (e) {
        if (!cancelled) console.warn('[AdMob] Initialize failed:', e?.message ?? e);
      }
    };
    initAds();
    return () => { cancelled = true; };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#030712" />
      <StreamingApp />
    </SafeAreaProvider>
  );
}

export default App;
