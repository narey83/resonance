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

import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
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
import type { Conversation } from '../../api/chat';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import type { MoreStackParamList } from '../../navigation/MainTabs';
import BottomSheet from '../../components/BottomSheet';

type Props = NativeStackScreenProps<MoreStackParamList, 'Chat'>;

export default function ChatScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { conversations, isLoading, loadConversations } = useConversationStore();
  const [composing, setComposing] = useState(false);
  const [newUsername, setNewUsername] = useState('');

  useFocusEffect(
    useCallback(() => {
      loadConversations();
    }, [loadConversations])
  );

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => setComposing(true)} hitSlop={8}>
          <Ionicons color={colors.accent} name="create-outline" size={22} />
        </Pressable>
      ),
    });
  }, [navigation, colors]);

  const openConversation = (username: string) => {
    navigation.navigate('ChatConversation', { username });
  };

  const handleLongPress = (item: Conversation) => {
    Alert.alert(item.username, undefined, [
      {
        text: 'Close conversation',
        style: 'destructive',
        onPress: () => useConversationStore.getState().removeConversation(item.username),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleCompose = () => {
    const username = newUsername.trim();
    if (!username) return;
    setComposing(false);
    setNewUsername('');
    openConversation(username);
  };

  const renderItem = ({ item, index }: { item: Conversation; index: number }) => {
    const isLast = index === conversations.length - 1;
    return (
      <Pressable
        onPress={() => openConversation(item.username)}
        onLongPress={() => handleLongPress(item)}
        style={({ pressed }) => [s.row, isLast && s.rowLast, pressed && s.rowPressed]}
      >
        <View style={s.avatar}>
          <Ionicons color={colors.accent} name="person" size={18} />
        </View>
        <View style={s.rowContent}>
          <Text style={s.username}>{item.username}</Text>
          {item.unAcknowledgedMessageCount > 0 && (
            <View style={s.badge}>
              <Text style={s.badgeText}>
                {item.unAcknowledgedMessageCount > 99 ? '99+' : item.unAcknowledgedMessageCount}
              </Text>
            </View>
          )}
        </View>
        <Ionicons color={colors.textDim} name="chevron-forward" size={16} />
      </Pressable>
    );
  };

  return (
    <View style={s.container}>
      {conversations.length === 0 && !isLoading ? (
        <View style={s.empty}>
          <Ionicons color={colors.textMuted} name="chatbubble-outline" size={40} />
          <Text style={s.emptyText}>No conversations</Text>
          <Text style={s.emptySub}>Tap the compose button to start one</Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.username}
          onRefresh={loadConversations}
          refreshing={isLoading}
          renderItem={renderItem}
          contentContainerStyle={s.list}
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
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bgPrimary },
    list:      { padding: Spacing.lg },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
      backgroundColor: c.bgSurface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    rowLast:    { borderBottomWidth: 0 },
    rowPressed: { backgroundColor: c.bgElevated },

    avatar: {
      width: 36,
      height: 36,
      borderRadius: Radius.full,
      backgroundColor: c.bgElevated,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rowContent: { flex: 1 },
    username:   { fontSize: Typography.base, fontWeight: '500', color: c.textPrimary },

    badge: {
      alignSelf: 'flex-start',
      marginTop: 2,
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
    sheetTitle: { fontSize: Typography.md, fontWeight: '600', color: c.textPrimary },
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
