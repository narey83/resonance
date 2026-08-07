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

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

// Connection speeds are shown in bits (Kbps/Mbps/Gbps), matching how ISPs and
// OSes report bandwidth, while file sizes stay in bytes (fmtBytes above).
export function fmtSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 Kbps';
  const kbps = (bytesPerSec * 8) / 1000;
  if (kbps >= 1_000_000) return `${(kbps / 1_000_000).toFixed(2).replace(/\.00$/, '')} Gbps`;
  if (kbps >= 1000) {
    const mbps = kbps / 1000;
    return `${mbps < 10 ? mbps.toFixed(1) : Math.round(mbps)} Mbps`;
  }
  return `${Math.round(kbps)} Kbps`;
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

// A "data" streak that runs the length of a rail while a link is live — the
// shared idiom for an active connection or flow (ConnectionScreen's hop rails,
// TransferFlow's direction lanes). Absolutely positioned, so the caller owns
// the rail it runs along and is responsible for clipping it.
export function TravellingPacket({
  live,
  distance,
  color,
  horizontal = false,
  reverse = false,
  thickness = 3,
  length = 20,
  duration = 1_100,
  style,
}: {
  live:        boolean;
  distance:    number;  // px to travel; nothing is drawn when this is <= 0
  color:       string;
  horizontal?: boolean;
  reverse?:    boolean; // run toward the rail's start instead of its end
  thickness?:  number;
  length?:     number;
  duration?:   number;
  style?:      StyleProp<ViewStyle>;
}) {
  const travel  = useRef(new Animated.Value(0)).current;
  const running = live && distance > 0;

  useEffect(() => {
    if (!running) return;
    travel.setValue(0);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(travel, { toValue: 1, duration, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.delay(500),
    ]));
    loop.start();
    return () => loop.stop();
  }, [running, duration, travel]);

  if (!running) return null;

  const anchor: ViewStyle = horizontal
    ? (reverse ? { right: 0 } : { left: 0 })
    : (reverse ? { bottom: 0 } : { top: 0 });
  const offset = travel.interpolate({ inputRange: [0, 1], outputRange: [0, reverse ? -distance : distance] });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width:  horizontal ? length : thickness,
          height: horizontal ? thickness : length,
          borderRadius: Radius.full,
          backgroundColor: color,
          transform: [horizontal ? { translateX: offset } : { translateY: offset }],
        },
        anchor,
        style,
      ]}
    />
  );
}

// ── Chain diagram ───────────────────────────────────────────────────────────
// A vertical chain of nodes linked by rails with a travelling "data" packet —
// originally built for ConnectionScreen's app/Soulseek hop diagram, reused
// here for any "A feeds B" relationship (e.g. the distributed network's
// parent → you → children chain).

export const CHAIN_NODE   = 44;  // node circle diameter
export const CHAIN_GUTTER = 56;  // width of the rail column the nodes/links sit in
export const CHAIN_LINK_H = 66;  // height of a connector between two nodes
const CHAIN_PACKET_H = 20;       // travelling "data" streak

export function ChainNode({ icon, title, sub, color, colors }: {
  icon:   React.ComponentProps<typeof Ionicons>['name'];
  title:  string;
  sub:    string;
  color:  string;
  colors: ThemeColors;
}) {
  const s = useMemo(() => makeChainStyles(colors), [colors]);
  return (
    <View style={s.row}>
      <View style={s.gutter}>
        <View style={[s.node, { borderColor: color, backgroundColor: color + '1f' }]}>
          <Ionicons name={icon} size={20} color={color} />
        </View>
      </View>
      <View style={s.nodeText}>
        <Text style={s.nodeTitle} numberOfLines={1}>{title}</Text>
        <Text style={s.nodeSub} numberOfLines={1}>{sub}</Text>
      </View>
    </View>
  );
}

// One hop: a coloured rail with a packet streaking down it while the hop is
// live, plus the hop's own headline and metric chips.
export function ChainLink({ title, status, chips, color, live, colors }: {
  title:  string;
  status: string;
  chips:  string[];
  color:  string;
  live:   boolean;
  colors: ThemeColors;
}) {
  const s = useMemo(() => makeChainStyles(colors), [colors]);

  return (
    <View style={s.row}>
      <View style={[s.gutter, { height: CHAIN_LINK_H }]}>
        <View style={[s.rail, { backgroundColor: color + (live ? '44' : '99') }]} />
        <TravellingPacket
          live={live}
          distance={CHAIN_LINK_H - CHAIN_PACKET_H}
          length={CHAIN_PACKET_H}
          color={color}
          style={s.packet}
        />
      </View>
      <View style={s.hop}>
        <Text style={s.hopTitle}>{title}</Text>
        <Text style={[s.hopStatus, { color }]} numberOfLines={1}>{status}</Text>
        <View style={s.chipRow}>
          {chips.map((c) => (
            <View key={c} style={[s.chip, { borderColor: color + '55', backgroundColor: color + '14' }]}>
              <Text style={[s.chipText, { color }]} numberOfLines={1}>{c}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function makeChainStyles(c: ThemeColors) {
  return StyleSheet.create({
    row:       { flexDirection: 'row', alignItems: 'center' },
    gutter:    { width: CHAIN_GUTTER, alignItems: 'center', justifyContent: 'center' },
    node:      { width: CHAIN_NODE, height: CHAIN_NODE, borderRadius: CHAIN_NODE / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    nodeText:  { flex: 1, paddingRight: Spacing.sm },
    nodeTitle: { fontSize: Typography.md, fontWeight: '700', color: c.textPrimary },
    nodeSub:   { fontSize: Typography.sm, color: c.textMuted },
    // Left is pinned rather than left to alignItems: an absolutely positioned
    // child's static position is easy to get wrong across platforms, and the
    // rail has to line up with the node circles above and below it to the pixel.
    rail:      { position: 'absolute', top: 0, bottom: 0, left: (CHAIN_GUTTER - 3) / 2, width: 3, borderRadius: Radius.full },
    packet:    { left: (CHAIN_GUTTER - 3) / 2 },
    hop:       { flex: 1, paddingRight: Spacing.sm, paddingVertical: Spacing.xs, gap: 3 },
    hopTitle:  { fontSize: Typography.xs, color: c.textMuted, fontWeight: '600', letterSpacing: 0.8 },
    hopStatus: { fontSize: Typography.base, fontWeight: '600' },
    chipRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: 2 },
    chip:      { borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 1 },
    chipText:  { fontSize: Typography.xs, fontWeight: '600', fontVariant: ['tabular-nums'] },
  });
}

export function EmptyState({ text, colors }: { text: string; colors: ThemeColors }) {
  return (
    <View style={{ padding: Spacing.lg, alignItems: 'center' }}>
      <Text style={{ fontSize: Typography.sm, color: colors.textMuted }}>{text}</Text>
    </View>
  );
}
