// <copyright file="RatioCard.tsx" company="John Narey">
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

// Simplified mobile counterpart of the web's Recharts sparkline: shows the
// current upload:download ratio as a single stat instead of a time series,
// to avoid pulling in a charting dependency for one card.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, Typography, ThemeColors } from '../../theme';
import { TransferSummary } from '../../api/analytics';
import { fmtBytes } from './shared';

function totalBytes(byState: Record<string, TransferSummary> | undefined) {
  return Object.values(byState ?? {}).reduce((sum, s) => sum + (s.totalBytes ?? 0), 0);
}

export default function RatioCard({
  summary,
  colors,
}: {
  summary: Record<string, Record<string, TransferSummary>> | null;
  colors:  ThemeColors;
}) {
  const s = useMemo(() => makeStyles(colors), [colors]);
  const ul = totalBytes(summary?.Upload);
  const dl = totalBytes(summary?.Download);
  const ratio = dl > 0 ? ul / dl : ul > 0 ? Infinity : 0;
  const ratioText = ratio === Infinity ? '∞' : ratio.toFixed(2);

  return (
    <View style={s.card}>
      <Text style={s.label}>Upload : Download Ratio</Text>
      <Text style={s.value}>{ratioText}</Text>
      <Text style={s.sub}>{fmtBytes(ul)} up · {fmtBytes(dl)} down</Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.bgSurface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: Spacing.md,
      gap: 2,
    },
    label: { fontSize: Typography.xs, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    value: { fontSize: Typography.xl, color: c.textPrimary, fontWeight: '700' },
    sub:   { fontSize: Typography.xs, color: c.textMuted },
  });
}
