// <copyright file="UserLeaderboard.tsx" company="John Narey">
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

import { Editorial, Spacing, Typography, ThemeColors } from '../../theme';

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TransferDirection, TransferSummary } from '../../api/analytics';
import { Card, EmptyState, fmtBytes, fmtNum, fmtSpeed } from './shared';

export default function UserLeaderboard({
  leaderboard,
  colors,
  onSelectUser,
}: {
  leaderboard:  { download: TransferSummary[]; upload: TransferSummary[] };
  colors:       ThemeColors;
  onSelectUser: (username: string) => void;
}) {
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [direction, setDirection] = useState<TransferDirection>('Download');
  const rows = direction === 'Download' ? leaderboard.download : leaderboard.upload;

  return (
    <>
      <View style={s.segWrapper}>
        {(['Download', 'Upload'] as TransferDirection[]).map((d) => {
          const active = direction === d;
          return (
            <Pressable
              key={d}
              onPress={() => setDirection(d)}
              style={[s.segPill, active && { backgroundColor: colors.accent }]}
            >
              <Text style={[s.segLabel, { color: active ? '#fff' : colors.textMuted }]}>{d}s</Text>
            </Pressable>
          );
        })}
      </View>
      <Card colors={colors}>
        {rows.length === 0 ? (
          <EmptyState text="No users in this window." colors={colors} />
        ) : (
          rows.map((row, i) => (
            <Pressable
              key={row.username ?? i}
              style={[s.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}
              onPress={() => row.username && onSelectUser(row.username)}
            >
              <Text style={s.rank}>{i + 1}</Text>
              <View style={s.info}>
                <Text style={s.username} numberOfLines={1}>{row.username ?? 'Unknown'}</Text>
                <Text style={s.sub}>{fmtNum(row.count)} files · {fmtSpeed(row.averageSpeed)}</Text>
              </View>
              <Text style={s.bytes}>{fmtBytes(row.totalBytes)}</Text>
            </Pressable>
          ))
        )}
      </Card>
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    segWrapper: {
      flexDirection: 'row',
      marginHorizontal: Spacing.xs,
      marginBottom: Spacing.sm,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bgElevated,
      overflow: 'hidden',
      padding: 2,
      ...Editorial.control,
    },
    segPill: { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center', ...Editorial.control },
    segLabel: { fontSize: Typography.sm, fontWeight: '600', ...Editorial.label },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      gap: Spacing.sm,
    },
    rank:     { width: 22, fontSize: Typography.sm, color: c.textMuted, fontWeight: '600' },
    info:     { flex: 1, gap: 2 },
    username: { fontSize: Typography.base, color: c.textPrimary, fontWeight: '500' },
    sub:      { fontSize: Typography.xs, color: c.textMuted },
    bytes:    { fontSize: Typography.sm, color: c.textPrimary, fontWeight: '600' },
  });
}
