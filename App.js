/**
 * Streaming Apps - Football & Movies
 * React Native App
 */

import React from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import StreamingApp from './src/components/StreamingApp';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#030712" />
      <StreamingApp />
    </SafeAreaProvider>
  );
}

export default App;
