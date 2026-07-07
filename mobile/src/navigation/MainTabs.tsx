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
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { makeScreenOptions } from '../theme';
import { PlayerMiniBar } from '../components/PlayerMiniBar';
import { FloatingTabBar } from '../components/FloatingTabBar';
import { useConversationStore } from '../store/conversationStore';

// Screens
import SearchScreen              from '../screens/search/SearchScreen';
import TransfersScreen           from '../screens/transfers/TransfersScreen';
import LibraryScreen             from '../screens/library/LibraryScreen';
import MoreScreen                from '../screens/more/MoreScreen';
import OverviewScreen            from '../screens/more/OverviewScreen';
import ConnectionScreen          from '../screens/more/ConnectionScreen';
import BrowseScreen              from '../screens/more/BrowseScreen';
import RoomsScreen               from '../screens/more/RoomsScreen';
import RoomDetailScreen          from '../screens/more/RoomDetailScreen';
import ChatScreen                from '../screens/more/ChatScreen';
import ChatConversationScreen    from '../screens/more/ChatConversationScreen';
import TagsScreen                from '../screens/more/TagsScreen';
import AnalysisScreen            from '../screens/more/AnalysisScreen';
import SystemScreen              from '../screens/more/SystemScreen';
import SettingsScreen            from '../screens/more/SettingsScreen';
import NetworkLogScreen          from '../screens/more/NetworkLogScreen';

export type MainTabParamList = {
  OverviewTab:  undefined;
  SearchTab:    undefined;
  TransfersTab: undefined;
  LibraryTab:   undefined;
  MoreTab:      NavigatorScreenParams<MoreStackParamList> | undefined;
};

export type MoreStackParamList = {
  More:             undefined;
  Connection:       undefined;
  Browse:           undefined;
  Rooms:            undefined;
  RoomDetail:       { roomName: string };
  Chat:             undefined;
  ChatConversation: { username: string };
  Tags:             undefined;
  Analysis:         undefined;
  System:           undefined;
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
      <More.Screen name="Connection"       component={ConnectionScreen}       options={{ title: 'Connection' }} />
      <More.Screen name="Browse"           component={BrowseScreen}           options={{ title: 'Browse' }} />
      <More.Screen name="Rooms"            component={RoomsScreen}            options={{ title: 'Rooms' }} />
      <More.Screen name="RoomDetail"       component={RoomDetailScreen}       options={{ title: '' }} />
      <More.Screen name="Chat"             component={ChatScreen}             options={{ title: 'Chat' }} />
      <More.Screen name="ChatConversation" component={ChatConversationScreen} options={{ title: '' }} />
      <More.Screen name="Tags"             component={TagsScreen}             options={{ title: 'Tags' }} />
      <More.Screen name="Analysis"         component={AnalysisScreen}         options={{ title: 'Analysis' }} />
      <More.Screen name="System"           component={SystemScreen}           options={{ title: 'System' }} />
      <More.Screen name="Settings"         component={SettingsScreen}         options={{ title: 'Settings' }} />
      <More.Screen name="NetworkLog"       component={NetworkLogScreen}       options={{ title: 'Network Log' }} />
    </More.Navigator>
  );
}

export default function MainTabs() {
  const { colors } = useTheme();
  const totalUnread = useConversationStore((s) => s.totalUnread);

  return (
    <Tab.Navigator
      initialRouteName="OverviewTab"
      tabBar={(props) => (
        <View>
          <PlayerMiniBar />
          <FloatingTabBar {...props} />
        </View>
      )}
      screenOptions={{
        ...makeScreenOptions(colors),
        headerStyle:      { backgroundColor: colors.header },
        headerTintColor:  colors.textPrimary,
        headerShadowVisible: false,
      }}
    >
      <Tab.Screen
        component={OverviewScreen}
        name="OverviewTab"
        options={{ title: 'Overview' }}
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
        component={LibraryScreen}
        name="LibraryTab"
        options={{ title: 'Library', headerShown: false }}
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
