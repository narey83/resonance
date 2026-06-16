import 'react-native-gesture-handler';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RootNavigator from './src/navigation/RootNavigator';
import { PlayerProvider } from './src/context/PlayerContext';
import { CastProvider } from './src/context/CastContext';

export default function App() {
  return (
    <SafeAreaProvider>
      <PlayerProvider>
        <CastProvider>
          <RootNavigator />
        </CastProvider>
      </PlayerProvider>
    </SafeAreaProvider>
  );
}
