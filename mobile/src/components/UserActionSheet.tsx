// <copyright file="UserActionSheet.tsx" company="John Narey">
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

import { Text } from './Typography';
import { Editorial, Radius, Spacing, Typography } from '../theme';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import type { ThemeColors } from '../theme';
import type { MainTabParamList } from '../navigation/MainTabs';
import { getUserInfo, getUserStatus } from '../api/users';
import type { UserInfo, UserStatus } from '../api/users';
import { useBlockedUsersStore } from '../store/blockedUsersStore';

export interface UserSheetAction {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  onPress: () => void;
}

/**
 * Bottom sheet of actions for a Soulseek user, opened by long-pressing a
 * username anywhere in the app. Offers chat, browse and a peer-info view
 * fetched on demand; callers can append screen-specific actions via
 * `extraActions` (the sheet closes itself before invoking them), and hide
 * built-in actions that are redundant on their screen via `hide`.
 */
export default function UserActionSheet({
  username,
  onClose,
  extraActions,
  hide,
}: {
  username: string | null;
  onClose: () => void;
  extraActions?: UserSheetAction[];
  hide?: ('chat' | 'browse')[];
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<MainTabParamList>>();

  const [showInfo, setShowInfo]   = useState(false);
  const [info, setInfo]           = useState<UserInfo | null>(null);
  const [status, setStatus]       = useState<UserStatus | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);

  const blockedSet = useBlockedUsersStore(state => state.blockedSet);
  const blocked = username !== null && blockedSet.has(username.toLowerCase());

  useEffect(() => {
    setShowInfo(false);
    setInfo(null);
    setStatus(null);
    setInfoError(null);
  }, [username]);

  // Refresh blocked state when the sheet opens in case a hub push was missed.
  useEffect(() => {
    if (username !== null) {
      useBlockedUsersStore.getState().fetch().catch(() => {});
    }
  }, [username]);

  const toggleBlocked = () => {
    if (!username) return;
    const store = useBlockedUsersStore.getState();
    onClose();
    (blocked ? store.unblock(username) : store.block(username)).catch(() => {});
  };

  const openChat = () => {
    if (!username) return;
    onClose();
    navigation.navigate('ChatTab', {
      screen: 'ChatConversation',
      params: { username },
      initial: false,
    });
  };

  const openBrowse = () => {
    if (!username) return;
    onClose();
    navigation.navigate('BrowseTab', {
      screen: 'BrowseUser',
      params: { username },
      initial: false,
    });
  };

  const openInfo = () => {
    if (!username) return;
    setShowInfo(true);
    getUserInfo(username)
      .then(setInfo)
      .catch(() => setInfoError('User is offline or did not respond.'));
    getUserStatus(username).then(setStatus).catch(() => {});
  };

  const renderAction = (a: UserSheetAction, key: string) => (
    <Pressable
      key={key}
      style={({ pressed }) => [s.action, pressed && s.actionPressed]}
      onPress={() => { onClose(); a.onPress(); }}
    >
      <Ionicons name={a.icon} size={20} color={a.destructive ? colors.danger : colors.accent} />
      <Text style={[s.actionLabel, a.destructive && { color: colors.danger }]}>{a.label}</Text>
    </Pressable>
  );

  return (
    <Modal supportedOrientations={['portrait', 'landscape-left', 'landscape-right']} visible={username !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose} />
      <View style={s.container} pointerEvents="box-none">
        <View style={s.sheet}>
          <View style={s.handle} />

          <View style={s.titleRow}>
            <View style={s.titleAvatar}>
              <Ionicons name="person" size={16} color={colors.accent} />
            </View>
            <Text style={s.title} numberOfLines={1}>{username}</Text>
            {blocked && <Text style={s.blockedBadge}>blocked</Text>}
            {showInfo && status && (
              <Text style={s.presence}>
                {status.presence}{status.isPrivileged ? ' · privileged' : ''}
              </Text>
            )}
          </View>

          {!showInfo ? (
            <>
              {!hide?.includes('chat') && (
                <Pressable style={({ pressed }) => [s.action, pressed && s.actionPressed]} onPress={openChat}>
                  <Ionicons name="chatbubble-outline" size={20} color={colors.accent} />
                  <Text style={s.actionLabel}>Send Message</Text>
                </Pressable>
              )}
              {!hide?.includes('browse') && (
                <Pressable style={({ pressed }) => [s.action, pressed && s.actionPressed]} onPress={openBrowse}>
                  <Ionicons name="folder-open-outline" size={20} color={colors.accent} />
                  <Text style={s.actionLabel}>Browse Files</Text>
                </Pressable>
              )}
              <Pressable style={({ pressed }) => [s.action, pressed && s.actionPressed]} onPress={openInfo}>
                <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
                <Text style={s.actionLabel}>User Info</Text>
              </Pressable>
              {extraActions?.map((a, i) => renderAction(a, `extra-${i}`))}
              <Pressable style={({ pressed }) => [s.action, pressed && s.actionPressed]} onPress={toggleBlocked}>
                <Ionicons name="ban-outline" size={20} color={blocked ? colors.accent : colors.danger} />
                <Text style={[s.actionLabel, !blocked && { color: colors.danger }]}>
                  {blocked ? 'Unblock User' : 'Block User'}
                </Text>
              </Pressable>
            </>
          ) : (
            <View style={s.infoBox}>
              {infoError ? (
                <Text style={s.infoError}>{infoError}</Text>
              ) : !info ? (
                <ActivityIndicator color={colors.accent} style={s.infoSpinner} />
              ) : (
                <>
                  {info.hasPicture && info.picture ? (
                    <Image
                      source={{ uri: `data:image/jpeg;base64,${info.picture}` }}
                      style={s.picture}
                      resizeMode="cover"
                    />
                  ) : null}
                  <ScrollView style={s.descScroll}>
                    <Text style={s.desc}>
                      {info.description?.trim() ? info.description.trim() : 'No description.'}
                    </Text>
                  </ScrollView>
                  <View style={s.statsRow}>
                    <View style={s.stat}>
                      <Text style={s.statValue}>{info.uploadSlots}</Text>
                      <Text style={s.statLabel}>Slots</Text>
                    </View>
                    <View style={s.stat}>
                      <Text style={s.statValue}>{info.queueLength}</Text>
                      <Text style={s.statLabel}>Queue</Text>
                    </View>
                    <View style={s.stat}>
                      <Text style={s.statValue}>{info.hasFreeUploadSlot ? 'Yes' : 'No'}</Text>
                      <Text style={s.statLabel}>Free slot</Text>
                    </View>
                  </View>
                </>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  overlay:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  container: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.bgElevated,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xl,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border,
    marginBottom: Spacing.md,
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  titleAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: `${c.accent}22`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontSize: Typography.lg, color: c.textPrimary, ...Editorial.heading },
  presence: { fontSize: Typography.xs, color: c.textMuted },
  blockedBadge: {
    fontSize: Typography.xs,
    fontWeight: '700',
    color: c.danger,
    textTransform: 'uppercase',
    borderWidth: 1,
    borderColor: c.danger,
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  actionPressed: { opacity: 0.6 },
  actionLabel:   { fontSize: Typography.base, color: c.textPrimary },

  infoBox:     { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingTop: Spacing.md },
  infoSpinner: { marginVertical: Spacing.lg },
  infoError:   { fontSize: Typography.sm, color: c.textMuted, textAlign: 'center', marginVertical: Spacing.lg },
  picture: {
    width: 96,
    height: 96,
    borderRadius: Radius.md,
    alignSelf: 'center',
    marginBottom: Spacing.md,
    backgroundColor: c.bgSurface,
  },
  descScroll: { maxHeight: 160, marginBottom: Spacing.md },
  desc:       { fontSize: Typography.sm, color: c.textPrimary, lineHeight: 20 },

  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  stat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: c.bgSurface,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
  },
  statValue: { fontSize: Typography.base, fontWeight: '600', color: c.textPrimary },
  statLabel: { fontSize: Typography.xs, color: c.textMuted, marginTop: 2, ...Editorial.label },
});
