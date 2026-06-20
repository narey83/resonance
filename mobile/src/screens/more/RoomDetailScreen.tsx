import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
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
import { useRoomStore } from '../../store/roomStore';
import type { RoomMessage, RoomUser } from '../../api/rooms';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import type { MoreStackParamList } from '../../navigation/MainTabs';

type Props = NativeStackScreenProps<MoreStackParamList, 'RoomDetail'>;

export default function RoomDetailScreen({ navigation, route }: Props) {
  const { roomName } = route.params;
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { joined, messages, loadMessages, sendMessage } = useRoomStore();
  const room = joined.find((r) => r.name === roomName);
  const thread = messages[roomName] ?? [];

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const listRef = useRef<FlatList>(null);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: roomName,
      headerRight: () => (
        <Pressable hitSlop={8} onPress={() => setShowUsers(true)}>
          <View style={s.userCountWrap}>
            <Ionicons color={colors.accent} name="people-outline" size={20} />
            {room && (
              <Text style={s.userCount}>{room.users.length}</Text>
            )}
          </View>
        </Pressable>
      ),
    });
  }, [navigation, roomName, colors, room, s]);

  useFocusEffect(
    useCallback(() => {
      loadMessages(roomName);
    }, [roomName, loadMessages])
  );

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
      await sendMessage(roomName, msg);
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item, index }: { item: RoomMessage; index: number }) => {
    const isSelf = item.self === true;
    const prev   = thread[index - 1];
    const showSender = prev?.username !== item.username;

    const ts = new Date(item.timestamp);
    const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
      <View style={[s.messageRow, isSelf ? s.messageRowSelf : s.messageRowOther]}>
        {!isSelf && (
          <View style={[s.avatarSmall, !showSender && s.avatarInvisible]}>
            <Text style={s.avatarInitial}>
              {item.username.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={[s.bubble, isSelf ? s.bubbleSelf : s.bubbleOther]}>
          {showSender && !isSelf && (
            <Text style={s.senderName}>{item.username}</Text>
          )}
          <Text style={[s.messageText, isSelf && s.messageTextSelf]}>{item.message}</Text>
          <Text style={[s.timestamp, isSelf && s.timestampSelf]}>{timeStr}</Text>
        </View>
      </View>
    );
  };

  const renderUser = ({ item, index }: { item: RoomUser; index: number }) => {
    const isLast = index === (room?.users.length ?? 0) - 1;
    return (
      <View style={[s.userRow, isLast && s.userRowLast]}>
        <View style={s.userAvatar}>
          <Text style={s.avatarInitial}>{item.username.charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={s.userName}>{item.self ? `${item.username} (you)` : item.username}</Text>
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
        keyExtractor={(item, index) => `${item.username}-${item.timestamp}-${index}`}
        renderItem={renderMessage}
        contentContainerStyle={s.list}
        onRefresh={() => loadMessages(roomName)}
        refreshing={false}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons color={colors.textMuted} name="chatbubbles-outline" size={32} />
            <Text style={s.emptyText}>No messages yet</Text>
          </View>
        }
      />
      <View style={s.inputBar}>
        <TextInput
          multiline
          onChangeText={setText}
          onSubmitEditing={handleSend}
          placeholder={`Message ${roomName}…`}
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

      {/* User list modal */}
      <Modal
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
              data={room?.users ?? []}
              keyExtractor={(item) => item.username}
              renderItem={renderUser}
              style={s.usersList}
            />
          </Pressable>
        </Pressable>
      </Modal>
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
    timestamp:       { fontSize: Typography.xs, color: c.textMuted, alignSelf: 'flex-end', marginTop: 2 },
    timestampSelf:   { color: 'rgba(255,255,255,0.65)' },

    empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xxl },
    emptyText: { fontSize: Typography.sm, color: c.textMuted },

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
    sendBtn:         { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: c.accent, justifyContent: 'center', alignItems: 'center' },
    sendBtnDisabled: { backgroundColor: c.bgElevated },

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
