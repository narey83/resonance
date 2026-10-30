// <copyright file="BlockedUserRow.tsx" company="John Narey">
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
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { Radius, Spacing, Typography } from '../theme';
import type { ThemeColors } from '../theme';
import type { BlockedUser } from '../api/blockedUsers';

interface Props {
  user: BlockedUser;
  onUnblock: () => void;
  onBlockIp: (ip: string) => void;
}

// A single blocked-user row: username, tappable known-IP chips, resolved
// location and reason, plus an unblock button. Shared by the summary preview
// and the full searchable list so both stay visually identical.
export default function BlockedUserRow({ user, onUnblock, onBlockIp }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={s.row}>
      <View style={s.rowMain}>
        <Text style={s.rowTitle} numberOfLines={1}>{user.username}</Text>
        {user.ips && user.ips.length > 0 && (
          <View style={s.ipWrap}>
            {user.ips.map(ip => (
              <Pressable key={ip} onPress={() => onBlockIp(ip)} style={s.ipChip}>
                <Text style={s.ipChipText}>{ip}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {(user.city || user.country) && (
          <Text style={s.rowLoc} numberOfLines={1}>
            {[user.city, user.country].filter(Boolean).join(', ')}
          </Text>
        )}
        {!!user.reason && <Text style={s.rowSub} numberOfLines={2}>{user.reason}</Text>}
      </View>
      <Pressable onPress={onUnblock} style={s.unblockBtn}>
        <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
      </Pressable>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  rowMain:  { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: Typography.md, color: c.textPrimary, fontWeight: '500' },
  rowSub:   { fontSize: Typography.xs, color: c.textMuted, marginTop: 2 },
  rowLoc:   { fontSize: Typography.xs, color: c.textMuted, marginTop: 2, fontStyle: 'italic' },
  unblockBtn: { paddingLeft: Spacing.sm },

  ipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  ipChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderStrong,
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  ipChipText: { fontSize: Typography.xs, color: c.textMuted },
});
