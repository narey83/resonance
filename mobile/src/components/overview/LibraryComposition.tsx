// <copyright file="LibraryComposition.tsx" company="John Narey">
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

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, Typography, ThemeColors } from '../../theme';
import { MusicGenre, MusicYear } from '../../api/musicLibrary';
import { PlayStat } from '../../api/libraryActivity';
import { BarRow, Card, EmptyState, fmtNum } from './shared';

type Tab = 'Genres' | 'Decades' | 'Most Played';
const TABS: Tab[] = ['Genres', 'Decades', 'Most Played'];

function toDecades(years: MusicYear[]) {
  const byDecade = new Map<number, number>();
  for (const y of years) {
    const decade = Math.floor(y.year / 10) * 10;
    byDecade.set(decade, (byDecade.get(decade) ?? 0) + y.trackCount);
  }
  return Array.from(byDecade.entries())
    .map(([decade, trackCount]) => ({ label: `${decade}s`, trackCount }))
    .sort((a, b) => b.trackCount - a.trackCount);
}

export default function LibraryComposition({
  genres,
  years,
  playStats,
  colors,
}: {
  genres:    MusicGenre[];
  years:     MusicYear[];
  playStats: PlayStat[];
  colors:    ThemeColors;
}) {
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<Tab>('Genres');

  let rows: { label: string; value: number }[] = [];
  if (tab === 'Genres') {
    rows = genres.map((g) => ({ label: g.genre || 'Unknown', value: g.trackCount })).sort((a, b) => b.value - a.value);
  } else if (tab === 'Decades') {
    rows = toDecades(years).map((d) => ({ label: d.label, value: d.trackCount }));
  } else {
    rows = playStats
      .map((p) => ({ label: p.path.split(/[/\\]/).pop() ?? p.path, value: p.playCount }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }

  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <>
      <View style={s.segWrapper}>
        {TABS.map((t) => {
          const active = tab === t;
          return (
            <Pressable key={t} onPress={() => setTab(t)} style={[s.segPill, active && { backgroundColor: colors.accent }]}>
              <Text style={[s.segLabel, { color: active ? '#fff' : colors.textMuted }]}>{t}</Text>
            </Pressable>
          );
        })}
      </View>
      <Card colors={colors}>
        {rows.length === 0 ? (
          <EmptyState text="No library data yet." colors={colors} />
        ) : (
          rows.map((r, i) => (
            <BarRow
              key={r.label}
              label={r.label}
              value={fmtNum(r.value)}
              fraction={r.value / max}
              colors={colors}
              last={i === rows.length - 1}
            />
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
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bgElevated,
      overflow: 'hidden',
      padding: 2,
    },
    segPill:  { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center', borderRadius: Radius.full },
    segLabel: { fontSize: Typography.xs, fontWeight: '600' },
  });
}
