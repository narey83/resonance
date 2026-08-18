// <copyright file="RootNavigator.tsx" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

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
import { initNotifications, useNotificationHub, usePushNotifications } from '../services/notificationService';
import { useConnectionMonitor } from '../services/connectionMonitor';
import { OverlayProgressRing, useFloatingOverlay } from '../hooks/useFloatingOverlay';
import { PerfProfiler, usePerfProbe } from '../lib/perfProbe';
import PlayerOverlay from '../components/PlayerOverlay';
import { PlayerBubble } from '../components/PlayerBubble';
import ConnectionBanner from '../components/ConnectionBanner';
import AuthStack from './AuthStack';
import MainTabs  from './MainTabs';

function AuthenticatedApp() {
  useMixtapesHub();
  useLibraryActivityHub();
  useNotificationHub();
  usePushNotifications();
  useConnectionMonitor();
  usePerfProbe();
  const playerMode = useAppSettings((s) => s.playerMode);
  // The native overlay (draws over other apps + home screen) takes over as the
  // controller when it's available and permitted; otherwise fall back to the
  // in-app JS bubble. Never show both.
  const { overlayActive } = useFloatingOverlay();
  // Each always-mounted piece is profiled separately so a perf summary names the subtree that's
  // actually committing, instead of attributing every frame to "the app".
  return (
    <>
      <PerfProfiler id="tabs"><MainTabs /></PerfProfiler>
      {playerMode === 'bubble' && !overlayActive && <PerfProfiler id="bubble"><PlayerBubble /></PerfProfiler>}
      {overlayActive && <OverlayProgressRing />}
      <PerfProfiler id="overlay"><PlayerOverlay /></PerfProfiler>
      <PerfProfiler id="banner"><ConnectionBanner /></PerfProfiler>
    </>
  );
}

function AppContent() {
  // Selectors: this is the root of the tree, so a whole-store read here re-rendered everything
  // below it (NavigationContainer included) on any unrelated auth or settings write.
  const isReady     = useAuthStore((s) => s.isReady);
  const accessToken = useAuthStore((s) => s.accessToken);
  const serverUrl   = useAuthStore((s) => s.serverUrl);
  const hydrate     = useAuthStore((s) => s.hydrate);
  const load          = useAppSettings((s) => s.load);
  const remoteLogging = useAppSettings((s) => s.remoteLogging);
  const { colors, isDark } = useTheme();

  useEffect(() => {
    hydrate();
    load();
    initNotifications();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
