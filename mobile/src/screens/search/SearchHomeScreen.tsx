// <copyright file="SearchHomeScreen.tsx" company="John Narey">
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

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, Typography } from '../../theme';
import type { ThemeColors } from '../../theme';
import * as searchApi from '../../api/searches';
import type { Search } from '../../api/searches';
import type { SearchStackParamList } from './SearchScreen';
import { LIST_PERF_PROPS } from '../../lib/listPerf';

type Nav = NativeStackNavigationProp<SearchStackParamList, 'SearchHome'>;

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function stateLabel(s: Search): string {
  if (s.isComplete) return 'Done';
  if (s.state & 4) return 'Searching…';
  if (s.state & 2) return 'Starting…';
  if (s.state & 1) return 'Queued';
  return 'Done';
}

// ─── Search row ───────────────────────────────────────────────────────────────

function SearchRow({
  item, colors, onPress, onStop, onDelete,
}: {
  item: Search;
  colors: ThemeColors;
  onPress: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  const styles = useMemo(() => makeRowStyles(colors), [colors]);
  const isActive = !item.isComplete;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <View style={styles.iconWrap}>
        {isActive
          ? <ActivityIndicator size="small" color={colors.accent} />
          : <Ionicons name="checkmark-circle" size={18} color={colors.success} />
        }
      </View>

      <View style={styles.info}>
        <Text style={styles.searchText} numberOfLines={1}>{item.searchText}</Text>
        <Text style={styles.meta}>
          {stateLabel(item)}
          {item.fileCount > 0 ? ` · ${item.fileCount} files` : ''}
          {item.responseCount > 0 ? ` · ${item.responseCount} peers` : ''}
        </Text>
      </View>

      <Pressable
        onPress={isActive ? onStop : onDelete}
        hitSlop={10}
        style={styles.action}
      >
        <Ionicons
          name={isActive ? 'stop-circle-outline' : 'close-circle-outline'}
          size={20}
          color={isActive ? colors.warning : colors.textDim}
        />
      </Pressable>
    </Pressable>
  );
}

const makeRowStyles = (c: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: c.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    gap: Spacing.sm,
  },
  rowPressed:  { opacity: 0.7 },
  iconWrap:    { width: 24, alignItems: 'center' },
  info:        { flex: 1 },
  searchText:  { fontSize: Typography.base, color: c.textPrimary, fontWeight: '500' },
  meta:        { fontSize: Typography.xs, color: c.textMuted, marginTop: 2 },
  action:      { padding: 4 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SearchHomeScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<Nav>();
  const [searches, setSearches]   = useState<Search[]>([]);
  const [query, setQuery]         = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const load = useCallback(async () => {
    try {
      const data = await searchApi.getAll();
      setSearches(
        data.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
      );
    } catch {
      // don't clear existing list on poll failure
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      intervalRef.current = setInterval(load, 3000);
      return () => {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      };
    }, [load]),
  );

  const onSubmit = useCallback(async () => {
    const text = query.trim();
    if (!text || submitting) return;
    Keyboard.dismiss();
    setSubmitting(true);
    try {
      const id = randomUUID();
      const newSearch = await searchApi.create(id, text);
      setQuery('');
      setSearches(prev => [newSearch, ...prev]);
      navigation.navigate('SearchResults', { searchId: newSearch.id, searchText: text });
    } catch {
      Alert.alert('Error', 'Failed to start search. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  }, [query, submitting, navigation]);

  const onStop = useCallback((id: string) => {
    searchApi.stop(id).then(load).catch(() => {});
  }, [load]);

  const onDelete = useCallback((id: string) => {
    searchApi.remove(id).then(load).catch(() => {});
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={styles.root}>
      {/* Search bar */}
      <View style={styles.bar}>
        <TextInput
          style={styles.input}
          placeholder="Search the Soulseek network…"
          placeholderTextColor={colors.textDim}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={onSubmit}
          editable={!submitting}
        />
        <Pressable
          style={[styles.searchBtn, (!query.trim() || submitting) && styles.searchBtnOff]}
          onPress={onSubmit}
          disabled={!query.trim() || submitting}
        >
          {submitting
            ? <ActivityIndicator size="small" color="#fff" />
            : <Ionicons name="search" size={18} color="#fff" />
          }
        </Pressable>
      </View>

      {/* History list */}
      <FlatList
        {...LIST_PERF_PROPS}
        data={searches}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <SearchRow
            item={item}
            colors={colors}
            onPress={() =>
              navigation.navigate('SearchResults', { searchId: item.id, searchText: item.searchText })
            }
            onStop={() => onStop(item.id)}
            onDelete={() => onDelete(item.id)}
          />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          !refreshing ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={52} color={colors.textDim} />
              <Text style={styles.emptyTitle}>No searches yet</Text>
              <Text style={styles.emptySub}>Search the Soulseek network above</Text>
            </View>
          ) : null
        }
        contentContainerStyle={searches.length === 0 ? styles.listEmpty : undefined}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bgPrimary },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: c.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  input: {
    flex: 1,
    backgroundColor: c.bgElevated,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: c.textPrimary,
    borderWidth: 1,
    borderColor: c.border,
  },
  searchBtn: {
    backgroundColor: c.accent,
    borderRadius: Radius.md,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnOff: { opacity: 0.4 },

  empty:      { alignItems: 'center', gap: Spacing.sm, paddingVertical: 60 },
  emptyTitle: {
    fontSize: Typography.lg,
    fontWeight: '600',
    color: c.textPrimary,
    marginTop: Spacing.sm,
  },
  emptySub: {
    fontSize: Typography.sm,
    color: c.textMuted,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },
  listEmpty: { flex: 1, justifyContent: 'center' },
});
