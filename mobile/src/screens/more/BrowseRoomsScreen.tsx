// <copyright file="BrowseRoomsScreen.tsx" company="John Narey">
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

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDeferredFocusEffect } from '../../hooks/useDeferredEffect';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRoomStore } from '../../store/roomStore';
import type { RoomInfo } from '../../api/rooms';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import type { RoomsStackParamList } from '../../navigation/MainTabs';

type Props = NativeStackScreenProps<RoomsStackParamList, 'BrowseRooms'>;

interface RoomRowProps {
  room:      RoomInfo;
  isFirst:   boolean;
  isLast:    boolean;
  s:         ReturnType<typeof makeStyles>;
  colors:    ThemeColors;
  isJoined:  boolean;
  isLoading: boolean;
  onJoin:    (roomName: string) => void;
}
const RoomRow = React.memo(function RoomRow({ room, isFirst, isLast, s, colors, isJoined, isLoading, onJoin }: RoomRowProps) {
  return (
    <View style={[s.row, isFirst && s.rowFirst, isLast && s.rowLast]}>
      <View style={s.iconWrap}>
        <Ionicons color={colors.textMuted} name="chatbubbles-outline" size={18} />
      </View>
      <View style={s.rowContent}>
        <Text style={s.rowLabel}>{room.name}</Text>
        <Text style={s.rowSub}>{room.userCount} user{room.userCount !== 1 ? 's' : ''}</Text>
      </View>
      {isJoined ? (
        <View style={s.joinedPill}>
          <Text style={s.joinedPillText}>Joined</Text>
        </View>
      ) : (
        <Pressable
          disabled={isLoading}
          onPress={() => onJoin(room.name)}
          style={[s.joinBtn, isLoading && s.joinBtnDisabled]}
        >
          <Text style={[s.joinBtnText, isLoading && s.joinBtnTextDisabled]}>
            {isLoading ? 'Joining…' : 'Join'}
          </Text>
        </Pressable>
      )}
    </View>
  );
});

export default function BrowseRoomsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { joined, available, isLoadingAvailable, loadAvailable, join } = useRoomStore();
  const [joining, setJoining] = useState<string | null>(null);
  const [query, setQuery]     = useState('');

  const joinedNames = useMemo(() => new Set(joined.map((r) => r.name)), [joined]);

  useDeferredFocusEffect(useCallback(() => { loadAvailable(); }, [loadAvailable]));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rooms = q ? available.filter((r) => r.name.toLowerCase().includes(q)) : available;
    return [...rooms].sort((a, b) => b.userCount - a.userCount);
  }, [available, query]);

  const handleJoin = useCallback(async (roomName: string) => {
    setJoining(roomName);
    try {
      await join(roomName);
      navigation.navigate('RoomDetail', { roomName });
    } catch {
      Alert.alert('Failed to join room', `Could not join "${roomName}"`);
    } finally {
      setJoining(null);
    }
  }, [join, navigation]);

  const renderItem = useCallback(({ item, index }: { item: RoomInfo; index: number }) => (
    <RoomRow
      room={item}
      isFirst={index === 0}
      isLast={index === filtered.length - 1}
      s={s}
      colors={colors}
      isJoined={joinedNames.has(item.name)}
      isLoading={joining === item.name}
      onJoin={handleJoin}
    />
  ), [filtered.length, s, colors, joinedNames, joining, handleJoin]);

  const q = query.trim();

  return (
    <View style={s.container}>
      <View style={s.searchBar}>
        <Ionicons color={colors.textMuted} name="search" size={16} />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="Search rooms…"
          placeholderTextColor={colors.textMuted}
          style={s.searchInput}
          value={query}
        />
        {query.length > 0 && (
          <Pressable hitSlop={8} onPress={() => setQuery('')}>
            <Ionicons color={colors.textMuted} name="close-circle" size={16} />
          </Pressable>
        )}
      </View>

      <FlatList
        contentContainerStyle={s.list}
        data={filtered}
        keyExtractor={(item) => item.name}
        onRefresh={loadAvailable}
        refreshing={isLoadingAvailable}
        renderItem={renderItem}
        ListEmptyComponent={
          q && !joinedNames.has(q) ? (
            <Pressable
              disabled={joining === q}
              onPress={() => handleJoin(q)}
              style={s.joinCustomRow}
            >
              <Ionicons color={colors.accent} name="add-circle-outline" size={18} />
              <Text style={s.joinCustomText}>{joining === q ? 'Joining…' : `Join "${q}"`}</Text>
            </Pressable>
          ) : (
            <Text style={s.emptyText}>No rooms found</Text>
          )
        }
        removeClippedSubviews
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={5}
        updateCellsBatchingPeriod={50}
      />
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bgPrimary },
    list:      { padding: Spacing.lg, flexGrow: 1 },

    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginHorizontal: Spacing.lg,
      marginTop: Spacing.lg,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.md,
      backgroundColor: c.bgElevated,
      borderWidth: 1,
      borderColor: c.border,
    },
    searchInput: { flex: 1, fontSize: Typography.base, color: c.textPrimary, padding: 0 },

    joinCustomRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      padding: Spacing.md,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      borderStyle: 'dashed',
    },
    joinCustomText: { fontSize: Typography.base, fontWeight: '500', color: c.accent },
    emptyText:      { fontSize: Typography.sm, color: c.textMuted, textAlign: 'center', paddingVertical: Spacing.xl },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      padding: Spacing.md,
      backgroundColor: c.bgSurface,
      borderWidth: 1,
      borderColor: c.border,
      borderTopWidth: 0,
    },
    rowFirst: { borderTopWidth: 1, borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
    rowLast:  { borderBottomLeftRadius: Radius.lg, borderBottomRightRadius: Radius.lg },

    iconWrap: {
      width: 32,
      height: 32,
      borderRadius: Radius.sm,
      backgroundColor: c.bgElevated,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rowContent: { flex: 1 },
    rowLabel:   { fontSize: Typography.base, fontWeight: '500', color: c.textPrimary },
    rowSub:     { fontSize: Typography.xs, color: c.textMuted, marginTop: 1 },

    joinBtn:             { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm, backgroundColor: c.accent },
    joinBtnDisabled:     { backgroundColor: c.bgElevated },
    joinBtnText:         { fontSize: Typography.xs, fontWeight: '600', color: '#fff' },
    joinBtnTextDisabled: { color: c.textMuted },

    joinedPill:     { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm, backgroundColor: c.bgElevated },
    joinedPillText: { fontSize: Typography.xs, color: c.textMuted },
  });
}
