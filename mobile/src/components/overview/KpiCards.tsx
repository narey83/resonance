// <copyright file="KpiCards.tsx" company="John Narey">
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

import React from 'react';
import { Text, View } from 'react-native';
import { ThemeColors } from '../../theme';
import { TransferSummary } from '../../api/analytics';
import { fmtBytes, fmtNum, fmtPct, StatTileGrid } from './shared';

function aggregate(byState: Record<string, TransferSummary> | undefined) {
  const states = Object.values(byState ?? {});
  const totalBytes = states.reduce((sum, s) => sum + (s.totalBytes ?? 0), 0);
  const count = states.reduce((sum, s) => sum + (s.count ?? 0), 0);
  const succeeded = byState?.Succeeded?.count ?? 0;
  return { totalBytes, count, successRate: count > 0 ? succeeded / count : 0 };
}

function delta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / previous;
}

export default function KpiCards({
  summary,
  prevSummary,
  colors,
}: {
  summary:     Record<string, Record<string, TransferSummary>> | null;
  prevSummary: Record<string, Record<string, TransferSummary>> | null;
  colors:      ThemeColors;
}) {
  const dl = aggregate(summary?.Download);
  const ul = aggregate(summary?.Upload);
  const prevDl = aggregate(prevSummary?.Download);
  const prevUl = aggregate(prevSummary?.Upload);
  const dlDelta = delta(dl.totalBytes, prevDl.totalBytes);
  const ulDelta = delta(ul.totalBytes, prevUl.totalBytes);

  const sub = (count: number, d: number | null) => (
    <View>
      <Text style={{ fontSize: 11, color: colors.textMuted }}>{fmtNum(count)} files</Text>
      {d !== null && (
        <Text style={{ fontSize: 11, color: d >= 0 ? colors.success : colors.danger }}>
          {d >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(d), 0)} vs prior
        </Text>
      )}
    </View>
  );

  return (
    <StatTileGrid
      colors={colors}
      tiles={[
        { key: 'dl', label: 'Downloaded', value: fmtBytes(dl.totalBytes), sub: sub(dl.count, dlDelta) },
        { key: 'ul', label: 'Uploaded', value: fmtBytes(ul.totalBytes), sub: sub(ul.count, ulDelta) },
        { key: 'dl-rate', label: 'Download Success', value: fmtPct(dl.successRate) },
        { key: 'ul-rate', label: 'Upload Success', value: fmtPct(ul.successRate) },
      ]}
    />
  );
}
