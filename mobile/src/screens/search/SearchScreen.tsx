// <copyright file="SearchScreen.tsx" company="John Narey">
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
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../../context/ThemeContext';
import { makeScreenOptions } from '../../theme';
import SearchHomeScreen from './SearchHomeScreen';
import SearchResultsScreen from './SearchResultsScreen';
import BrowseFolderScreen from './BrowseFolderScreen';

export type SearchStackParamList = {
  SearchHome:    undefined;
  SearchResults: { searchId: string; searchText: string };
  BrowseFolder:  { username: string; directory: string };
};

const Stack = createNativeStackNavigator<SearchStackParamList>();

export default function SearchScreen() {
  const { colors } = useTheme();
  const navOpts = makeScreenOptions(colors);
  return (
    <Stack.Navigator screenOptions={navOpts}>
      <Stack.Screen
        name="SearchHome"
        component={SearchHomeScreen}
        options={{ title: 'Search' }}
      />
      <Stack.Screen
        name="SearchResults"
        component={SearchResultsScreen}
        options={{ title: 'Results' }}
      />
      <Stack.Screen
        name="BrowseFolder"
        component={BrowseFolderScreen}
        options={{ title: 'Folder' }}
      />
    </Stack.Navigator>
  );
}
