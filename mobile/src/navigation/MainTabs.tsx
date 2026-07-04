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
import { createBottomTabNavigator , BottomTabBar } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { makeScreenOptions } from '../theme';
import { PlayerMiniBar } from '../components/PlayerMiniBar';
import { useConversationStore } from '../store/conversationStore';

// Screens
import SearchScreen              from '../screens/search/SearchScreen';
import TransfersScreen           from '../screens/transfers/TransfersScreen';
import LibraryScreen             from '../screens/library/LibraryScreen';
import MoreScreen                from '../screens/more/MoreScreen';
import OverviewScreen            from '../screens/more/OverviewScreen';
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
  SearchTab:    undefined;
  TransfersTab: undefined;
  LibraryTab:   undefined;
  MoreTab:      undefined;
};

export type MoreStackParamList = {
  More:             undefined;
  Overview:         undefined;
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
      <More.Screen name="Overview"         component={OverviewScreen}         options={{ title: 'Overview' }} />
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

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_ICONS: Record<string, { active: IoniconName; inactive: IoniconName }> = {
  SearchTab:    { active: 'search',        inactive: 'search-outline' },
  TransfersTab: { active: 'arrow-down',    inactive: 'arrow-down-outline' },
  LibraryTab:   { active: 'musical-notes', inactive: 'musical-notes-outline' },
  MoreTab:      { active: 'grid',          inactive: 'grid-outline' },
};

export default function MainTabs() {
  const { colors } = useTheme();
  const totalUnread = useConversationStore((s) => s.totalUnread);

  return (
    <Tab.Navigator
      tabBar={(props) => (
        <View>
          <PlayerMiniBar />
          <BottomTabBar {...props} />
        </View>
      )}
      screenOptions={({ route }) => ({
        ...makeScreenOptions(colors),
        tabBarIcon: ({ focused, color, size }) => {
          const icons = TAB_ICONS[route.name];
          const name  = focused ? icons.active : icons.inactive;
          return <Ionicons color={color} name={name} size={size} />;
        },
        tabBarActiveTintColor:   colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor:  colors.tabBarBorder,
          borderTopWidth:  1,
        },
        tabBarLabelStyle: { fontSize: 10 },
        headerStyle:      { backgroundColor: colors.header },
        headerTintColor:  colors.textPrimary,
        headerShadowVisible: false,
      })}
    >
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
