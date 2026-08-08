// <copyright file="MainTabs.tsx" company="John Narey">
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

import React from 'react';
import { BottomTabBarHeightCallbackContext, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useTheme } from '../context/ThemeContext';
import { makeScreenOptions } from '../theme';
import { PlayerMiniBar } from '../components/PlayerMiniBar';
import { FloatingTabBar } from '../components/FloatingTabBar';
import { useConversationStore } from '../store/conversationStore';
import { totalMentions, useRoomStore } from '../store/roomStore';
import { useAppSettings } from '../store/appSettingsStore';
import { PerfProfiler } from '../lib/perfProbe';

// Screens
import SearchScreen              from '../screens/search/SearchScreen';
import TransfersScreen           from '../screens/transfers/TransfersScreen';
import LibraryScreen             from '../screens/library/LibraryScreen';
import MoreScreen                from '../screens/more/MoreScreen';
import OverviewScreen            from '../screens/more/OverviewScreen';
import ConnectionScreen          from '../screens/more/ConnectionScreen';
import BrowseScreen              from '../screens/more/BrowseScreen';
import BrowseUserScreen          from '../screens/more/BrowseUserScreen';
import RoomsScreen               from '../screens/more/RoomsScreen';
import BrowseRoomsScreen         from '../screens/more/BrowseRoomsScreen';
import RoomDetailScreen          from '../screens/more/RoomDetailScreen';
import ChatScreen                from '../screens/more/ChatScreen';
import ChatConversationScreen    from '../screens/more/ChatConversationScreen';
import TagsScreen                from '../screens/more/TagsScreen';
import AnalysisScreen            from '../screens/more/AnalysisScreen';
import LogsScreen                from '../screens/more/LogsScreen';
import BlockedScreen             from '../screens/more/BlockedScreen';
import BlockedUsersScreen        from '../screens/more/BlockedUsersScreen';
import SettingsScreen            from '../screens/more/SettingsScreen';
import NotificationsScreen       from '../screens/more/NotificationsScreen';
import SoulseekRelayScreen       from '../screens/more/SoulseekRelayScreen';
import NetworkLogScreen          from '../screens/more/NetworkLogScreen';

export type MainTabParamList = {
  LibraryTab:   undefined;
  SearchTab:    undefined;
  TransfersTab: undefined;
  BrowseTab:    NavigatorScreenParams<BrowseStackParamList> | undefined;
  RoomsTab:     NavigatorScreenParams<RoomsStackParamList> | undefined;
  ChatTab:      NavigatorScreenParams<ChatStackParamList> | undefined;
  MoreTab:      NavigatorScreenParams<MoreStackParamList> | undefined;
};

export type MoreStackParamList = {
  More:             undefined;
  Overview:         undefined;
  Connection:       undefined;
  Tags:             undefined;
  Analysis:         undefined;
  Logs:             undefined;
  Blocked:          undefined;
  BlockedUsers:     undefined;
  Settings:         undefined;
  Notifications:    undefined;
  SoulseekRelay:    undefined;
  NetworkLog:       undefined;
};

export type BrowseStackParamList = {
  Browse:     undefined;
  BrowseUser: { username: string };
};

export type RoomsStackParamList = {
  Rooms:        undefined;
  BrowseRooms:  undefined;
  RoomDetail:   { roomName: string };
};

export type ChatStackParamList = {
  Chat:             undefined;
  ChatConversation: { username: string };
};

const Tab    = createBottomTabNavigator<MainTabParamList>();
const More   = createNativeStackNavigator<MoreStackParamList>();
const Browse = createNativeStackNavigator<BrowseStackParamList>();
const Rooms  = createNativeStackNavigator<RoomsStackParamList>();
const Chat   = createNativeStackNavigator<ChatStackParamList>();

function MoreStack() {
  const { colors } = useTheme();
  const navOpts = makeScreenOptions(colors);
  return (
    <More.Navigator screenOptions={navOpts}>
      <More.Screen name="More"             component={MoreScreen}             options={{ title: 'More' }} />
      <More.Screen name="Overview"         component={OverviewScreen}         options={{ title: 'Overview' }} />
      <More.Screen name="Connection"       component={ConnectionScreen}       options={{ title: 'Connection' }} />
      <More.Screen name="Tags"             component={TagsScreen}             options={{ title: 'Tags' }} />
      <More.Screen name="Analysis"         component={AnalysisScreen}         options={{ title: 'Analysis' }} />
      <More.Screen name="Logs"             component={LogsScreen}             options={{ title: 'Server Logs' }} />
      <More.Screen name="Blocked"          component={BlockedScreen}          options={{ title: 'Blocked' }} />
      <More.Screen name="BlockedUsers"     component={BlockedUsersScreen}     options={{ title: 'Blocked Users' }} />
      <More.Screen name="Settings"         component={SettingsScreen}         options={{ title: 'Settings' }} />
      <More.Screen name="Notifications"    component={NotificationsScreen}    options={{ title: 'Notifications' }} />
      <More.Screen name="SoulseekRelay"    component={SoulseekRelayScreen}    options={{ title: 'Soulseek Relay' }} />
      <More.Screen name="NetworkLog"       component={NetworkLogScreen}       options={{ title: 'Network Log' }} />
    </More.Navigator>
  );
}

function BrowseStack() {
  const { colors } = useTheme();
  return (
    <Browse.Navigator screenOptions={makeScreenOptions(colors)}>
      <Browse.Screen name="Browse"     component={BrowseScreen}     options={{ title: 'Browse' }} />
      <Browse.Screen name="BrowseUser" component={BrowseUserScreen} options={{ title: '' }} />
    </Browse.Navigator>
  );
}

function RoomsStack() {
  const { colors } = useTheme();
  return (
    <Rooms.Navigator screenOptions={makeScreenOptions(colors)}>
      <Rooms.Screen name="Rooms"       component={RoomsScreen}       options={{ title: 'Rooms' }} />
      <Rooms.Screen name="BrowseRooms" component={BrowseRoomsScreen} options={{ title: 'Browse Rooms' }} />
      <Rooms.Screen name="RoomDetail"  component={RoomDetailScreen}  options={{ title: '' }} />
    </Rooms.Navigator>
  );
}

function ChatStack() {
  const { colors } = useTheme();
  return (
    <Chat.Navigator screenOptions={makeScreenOptions(colors)}>
      <Chat.Screen name="Chat"             component={ChatScreen}             options={{ title: 'Chat' }} />
      <Chat.Screen name="ChatConversation" component={ChatConversationScreen} options={{ title: '' }} />
    </Chat.Navigator>
  );
}

function TabBarWithPlayer(props: BottomTabBarProps) {
  const playerMode = useAppSettings((s) => s.playerMode);
  const reportHeight = React.useContext(BottomTabBarHeightCallbackContext);
  const [barHeight, setBarHeight] = React.useState(0);

  // The mini bar rides up to sit on top of the keyboard rather than being buried
  // behind it. A KeyboardStickyView lifts by the full keyboard height measured
  // from the screen bottom, which overshoots by however much sits below the mini
  // bar — the tab bar itself — so `offset.opened` pulls it back down flush.
  //
  // That same number is what a screen with its own bottom input bar needs to
  // clear, so it's also what we report as the navigator's tab bar height:
  // react-navigation never measures a custom `tabBar`, it just keeps the guess
  // it made for a stock one.
  const onBarLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setBarHeight(h);
    reportHeight?.(h);
  };

  return (
    <View>
      {playerMode === 'bar' && (
        <KeyboardStickyView offset={{ opened: barHeight }}>
          <PlayerMiniBar />
        </KeyboardStickyView>
      )}
      <View onLayout={onBarLayout}>
        <FloatingTabBar {...props} />
      </View>
    </View>
  );
}

// One Profiler id per tab screen plus one for the bar. A single "tabs" id around the whole
// navigator proved too coarse: it showed repeated ~630ms commits and bursts of 300+ commits per
// window without saying which screen was producing them. Defined at module scope so the wrapper
// keeps a stable component identity — building them inside render would remount every screen on
// each pass.
function perfScreen<P extends object>(id: string, Screen: React.ComponentType<P>) {
  const Wrapped = (props: P) => (
    <PerfProfiler id={id}><Screen {...props} /></PerfProfiler>
  );
  Wrapped.displayName = `Perf(${id})`;
  return Wrapped;
}

const PerfLibrary   = perfScreen('s:library', LibraryScreen);
const PerfSearch    = perfScreen('s:search', SearchScreen);
const PerfTransfers = perfScreen('s:transfers', TransfersScreen);
const PerfBrowse    = perfScreen('s:browse', BrowseStack);
const PerfRooms     = perfScreen('s:rooms', RoomsStack);
const PerfChat      = perfScreen('s:chat', ChatStack);
const PerfMore      = perfScreen('s:more', MoreStack);

export default function MainTabs() {
  const { colors } = useTheme();
  const totalUnread  = useConversationStore((s) => s.totalUnread);
  const roomMentions = useRoomStore(totalMentions);

  return (
    <Tab.Navigator
      initialRouteName="LibraryTab"
      tabBar={(props) => <PerfProfiler id="tabbar"><TabBarWithPlayer {...props} /></PerfProfiler>}
      screenOptions={{
        ...makeScreenOptions(colors),
        headerStyle:      { backgroundColor: colors.header },
        headerTintColor:  colors.textPrimary,
        headerShadowVisible: false,
        // Blurred tabs keep their state but stop re-rendering (react-freeze via
        // react-native-screens) — state pushed by hubs/stores while away is applied
        // on refocus instead of re-rendering a hidden analytics dashboard.
        freezeOnBlur: true,
      }}
    >
      <Tab.Screen
        component={PerfLibrary}
        name="LibraryTab"
        options={{ title: 'Library', headerShown: false }}
      />
      <Tab.Screen
        component={PerfSearch}
        name="SearchTab"
        options={{ title: 'Search', headerShown: false }}
      />
      <Tab.Screen
        component={PerfTransfers}
        name="TransfersTab"
        options={{ title: 'Transfers' }}
      />
      <Tab.Screen
        component={PerfBrowse}
        name="BrowseTab"
        options={{ title: 'Browse', headerShown: false }}
      />
      <Tab.Screen
        component={PerfRooms}
        name="RoomsTab"
        options={{
          title: 'Rooms',
          headerShown: false,
          tabBarBadge: roomMentions > 0 ? (roomMentions > 99 ? '99+' : roomMentions) : undefined,
        }}
      />
      <Tab.Screen
        component={PerfChat}
        name="ChatTab"
        options={{
          title: 'Chat',
          headerShown: false,
          tabBarBadge: totalUnread > 0 ? (totalUnread > 99 ? '99+' : totalUnread) : undefined,
        }}
      />
      <Tab.Screen
        component={PerfMore}
        name="MoreTab"
        options={{ title: 'More', headerShown: false }}
      />
    </Tab.Navigator>
  );
}
