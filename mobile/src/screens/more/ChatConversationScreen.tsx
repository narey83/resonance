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
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useConversationStore } from '../../store/conversationStore';
import { useTranslationStore } from '../../store/translationStore';
import { languageName } from '../../api/translation';
import type { PrivateMessage } from '../../api/chat';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import type { ChatStackParamList } from '../../navigation/MainTabs';
import UserActionSheet from '../../components/UserActionSheet';
import UserAvatar from '../../components/UserAvatar';
import { useUserInfoStore } from '../../store/userInfoStore';

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatConversation'>;

// The peer's picture and tagline, sitting under the nav bar like WhatsApp's
// contact header. Renders nothing at all until (or unless) the peer answers the
// info request, so an offline user costs no vertical space. Tapping it opens the
// full user sheet.
function ProfileStrip({ username, colors, onPress }: { username: string; colors: ThemeColors; onPress: () => void }) {
  const profile = useUserInfoStore((st) => st.profiles[username]);
  const load    = useUserInfoStore((st) => st.load);
  const s       = useMemo(() => makeStyles(colors), [colors]);

  React.useEffect(() => { load(username); }, [username, load]);

  if (!profile?.picture && !profile?.description) return null;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.strip, pressed && { backgroundColor: colors.bgElevated }]}>
      <UserAvatar username={username} size={36} />
      <Text style={s.stripText} numberOfLines={2}>
        {profile.description ?? username}
      </Text>
      <Ionicons color={colors.textDim} name="chevron-forward" size={16} />
    </Pressable>
  );
}

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
  const thread = useMemo(() => messages[username] ?? [], [messages, username]);

  // Translation
  const threadKey = `chat:${username}`;
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

  // Rendered newest-first into an `inverted` FlatList: the viewport is anchored
  // to index 0, so the latest message is always what's on screen (and stays
  // there as new ones arrive) without needing scrollToEnd — which, driven off
  // a virtualized list that only renders the first ~10 items, would keep
  // firing before the real last item was even measured.
  const reversedThread = useMemo(() => [...thread].reverse(), [thread]);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [actionUser, setActionUser] = useState<string | null>(null);

  // Reserves scroll space below the (inverted) list's newest message equal to
  // the live keyboard height, so it isn't left hidden behind the keyboard —
  // paired with `KeyboardStickyView` below, which pins the input bar itself
  // to the top of the keyboard. `height` runs 0 (closed) to -keyboardHeight.
  //
  // The reservation lives on this Animated.View spacer, rendered as the
  // inverted list's header (i.e. visually at the bottom), rather than on the
  // list's `contentContainerStyle`: an animated style on `contentContainerStyle`
  // crashes ("attempted to set the key `current` … on an object … frozen"),
  // because the list machinery freezes that style object before Reanimated can
  // manage it. A genuine Animated component's `style` is the supported path.
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const spacerAnimatedStyle = useAnimatedStyle(() => ({
    height: -keyboardHeight.value,
  }));

  // The input bar rests above the (non-absolute) bottom tab bar, so it starts
  // `tabBarHeight` up from the true screen bottom. KeyboardStickyView lifts it
  // by the full keyboard height measured from that bottom, which would overshoot
  // and leave a gap the size of the tab bar between the input and the keyboard;
  // `offset.opened` pulls it back down flush against the keyboard.
  //
  // `tabBarHeight` is the tab bar alone, mini bar excluded (MainTabs reports it —
  // react-navigation never measures a custom tabBar). So when the mini bar is
  // showing, the input bar's resting position is that much higher and this lift
  // lands it exactly on top of the mini bar, which rides the keyboard too.
  const tabBarHeight = useBottomTabBarHeight();

  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: username,
      headerRight: () => (
        <View style={s.headerActions}>
          {translationEnabled && (
            <Pressable hitSlop={8} onPress={() => toggleAuto(threadKey)}>
              <Ionicons
                color={auto ? colors.accent : colors.textMuted}
                name="language"
                size={21}
              />
            </Pressable>
          )}
          <Pressable hitSlop={8} onPress={() => setActionUser(username)}>
            <Ionicons color={colors.accent} name="ellipsis-horizontal" size={22} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, username, colors, s, translationEnabled, auto, threadKey, toggleAuto]);

  useFocusEffect(
    useCallback(() => {
      loadMessages(username).then(() => {
        acknowledge(username);
      });
    }, [username, loadMessages, acknowledge])
  );

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
          m.message?.trim() &&
          (m.direction === 'In' || !sentOriginals[m.message]),
      )
      .map((m) => ({ key: `${m.direction}|${m.id}|${m.timestamp}`, text: m.message }));
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
        const latestInbound = [...thread].reverse().find((m) => m.direction === 'In')?.message;
        toSend = await translateOutgoing(threadKey, msg, latestInbound);
      }
      await sendMessage(username, toSend);
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

    const msgKey = `${item.direction}|${item.id}|${item.timestamp}`;
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
            <Text style={[s.messageText, isSelf && s.messageTextSelf]}>
              {isSelf
                ? showSelfInLang
                  ? selfInLang
                  : item.message
                : showTranslated
                  ? tr!.text
                  : item.message}
            </Text>
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
            <Text style={[s.timestamp, isSelf && s.timestampSelf]}>{timeStr}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={s.container}>
      <ProfileStrip username={username} colors={colors} onPress={() => setActionUser(username)} />
      <Animated.FlatList
        data={reversedThread}
        inverted
        keyExtractor={(item, index) => `${item.direction}-${item.id}-${item.timestamp}-${index}`}
        renderItem={renderMessage}
        contentContainerStyle={s.list}
        ListHeaderComponent={<Animated.View style={spacerAnimatedStyle} />}
        onRefresh={() => loadMessages(username)}
        refreshing={false}
      />
      <KeyboardStickyView offset={{ opened: tabBarHeight }}>
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
            onChangeText={setText}
            onSubmitEditing={handleSend}
            placeholder={reply ? 'Reply in their language…' : 'Message…'}
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
      </KeyboardStickyView>

      <UserActionSheet
        username={actionUser}
        onClose={() => setActionUser(null)}
        hide={['chat']}
      />
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      backgroundColor: c.bgSurface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    stripText: { flex: 1, fontSize: Typography.sm, color: c.textMuted, fontStyle: 'italic' },

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

    headerActions:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    translateNote:   { fontSize: Typography.xs, color: c.accent, marginTop: 3, opacity: 0.9 },
    translateNoteSelf: { color: 'rgba(255,255,255,0.85)', alignSelf: 'flex-end' },

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
    replyToggle: {
      width: 40,
      height: 40,
      borderRadius: Radius.full,
      backgroundColor: c.bgElevated,
      justifyContent: 'center',
      alignItems: 'center',
    },
    replyToggleOn: { backgroundColor: c.accent },
  });
}
