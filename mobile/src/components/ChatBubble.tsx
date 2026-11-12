import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { totalRoomUnread, useRoomStore } from '../store/roomStore';
import { useConversationStore } from '../store/conversationStore';
import { messageCount, messageCountLabel } from '../lib/messageCount';
import { ThemeColors, Typography } from '../theme';
import { Text } from './Typography';

/** A single entry point for private messages and joined-room chat. */
export function ChatBubble({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const privateUnread = useConversationStore((state) => state.totalUnread);
  const roomUnread = useRoomStore(totalRoomUnread);
  const unread = messageCount(privateUnread, roomUnread);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open messages${unread ? `, ${unread} unread` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.bubble, pressed && styles.pressed]}
    >
      <Ionicons color="#fff" name="chatbubbles" size={25} />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{messageCountLabel(unread)}</Text>
        </View>
      )}
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    bubble: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 8,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    pressed: { opacity: 0.8 },
    badge: {
      position: 'absolute',
      top: -5,
      right: -5,
      minWidth: 21,
      height: 21,
      borderRadius: 11,
      paddingHorizontal: 4,
      backgroundColor: colors.danger,
      borderWidth: 2,
      borderColor: colors.bgPrimary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: '#fff', fontSize: Typography.xs, fontWeight: '700' },
  });
}
