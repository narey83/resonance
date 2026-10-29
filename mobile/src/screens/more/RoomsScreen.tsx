// <copyright file="RoomsScreen.tsx" company="John Narey">
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

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDeferredFocusEffect } from '../../hooks/useDeferredEffect';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRoomStore } from '../../store/roomStore';
import type { Room } from '../../api/rooms';
import { useTheme } from '../../context/ThemeContext';
import type { RoomsStackParamList } from '../../navigation/MainTabs';
import BottomSheet from '../../components/BottomSheet';

type Props = NativeStackScreenProps<RoomsStackParamList, 'Rooms'>;

// ─── memoised row component ─────────────────────────────────────────────────

interface JoinedRowProps {
  room:       Room;
  isFirst:    boolean;
  isLast:     boolean;
  s:          ReturnType<typeof makeStyles>;
  colors:     ThemeColors;
  mentions:   number;
  onNavigate: (roomName: string) => void;
}
const JoinedRow = React.memo(function JoinedRow({ room, isFirst, isLast, s, colors, mentions, onNavigate }: JoinedRowProps) {
  return (
    <Pressable
      onPress={() => onNavigate(room.name)}
      style={({ pressed }) => [s.row, isFirst && s.rowFirst, isLast && s.rowLast, pressed && s.rowPressed]}
    >
      <View style={s.iconWrap}>
        <Ionicons color={colors.accent} name="chatbubbles" size={18} />
      </View>
      <View style={s.rowContent}>
        <Text style={s.rowLabel}>{room.name}</Text>
        <Text style={s.rowSub}>{room.users.length} user{room.users.length !== 1 ? 's' : ''}</Text>
      </View>
      {mentions > 0 && (
        <View style={s.mentionBadge}>
          <Text style={s.mentionBadgeText}>{mentions > 99 ? '99+' : mentions}</Text>
        </View>
      )}
      <Ionicons color={colors.textDim} name="chevron-forward" size={16} />
    </Pressable>
  );
});

// ─── screen ──────────────────────────────────────────────────────────────────

export default function RoomsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { joined, mentions, isLoadingJoined, loadJoined, join } = useRoomStore();
  const [joining, setJoining]       = useState<string | null>(null);
  const [customRoom, setCustomRoom] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  useDeferredFocusEffect(useCallback(() => { loadJoined(); }, [loadJoined]));

  const handleNavigate = useCallback((roomName: string) => {
    navigation.navigate('RoomDetail', { roomName });
  }, [navigation]);

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

  const handleCustomJoin = useCallback(async () => {
    const name = customRoom.trim();
    if (!name) return;
    setShowCustom(false);
    setCustomRoom('');
    await handleJoin(name);
  }, [customRoom, handleJoin]);

  const renderItem = useCallback(({ item, index }: { item: Room; index: number }) => (
    <JoinedRow
      room={item}
      isFirst={index === 0}
      isLast={index === joined.length - 1}
      s={s}
      colors={colors}
      mentions={mentions[item.name] ?? 0}
      onNavigate={handleNavigate}
    />
  ), [joined.length, s, colors, mentions, handleNavigate]);

  return (
    <View style={s.container}>
      <View style={s.actionsRow}>
        <Pressable onPress={() => navigation.navigate('BrowseRooms')} style={s.actionBtn}>
          <Ionicons color={colors.accent} name="search" size={16} />
          <Text style={s.actionBtnText}>Browse Rooms</Text>
        </Pressable>
        <Pressable onPress={() => setShowCustom(true)} style={s.actionBtn}>
          <Ionicons color={colors.accent} name="add-circle-outline" size={16} />
          <Text style={s.actionBtnText}>Create Room</Text>
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={s.list}
        data={joined}
        keyExtractor={(item) => item.name}
        onRefresh={loadJoined}
        refreshing={isLoadingJoined}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons color={colors.textMuted} name="chatbubbles-outline" size={28} />
            <Text style={s.emptyText}>No rooms joined</Text>
            <Text style={s.emptyHint}>Browse Rooms to find one, or create your own</Text>
          </View>
        }
        removeClippedSubviews
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={5}
        updateCellsBatchingPeriod={50}
      />

      <BottomSheet visible={showCustom} onClose={() => { setShowCustom(false); setCustomRoom(''); }}>
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>Create a room</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onChangeText={setCustomRoom}
            onSubmitEditing={handleCustomJoin}
            placeholder="Room name"
            placeholderTextColor={colors.textMuted}
            returnKeyType="go"
            style={s.sheetInput}
            value={customRoom}
          />
          <View style={s.sheetActions}>
            <Pressable onPress={() => { setShowCustom(false); setCustomRoom(''); }} style={s.sheetCancel}>
              <Text style={s.sheetCancelText}>Cancel</Text>
            </Pressable>
            <Pressable disabled={joining === customRoom.trim()} onPress={handleCustomJoin} style={s.sheetJoin}>
              <Text style={s.sheetJoinText}>{joining === customRoom.trim() ? 'Joining…' : 'Create'}</Text>
            </Pressable>
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bgPrimary },
    list:      { padding: Spacing.lg, flexGrow: 1 },

    actionsRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginHorizontal: Spacing.lg,
      marginTop: Spacing.lg,
    },
    actionBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.md,
      backgroundColor: c.bgElevated,
      borderWidth: 1,
      borderColor: c.border,
    },
    actionBtnText: { fontSize: Typography.sm, fontWeight: '600', color: c.accent },

    empty: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xxl },
    emptyText: { fontSize: Typography.base, fontWeight: '500', color: c.textPrimary },
    emptyHint: { fontSize: Typography.sm, color: c.textMuted },

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
    rowFirst:   { borderTopWidth: 1, borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
    rowLast:    { borderBottomLeftRadius: Radius.lg, borderBottomRightRadius: Radius.lg },
    rowPressed: { backgroundColor: c.bgElevated },

    iconWrap: {
      width: 32,
      height: 32,
      borderRadius: Radius.sm,
      backgroundColor: c.bgElevated,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rowContent: { flex: 1 },
    rowLabel: { fontSize: Typography.base, color: c.textPrimary, ...Editorial.heading },
    rowSub:     { fontSize: Typography.xs, color: c.textMuted, marginTop: 1 },

    mentionBadge: {
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 5,
      backgroundColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: Spacing.sm,
    },
    mentionBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },

    sheet: {
      backgroundColor: c.bgSurface,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      padding: Spacing.xl,
      gap: Spacing.md,
    },
    sheetTitle: { fontSize: Typography.md, color: c.textPrimary, ...Editorial.heading },
    sheetInput: {
      backgroundColor: c.bgElevated,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: Typography.base,
      color: c.textPrimary,
    },
    sheetActions:    { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'flex-end' },
    sheetCancel:     { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border },
    sheetCancelText: { fontSize: Typography.base, color: c.textMuted },
    sheetJoin:       { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.md, backgroundColor: c.accent },
    sheetJoinText:   { fontSize: Typography.base, fontWeight: '600', color: '#fff' },
  });
}
