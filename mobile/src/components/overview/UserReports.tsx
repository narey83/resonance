// <copyright file="UserReports.tsx" company="John Narey">
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

import { Text, TextInput } from '../Typography';
import { Editorial, Radius, Spacing, Typography, ThemeColors } from '../../theme';

// FlatList already virtualizes rows, so unlike the web version (which needs
// @tanstack/react-virtual for its plain HTML table) no extra dependency is
// needed here for large user lists.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getUserList, UserReportSummary } from '../../api/analytics';
import { SkeletonRows } from '../Skeleton';
import { EmptyState, fmtBytes, fmtDate } from './shared';

const PAGE_SIZE = 25;

export default function UserReports({ colors, onSelectUser }: { colors: ThemeColors; onSelectUser: (username: string) => void }) {
  const s = React.useMemo(() => makeStyles(colors), [colors]);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<UserReportSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingMoreRef = useRef(false);
  const requestSeqRef = useRef(0);

  const load = useCallback(async (query: string, offset: number) => {
    const seq = ++requestSeqRef.current;
    const page = await getUserList({ search: query || undefined, limit: PAGE_SIZE, offset });
    if (seq !== requestSeqRef.current) return; // superseded by a newer request
    setTotal(page.total);
    setItems((prev) => {
      if (offset === 0) return page.items;
      // The list is sorted by LastSeen over live data, so page boundaries can
      // shift between fetches; drop users we already have to keep keys unique.
      const seen = new Set(prev.map((u) => u.username));
      return [...prev, ...page.items.filter((u) => !seen.has(u.username))];
    });
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      load(search, 0).finally(() => setLoading(false));
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const loadMore = useCallback(async () => {
    // onEndReached can fire several times per frame on a non-scrolling
    // FlatList; the ref guards synchronously where state would lag a render.
    if (loadingMoreRef.current || items.length >= total) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await load(search, items.length);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [items.length, total, load, search]);

  return (
    <View style={{ gap: Spacing.sm }}>
      <View style={s.searchWrap}>
        <Ionicons name="search-outline" size={16} color={colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search username"
          placeholderTextColor={colors.textMuted}
          style={s.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      {loading ? (
        <SkeletonRows rows={5} />
      ) : items.length === 0 ? (
        <EmptyState text="No users found." colors={colors} />
      ) : (
        // Plain mapped rows, not a FlatList: this sits inside the page ScrollView, so a
        // nested list can't virtualize anyway, and onEndReached on a non-scrolling list
        // fires continuously — it auto-paginated the ENTIRE user table 25 rows at a time,
        // hammering the API every few seconds and rendering an unbounded list. Paging is
        // explicit via the button below instead.
        <View>
          {items.map((item) => (
            <Pressable key={item.username} style={s.row} onPress={() => onSelectUser(item.username)}>
              <View style={s.info}>
                <Text style={s.username} numberOfLines={1}>{item.username}</Text>
                <Text style={s.sub}>
                  ↓ {fmtBytes(item.downloadBytes)} · ↑ {fmtBytes(item.uploadBytes)} · {fmtDate(item.lastSeen)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </Pressable>
          ))}
          {items.length < total && (
            <Pressable style={s.moreBtn} onPress={loadMore} disabled={loadingMore}>
              {loadingMore ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Text style={s.moreText}>Show more · {items.length} of {total}</Text>
              )}
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      backgroundColor: c.bgElevated,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    searchInput: { flex: 1, fontSize: Typography.base, color: c.textPrimary, padding: 0, ...Editorial.control },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.bgSurface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: Spacing.md,
      marginBottom: Spacing.xs,
    },
    info:     { flex: 1, gap: 2 },
    username: { fontSize: Typography.base, color: c.textPrimary, fontWeight: '500' },
    sub:      { fontSize: Typography.xs, color: c.textMuted },
    moreBtn:  {
      alignItems: 'center',
      paddingVertical: Spacing.sm,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bgElevated,
      marginTop: Spacing.xs,
    },
    moreText: { fontSize: Typography.sm, fontWeight: '600', color: c.accent },
  });
}
