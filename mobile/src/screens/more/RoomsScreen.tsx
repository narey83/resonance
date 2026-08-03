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

import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDeferredFocusEffect } from '../../hooks/useDeferredEffect';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRoomStore } from '../../store/roomStore';
import type { Room, RoomInfo } from '../../api/rooms';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import type { RoomsStackParamList } from '../../navigation/MainTabs';
import BottomSheet from '../../components/BottomSheet';

type Props = NativeStackScreenProps<RoomsStackParamList, 'Rooms'>;

type JoinedItem   = { _type: 'joined';   room: Room }
type EmptyItem    = { _type: 'empty' }
type AvailItem    = { _type: 'available'; room: RoomInfo }
type AnyItem      = JoinedItem | EmptyItem | AvailItem;
type RoomSection  = { key: 'joined' | 'available'; title: string; data: AnyItem[] };

// ─── memoised row components ────────────────────────────────────────────────

interface RowShared { isFirst: boolean; isLast: boolean; s: ReturnType<typeof makeStyles> }

const EmptyRow = React.memo(function EmptyRow({ s }: { s: ReturnType<typeof makeStyles> }) {
  return (
    <View style={[s.row, s.rowFirst, s.rowLast, s.emptyRow]}>
      <Text style={s.emptyText}>No rooms joined</Text>
    </View>
  );
});

interface JoinedRowProps extends RowShared {
  room:       Room;
  colors:     ThemeColors;
  mentions:   number;
  onNavigate: (roomName: string) => void;
  onLeave:    (room: Room) => void;
}
const JoinedRow = React.memo(function JoinedRow({ room, isFirst, isLast, s, colors, mentions, onNavigate, onLeave }: JoinedRowProps) {
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
      <Pressable hitSlop={8} onPress={() => onLeave(room)} style={s.leaveBtn}>
        <Text style={s.leaveBtnText}>Leave</Text>
      </Pressable>
      <Ionicons color={colors.textDim} name="chevron-forward" size={16} />
    </Pressable>
  );
});

interface AvailRowProps extends RowShared {
  room:      RoomInfo;
  colors:    ThemeColors;
  isJoined:  boolean;
  isLoading: boolean;
  onJoin:    (roomName: string) => void;
}
const AvailRow = React.memo(function AvailRow({ room, isFirst, isLast, s, colors, isJoined, isLoading, onJoin }: AvailRowProps) {
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

const SectionGap = () => <View style={sectionGapStyle} />;
const sectionGapStyle = { height: Spacing.lg };

// ─── screen ──────────────────────────────────────────────────────────────────

export default function RoomsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { joined, available, mentions, isLoadingJoined, isLoadingAvailable, loadJoined, loadAvailable, join, leave } = useRoomStore();
  const [joining, setJoining]      = useState<string | null>(null);
  const [customRoom, setCustomRoom] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  // O(1) lookup for "already joined" in AvailRow
  const joinedNames = useMemo(() => new Set(joined.map((r) => r.name)), [joined]);

  useDeferredFocusEffect(
    useCallback(() => {
      loadJoined();
      loadAvailable();
    }, [loadJoined, loadAvailable])
  );

  const sections: RoomSection[] = useMemo(() => [
    {
      key:   'joined',
      title: 'Joined',
      data:  joined.length > 0
        ? joined.map((room) => ({ _type: 'joined' as const, room }))
        : [{ _type: 'empty'  as const }],
    },
    {
      key:   'available',
      title: 'Available',
      data:  available.map((room) => ({ _type: 'available' as const, room })),
    },
  ], [joined, available]);

  const handleNavigate = useCallback((roomName: string) => {
    navigation.navigate('RoomDetail', { roomName });
  }, [navigation]);

  const handleLeave = useCallback((room: Room) => {
    leave(room.name);
  }, [leave]);

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

  const renderSectionHeader = useCallback(({ section }: { section: RoomSection }) => (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{section.title}</Text>
      {section.key === 'joined' && (
        <Pressable hitSlop={8} onPress={() => setShowCustom(true)}>
          <Ionicons color={colors.accent} name="add-circle-outline" size={20} />
        </Pressable>
      )}
    </View>
  ), [s, colors]);

  const renderItem = useCallback(({ item, index, section }: { item: AnyItem; index: number; section: RoomSection }) => {
    const isFirst = index === 0;
    const isLast  = index === section.data.length - 1;

    if (item._type === 'empty') {
      return <EmptyRow s={s} />;
    }
    if (item._type === 'joined') {
      return (
        <JoinedRow
          room={item.room}
          isFirst={isFirst}
          isLast={isLast}
          s={s}
          colors={colors}
          mentions={mentions[item.room.name] ?? 0}
          onNavigate={handleNavigate}
          onLeave={handleLeave}
        />
      );
    }
    return (
      <AvailRow
        room={item.room}
        isFirst={isFirst}
        isLast={isLast}
        s={s}
        colors={colors}
        isJoined={joinedNames.has(item.room.name)}
        isLoading={joining === item.room.name}
        onJoin={handleJoin}
      />
    );
  }, [s, colors, mentions, handleNavigate, handleLeave, handleJoin, joinedNames, joining]);

  const keyExtractor = useCallback((item: AnyItem, index: number) =>
    item._type === 'joined'    ? item.room.name :
    item._type === 'available' ? item.room.name :
    `empty-${index}`
  , []);

  const isLoading = isLoadingJoined || isLoadingAvailable;

  return (
    <View style={s.container}>
      <SectionList
        sections={sections}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        onRefresh={() => { loadJoined(); loadAvailable(); }}
        refreshing={isLoading}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={s.list}
        SectionSeparatorComponent={SectionGap}
        removeClippedSubviews
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={5}
        updateCellsBatchingPeriod={50}
      />

      <BottomSheet visible={showCustom} onClose={() => { setShowCustom(false); setCustomRoom(''); }}>
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>Join a room</Text>
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
            <Pressable onPress={handleCustomJoin} style={s.sheetJoin}>
              <Text style={s.sheetJoinText}>Join</Text>
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
    list:      { padding: Spacing.lg },

    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.xs,
      paddingBottom: Spacing.sm,
      backgroundColor: c.bgPrimary,
    },
    sectionTitle: {
      fontSize: Typography.sm,
      fontWeight: '600',
      color: c.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },

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
    emptyRow:   { justifyContent: 'center' },
    emptyText:  { fontSize: Typography.sm, color: c.textMuted },

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

    leaveBtn:       { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm, borderWidth: 1, borderColor: c.danger },
    leaveBtnText:   { fontSize: Typography.xs, fontWeight: '600', color: c.danger },

    joinBtn:             { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm, backgroundColor: c.accent },
    joinBtnDisabled:     { backgroundColor: c.bgElevated },
    joinBtnText:         { fontSize: Typography.xs, fontWeight: '600', color: '#fff' },
    joinBtnTextDisabled: { color: c.textMuted },

    joinedPill:     { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm, backgroundColor: c.bgElevated },
    joinedPillText: { fontSize: Typography.xs, color: c.textMuted },

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
    sheetTitle:      { fontSize: Typography.md, fontWeight: '600', color: c.textPrimary },
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
