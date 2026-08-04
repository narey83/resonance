// <copyright file="TransferFlow.tsx" company="John Narey">
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

// The Overview's headline card: what actually moved through this node in the
// selected window, split into its two directions.
//
//   peers ──── downloaded (in) ────> this server ──── uploaded (out) ────> peers
//
// Replaces the old KpiCards + RatioCard pair, which listed in/out as four
// interchangeable tiles plus a detached ratio — nothing showed that these are
// two opposing flows, or which one dominates. Here each direction owns a lane
// whose fill length is its share of the larger direction (so the imbalance is
// the picture, not a number you have to divide yourself), with the same live
// packet idiom the Connection screen uses for its hops, and the ratio sitting
// between the lanes as the relationship it describes.
//
// Used for both the admin dashboard (everyone's traffic) and PersonalSummary
// (just yours) — same shape of data, same card.

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, Typography, ThemeColors } from '../../theme';
import { TransferSummary } from '../../api/analytics';
import { Card, fmtBytes, fmtNum, fmtPct, TravellingPacket } from './shared';

const TRACK   = 10;  // lane rail height
const PACKET  = 30;  // streak length

type ByState = Record<string, TransferSummary> | undefined;

function aggregate(byState: ByState) {
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

function Lane({
  icon,
  label,
  stats,
  change,
  color,
  fraction,
  reverse,
  laneWidth,
  onLaneWidth,
  colors,
}: {
  icon:         React.ComponentProps<typeof Ionicons>['name'];
  label:        string;
  stats:        ReturnType<typeof aggregate>;
  change:       number | null;
  color:        string;
  fraction:     number;  // 0..1 of the busier direction
  reverse:      boolean; // uploads run right-to-left, back out to the peers
  laneWidth:    number;
  onLaneWidth?: (w: number) => void;
  colors:       ThemeColors;
}) {
  const s = useMemo(() => makeStyles(colors), [colors]);
  const rateColor = stats.count === 0 ? colors.textMuted
                  : stats.successRate >= 0.95 ? colors.success
                  : stats.successRate >= 0.8  ? colors.warning
                  : colors.danger;
  const fillWidth = laneWidth * fraction;

  return (
    <View style={s.lane}>
      <View style={s.laneHead}>
        <Ionicons name={icon} size={14} color={color} />
        <Text style={s.laneLabel}>{label}</Text>
        <Text style={[s.laneValue, { color }]} numberOfLines={1}>{fmtBytes(stats.totalBytes)}</Text>
      </View>

      <View style={s.track} onLayout={onLaneWidth ? (e) => onLaneWidth(e.nativeEvent.layout.width) : undefined}>
        <View style={[s.fill, { width: `${fraction * 100}%`, backgroundColor: color + '40' }, reverse && s.fillReverse]} />
        <TravellingPacket
          live={stats.totalBytes > 0}
          distance={fillWidth - PACKET}
          length={PACKET}
          thickness={TRACK}
          color={color}
          horizontal
          reverse={reverse}
        />
      </View>

      <View style={s.laneFoot}>
        <Text style={s.footText}>{fmtNum(stats.count)} files</Text>
        <Text style={[s.footText, { color: rateColor }]}>{fmtPct(stats.successRate, 0)} success</Text>
        {change !== null && (
          <Text style={[s.footText, { color: change >= 0 ? colors.success : colors.danger }]}>
            {change >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(change), 0)} vs prior
          </Text>
        )}
      </View>
    </View>
  );
}

export default function TransferFlow({
  summary,
  prevSummary,
  caption,
  colors,
}: {
  summary:      Record<string, Record<string, TransferSummary>> | null;
  prevSummary?: Record<string, Record<string, TransferSummary>> | null;
  caption:      string;
  colors:       ThemeColors;
}) {
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [laneWidth, setLaneWidth] = useState(0);

  const dl = aggregate(summary?.Download);
  const ul = aggregate(summary?.Upload);
  const busiest = Math.max(dl.totalBytes, ul.totalBytes);

  // Keep a sliver visible for a direction that moved *something*, so "tiny" and
  // "nothing at all" don't render identically.
  const share = (bytes: number) => (busiest > 0 ? Math.max(bytes / busiest, bytes > 0 ? 0.06 : 0) : 0);

  const ratio = dl.totalBytes > 0 ? ul.totalBytes / dl.totalBytes : ul.totalBytes > 0 ? Infinity : 0;

  return (
    <Card colors={colors}>
      <View style={s.body}>
        <Text style={s.caption}>{caption}</Text>

        <Lane
          icon="arrow-down"
          label="DOWNLOADED"
          stats={dl}
          change={prevSummary ? delta(dl.totalBytes, aggregate(prevSummary.Download).totalBytes) : null}
          color={colors.accent}
          fraction={share(dl.totalBytes)}
          reverse={false}
          laneWidth={laneWidth}
          onLaneWidth={setLaneWidth}
          colors={colors}
        />

        <View style={s.ratioRow}>
          <View style={s.rule} />
          <View style={s.ratioBadge}>
            <Text style={s.ratioValue}>{ratio === Infinity ? '∞' : ratio.toFixed(2)}</Text>
            <Text style={s.ratioLabel}>UP : DOWN</Text>
          </View>
          <View style={s.rule} />
        </View>

        <Lane
          icon="arrow-up"
          label="UPLOADED"
          stats={ul}
          change={prevSummary ? delta(ul.totalBytes, aggregate(prevSummary.Upload).totalBytes) : null}
          color={colors.success}
          fraction={share(ul.totalBytes)}
          reverse
          laneWidth={laneWidth}
          colors={colors}
        />
      </View>
    </Card>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    body:       { padding: Spacing.md, gap: Spacing.sm },
    caption:    { fontSize: Typography.xs, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '600' },
    lane:       { gap: 5 },
    laneHead:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    laneLabel:  { fontSize: Typography.xs, color: c.textMuted, letterSpacing: 0.8, fontWeight: '600', flex: 1 },
    laneValue:  { fontSize: Typography.xl, fontWeight: '700', fontVariant: ['tabular-nums'] },
    track:      { height: TRACK, borderRadius: Radius.full, backgroundColor: c.bgElevated, overflow: 'hidden' },
    fill:       { height: '100%', borderRadius: Radius.full },
    // Uploads read right-to-left, so their fill grows from the right edge.
    fillReverse: { alignSelf: 'flex-end' },
    laneFoot:   { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    footText:   { fontSize: Typography.xs, color: c.textMuted, fontVariant: ['tabular-nums'] },
    ratioRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    rule:       { flex: 1, height: 1, backgroundColor: c.border },
    ratioBadge: { alignItems: 'center' },
    ratioValue: { fontSize: Typography.lg, fontWeight: '700', color: c.textPrimary, fontVariant: ['tabular-nums'] },
    ratioLabel: { fontSize: 9, color: c.textMuted, letterSpacing: 1, fontWeight: '600' },
  });
}
