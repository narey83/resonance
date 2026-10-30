// <copyright file="ActivityHeatmap.tsx" company="John Narey">
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

import { Text } from '../Typography';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Spacing, Typography, ThemeColors } from '../../theme';
import { HeatmapCell } from '../../api/analytics';
import { Card, EmptyState } from './shared';

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CELL = 14;

export default function ActivityHeatmap({ data, colors }: { data: HeatmapCell[] | null; colors: ThemeColors }) {
  const s = useMemo(() => makeStyles(colors), [colors]);

  const grid = useMemo(() => {
    const byDowHour = new Map<string, HeatmapCell>();
    for (const cell of data ?? []) byDowHour.set(`${cell.dow}:${cell.hour}`, cell);
    return byDowHour;
  }, [data]);

  const max = Math.max(1, ...(data ?? []).map((c) => c.bytes));

  if (!data || data.length === 0) {
    return <Card colors={colors}><EmptyState text="No activity recorded yet." colors={colors} /></Card>;
  }

  return (
    <Card colors={colors}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.scroll}>
        <View>
          {DOW_LABELS.map((label, dow) => (
            <View key={label} style={s.row}>
              <Text style={s.dowLabel}>{label}</Text>
              {Array.from({ length: 24 }, (_, hour) => {
                const cell = grid.get(`${dow}:${hour}`);
                const intensity = cell ? Math.max(0.08, Math.min(1, cell.bytes / max)) : 0;
                return (
                  <View
                    key={hour}
                    style={[
                      s.cell,
                      { backgroundColor: intensity > 0 ? colors.accent : colors.bgElevated, opacity: intensity > 0 ? intensity : 1 },
                    ]}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </Card>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll: { padding: Spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 3 },
    dowLabel: { width: 32, fontSize: Typography.xs, color: c.textMuted },
    cell: { width: CELL, height: CELL, borderRadius: 3 },
  });
}
