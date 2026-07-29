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
import { useAppSettings } from '../store/appSettingsStore';

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
import RoomDetailScreen          from '../screens/more/RoomDetailScreen';
import ChatScreen                from '../screens/more/ChatScreen';
import ChatConversationScreen    from '../screens/more/ChatConversationScreen';
import TagsScreen                from '../screens/more/TagsScreen';
import AnalysisScreen            from '../screens/more/AnalysisScreen';
import LogsScreen                from '../screens/more/LogsScreen';
import BlockedScreen             from '../screens/more/BlockedScreen';
import BlockedUsersScreen        from '../screens/more/BlockedUsersScreen';
import SettingsScreen            from '../screens/more/SettingsScreen';
import NetworkLogScreen          from '../screens/more/NetworkLogScreen';

export type MainTabParamList = {
  LibraryTab:   undefined;
  SearchTab:    undefined;
  TransfersTab: undefined;
  MoreTab:      NavigatorScreenParams<MoreStackParamList> | undefined;
};

export type MoreStackParamList = {
  More:             undefined;
  Overview:         undefined;
  Connection:       undefined;
  Browse:           undefined;
  BrowseUser:       { username: string };
  Rooms:            undefined;
  RoomDetail:       { roomName: string };
  Chat:             undefined;
  ChatConversation: { username: string };
  Tags:             undefined;
  Analysis:         undefined;
  Logs:             undefined;
  Blocked:          undefined;
  BlockedUsers:     undefined;
  Settings:         undefined;
  NetworkLog:       undefined;
};

const Tab  = createBottomTabNavigator<MainTabParamList>();
const More = createNativeStackNavigator<MoreStackParamList>();

function MoreStack() {
  const { colors } = useTheme();
  const navOpts = makeScreenOptions(colors);
  return (
    <More.Navigator screenOptions={navOpts}>
      <More.Screen name="More"             component={MoreScreen}             options={{ title: 'More' }} />
      <More.Screen name="Overview"         component={OverviewScreen}         options={{ title: 'Overview' }} />
      <More.Screen name="Connection"       component={ConnectionScreen}       options={{ title: 'Connection' }} />
      <More.Screen name="Browse"           component={BrowseScreen}           options={{ title: 'Browse' }} />
      <More.Screen name="BrowseUser"       component={BrowseUserScreen}       options={{ title: '' }} />
      <More.Screen name="Rooms"            component={RoomsScreen}            options={{ title: 'Rooms' }} />
      <More.Screen name="RoomDetail"       component={RoomDetailScreen}       options={{ title: '' }} />
      <More.Screen name="Chat"             component={ChatScreen}             options={{ title: 'Chat' }} />
      <More.Screen name="ChatConversation" component={ChatConversationScreen} options={{ title: '' }} />
      <More.Screen name="Tags"             component={TagsScreen}             options={{ title: 'Tags' }} />
      <More.Screen name="Analysis"         component={AnalysisScreen}         options={{ title: 'Analysis' }} />
      <More.Screen name="Logs"             component={LogsScreen}             options={{ title: 'Server Logs' }} />
      <More.Screen name="Blocked"          component={BlockedScreen}          options={{ title: 'Blocked' }} />
      <More.Screen name="BlockedUsers"     component={BlockedUsersScreen}     options={{ title: 'Blocked Users' }} />
      <More.Screen name="Settings"         component={SettingsScreen}         options={{ title: 'Settings' }} />
      <More.Screen name="NetworkLog"       component={NetworkLogScreen}       options={{ title: 'Network Log' }} />
    </More.Navigator>
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

export default function MainTabs() {
  const { colors } = useTheme();
  const totalUnread = useConversationStore((s) => s.totalUnread);

  return (
    <Tab.Navigator
      initialRouteName="LibraryTab"
      tabBar={(props) => <TabBarWithPlayer {...props} />}
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
        component={LibraryScreen}
        name="LibraryTab"
        options={{ title: 'Library', headerShown: false }}
      />
      <Tab.Screen
        component={SearchScreen}
        name="SearchTab"
        options={{ title: 'Search', headerShown: false }}
      />
      <Tab.Screen
        component={TransfersScreen}
        name="TransfersTab"
        options={{ title: 'Transfers' }}
      />
      <Tab.Screen
        component={MoreStack}
        name="MoreTab"
        options={{
          title: 'More',
          headerShown: false,
          tabBarBadge: totalUnread > 0 ? (totalUnread > 99 ? '99+' : totalUnread) : undefined,
        }}
      />
    </Tab.Navigator>
  );
}
