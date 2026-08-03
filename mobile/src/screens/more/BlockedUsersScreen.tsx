// <copyright file="BlockedUsersScreen.tsx" company="John Narey">
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

import React, { useMemo, useState } from 'react';
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
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, Typography } from '../../theme';
import type { ThemeColors } from '../../theme';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';
import BlockedUserRow from '../../components/BlockedUserRow';
import { LIST_PERF_PROPS } from '../../lib/listPerf';

export default function BlockedUsersScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { users, unblock, blockIp } = useBlockedUsersStore();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      u.username.toLowerCase().includes(q) ||
      (u.city ?? '').toLowerCase().includes(q) ||
      (u.country ?? '').toLowerCase().includes(q),
    );
  }, [users, query]);

  const confirmUnblock = (username: string) =>
    unblock(username).catch(err => Alert.alert('Error', String(err?.message ?? err)));

  return (
    <View style={s.screen}>
      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={s.searchInput}
          placeholder="Search blocked users…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
        />
        {query.trim().length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      <FlatList
        {...LIST_PERF_PROPS}
        data={filtered}
        keyExtractor={u => u.username}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={filtered.length === 0 ? s.emptyWrap : s.listContent}
        renderItem={({ item }) => (
          <BlockedUserRow
            user={item}
            onUnblock={() => confirmUnblock(item.username)}
            onBlockIp={ip => blockIp(ip).catch(() => {})}
          />
        )}
        ListEmptyComponent={
          <Text style={s.empty}>
            {query.trim() ? `No matches for “${query.trim()}”` : 'No blocked users'}
          </Text>
        }
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgPrimary },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: c.bgElevated,
    borderRadius: Radius.md,
    margin: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  searchInput: { flex: 1, color: c.textPrimary, fontSize: Typography.sm, paddingVertical: 0 },
  listContent: {
    backgroundColor: c.bgElevated,
    borderRadius: Radius.md,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.xl,
    overflow: 'hidden',
  },
  emptyWrap: { padding: Spacing.md },
  empty: { color: c.textMuted, fontSize: Typography.sm, padding: Spacing.md, textAlign: 'center' },
});
