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

import { Text } from '../components/Typography';
import { useServerProfiles } from '../store/serverProfilesStore';
import { tokenUsername } from '../lib/jwt';
import StudioController from '../components/StudioController';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, Linking, Pressable } from 'react-native';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import TrackPlayer from 'react-native-track-player';
import { useAuthStore } from '../store/auth';
import { startSessionHealth } from '../services/sessionHealth';
import { useAppSettings } from '../store/appSettingsStore';
import { useMixtapesHub } from '../store/mixtapeStore';
import { useLibraryActivityHub } from '../store/libraryActivityStore';
import { enableRemoteLogging, disableRemoteLogging } from '../api/remoteLogger';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { initNotifications, refreshMessageBadge, useMessageBadge, useNotificationHub } from '../services/notificationService';
import { useBackgroundChat } from '../services/backgroundChat';
import { useConnectionMonitor } from '../services/connectionMonitor';
import { OverlayProgressRing, useFloatingOverlay } from '../hooks/useFloatingOverlay';
import { PerfProfiler, usePerfProbe } from '../lib/perfProbe';
import { occludingFold, useWindowFold } from '../lib/adaptiveWindow';
import PlayerOverlay from '../components/PlayerOverlay';
import { PlayerBubble } from '../components/PlayerBubble';
import { ChatBubble } from '../components/ChatBubble';
import { useMiniBarHeight } from '../components/PlayerMiniBar';
import ConnectionBanner from '../components/ConnectionBanner';
import AuthStack from './AuthStack';
import MainTabs from './MainTabs';
import type { MainTabParamList } from './MainTabs';
import StartScreen from '../screens/auth/StartScreen';
import { useAppMode } from '../store/appModeStore';
import { useLibrarySettings } from '../store/librarySettingsStore';

function RemoteServices() {
  useEffect(() => startSessionHealth(), []);
  useEffect(() => {
    let active = true;
    void initNotifications().then(() => { if (active) void refreshMessageBadge(); });
    return () => { active = false; };
  }, []);
  useMixtapesHub();
  useLibraryActivityHub();
  useNotificationHub();
  useBackgroundChat();
  useMessageBadge();
  useConnectionMonitor();
  return <ConnectionBanner />;
}

function MusicApp({ remote, activeTab, onOpenChat }: { remote: boolean; activeTab: string | null; onOpenChat: () => void }) {
  usePerfProbe();
  const fold = occludingFold(useWindowFold());
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const browsingPane = fold ? (fold.vertical ? { width: fold.x } : { flex: 0, height: fold.y }) : undefined;
  const playerMode = useAppSettings((s) => s.playerMode);
  const miniBarHeight = useMiniBarHeight();
  // The native overlay (draws over other apps + home screen) takes over as the
  // controller when it's available and permitted; otherwise fall back to the
  // in-app JS bubble. Never show both.
  const { overlayActive } = useFloatingOverlay();
  // Each always-mounted piece is profiled separately so a perf summary names the subtree that's
  // actually committing, instead of attributing every frame to "the app".
  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <View style={[{ flex: 1, backgroundColor: colors.bgPrimary, paddingLeft: insets.left, paddingRight: fold?.vertical ? 0 : insets.right }, browsingPane]}>
      <PerfProfiler id="tabs"><MainTabs /></PerfProfiler>
      {playerMode === 'bubble' && !overlayActive && <PerfProfiler id="bubble"><PlayerBubble /></PerfProfiler>}
      {remote && activeTab !== 'ChatTab' && activeTab !== 'RoomsTab' && (
        <View style={{ position: 'absolute', right: 16, bottom: Math.max(insets.bottom, 8) + 68 + miniBarHeight, zIndex: 50, elevation: 50 }}>
          <ChatBubble onPress={onOpenChat} />
        </View>
      )}
      {overlayActive && <OverlayProgressRing />}
      </View>
      <PerfProfiler id="overlay"><PlayerOverlay /></PerfProfiler>
      <PerfProfiler id="banner">{remote && <RemoteServices />}</PerfProfiler>
    </View>
  );
}

function AppContent() {
  const navigationRef = useNavigationContainerRef<MainTabParamList>();
  const pendingChatLink = useRef(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  // Selectors: this is the root of the tree, so a whole-store read here re-rendered everything
  // below it (NavigationContainer included) on any unrelated auth or settings write.
  const hydrationError = useAuthStore((s) => s.hydrationError);
  const sessionId = useAuthStore((s) => s.sessionId);
  const mode = useAppMode(state => state.mode);
  const modeLoaded = useAppMode(state => state.loaded);
  const libraryLoaded = useLibrarySettings(state => state.loaded);
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
    void useAppMode.getState().load();
    void useLibrarySettings.getState().load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isReady && modeLoaded && mode !== 'local' && !hydrationError && !accessToken) {
      TrackPlayer.reset().catch(() => {});
    }
  }, [isReady, modeLoaded, mode, hydrationError, accessToken]);

  const isAuthenticated = mode === 'remote' && !!accessToken && !!serverUrl;
  useEffect(() => {
    const openChatLink = (url: string | null) => {
      if (!url || !isAuthenticated || !sessionId || !url.startsWith('resonance://chat?')) return;
      const match = /[?&]sid=([^&#]+)/.exec(url);
      if (!match || match[1] !== sessionId) return;
      if (navigationRef.isReady()) navigationRef.navigate('ChatTab', { screen: 'Chat' });
      else pendingChatLink.current = true;
    };
    void Linking.getInitialURL().then(openChatLink).catch(() => {});
    const subscription = Linking.addEventListener('url', ({ url }) => openChatLink(url));
    return () => subscription.remove();
  }, [isAuthenticated, sessionId, navigationRef]);
  useEffect(() => {
    if (!isAuthenticated || !serverUrl) return;
    const current = useAuthStore.getState();
    if (current.serverUrl !== serverUrl) return;
    void useServerProfiles.getState().remember(serverUrl, tokenUsername(current.accessToken) ?? undefined).catch(() => {});
  }, [isAuthenticated, serverUrl, sessionId]);

  useEffect(() => {
    if (isAuthenticated && remoteLogging) {
      enableRemoteLogging();
    } else {
      disableRemoteLogging();
    }
  }, [isAuthenticated, remoteLogging]);

  if (!isReady || !modeLoaded || !libraryLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgPrimary }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (hydrationError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16, backgroundColor: colors.bgPrimary }}>
        <Text style={{ color: colors.textPrimary, textAlign: 'center' }}>{hydrationError}</Text>
        <Pressable accessibilityRole="button" onPress={() => { void hydrate(); }} style={{ padding: 12 }}>
          <Text style={{ color: colors.accent }}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <NavigationContainer
        ref={navigationRef}
        onReady={() => {
          const state = navigationRef.getRootState();
          setActiveTab(state?.routes[state.index]?.name ?? null);
          if (pendingChatLink.current) {
            pendingChatLink.current = false;
            navigationRef.navigate('ChatTab', { screen: 'Chat' });
          }
        }}
        onStateChange={(state) => setActiveTab(state?.routes[state.index]?.name ?? null)}
      >
        {mode === 'choose' ? <StartScreen /> : isAuthenticated || mode === 'local' ? <MusicApp remote={isAuthenticated} activeTab={activeTab} onOpenChat={() => navigationRef.navigate('ChatTab', { screen: 'Chat' })} key={isAuthenticated ? `${serverUrl}:${sessionId}` : 'local'} /> : <AuthStack />}
      </NavigationContainer>
    </>
  );
}

export default function RootNavigator() {
  return (
    <ThemeProvider>
      <StudioController />
      <AppContent />
    </ThemeProvider>
  );
}
