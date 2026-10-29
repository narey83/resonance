// <copyright file="MoreScreen.tsx" company="John Narey">
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

import { Editorial, Radius, Spacing, ThemeColors, Typography } from '../../theme';

import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useAuthStore } from '../../store/auth';
import { useRemoteAccess } from '../../lib/remoteAccess';
import { useAppMode } from '../../store/appModeStore';
import { enterLocalMode } from '../../services/appMode';
import { logout } from '../../api/session';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { MainTabParamList, MoreStackParamList } from '../../navigation/MainTabs';

type Props = NativeStackScreenProps<MoreStackParamList, 'More'>;

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type ParamlessScreen = { [K in keyof MoreStackParamList]: MoreStackParamList[K] extends undefined ? K : never }[keyof MoreStackParamList];

interface MenuItem {
  label:     string;
  icon:      IoniconName;
  screen:    ParamlessScreen;
  subtitle:  string;
  adminOnly?: boolean;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

const MENU_SECTIONS: MenuSection[] = [
  {
    title: 'App',
    items: [
      { label: 'Overview',   icon: 'bar-chart-outline', screen: 'Overview',  subtitle: 'Stats & activity dashboard', adminOnly: true },
      // Everything about the backend itself now lives behind this one entry; see
      // SERVER_SECTIONS in ServerScreen for what it fans out to.
      { label: 'Server',     icon: 'server-outline',  screen: 'Server',     subtitle: 'Status, logs, relay & restart', adminOnly: true },
      { label: 'Notifications', icon: 'notifications-outline', screen: 'Notifications', subtitle: 'Alerts & sounds' },
      { label: 'Servers', icon: 'server-outline', screen: 'Servers', subtitle: 'Recent servers & biometric sign-in' },
      { label: 'Studio', icon: 'options-outline', screen: 'Studio', subtitle: 'Mastering & creative audio rack' },
      { label: 'Settings',   icon: 'settings-outline', screen: 'Settings',   subtitle: 'App preferences' },
      { label: 'About',      icon: 'information-circle-outline', screen: 'About', subtitle: 'Version, developer & source code' },
    ],
  },
];

export default function MoreScreen({ navigation }: Props) {
  const remote = useRemoteAccess();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { refreshToken, clearTokens, isAdmin } = useAuthStore();
  const sections = useMemo(
    () =>
      MENU_SECTIONS
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => (!item.adminOnly || isAdmin) && (remote || item.screen === 'Settings' || item.screen === 'Studio' || item.screen === 'About')),
        }))
        .filter((section) => section.items.length > 0),
    [isAdmin, remote],
  );

  const handleLogout = async () => {
    try { if (refreshToken) await logout(refreshToken); } catch {}
    await clearTokens();
  };

  return (
    <ScrollView contentContainerStyle={s.container} style={s.scroll}>
      {remote && <View>
        <Text style={s.sectionTitle}>COMMUNITY & DIGGING</Text>
        <View style={s.group}>
          {([{ target: 'BrowseTab', label: 'Browse shares', icon: 'folder-outline' }, { target: 'RoomsTab', label: 'Rooms', icon: 'chatbubbles-outline' }, { target: 'ChatTab', label: 'Private conversations', icon: 'chatbubble-outline' }] as const).map(item => (
            <Pressable key={item.target} style={s.row} onPress={() => navigation.getParent<BottomTabNavigationProp<MainTabParamList>>()?.navigate(item.target)}>
              <View style={s.iconWrap}><Ionicons color={colors.accent} name={item.icon} size={20} /></View>
              <View style={s.rowText}><Text style={s.rowLabel}>{item.label}</Text></View>
              <Ionicons color={colors.textDim} name="chevron-forward" size={16} />
            </Pressable>
          ))}
        </View>
      </View>
      }
      {!remote && <View style={s.group}><Pressable accessibilityRole="button" style={s.row} onPress={() => { void useAppMode.getState().select('remote').catch(() => Alert.alert('Could not connect', 'Please try again.')); }}><View style={s.iconWrap}><Ionicons color={colors.accent} name="server-outline" size={20} /></View><View style={s.rowText}><Text style={s.rowLabel}>Connect to server</Text><Text style={s.rowSub}>Add your remote library when you’re ready</Text></View><Ionicons color={colors.textMuted} name="arrow-forward" size={18} /></Pressable></View>}
      {sections.map((section) => (
        <View key={section.title}>
          <Text style={s.sectionTitle}>{section.title.toUpperCase()}</Text>
          <View style={s.group}>
            {section.items.map((item, i) => (
              <Pressable
                key={item.screen}
                onPress={() => navigation.navigate(item.screen)}
                style={({ pressed }) => [
                  s.row,
                  i === section.items.length - 1 && s.rowLast,
                  pressed && s.rowPressed,
                ]}
              >
                <View style={s.iconWrap}>
                  <Ionicons color={colors.accent} name={item.icon} size={20} />
                </View>
                <View style={s.rowText}>
                  <Text style={s.rowLabel}>{item.label}</Text>
                  <Text style={s.rowSub}>{item.subtitle}</Text>
                </View>
                <Ionicons color={colors.textDim} name="chevron-forward" size={16} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      {remote && <Pressable
        onPress={() => { void enterLocalMode().catch(() => Alert.alert('Could not switch', 'Please try again.')); }}
        style={s.logoutBtn}
      ><Text style={s.logoutText}>Use only local music</Text></Pressable>}
      {remote && <Pressable
        onPress={handleLogout}
        style={({ pressed }) => [s.logoutBtn, pressed && s.rowPressed]}
      >
        <Text style={s.logoutText}>Sign out</Text>
      </Pressable>}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll:     { flex: 1, backgroundColor: c.bgPrimary },
    container:  { padding: Spacing.lg, gap: Spacing.lg },
    sectionTitle: {
      fontSize: Typography.xs,
      color: c.textMuted,
      paddingHorizontal: Spacing.sm,
      paddingBottom: Spacing.xs,
      ...Editorial.heading,
    },
    group: {
      backgroundColor: c.bgSurface,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
      ...Editorial.panel,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      padding: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    rowLast:    { borderBottomWidth: 0 },
    rowPressed: { backgroundColor: c.bgElevated },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: Radius.sm,
      backgroundColor: c.bgElevated,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rowText:    { flex: 1, gap: 2 },
    rowLabel: { fontSize: Typography.base, color: c.textPrimary, ...Editorial.heading },
    rowSub:     { fontSize: Typography.xs, color: c.textMuted },
    logoutBtn: {
      backgroundColor: c.bgSurface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: Spacing.md,
      alignItems: 'center',
    },
    logoutText: { fontSize: Typography.base, fontWeight: '600', color: c.danger },
  });
}
