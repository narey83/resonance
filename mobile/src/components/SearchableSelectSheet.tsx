// <copyright file="SearchableSelectSheet.tsx" company="John Narey">
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
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import { useTheme } from '../context/ThemeContext';
import { Radius, Spacing, Typography } from '../theme';
import type { ThemeColors } from '../theme';

interface Props {
  visible: boolean;
  title: string;
  options: string[];
  onSelect: (value: string) => void;
  onClose: () => void;
  /** Allow choosing a typed value that is not in the list (mirrors the web's allowAdditions). */
  allowCustom?: boolean;
  placeholder?: string;
}

/**
 * Searchable single-select presented as a bottom sheet. Filters {options} by the
 * search text and, when {allowCustom} is set, offers to use the raw text as a value
 * — so a country/city that has not been observed yet can still be blocked.
 */
export default function SearchableSelectSheet({
  visible,
  title,
  options,
  onSelect,
  onClose,
  allowCustom = true,
  placeholder = 'Search…',
}: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, query]);

  const trimmed = query.trim();
  const showCustom =
    allowCustom &&
    trimmed.length > 0 &&
    !options.some(o => o.toLowerCase() === trimmed.toLowerCase());

  const choose = (value: string) => {
    setQuery('');
    onSelect(value);
  };

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={close}>
      <View style={s.sheet}>
        <View style={s.header}>
          <Text style={s.title}>{title}</Text>
          <Pressable onPress={close} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        <TextInput
          style={s.search}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          value={query}
          onChangeText={setQuery}
        />

        <FlatList
          data={filtered}
          keyExtractor={(item, i) => `${item}-${i}`}
          keyboardShouldPersistTaps="handled"
          style={s.list}
          ListHeaderComponent={
            showCustom ? (
              <Pressable style={s.item} onPress={() => choose(trimmed)}>
                <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
                <Text style={[s.itemText, { color: colors.accent }]} numberOfLines={1}>
                  Use “{trimmed}”
                </Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            showCustom ? null : <Text style={s.empty}>No matches</Text>
          }
          renderItem={({ item }) => (
            <Pressable style={s.item} onPress={() => choose(item)}>
              <Text style={s.itemText} numberOfLines={1}>{item}</Text>
            </Pressable>
          )}
        />
      </View>
    </BottomSheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheet: {
    backgroundColor: c.bgElevated,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    maxHeight: '70%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  title: { fontSize: Typography.md, fontWeight: '700', color: c.textPrimary },
  search: {
    backgroundColor: c.bgPrimary,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    color: c.textPrimary,
    fontSize: Typography.sm,
  },
  list: { flexGrow: 0 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  itemText: { flex: 1, fontSize: Typography.md, color: c.textPrimary },
  empty: { color: c.textMuted, fontSize: Typography.sm, padding: Spacing.md, textAlign: 'center' },
});
