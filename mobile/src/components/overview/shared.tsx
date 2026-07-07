// <copyright file="shared.tsx" company="John Narey">
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
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, Typography, ThemeColors } from '../../theme';

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024)      return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
}

export function fmtNum(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString() : '—';
}

export function fmtPct(n: number, digits = 1): string {
  return Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : '—';
}

export function fmtSpeed(bytesPerSec: number): string {
  return `${fmtBytes(bytesPerSec)}/s`;
}

// Handles both past ("Xm ago") and future ("in Xm") timestamps — the latter
// is used for things like JWT expiry, not just "last seen" style fields.
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = Date.now();
  const diffMs = now - d.getTime();
  const future = diffMs < 0;
  const diffMin = Math.abs(diffMs) / 60_000;
  if (diffMin < 1) return 'just now';
  const unit = (n: number, u: string) => (future ? `in ${n}${u}` : `${n}${u} ago`);
  if (diffMin < 60) return unit(Math.floor(diffMin), 'm');
  if (diffMin < 60 * 24) return unit(Math.floor(diffMin / 60), 'h');
  if (diffMin < 60 * 24 * 30) return unit(Math.floor(diffMin / (60 * 24)), 'd');
  return d.toLocaleDateString();
}

export function SectionHeader({ title, colors }: { title: string; colors: ThemeColors }) {
  return (
    <Text style={[sectionHeaderStyle, { color: colors.textMuted }]}>
      {title.toUpperCase()}
    </Text>
  );
}

const sectionHeaderStyle = {
  fontSize:      Typography.xs,
  fontWeight:    '600' as const,
  letterSpacing: 0.8,
  paddingHorizontal: Spacing.sm,
  paddingBottom: Spacing.xs,
};

export function Card({ children, colors }: { children: React.ReactNode; colors: ThemeColors }) {
  return (
    <View style={{
      backgroundColor: colors.bgSurface,
      borderRadius:    Radius.lg,
      borderWidth:     1,
      borderColor:     colors.border,
      overflow:        'hidden',
    }}>
      {children}
    </View>
  );
}

export function StatRow({
  label,
  value,
  valueColor,
  last = false,
  colors,
}: {
  label:      string;
  value:      string | React.ReactNode;
  valueColor?: string;
  last?:      boolean;
  colors:     ThemeColors;
}) {
  const s = useMemo(() => makeRowStyles(colors, last), [colors, last]);
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      {typeof value === 'string' ? (
        <Text style={[s.value, valueColor ? { color: valueColor } : null]}>{value}</Text>
      ) : value}
    </View>
  );
}

function makeRowStyles(c: ThemeColors, last: boolean) {
  return StyleSheet.create({
    row: {
      flexDirection:    'row',
      alignItems:       'center',
      justifyContent:   'space-between',
      padding:          Spacing.md,
      borderBottomWidth: last ? 0 : 1,
      borderBottomColor: c.border,
    },
    label: { fontSize: Typography.base, color: c.textMuted, flex: 1 },
    value: { fontSize: Typography.base, color: c.textPrimary, fontWeight: '500', textAlign: 'right', flexShrink: 1, marginLeft: Spacing.sm },
  });
}

// A single labeled proportional bar — the workhorse for every hand-rolled
// "chart" here (matches how most of the web dashboard's own charts are
// plain CSS bars, not a charting library; see Overview/PopularDirectories.jsx
// etc. on the frontend).
export function BarRow({
  label,
  value,
  fraction,
  color,
  last = false,
  colors,
  onPress,
}: {
  label:     string;
  value:     string;
  fraction:  number; // 0..1
  color?:    string;
  last?:     boolean;
  colors:    ThemeColors;
  onPress?:  () => void;
}) {
  const s = useMemo(() => makeBarStyles(colors, last), [colors, last]);
  const pct = Math.max(0, Math.min(1, fraction));
  return (
    <Pressable style={s.row} disabled={!onPress} onPress={onPress}>
      <View style={s.topLine}>
        <Text style={s.label} numberOfLines={1}>{label}</Text>
        <Text style={s.value}>{value}</Text>
      </View>
      <View style={s.track}>
        <View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: color ?? colors.accent }]} />
      </View>
    </Pressable>
  );
}

function makeBarStyles(c: ThemeColors, last: boolean) {
  return StyleSheet.create({
    row: {
      padding: Spacing.md,
      borderBottomWidth: last ? 0 : 1,
      borderBottomColor: c.border,
      gap: 6,
    },
    topLine:  { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
    label:    { fontSize: Typography.sm, color: c.textPrimary, flexShrink: 1 },
    value:    { fontSize: Typography.sm, color: c.textMuted, fontVariant: ['tabular-nums'] },
    track:    { height: 6, borderRadius: Radius.full, backgroundColor: c.bgElevated, overflow: 'hidden' },
    fill:     { height: '100%', borderRadius: Radius.full },
  });
}

export interface StatTileData {
  key:         string;
  label:       string;
  value:       string | React.ReactNode;
  valueColor?: string;
  sub?:        string | React.ReactNode;
}

// The bold tile-grid look (big number, small caps label) used across the
// KPI-style cards — Server/System reuse this too so the whole screen shares
// one visual language instead of mixing tiles with plain label/value rows.
export function StatTileGrid({ tiles, colors }: { tiles: StatTileData[]; colors: ThemeColors }) {
  const s = useMemo(() => makeTileStyles(colors), [colors]);
  return (
    <View style={s.grid}>
      {tiles.map((t) => (
        <View key={t.key} style={s.tile}>
          <Text style={s.label}>{t.label}</Text>
          {typeof t.value === 'string' ? (
            <Text style={[s.value, t.valueColor ? { color: t.valueColor } : null]} numberOfLines={1}>{t.value}</Text>
          ) : t.value}
          {t.sub != null ? (
            typeof t.sub === 'string' ? <Text style={s.sub}>{t.sub}</Text> : t.sub
          ) : null}
        </View>
      ))}
    </View>
  );
}

function makeTileStyles(c: ThemeColors) {
  return StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    tile: {
      flexBasis: '48%',
      flexGrow: 1,
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

export function EmptyState({ text, colors }: { text: string; colors: ThemeColors }) {
  return (
    <View style={{ padding: Spacing.lg, alignItems: 'center' }}>
      <Text style={{ fontSize: Typography.sm, color: colors.textMuted }}>{text}</Text>
    </View>
  );
}
