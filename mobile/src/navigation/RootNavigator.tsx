import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import TrackPlayer from 'react-native-track-player';
import { useAuthStore } from '../store/auth';
import { useAppSettings } from '../store/appSettingsStore';
import { useMixtapesHub } from '../store/mixtapeStore';
import { useLibraryActivityHub } from '../store/libraryActivityStore';
import { enableRemoteLogging, disableRemoteLogging } from '../api/remoteLogger';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { initNotifications, useNotificationHub } from '../services/notificationService';
import { useConnectionMonitor } from '../services/connectionMonitor';
import PlayerOverlay from '../components/PlayerOverlay';
import ConnectionBanner from '../components/ConnectionBanner';
import AuthStack from './AuthStack';
import MainTabs  from './MainTabs';

function AuthenticatedApp() {
  useMixtapesHub();
  useLibraryActivityHub();
  useNotificationHub();
  useConnectionMonitor();
  return (
    <>
      <MainTabs />
      <PlayerOverlay />
      <ConnectionBanner />
    </>
  );
}

function AppContent() {
  const { isReady, accessToken, serverUrl, hydrate } = useAuthStore();
  const { load, remoteLogging } = useAppSettings();
  const { colors, isDark } = useTheme();

  useEffect(() => {
    hydrate();
    load();
    initNotifications();
  }, []);

  useEffect(() => {
    if (isReady && !accessToken) {
      TrackPlayer.reset().catch(() => {});
    }
  }, [isReady, accessToken]);

  const isAuthenticated = !!accessToken && !!serverUrl;

  useEffect(() => {
    if (isAuthenticated && remoteLogging) {
      enableRemoteLogging();
    } else {
      disableRemoteLogging();
    }
  }, [isAuthenticated, remoteLogging]);

  if (!isReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgPrimary }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <NavigationContainer>
        {isAuthenticated ? <AuthenticatedApp /> : <AuthStack />}
      </NavigationContainer>
    </>
  );
}

export default function RootNavigator() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
