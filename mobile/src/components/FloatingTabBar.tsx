// <copyright file="FloatingTabBar.tsx" company="John Narey">
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

// A fixed five-tab rail. Shared-folder browsing and community screens live under More.

import { Text } from './Typography';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTheme } from '../context/ThemeContext';
import { notePerfInteraction } from '../lib/perfProbe';
import { Spacing, ThemeColors, Typography } from '../theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_ICONS: Record<string, { active: IoniconName; inactive: IoniconName }> = {
  DiscoverTab: { active: 'disc', inactive: 'disc-outline' },
  LibraryTab:   { active: 'musical-notes', inactive: 'musical-notes-outline' },
  SearchTab:    { active: 'search',        inactive: 'search-outline' },
  TransfersTab: { active: 'arrow-down',    inactive: 'arrow-down-outline' },
  BrowseTab:    { active: 'folder',        inactive: 'folder-outline' },
  RoomsTab:     { active: 'chatbubbles',   inactive: 'chatbubbles-outline' },
  ChatTab:      { active: 'chatbubble',    inactive: 'chatbubble-outline' },
  MoreTab:      { active: 'grid',          inactive: 'grid-outline' },
};

export function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  return (
    <View style={[s.wrapper, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
      <View style={s.bar}>
        {state.routes.filter(route => !['BrowseTab', 'RoomsTab', 'ChatTab'].includes(route.name)).map((route) => {
          const index = state.routes.findIndex(item => item.key === route.key);
          const { options } = descriptors[route.key];
          const focused = state.index === index || (route.name === 'MoreTab' && ['BrowseTab', 'RoomsTab', 'ChatTab'].includes(state.routes[state.index].name));
          const icons = TAB_ICONS[route.name];
          const label = typeof options.title === 'string' ? options.title : route.name;
          const badge = options.tabBarBadge;

          const onPress = () => {
            // Start the tap-to-paint measurement here — this is the moment the user has already
            // heard the touch feedback and is waiting for the screen to change.
            notePerfInteraction(`tab:${route.name}`);
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (state.index !== index && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable key={route.key} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: focused }} onPress={onPress} style={s.tab}>
              <View style={[s.iconWrap, focused && { borderTopColor: colors.accent }]}>
                <Ionicons
                  color={focused ? colors.accent : colors.textMuted}
                  name={icons ? (focused ? icons.active : icons.inactive) : 'ellipse-outline'}
                  size={21}
                />
                {badge != null && badge !== 0 && (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{badge}</Text>
                  </View>
                )}
              </View>
              {/* Backstop for a long label at a large font scale: clip rather
                  than wrap, which would make one tab taller and jog the bar. */}
              <Text numberOfLines={1} style={[s.label, { color: focused ? colors.accent : colors.textMuted }]}>{label.toUpperCase()}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrapper: {
      backgroundColor: c.bgPrimary,
      borderTopWidth: 1,
      borderTopColor: c.tabBarBorder,
    },
    bar: {
      flexDirection: 'row',
      backgroundColor: c.tabBar,
      paddingHorizontal: Spacing.sm,
      paddingBottom: 3,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      minHeight: 52,
      gap: 2,
    },
    iconWrap: {
      width: 40,
      height: 35,
      borderTopWidth: 3,
      borderTopColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    badge: {
      position: 'absolute',
      top: -2,
      right: 4,
      minWidth: 14,
      height: 14,
      borderRadius: 7,
      paddingHorizontal: 3,
      backgroundColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: {
      color: '#fff',
      fontSize: 9,
      fontWeight: '700',
    },
    label: {
      fontSize: 9,
      fontFamily: Typography.mono,
      letterSpacing: .3,
    },
  });
}
