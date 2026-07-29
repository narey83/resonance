// <copyright file="BrowseScreen.tsx" company="John Narey">
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDeferredFocusEffect } from '../../hooks/useDeferredEffect';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { HubConnection } from '@microsoft/signalr';
import * as browseApi from '../../api/browse';
import { BROWSE_HISTORY, createBrowseHubConnection } from '../../api/browseHub';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, Typography } from '../../theme';
import type { ThemeColors } from '../../theme';
import type { BrowseStackParamList } from '../../navigation/MainTabs';
import UserActionSheet from '../../components/UserActionSheet';
import { LIST_PERF_PROPS } from '../../lib/listPerf';

type Props = NativeStackScreenProps<BrowseStackParamList, 'Browse'>;

export default function BrowseScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [actionUser, setActionUser] = useState<string | null>(null);
  const hubRef = useRef<HubConnection | null>(null);

  // Initial fetch + live sync: any add/remove on web or another device
  // arrives over the browse hub and replaces the list wholesale.
  useEffect(() => {
    let cancelled = false;

    browseApi.getBrowseHistory()
      .then(list => { if (!cancelled) setHistory(list); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    const hub = createBrowseHubConnection();
    if (hub) {
      hub.on(BROWSE_HISTORY, (list: string[]) => {
        if (!cancelled && Array.isArray(list)) setHistory(list);
      });
      hub.start().catch(() => {});
      hubRef.current = hub;
    }

    return () => {
      cancelled = true;
      hubRef.current?.stop().catch(() => {});
      hubRef.current = null;
    };
  }, []);

  // Refetch on focus so the most-recently-viewed ordering is always current,
  // even if the hub connection dropped while another screen was open.
  useDeferredFocusEffect(
    useCallback(() => {
      browseApi.getBrowseHistory().then(setHistory).catch(() => {});
    }, []),
  );

  const openUser = useCallback((user: string) => {
    const trimmed = user.trim();
    if (!trimmed) return;
    setUsername('');
    // Optimistic local bump; the PUT's hub broadcast reconciles everywhere.
    setHistory(prev => [trimmed, ...prev.filter(u => u.toLowerCase() !== trimmed.toLowerCase())]);
    browseApi.addToBrowseHistory(trimmed).then(setHistory).catch(() => {});
    navigation.navigate('BrowseUser', { username: trimmed });
  }, [navigation]);

  const removeUser = useCallback((user: string) => {
    Alert.alert(user, 'Remove from browse history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setHistory(prev => prev.filter(u => u.toLowerCase() !== user.toLowerCase()));
          browseApi.removeFromBrowseHistory(user).then(setHistory).catch(() => {});
        },
      },
    ]);
  }, []);

  return (
    <View style={s.root}>
      <View style={s.inputRow}>
        <Ionicons name="person-outline" size={15} color={colors.textDim} style={s.inputIcon} />
        <TextInput
          style={s.input}
          value={username}
          onChangeText={setUsername}
          onSubmitEditing={() => openUser(username)}
          placeholder="Browse a user…"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
        />
        <Pressable
          style={[s.goBtn, !username.trim() && { opacity: 0.4 }]}
          onPress={() => openUser(username)}
          disabled={!username.trim()}
        >
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </Pressable>
      </View>

      <FlatList<string>
        {...LIST_PERF_PROPS}
        data={history}
        keyExtractor={u => u}
        ListHeaderComponent={
          history.length > 0
            ? <Text style={s.sectionLabel}>Recently browsed</Text>
            : null
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={s.empty}>
              <Ionicons name="folder-open-outline" size={40} color={colors.textDim} />
              <Text style={s.emptyText}>No users browsed yet</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
            onPress={() => openUser(item)}
            onLongPress={() => setActionUser(item)}
          >
            <View style={s.rowIcon}>
              <Ionicons name="person" size={14} color={colors.accent} />
            </View>
            <Text style={s.rowName} numberOfLines={1}>{item}</Text>
            <Pressable onPress={() => removeUser(item)} hitSlop={10} style={s.rowRemove}>
              <Ionicons name="close" size={16} color={colors.textDim} />
            </Pressable>
          </Pressable>
        )}
      />

      <UserActionSheet
        username={actionUser}
        onClose={() => setActionUser(null)}
        extraActions={[
          {
            label: 'Remove from History',
            icon: 'trash-outline',
            destructive: true,
            onPress: () => {
              if (actionUser) removeUser(actionUser);
            },
          },
        ]}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bgPrimary },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: Spacing.md,
    paddingLeft: Spacing.md,
    backgroundColor: c.bgSurface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: c.border,
    gap: Spacing.xs,
  },
  inputIcon: { flexShrink: 0 },
  input: {
    flex: 1,
    paddingVertical: Spacing.sm + 2,
    fontSize: Typography.base,
    color: c.textPrimary,
  },
  goBtn: {
    backgroundColor: c.accent,
    borderTopRightRadius: Radius.md,
    borderBottomRightRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionLabel: {
    fontSize: Typography.xs,
    fontWeight: '600',
    color: c.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xs,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: `${c.accent}1A`,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowName:   { flex: 1, fontSize: Typography.base, color: c.textPrimary, fontWeight: '500' },
  rowRemove: { padding: Spacing.xs },

  empty: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: 80,
  },
  emptyText: { fontSize: Typography.sm, color: c.textMuted },
});
