// <copyright file="ChatConversationScreen.tsx" company="John Narey">
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
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useConversationStore } from '../../store/conversationStore';
import type { PrivateMessage } from '../../api/chat';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import type { MoreStackParamList } from '../../navigation/MainTabs';

type Props = NativeStackScreenProps<MoreStackParamList, 'ChatConversation'>;

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

export default function ChatConversationScreen({ navigation, route }: Props) {
  const { username } = route.params;
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { messages, loadMessages, sendMessage, acknowledge } = useConversationStore();
  const thread = messages[username] ?? [];

  // Rendered newest-first into an `inverted` FlatList: the viewport is anchored
  // to index 0, so the latest message is always what's on screen (and stays
  // there as new ones arrive) without needing scrollToEnd — which, driven off
  // a virtualized list that only renders the first ~10 items, would keep
  // firing before the real last item was even measured.
  const reversedThread = useMemo(() => [...thread].reverse(), [thread]);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: username });
  }, [navigation, username]);

  useFocusEffect(
    useCallback(() => {
      loadMessages(username).then(() => {
        acknowledge(username);
      });
    }, [username, loadMessages, acknowledge])
  );

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg || sending) return;
    setText('');
    setSending(true);
    try {
      await sendMessage(username, msg);
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item, index }: { item: PrivateMessage; index: number }) => {
    const isSelf = item.direction === 'Out';
    // Chronologically-previous message: one index further along in the
    // reversed (newest-first) array — rendered above `item` on screen since
    // the list is inverted.
    const prev   = reversedThread[index + 1];
    const showSender = !isSelf && prev?.direction !== 'In';
    // No older message, or the older one falls on a different day: `item` is
    // the first message of its day, so the separator belongs above it.
    const showDateSeparator = !prev || dayKey(prev.timestamp) !== dayKey(item.timestamp);

    const ts = new Date(item.timestamp);
    const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
      <View>
        {showDateSeparator && (
          <View style={s.daySeparator}>
            <Text style={s.daySeparatorText}>{formatDayLabel(item.timestamp)}</Text>
          </View>
        )}
        <View style={[s.messageRow, isSelf ? s.messageRowSelf : s.messageRowOther]}>
          {!isSelf && (
            <View style={[s.avatarSmall, !showSender && s.avatarInvisible]}>
              <Ionicons color={colors.accent} name="person" size={14} />
            </View>
          )}
          <View style={[s.bubble, isSelf ? s.bubbleSelf : s.bubbleOther]}>
            {showSender && (
              <Text style={s.senderName}>{item.username}</Text>
            )}
            <Text style={[s.messageText, isSelf && s.messageTextSelf]}>{item.message}</Text>
            <Text style={[s.timestamp, isSelf && s.timestampSelf]}>{timeStr}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      automaticOffset
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={s.container}
    >
      <FlatList
        data={reversedThread}
        inverted
        keyExtractor={(item, index) => `${item.direction}-${item.id}-${item.timestamp}-${index}`}
        renderItem={renderMessage}
        contentContainerStyle={s.list}
        onRefresh={() => loadMessages(username)}
        refreshing={false}
      />
      <View style={s.inputBar}>
        <TextInput
          multiline
          onChangeText={setText}
          onSubmitEditing={handleSend}
          placeholder="Message…"
          placeholderTextColor={colors.textMuted}
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

    bubble: {
      maxWidth: '75%',
      borderRadius: Radius.lg,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    bubbleSelf:  { backgroundColor: c.accent, borderBottomRightRadius: Radius.sm },
    bubbleOther: { backgroundColor: c.bgSurface, borderBottomLeftRadius: Radius.sm },

    senderName:      { fontSize: Typography.xs, color: c.textMuted, marginBottom: 2 },
    messageText:     { fontSize: Typography.base, color: c.textPrimary, lineHeight: 20 },
    messageTextSelf: { color: '#fff' },
    timestamp:       { fontSize: Typography.xs, color: c.textMuted, alignSelf: 'flex-end', marginTop: 2 },
    timestampSelf:   { color: 'rgba(255,255,255,0.65)' },

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
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Platform.OS === 'ios' ? Spacing.sm : Spacing.xs,
      fontSize: Typography.base,
      color: c.textPrimary,
      maxHeight: 120,
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
  });
}
