// <copyright file="ServerScreen.tsx" company="John Narey">
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

import { Text } from '../../components/Typography';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import { useAuthStore } from '../../store/auth';
import { AppState, getApplicationState, restartApplication } from '../../api/application';
import { Card, SectionHeader, StatRow, fmtDate } from '../../components/overview/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MoreStackParamList } from '../../navigation/MainTabs';

type Props = NativeStackScreenProps<MoreStackParamList, 'Server'>;

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// Same shape MoreScreen uses — navigate() is only type-safe for screens taking no params.
type ParamlessScreen = { [K in keyof MoreStackParamList]: MoreStackParamList[K] extends undefined ? K : never }[keyof MoreStackParamList];

// The backend-facing screens that used to sit at the top level of More. They're grouped
// here rather than there so More stays about the app and this screen is the one place the
// server is administered from.
const SERVER_SECTIONS: {
  label:    string;
  icon:     IoniconName;
  screen:   ParamlessScreen;
  subtitle: string;
}[] = [
  { label: 'Connection',     icon: 'wifi-outline',        screen: 'Connection',    subtitle: 'App, Soulseek & disk status' },
  { label: 'Soulseek Relay', icon: 'git-network-outline', screen: 'SoulseekRelay', subtitle: 'Your position in the distributed search network' },
  { label: 'Server Logs',    icon: 'reader-outline',      screen: 'Logs',          subtitle: 'Live & historical server logs' },
  { label: 'Blocked',        icon: 'ban-outline',         screen: 'Blocked',       subtitle: 'Blocked users, IPs & locations' },
];

// Matches ConnectionScreen's cadence, which polls the same endpoint.
const POLL_MS = 15_000;

export default function ServerScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const isAdmin = useAuthStore((state) => state.isAdmin);

  const [appState, setAppState]   = useState<AppState | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [fetchedAt, setFetchedAt]   = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setAppState(await getApplicationState());
      setFetchedAt(new Date().toISOString());
      setError(null);
    } catch (e) {
      // A restart tears the API down mid-poll; keep the last good state on screen
      // rather than flashing an error the user can't act on.
      setError(e instanceof Error ? e.message : 'Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) fetch(); }, [isAdmin, fetch]);

  useEffect(() => {
    if (!isAdmin) return;
    const interval = setInterval(() => fetch(true), POLL_MS);
    return () => clearInterval(interval);
  }, [isAdmin, fetch]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetch(true);
    setRefreshing(false);
  }, [fetch]);

  const doRestart = useCallback(async () => {
    setRestarting(true);
    try {
      await restartApplication();
      // The backend relaunches itself; there's no success response to wait for beyond
      // the 204. Poll until the new process answers, then the pending badge clears itself.
      setTimeout(() => { fetch(true); setRestarting(false); }, 8_000);
    } catch (e) {
      setRestarting(false);
      Alert.alert(
        'Restart failed',
        e instanceof Error ? e.message : 'The server did not accept the restart request.',
      );
    }
  }, [fetch]);

  const confirmRestart = useCallback(() => {
    Alert.alert(
      'Restart backend',
      'Transfers in progress will be interrupted and the server will be briefly unreachable while it comes back up.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restart', style: 'destructive', onPress: doRestart },
      ],
    );
  }, [doRestart]);

  if (!isAdmin) {
    return (
      <View style={s.denied}>
        <Ionicons color={colors.textDim} name="lock-closed-outline" size={40} />
        <Text style={s.deniedText}>Only administrators can restart the server.</Text>
      </View>
    );
  }

  const pendingRestart   = !!appState?.pendingRestart;
  const pendingReconnect = !!appState?.pendingReconnect;
  const version          = appState?.version;
  const server           = appState?.server;

  if (loading && !appState) {
    return (
      <View style={s.denied}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={s.container}
      style={s.scroll}
      refreshControl={
        <RefreshControl onRefresh={onRefresh} refreshing={refreshing} tintColor={colors.accent} />
      }
    >
      {pendingRestart && (
        <View style={s.banner}>
          <Ionicons color={colors.warning} name="alert-circle" size={20} />
          <View style={s.bannerText}>
            <Text style={s.bannerTitle}>Restart required</Text>
            <Text style={s.bannerBody}>
              A configuration change has been saved but won&apos;t take effect until the backend restarts.
            </Text>
          </View>
        </View>
      )}

      {pendingReconnect && !pendingRestart && (
        <View style={[s.banner, s.bannerInfo]}>
          <Ionicons color={colors.accent} name="information-circle" size={20} />
          <View style={s.bannerText}>
            <Text style={s.bannerTitle}>Reconnect required</Text>
            <Text style={s.bannerBody}>
              A Soulseek option changed; the client needs to reconnect. A restart also applies it.
            </Text>
          </View>
        </View>
      )}

      <SectionHeader colors={colors} title="Manage" />
      <Card colors={colors}>
        {SERVER_SECTIONS.map((item, i) => (
          <Pressable
            key={item.screen}
            onPress={() => navigation.navigate(item.screen)}
            style={({ pressed }) => [
              s.navRow,
              i === SERVER_SECTIONS.length - 1 && s.navRowLast,
              pressed && s.navRowPressed,
            ]}
          >
            <View style={s.navIcon}>
              <Ionicons color={colors.accent} name={item.icon} size={20} />
            </View>
            <View style={s.navText}>
              <Text style={s.navLabel}>{item.label}</Text>
              <Text style={s.navSub} numberOfLines={1}>{item.subtitle}</Text>
            </View>
            <Ionicons color={colors.textDim} name="chevron-forward" size={16} />
          </Pressable>
        ))}
      </Card>

      <SectionHeader colors={colors} title="Status" />
      <Card colors={colors}>
        <StatRow
          colors={colors}
          label="Pending action"
          value={pendingRestart ? 'Restart required' : pendingReconnect ? 'Reconnect required' : 'None'}
          valueColor={pendingRestart ? colors.warning : pendingReconnect ? colors.accent : colors.success}
        />
        <StatRow colors={colors} label="Version" value={version?.current ?? '—'} />
        <StatRow
          colors={colors}
          label="Soulseek"
          value={server?.isLoggedIn ? 'Signed in' : server?.state ?? 'Disconnected'}
          valueColor={server?.isLoggedIn ? colors.success : colors.textMuted}
        />
        <StatRow colors={colors} label="Last checked" last value={fetchedAt ? fmtDate(fetchedAt) : '—'} />
      </Card>

      {error && <Text style={s.error}>{error}</Text>}

      <SectionHeader colors={colors} title="Actions" />
      <Pressable
        disabled={restarting}
        onPress={confirmRestart}
        style={({ pressed }) => [
          s.restartBtn,
          pendingRestart && s.restartBtnUrgent,
          (pressed || restarting) && s.restartBtnPressed,
        ]}
      >
        {restarting ? (
          <ActivityIndicator color={colors.warning} size="small" />
        ) : (
          <Ionicons color={pendingRestart ? colors.warning : colors.textPrimary} name="refresh" size={18} />
        )}
        <Text style={[s.restartText, pendingRestart && { color: colors.warning }]}>
          {restarting ? 'Restarting…' : 'Restart backend'}
        </Text>
      </Pressable>
      <Text style={s.hint}>
        The server relaunches itself and is unreachable for a few seconds. Active transfers are
        interrupted and resume on the way back up.
      </Text>
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll:    { flex: 1, backgroundColor: c.bgPrimary },
    container: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xl },

    denied:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl, backgroundColor: c.bgPrimary },
    deniedText: { color: c.textMuted, fontSize: Typography.base, textAlign: 'center' },

    banner: {
      flexDirection:   'row',
      gap:             Spacing.sm,
      padding:         Spacing.md,
      borderRadius:    Radius.lg,
      borderWidth:     1,
      borderColor:     c.warning,
      backgroundColor: c.bgSurface,
      alignItems:      'flex-start',
    },
    bannerInfo:  { borderColor: c.accent },
    bannerText:  { flex: 1, gap: 2 },
    bannerTitle: { color: c.textPrimary, fontSize: Typography.base, fontWeight: '600' },
    bannerBody:  { color: c.textMuted, fontSize: Typography.sm, lineHeight: 18 },

    error: { color: c.danger, fontSize: Typography.sm, paddingHorizontal: Spacing.sm },

    navRow: {
      flexDirection:     'row',
      alignItems:        'center',
      padding:           Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    navRowLast:    { borderBottomWidth: 0 },
    navRowPressed: { backgroundColor: c.bgElevated },
    navIcon:       { width: 28, alignItems: 'center', marginRight: Spacing.sm },
    navText:       { flex: 1, gap: 2 },
    navLabel:      { color: c.textPrimary, fontSize: Typography.base, fontWeight: '500' },
    navSub:        { color: c.textMuted, fontSize: Typography.xs },

    restartBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             Spacing.sm,
      padding:         Spacing.md,
      borderRadius:    Radius.lg,
      borderWidth:     1,
      borderColor:     c.border,
      backgroundColor: c.bgSurface,
    },
    restartBtnUrgent:  { borderColor: c.warning },
    restartBtnPressed: { opacity: 0.6 },
    restartText:       { color: c.textPrimary, fontSize: Typography.base, fontWeight: '600' },

    hint: { color: c.textDim, fontSize: Typography.xs, lineHeight: 16, paddingHorizontal: Spacing.sm },
  });
}
