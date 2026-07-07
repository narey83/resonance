// <copyright file="SocialPulse.tsx" company="John Narey">
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

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, Typography, ThemeColors } from '../../theme';
import { SocialActivity } from '../../api/analytics';
import { fmtNum } from './shared';

export default function SocialPulse({ data, colors }: { data: SocialActivity | null; colors: ThemeColors }) {
  const s = useMemo(() => makeStyles(colors), [colors]);
  const tiles: { label: string; value: number; icon: keyof typeof Ionicons.glyphMap }[] = [
    { label: 'Browses', value: data?.browsed ?? 0, icon: 'folder-open-outline' },
    { label: 'Private Messages', value: data?.privateMessages ?? 0, icon: 'chatbubble-outline' },
    { label: 'Room Messages', value: data?.roomMessages ?? 0, icon: 'chatbubbles-outline' },
    { label: 'Mentions', value: data?.mentions ?? 0, icon: 'at-outline' },
  ];

  return (
    <View style={s.row}>
      {tiles.map((t) => (
        <View key={t.label} style={s.tile}>
          <Ionicons name={t.icon} size={18} color={colors.accent} />
          <Text style={s.value}>{fmtNum(t.value)}</Text>
          <Text style={s.label}>{t.label}</Text>
        </View>
      ))}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    tile: {
      flexBasis: '48%',
      flexGrow: 1,
      backgroundColor: c.bgSurface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: Spacing.md,
      gap: 4,
      alignItems: 'flex-start',
    },
    value: { fontSize: Typography.lg, color: c.textPrimary, fontWeight: '700' },
    label: { fontSize: Typography.xs, color: c.textMuted },
  });
}
