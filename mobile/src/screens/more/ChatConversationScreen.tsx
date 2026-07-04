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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useConversationStore } from '../../store/conversationStore';
import type { PrivateMessage } from '../../api/chat';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import type { MoreStackParamList } from '../../navigation/MainTabs';

type Props = NativeStackScreenProps<MoreStackParamList, 'ChatConversation'>;

export default function ChatConversationScreen({ navigation, route }: Props) {
  const { username } = route.params;
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { messages, loadMessages, sendMessage, acknowledge } = useConversationStore();
  const thread = messages[username] ?? [];

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

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

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (thread.length > 0) {
      listRef.current?.scrollToEnd({ animated: false });
    }
  }, [thread.length]);

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
    const prev   = thread[index - 1];
    const showSender = !isSelf && prev?.direction !== 'In';

    const ts = new Date(item.timestamp);
    const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
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
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      style={s.container}
    >
      <FlatList
        ref={listRef}
        data={thread}
        keyExtractor={(item) => String(item.id)}
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
      justifyContent: 'flex-end',
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

    inputBar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: Spacing.sm,
      padding: Spacing.md,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.bgSurface,
    },
    input: {
      flex: 1,
      backgroundColor: c.bgElevated,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: Spacing.md,
      paddingVertical: Platform.OS === 'ios' ? Spacing.sm : Spacing.xs,
      fontSize: Typography.base,
      color: c.textPrimary,
      maxHeight: 120,
    },
    sendBtn: {
      width: 36,
      height: 36,
      borderRadius: Radius.full,
      backgroundColor: c.accent,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sendBtnDisabled: { backgroundColor: c.bgElevated },
  });
}
