// <copyright file="RoomDetailScreen.tsx" company="John Narey">
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
import type { TextInput as NativeTextInput } from 'react-native';

import { useLatestMessage } from '../../hooks/useLatestMessage';

import { Editorial, Radius, Spacing, ThemeColors, Typography } from '../../theme';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useFocusEffect } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useMiniBarHeight } from '../../components/PlayerMiniBar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRoomStore } from '../../store/roomStore';
import { useTranslationStore } from '../../store/translationStore';
import { languageName } from '../../api/translation';
import type { RoomMessage, RoomUser } from '../../api/rooms';
import { useTheme } from '../../context/ThemeContext';
import type { RoomsStackParamList } from '../../navigation/MainTabs';
import UserActionSheet from '../../components/UserActionSheet';
import Linkify, { findFirstUrl } from '../../components/Linkify';
import LinkPreviewCard from '../../components/LinkPreviewCard';
import { LIST_PERF_PROPS } from '../../lib/listPerf';
import { haptics } from '../../lib/haptics';
import * as Clipboard from 'expo-clipboard';

type Props = NativeStackScreenProps<RoomsStackParamList, 'RoomDetail'>;

const dayKey = (iso: string) => iso.slice(0, 10);

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export default function RoomDetailScreen({ navigation, route }: Props) {
  const { roomName } = route.params;
  const focused = useIsFocused();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { joined, messages, loadMessages, sendMessage, clearMentions, markRead, leave } = useRoomStore();
  const mentionCount = useRoomStore((s) => s.unread[roomName] ?? 0);
  const room = joined.find((r) => r.name === roomName);
  const thread = useMemo(() => messages[roomName] ?? [], [messages, roomName]);

  // Translation
  const threadKey = `room:${roomName}`;
  const translationEnabled = useTranslationStore((st) => st.enabled);
  const targetLang = useTranslationStore((st) => st.targetLang);
  const auto = useTranslationStore((st) => Boolean(st.autoByThread[threadKey]));
  const reply = useTranslationStore((st) => Boolean(st.replyByThread[threadKey]));
  const translations = useTranslationStore((st) => st.translations);
  const originals = useTranslationStore((st) => st.originals);
  const sentOriginals = useTranslationStore((st) => st.sentOriginals);
  const toggleAuto = useTranslationStore((st) => st.toggleAuto);
  const toggleReply = useTranslationStore((st) => st.toggleReply);
  const translateOutgoing = useTranslationStore((st) => st.translateOutgoing);
  const ensureTranslated = useTranslationStore((st) => st.ensureTranslated);
  const toggleOriginal = useTranslationStore((st) => st.toggleOriginal);
  const loadTranslationStatus = useTranslationStore((st) => st.loadStatus);

  // Rendered newest-first into an `inverted` FlatList so the viewport is
  // anchored to the latest message — see ChatConversationScreen for why
  // scrollToEnd on a normal-order virtualized list falls short of the truth.
  const reversedThread = useMemo(() => [...thread].reverse(), [thread]);
  const latestMessage = useLatestMessage<RoomMessage>(threadKey, JSON.stringify(reversedThread[0] ?? null));

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [actionUser, setActionUser] = useState<string | null>(null);
  const inputRef = useRef<NativeTextInput>(null);

  const miniBarHeight = useMiniBarHeight();
  const headerHeight = useHeaderHeight();

  // Close the user-list modal before opening the action sheet — stacked
  // visible Modals are unreliable on iOS.
  const openUserActions = (username: string) => {
    setShowUsers(false);
    setActionUser(username);
  };

  const handleReply = (item: RoomMessage) => {
    const label = item.self ? 'You' : item.username;
    setText((prev) => `${prev}[${label}] ${item.message} --> `);
    inputRef.current?.focus();
  };

  // A plain-text long-press-to-copy instead of relying on Text's native
  // `selectable` overlay: on this Android device that overlay could get
  // stuck open (its handles/toolbar not dismissing on an outside tap) once
  // shown from inside this screen's nested Pressable/FlatList hierarchy.
  const handleCopy = async (message: string) => {
    await Clipboard.setStringAsync(message);
    haptics.light();
  };

  const handleLeave = useCallback(() => {
    Alert.alert('Leave room?', `You'll stop receiving messages from "${roomName}".`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          await leave(roomName);
          navigation.goBack();
        },
      },
    ]);
  }, [roomName, leave, navigation]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: roomName,
      headerRight: () => (
        <View style={s.headerActions}>
          {translationEnabled && (
            <Pressable hitSlop={8} onPress={() => toggleAuto(threadKey)}>
              <Ionicons
                color={auto ? colors.accent : colors.textMuted}
                name="language"
                size={20}
              />
            </Pressable>
          )}
          <Pressable hitSlop={8} onPress={() => setShowUsers(true)}>
            <View style={s.userCountWrap}>
              <Ionicons color={colors.accent} name="people-outline" size={20} />
              {room && (
                <Text style={s.userCount}>{room.users.length}</Text>
              )}
            </View>
          </Pressable>
          <Pressable hitSlop={8} onPress={handleLeave}>
            <Ionicons color={colors.danger} name="log-out-outline" size={20} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, roomName, colors, room, s, translationEnabled, auto, threadKey, toggleAuto, handleLeave]);

  useFocusEffect(
    useCallback(() => {
      setShowUsers(false);
      void loadMessages(roomName).catch(() => {});
      clearMentions(roomName);
      markRead(roomName);
      return () => setShowUsers(false);
    }, [roomName, loadMessages, clearMentions, markRead])
  );

  React.useEffect(() => {
    if (focused && AppState.currentState === 'active' && mentionCount) {
      clearMentions(roomName);
      markRead(roomName);
    }
  }, [focused, mentionCount, roomName, clearMentions, markRead]);

  React.useEffect(() => {
    loadTranslationStatus();
  }, [loadTranslationStatus]);

  // Translate not-yet-translated incoming messages when auto-translate is on.
  React.useEffect(() => {
    if (!translationEnabled || !auto) return;
    const pending = thread
      // incoming messages, plus your own sends we didn't capture an original for
      .filter(
        (m) =>
          m.message?.trim() && (m.self !== true || !sentOriginals[m.message]),
      )
      .map((m) => ({ key: `${m.username}|${m.timestamp}|${m.message}`, text: m.message }));
    if (pending.length > 0) ensureTranslated(threadKey, pending);
  }, [thread, auto, translationEnabled, ensureTranslated, threadKey, sentOriginals]);

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg || sending) return;
    setText('');
    setSending(true);
    try {
      let toSend = msg;
      if (translationEnabled && reply) {
        const latestInbound = [...thread].reverse().find((m) => m.self !== true)?.message;
        toSend = await translateOutgoing(threadKey, msg, latestInbound);
      }
      await sendMessage(roomName, toSend);
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item, index }: { item: RoomMessage; index: number }) => {
    const isSelf = item.self === true;
    // Chronologically-previous message: one index further along in the
    // reversed (newest-first) array — rendered above `item` on screen since
    // the list is inverted.
    const prev   = reversedThread[index + 1];
    const showSender = prev?.username !== item.username;
    // No older message, or the older one falls on a different day: `item` is
    // the first message of its day, so the separator belongs above it.
    const showDateSeparator = !prev || dayKey(prev.timestamp) !== dayKey(item.timestamp);

    const ts = new Date(item.timestamp);
    const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const msgKey = `${item.username}|${item.timestamp}|${item.message}`;
    const tr = translations[msgKey];
    const canTranslate = translationEnabled && auto && !isSelf;
    const translatedDiffers =
      !!tr?.text &&
      !!tr?.detectedSourceLanguage &&
      tr.detectedSourceLanguage.toUpperCase().split('-')[0] !== targetLang.toUpperCase();
    const showTranslated = canTranslate && translatedDiffers && !originals[msgKey];

    // Your own message shown in your language: exact original if captured at send
    // time, else a back-translation of the sent (foreign) text.
    const captured = isSelf ? sentOriginals[item.message] : undefined;
    const backTr =
      isSelf &&
      !captured &&
      tr?.text &&
      (tr.detectedSourceLanguage || '').toUpperCase().split('-')[0] !==
        targetLang.toUpperCase()
        ? tr
        : undefined;
    const selfForeign =
      (!!captured && captured.original !== item.message) || !!backTr;
    const selfExact = !!captured;
    const selfInLang = captured ? captured.original : backTr?.text;
    const selfSourceLang = captured ? captured.lang : backTr?.detectedSourceLanguage;
    const showSelfInLang = selfForeign && !!originals[msgKey];
    const displayText = isSelf
      ? showSelfInLang
        ? selfInLang!
        : item.message
      : showTranslated
        ? tr!.text
        : item.message;
    const previewUrl = findFirstUrl(displayText);

    return (
      <View>
        {showDateSeparator && (
          <View style={s.daySeparator}>
            <Text style={s.daySeparatorText}>{formatDayLabel(item.timestamp)}</Text>
          </View>
        )}
        <View style={[s.messageRow, isSelf ? s.messageRowSelf : s.messageRowOther]}>
          {!isSelf && (
            <Pressable
              disabled={!showSender}
              onPress={() => openUserActions(item.username)}
              style={[s.avatarSmall, !showSender && s.avatarInvisible]}
            >
              <Text style={s.avatarInitial}>
                {item.username.charAt(0).toUpperCase()}
              </Text>
            </Pressable>
          )}
          <Pressable
            onLongPress={() => handleCopy(item.message)}
            style={[s.bubble, isSelf ? s.bubbleSelf : s.bubbleOther]}
          >
            {showSender && !isSelf && (
              <Text style={s.senderName}>{item.username}</Text>
            )}
            <Text style={[s.messageText, isSelf && s.messageTextSelf]}>
              <Linkify text={displayText} />
            </Text>
            {previewUrl && <LinkPreviewCard url={previewUrl} />}
            {canTranslate && translatedDiffers && (
              <Pressable onPress={() => toggleOriginal(msgKey)}>
                <Text style={s.translateNote}>
                  {showTranslated
                    ? `Translated from ${languageName(tr!.detectedSourceLanguage)} · Show original`
                    : 'Show translation'}
                </Text>
              </Pressable>
            )}
            {selfForeign && (
              <Pressable onPress={() => toggleOriginal(msgKey)}>
                <Text style={[s.translateNote, s.translateNoteSelf]}>
                  {showSelfInLang
                    ? 'Show sent message'
                    : `Sent in ${languageName(selfSourceLang)} · ${selfExact ? 'Show original' : `Show in ${languageName(targetLang)}`}`}
                </Text>
              </Pressable>
            )}
            <View style={s.bubbleFooter}>
              <Text style={[s.timestamp, isSelf && s.timestampSelf]}>{timeStr}</Text>
              <Pressable hitSlop={8} onPress={() => handleReply(item)}>
                <Ionicons
                  color={isSelf ? 'rgba(255,255,255,0.75)' : colors.textMuted}
                  name="arrow-undo-outline"
                  size={13}
                />
              </Pressable>
            </View>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderUser = ({ item, index }: { item: RoomUser; index: number }) => {
    const isLast = index === (room?.users.length ?? 0) - 1;
    return (
      <Pressable
        style={({ pressed }) => [s.userRow, isLast && s.userRowLast, pressed && !item.self && { opacity: 0.6 }]}
        onPress={item.self ? undefined : () => openUserActions(item.username)}
        onLongPress={item.self ? undefined : () => openUserActions(item.username)}
      >
        <View style={s.userAvatar}>
          <Text style={s.avatarInitial}>{item.username.charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={s.userName}>{item.self ? `${item.username} (you)` : item.username}</Text>
      </Pressable>
    );
  };

  return (
    <KeyboardAvoidingView key={threadKey} behavior="height" keyboardVerticalOffset={headerHeight + miniBarHeight} style={s.container}>
      <FlatList
        {...LIST_PERF_PROPS}
        ref={latestMessage.listRef}
        onScroll={latestMessage.onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={latestMessage.onContentSizeChange}
        onLayout={latestMessage.onLayout}
        // removeClippedSubviews is unreliable on Android inverted lists (blanks rows),
        // so opt this one back out while keeping the batching/window tuning.
        removeClippedSubviews={false}
        data={reversedThread}
        inverted
        keyExtractor={(item, index) => `${item.username}-${item.timestamp}-${index}`}
        renderItem={renderMessage}
        contentContainerStyle={s.list}
        onRefresh={() => { void loadMessages(roomName).catch(() => {}); }}
        refreshing={false}
        ListEmptyComponent={
          // VirtualizedList already counter-flips ListEmptyComponent when
          // `inverted` is set, so no manual transform needed here.
          <View style={s.empty}>
            <Ionicons color={colors.textMuted} name="chatbubbles-outline" size={32} />
            <Text style={s.emptyText}>No messages yet</Text>
          </View>
        }
      />
      <View style={s.inputBar}>
        {translationEnabled && (
          <Pressable
            hitSlop={8}
            onPress={() => toggleReply(threadKey)}
            style={[s.replyToggle, reply && s.replyToggleOn]}
          >
            <Ionicons
              color={reply ? '#fff' : colors.textMuted}
              name="globe-outline"
              size={18}
            />
          </Pressable>
        )}
        <TextInput
          multiline
          onFocus={latestMessage.showLatest}
          onChangeText={setText}
          onSubmitEditing={handleSend}
          placeholder={reply ? 'Reply in their language…' : `Message ${roomName}…`}
          placeholderTextColor={colors.textMuted}
          ref={inputRef}
          returnKeyType="send"
          style={s.input}
          value={text}
          blurOnSubmit={false}
        />
        <Pressable
          disabled={!text.trim() || sending}
          hitSlop={8}
          onPress={handleSend}
          style={[s.sendBtn, (!text.trim() || sending) && s.sendBtnDisabled]}
        >
          <Ionicons
            color={!text.trim() || sending ? colors.textDim : '#fff'}
            name="send"
            size={18}
          />
        </Pressable>
      </View>

      {/* User list modal */}
      <Modal supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
        animationType="slide"
        onRequestClose={() => setShowUsers(false)}
        transparent
        visible={showUsers}
      >
        <Pressable style={s.overlay} onPress={() => setShowUsers(false)}>
          <Pressable style={s.usersSheet} onPress={() => {}}>
            <View style={s.usersSheetHandle} />
            <Text style={s.usersSheetTitle}>
              {room?.users.length ?? 0} user{(room?.users.length ?? 0) !== 1 ? 's' : ''} in {roomName}
            </Text>
            <FlatList
              {...LIST_PERF_PROPS}
              data={room?.users ?? []}
              keyExtractor={(item) => item.username}
              renderItem={renderUser}
              style={s.usersList}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <UserActionSheet username={actionUser} onClose={() => setActionUser(null)} />
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bgPrimary },
    list: {
      padding: Spacing.md,
      gap: Spacing.xs,
      flexGrow: 1,
    },

    messageRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.xs, marginVertical: 2 },
    messageRowSelf:  { justifyContent: 'flex-end' },
    messageRowOther: { justifyContent: 'flex-start' },

    avatarSmall: {
      width: 26,
      height: 26,
      borderRadius: Radius.full,
      backgroundColor: c.bgElevated,
      justifyContent: 'center',
      alignItems: 'center',
      flexShrink: 0,
    },
    avatarInvisible: { opacity: 0 },
    avatarInitial:   { fontSize: Typography.xs, fontWeight: '700', color: c.textMuted },

    bubble: {
      maxWidth: '75%',
      borderRadius: Radius.lg,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    bubbleSelf:  { backgroundColor: c.accent, borderBottomRightRadius: Radius.sm },
    bubbleOther: { backgroundColor: c.bgSurface, borderBottomLeftRadius: Radius.sm },

    senderName:      { fontSize: Typography.xs, color: c.accent, marginBottom: 2, fontWeight: '600' },
    messageText:     { fontSize: Typography.base, color: c.textPrimary, lineHeight: 20 },
    messageTextSelf: { color: '#fff' },
    bubbleFooter:    { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', marginTop: 2 },
    timestamp:       { fontSize: Typography.xs, color: c.textMuted },
    timestampSelf:   { color: 'rgba(255,255,255,0.65)' },

    headerActions:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    translateNote:   { fontSize: Typography.xs, color: c.accent, marginTop: 3, opacity: 0.9 },
    translateNoteSelf: { color: 'rgba(255,255,255,0.85)', alignSelf: 'flex-end' },

    empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xxl },
    emptyText: { fontSize: Typography.sm, color: c.textMuted },

    daySeparator:     { alignItems: 'center', marginVertical: Spacing.md },
    daySeparatorText: {
      fontSize: Typography.xs,
      fontWeight: '600',
      color: c.textMuted,
      backgroundColor: c.bgElevated,
      paddingHorizontal: Spacing.md,
      paddingVertical: 4,
      borderRadius: Radius.full,
      overflow: 'hidden',
    },

    inputBar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      backgroundColor: c.bgSurface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    input: {
      flex: 1,
      minHeight: 42,
      backgroundColor: c.bgElevated,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Platform.OS === 'ios' ? Spacing.sm : Spacing.xs,
      fontSize: Typography.base,
      color: c.textPrimary,
      maxHeight: 120,
      ...Editorial.control,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: Radius.full,
      backgroundColor: c.accent,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: c.accent,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.35,
      shadowRadius: 6,
      elevation: 3,
    },
    sendBtnDisabled: {
      backgroundColor: c.bgElevated,
      shadowOpacity: 0,
      elevation: 0,
    },
    replyToggle: {
      width: 40,
      height: 40,
      borderRadius: Radius.full,
      backgroundColor: c.bgElevated,
      justifyContent: 'center',
      alignItems: 'center',
    },
    replyToggleOn: { backgroundColor: c.accent },

    userCountWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    userCount:     { fontSize: Typography.sm, color: c.accent, fontWeight: '600' },

    overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    usersSheet: {
      backgroundColor: c.bgSurface,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      paddingTop: Spacing.sm,
      maxHeight: '60%',
    },
    usersSheetHandle: {
      width: 36,
      height: 4,
      borderRadius: Radius.full,
      backgroundColor: c.border,
      alignSelf: 'center',
      marginBottom: Spacing.md,
    },
    usersSheetTitle: {
      fontSize: Typography.md,
      fontWeight: '600',
      color: c.textPrimary,
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.sm,
    },
    usersList: { paddingHorizontal: Spacing.lg },
    userRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    userRowLast: { borderBottomWidth: 0 },
    userAvatar: {
      width: 30,
      height: 30,
      borderRadius: Radius.full,
      backgroundColor: c.bgElevated,
      justifyContent: 'center',
      alignItems: 'center',
    },
    userName: { fontSize: Typography.base, color: c.textPrimary },
  });
}
