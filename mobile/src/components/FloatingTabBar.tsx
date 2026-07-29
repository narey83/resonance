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

// Floating pill-style replacement for the stock BottomTabBar — same 5 tabs
// and navigation behavior, just rendered as a rounded bar with margin
// instead of a full-width bar docked to the screen edge.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTheme } from '../context/ThemeContext';
import { Radius, Spacing, ThemeColors } from '../theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_ICONS: Record<string, { active: IoniconName; inactive: IoniconName }> = {
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
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const icons = TAB_ICONS[route.name];
          const label = typeof options.title === 'string' ? options.title : route.name;
          const badge = options.tabBarBadge;

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable key={route.key} onPress={onPress} style={s.tab}>
              <View style={[s.iconWrap, focused && { backgroundColor: colors.accent + '22' }]}>
                <Ionicons
                  color={focused ? colors.accent : colors.textMuted}
                  name={icons ? (focused ? icons.active : icons.inactive) : 'ellipse-outline'}
                  size={22}
                />
                {badge != null && badge !== 0 && (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{badge}</Text>
                  </View>
                )}
              </View>
              {/* 7 tabs leaves ~45dp each — clip rather than wrap, which would
                  make one tab taller than the rest and jog the whole bar. */}
              <Text numberOfLines={1} style={[s.label, { color: focused ? colors.accent : colors.textMuted }]}>{label}</Text>
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
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.xs,
      backgroundColor: c.bgPrimary,
    },
    bar: {
      flexDirection: 'row',
      backgroundColor: c.tabBar,
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: c.tabBarBorder,
      paddingVertical: Spacing.sm,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 8,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    iconWrap: {
      width: 36,
      height: 28,
      borderRadius: Radius.full,
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
      fontSize: 10,
    },
  });
}
