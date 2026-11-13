// <copyright file="ChatScreen.tsx" company="John Narey">
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

import { Text, TextInput } from '../../components/Typography';
import { Editorial, Radius, Spacing, ThemeColors, Typography } from '../../theme';

import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDeferredFocusEffect } from '../../hooks/useDeferredEffect';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useConversationStore } from '../../store/conversationStore';
import { totalRoomUnread, useRoomStore } from '../../store/roomStore';
import type { Conversation } from '../../api/chat';
import type { Room } from '../../api/rooms';
import { useTheme } from '../../context/ThemeContext';
import type { ChatStackParamList, MainTabParamList } from '../../navigation/MainTabs';
import BottomSheet from '../../components/BottomSheet';
import UserAvatar from '../../components/UserAvatar';
import { useUserInfoStore } from '../../store/userInfoStore';
import UserActionSheet from '../../components/UserActionSheet';
import { LIST_PERF_PROPS } from '../../lib/listPerf';
import { messageCountLabel } from '../../lib/messageCount';

type Props = NativeStackScreenProps<ChatStackParamList, 'Chat'>;

const AVATAR = 48;

// Messenger-style relative time: clock for today, "Yesterday", weekday inside
// the last week, then a short date — the same ladder WhatsApp uses, so the
// column stays narrow whatever the age of the conversation.
function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

  if (now.getTime() - d.getTime() < 7 * 86_400_000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function ConversationRow({
  item,
  onPress,
  onLongPress,
  s,
}: {
  item:        Conversation;
  onPress:     () => void;
  onLongPress: () => void;
  s:           ReturnType<typeof makeStyles>;
}) {
  // Third line: the user's own tagline, which arrives asynchronously (or never,
  // for an offline peer) — the row just gets shorter without it.
  const tagline = useUserInfoStore((st) => st.profiles[item.username]?.description);

  const unread = item.unAcknowledgedMessageCount;
  const last   = item.lastMessage;
  // Collapse newlines so a multi-line message can't blow out the single-line preview.
  const preview = last
    ? `${last.direction === 'Out' ? 'You: ' : ''}${last.message.replace(/\s+/g, ' ').trim()}`
    : 'No messages yet';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
    >
      <UserAvatar username={item.username} size={AVATAR} />

      <View style={s.rowContent}>
        <View style={s.line}>
          <Text style={s.username} numberOfLines={1}>{item.username}</Text>
          <Text style={[s.when, unread > 0 && s.whenUnread]}>
            {fmtWhen(item.lastMessageTimestamp ?? last?.timestamp)}
          </Text>
        </View>
        <View style={s.line}>
          <Text style={[s.preview, unread > 0 && s.previewUnread]} numberOfLines={1}>{preview}</Text>
          {unread > 0 && (
            <View style={s.badge}>
              <Text style={s.badgeText}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          )}
        </View>
        {!!tagline && <Text style={s.tagline} numberOfLines={1}>{tagline}</Text>}
      </View>
    </Pressable>
  );
}

export default function ChatScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { conversations, isLoading, loadConversations } = useConversationStore();
  const privateUnread = useConversationStore((state) => state.totalUnread);
  const { joined, unread: roomUnread, isLoadingJoined, loadJoined, loadUnread } = useRoomStore();
  const roomsUnread = useRoomStore(totalRoomUnread);
  const [section, setSection] = useState<'private' | 'rooms'>('private');
  const [composing, setComposing] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [actionUser, setActionUser] = useState<string | null>(null);
  const tabs = navigation.getParent<BottomTabNavigationProp<MainTabParamList>>();
  const openRooms = useCallback(() => tabs?.navigate('RoomsTab', { screen: 'Rooms' }), [tabs]);
  const openRoom = (roomName: string) => tabs?.navigate('RoomsTab', { screen: 'RoomDetail', params: { roomName } });

  useDeferredFocusEffect(
    useCallback(() => {
      void loadConversations();
      void loadJoined();
      void loadUnread().catch(() => {});
    }, [loadConversations, loadJoined, loadUnread])
  );

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="Back to More" onPress={() => tabs?.navigate('MoreTab')} hitSlop={8} style={{ marginRight: Spacing.sm }}>
          <Ionicons color={colors.textPrimary} name="arrow-back" size={24} />
        </Pressable>
      ),
      headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel={section === 'private' ? 'New private message' : 'Browse chatrooms'} onPress={() => section === 'private' ? setComposing(true) : openRooms()} hitSlop={8}>
          <Ionicons color={colors.accent} name={section === 'private' ? 'create-outline' : 'add-circle-outline'} size={22} />
        </Pressable>
      ),
    });
  }, [navigation, colors, section, openRooms, tabs]);

  const openConversation = (username: string) => {
    navigation.navigate('ChatConversation', { username });
  };

  const handleLongPress = (item: Conversation) => {
    setActionUser(item.username);
  };

  const handleCompose = () => {
    const username = newUsername.trim();
    if (!username) return;
    setComposing(false);
    setNewUsername('');
    openConversation(username);
  };

  const renderItem = ({ item }: { item: Conversation }) => (
    <ConversationRow
      item={item}
      onPress={() => openConversation(item.username)}
      onLongPress={() => handleLongPress(item)}
      s={s}
    />
  );

  // Pull-to-refresh also retries the profile lookups: the common failure is the
  // peer being offline, and that's exactly what a manual refresh is for.
  const refresh = () => {
    useUserInfoStore.getState().reset();
    void loadConversations();
  };

  const renderRoom = ({ item }: { item: Room }) => {
    const unread = roomUnread[item.name] ?? 0;
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}${unread ? `, ${unread} unread` : ''}`} onPress={() => openRoom(item.name)} style={({ pressed }) => [s.row, pressed && s.rowPressed]}>
        <View style={s.roomIcon}><Ionicons color={colors.accent} name="chatbubbles-outline" size={22} /></View>
        <View style={s.rowContent}>
          <Text style={s.username} numberOfLines={1}>{item.name}</Text>
          <Text style={s.preview} numberOfLines={1}>{item.messages.at(-1)?.message ?? 'Joined chatroom'}</Text>
        </View>
        {unread > 0 && <View style={s.badge}><Text style={s.badgeText}>{messageCountLabel(unread)}</Text></View>}
        <Ionicons color={colors.textDim} name="chevron-forward" size={17} />
      </Pressable>
    );
  };

  return (
    <View style={s.container}>
      <View style={s.sections}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: section === 'private' }} onPress={() => setSection('private')} style={[s.section, section === 'private' && s.sectionActive]}>
          <Text style={[s.sectionText, section === 'private' && s.sectionTextActive]}>Private{privateUnread ? `  ${messageCountLabel(privateUnread)}` : ''}</Text>
        </Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: section === 'rooms' }} onPress={() => setSection('rooms')} style={[s.section, section === 'rooms' && s.sectionActive]}>
          <Text style={[s.sectionText, section === 'rooms' && s.sectionTextActive]}>Chatrooms{roomsUnread ? `  ${messageCountLabel(roomsUnread)}` : ''}</Text>
        </Pressable>
      </View>
      {section === 'rooms' ? (
        <FlatList
          {...LIST_PERF_PROPS}
          data={joined}
          keyExtractor={(item) => item.name}
          onRefresh={() => { void loadJoined(); void loadUnread().catch(() => {}); }}
          refreshing={isLoadingJoined}
          renderItem={renderRoom}
          ItemSeparatorComponent={() => <View style={s.separator} />}
          ListEmptyComponent={!isLoadingJoined ? <View style={s.empty}><Ionicons color={colors.textMuted} name="chatbubbles-outline" size={40} /><Text style={s.emptyText}>No chatrooms joined</Text></View> : null}
          ListFooterComponent={<Pressable accessibilityRole="button" onPress={openRooms} style={s.browseRooms}><Ionicons name="search" size={17} color={colors.accent} /><Text style={s.browseRoomsText}>Browse chatrooms</Text></Pressable>}
        />
      ) : conversations.length === 0 && !isLoading ? (
        <View style={s.empty}>
          <Ionicons color={colors.textMuted} name="chatbubble-outline" size={40} />
          <Text style={s.emptyText}>No conversations</Text>
          <Text style={s.emptySub}>Tap the compose button to start one</Text>
        </View>
      ) : (
        <FlatList
          {...LIST_PERF_PROPS}
          data={conversations}
          keyExtractor={(item) => item.username}
          onRefresh={refresh}
          refreshing={isLoading}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={s.separator} />}
        />
      )}

      <BottomSheet visible={composing} onClose={() => { setComposing(false); setNewUsername(''); }}>
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>New message</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onChangeText={setNewUsername}
            onSubmitEditing={handleCompose}
            placeholder="Username"
            placeholderTextColor={colors.textMuted}
            returnKeyType="go"
            style={s.sheetInput}
            value={newUsername}
          />
          <View style={s.sheetActions}>
            <Pressable
              onPress={() => { setComposing(false); setNewUsername(''); }}
              style={s.sheetCancel}
            >
              <Text style={s.sheetCancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={handleCompose} style={s.sheetConfirm}>
              <Text style={s.sheetConfirmText}>Start</Text>
            </Pressable>
          </View>
        </View>
      </BottomSheet>

      <UserActionSheet
        username={actionUser}
        onClose={() => setActionUser(null)}
        extraActions={[
          {
            label: 'Close Conversation',
            icon: 'trash-outline',
            destructive: true,
            onPress: () => {
              if (actionUser) useConversationStore.getState().removeConversation(actionUser);
            },
          },
        ]}
      />
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bgPrimary },
    sections: { flexDirection: 'row', padding: Spacing.sm, gap: Spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
    section: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.md },
    sectionActive: { backgroundColor: c.bgElevated },
    sectionText: { color: c.textMuted, fontSize: Typography.base, fontWeight: '600' },
    sectionTextActive: { color: c.accent },
    roomIcon: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: c.bgElevated, alignItems: 'center', justifyContent: 'center' },
    browseRooms: { margin: Spacing.lg, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderWidth: 1, borderColor: c.border, borderRadius: Radius.md },
    browseRoomsText: { color: c.accent, fontSize: Typography.base, fontWeight: '600' },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
    },
    rowPressed: { backgroundColor: c.bgElevated },
    // Inset past the avatar, so the rows read as one list rather than stacked cards.
    separator: { height: 1, marginLeft: Spacing.lg + AVATAR + Spacing.md, backgroundColor: c.border },

    rowContent: { flex: 1, gap: 3 },
    line:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    username:   { flex: 1, fontSize: Typography.md, fontWeight: '600', color: c.textPrimary },
    when:       { fontSize: Typography.xs, color: c.textMuted },
    whenUnread: { color: c.accent, fontWeight: '700' },

    preview:       { flex: 1, fontSize: Typography.base, color: c.textMuted },
    previewUnread: { color: c.textPrimary, fontWeight: '600' },
    tagline:       { fontSize: Typography.xs, color: c.textDim, fontStyle: 'italic' },

    badge: {
      backgroundColor: c.accent,
      borderRadius: Radius.full,
      paddingHorizontal: 6,
      paddingVertical: 1,
      minWidth: 20,
      alignItems: 'center',
    },
    badgeText: { fontSize: Typography.xs, fontWeight: '700', color: '#fff' },

    empty:     { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, paddingBottom: 80 },
    emptyText: { fontSize: Typography.md, fontWeight: '600', color: c.textMuted },
    emptySub:  { fontSize: Typography.sm, color: c.textDim },

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
    sheetActions:      { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'flex-end' },
    sheetCancel:       { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border },
    sheetCancelText:   { fontSize: Typography.base, color: c.textMuted },
    sheetConfirm:      { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.md, backgroundColor: c.accent },
    sheetConfirmText:  { fontSize: Typography.base, fontWeight: '600', color: '#fff' },
  });
}
