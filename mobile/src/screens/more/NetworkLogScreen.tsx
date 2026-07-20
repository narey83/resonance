// <copyright file="NetworkLogScreen.tsx" company="John Narey">
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
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import { useNetworkLog, NetworkLogEntry, NetworkLogKind } from '../../store/networkLogStore';
import { useConnectionStore } from '../../services/connectionMonitor';
import {
  exportNetworkLogAsHar,
  openNetworkLogInHarReader,
  saveNetworkLogToFolder,
  HarExportResult,
} from '../../services/harExport';
import { LIST_PERF_PROPS } from '../../lib/listPerf';

// Latency thresholds for colour-coding (ms). Mirrors the connection monitor's SLOW_MS.
const WARN_MS = 500;
const SLOW_MS = 1_500;

function durationColor(c: ThemeColors, ms: number): string {
  if (ms >= SLOW_MS) return c.danger;
  if (ms >= WARN_MS) return c.warning;
  return c.success;
}

function statusColor(c: ThemeColors, entry: NetworkLogEntry): string {
  if (!entry.ok)             return c.danger;      // failure (incl. no response / 4xx / 5xx)
  if (entry.status === null) return c.danger;
  if (entry.status >= 400)   return c.warning;
  return c.success;
}

function kindColor(c: ThemeColors, kind: NetworkLogKind): string {
  if (kind === 'img')    return c.queued;     // purple — native artwork load
  if (kind === 'stream') return c.warning;    // amber  — audio buffering
  return c.accent;                            // blue   — REST
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function NetworkLogScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const entries  = useNetworkLog((st) => st.entries);
  const paused   = useNetworkLog((st) => st.paused);
  const setPaused = useNetworkLog((st) => st.setPaused);
  const clear    = useNetworkLog((st) => st.clear);

  const connStatus  = useConnectionStore((st) => st.status);
  const connLatency = useConnectionStore((st) => st.latencyMs);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const runExport = async (fn: (entries: NetworkLogEntry[]) => Promise<HarExportResult>) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await fn(useNetworkLog.getState().entries);
      const note = result.ok ? result.message : result.reason;
      if (note) Alert.alert('Export', note);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const exportDisabled = busy || entries.length === 0;

  const stats = useMemo(() => {
    if (entries.length === 0) return { count: 0, avg: 0, max: 0, errors: 0 };
    let sum = 0;
    let max = 0;
    let errors = 0;
    for (const e of entries) {
      sum += e.durationMs;
      if (e.durationMs > max) max = e.durationMs;
      if (!e.ok) errors++;
    }
    return { count: entries.length, avg: Math.round(sum / entries.length), max, errors };
  }, [entries]);

  return (
    <FlatList
      {...LIST_PERF_PROPS}
      style={s.scroll}
      contentContainerStyle={s.container}
      data={entries}
      keyExtractor={(e) => String(e.id)}
      extraData={expandedId}
      ListHeaderComponent={
        <View style={s.header}>
          {/* Live connection summary (from the connection monitor's periodic ping) */}
          <View style={s.summaryRow}>
            <Stat label="Status"  value={connStatus} colors={colors} />
            <Stat label="Ping"    value={connLatency != null ? `${connLatency}ms` : '—'} colors={colors} />
            <Stat label="Reqs"    value={String(stats.count)} colors={colors} />
            <Stat
              label="Errors"
              value={String(stats.errors)}
              colors={colors}
              accent={stats.errors > 0 ? colors.danger : undefined}
            />
          </View>
          <View style={s.summaryRow}>
            <Stat
              label="Avg latency"
              value={stats.count ? `${stats.avg}ms` : '—'}
              colors={colors}
              accent={durationColor(colors, stats.avg)}
            />
            <Stat
              label="Max latency"
              value={stats.count ? `${stats.max}ms` : '—'}
              colors={colors}
              accent={durationColor(colors, stats.max)}
            />
          </View>

          {/* Capture controls */}
          <View style={s.controls}>
            <Pressable
              onPress={() => setPaused(!paused)}
              style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
            >
              <Ionicons
                color={paused ? colors.warning : colors.textPrimary}
                name={paused ? 'play' : 'pause'}
                size={15}
              />
              <Text style={s.btnText}>{paused ? 'Resume' : 'Pause'}</Text>
            </Pressable>
            <Pressable
              onPress={clear}
              style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
            >
              <Ionicons color={colors.textPrimary} name="trash-outline" size={15} />
              <Text style={s.btnText}>Clear</Text>
            </Pressable>
          </View>

          {/* Export (HAR) */}
          <View style={s.controls}>
            <Pressable
              disabled={exportDisabled}
              onPress={() => runExport(openNetworkLogInHarReader)}
              style={({ pressed }) => [s.btn, pressed && s.btnPressed, exportDisabled && s.btnDisabled]}
            >
              <Ionicons color={colors.textPrimary} name="open-outline" size={15} />
              <Text style={s.btnText}>Open</Text>
            </Pressable>
            <Pressable
              disabled={exportDisabled}
              onPress={() => runExport(saveNetworkLogToFolder)}
              style={({ pressed }) => [s.btn, pressed && s.btnPressed, exportDisabled && s.btnDisabled]}
            >
              <Ionicons color={colors.textPrimary} name="download-outline" size={15} />
              <Text style={s.btnText}>Save</Text>
            </Pressable>
            <Pressable
              disabled={exportDisabled}
              onPress={() => runExport(exportNetworkLogAsHar)}
              style={({ pressed }) => [s.btn, pressed && s.btnPressed, exportDisabled && s.btnDisabled]}
            >
              <Ionicons color={colors.textPrimary} name="share-outline" size={15} />
              <Text style={s.btnText}>Share</Text>
            </Pressable>
          </View>
        </View>
      }
      ListEmptyComponent={
        <Text style={s.empty}>
          {paused ? 'Capture paused.' : 'No requests captured yet. API calls will appear here as they happen.'}
        </Text>
      }
      renderItem={({ item }) => (
        <Row
          entry={item}
          colors={colors}
          styles={s}
          expanded={expandedId === item.id}
          onToggle={() => setExpandedId((cur) => (cur === item.id ? null : item.id))}
        />
      )}
    />
  );
}

function Stat({
  label,
  value,
  colors,
  accent,
}: {
  label: string;
  value: string;
  colors: ThemeColors;
  accent?: string;
}) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ fontSize: Typography.xs, color: colors.textMuted }}>{label}</Text>
      <Text
        numberOfLines={1}
        style={{ fontSize: Typography.base, fontWeight: '600', color: accent ?? colors.textPrimary }}
      >
        {value}
      </Text>
    </View>
  );
}

function Row({
  entry,
  colors,
  styles,
  expanded,
  onToggle,
}: {
  entry: NetworkLogEntry;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgElevated }]}
    >
      <View style={styles.rowTop}>
        <Text style={[styles.method, { color: kindColor(colors, entry.kind) }]}>{entry.method}</Text>
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.url}>{entry.url}</Text>
        <Text style={[styles.duration, { color: durationColor(colors, entry.durationMs) }]}>
          {entry.durationMs}ms
        </Text>
      </View>
      <View style={styles.rowBottom}>
        <Text style={styles.time}>{formatTime(entry.startedAt)}</Text>
        <Text style={[styles.status, { color: statusColor(colors, entry) }]}>
          {entry.error ?? entry.status ?? '—'}
        </Text>
      </View>

      {expanded ? (
        <View style={styles.detail}>
          <DetailLine label="URL" value={entry.fullUrl ?? entry.url} styles={styles} mono />
          {entry.requestHeaders ? (
            <HeaderBlock title="Request headers" headers={entry.requestHeaders} styles={styles} />
          ) : null}
          {entry.responseHeaders ? (
            <HeaderBlock title="Response headers" headers={entry.responseHeaders} styles={styles} />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function DetailLine({
  label,
  value,
  styles,
  mono,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
  mono?: boolean;
}) {
  return (
    <View style={{ gap: 1 }}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={mono ? styles.detailValueMono : styles.detailValue}>{value}</Text>
    </View>
  );
}

function HeaderBlock({
  title,
  headers,
  styles,
}: {
  title: string;
  headers: Record<string, string>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={{ gap: 1 }}>
      <Text style={styles.detailLabel}>{title}</Text>
      {Object.entries(headers).map(([k, v]) => (
        <Text key={k} selectable style={styles.detailValueMono}>
          {k}: {v}
        </Text>
      ))}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll:    { flex: 1, backgroundColor: c.bgPrimary },
    container: { padding: Spacing.lg, gap: Spacing.sm },

    header: { gap: Spacing.md, marginBottom: Spacing.sm },
    summaryRow: {
      flexDirection: 'row',
      gap: Spacing.md,
      backgroundColor: c.bgSurface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: Spacing.md,
    },
    controls: { flexDirection: 'row', gap: Spacing.sm },
    btn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: c.borderStrong,
      backgroundColor: c.bgSurface,
    },
    btnPressed:  { backgroundColor: c.bgElevated },
    btnDisabled: { opacity: 0.4 },
    btnText:     { fontSize: Typography.sm, fontWeight: '600', color: c.textPrimary },

    empty: {
      fontSize: Typography.sm,
      color: c.textMuted,
      textAlign: 'center',
      paddingVertical: Spacing.xl,
    },

    row: {
      backgroundColor: c.bgSurface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      gap: 2,
    },
    rowTop:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    method: {
      fontSize: Typography.xs,
      fontWeight: '700',
      color: c.accent,
      fontFamily: Typography.mono,
      minWidth: 42,
    },
    url: {
      flex: 1,
      fontSize: Typography.sm,
      color: c.textPrimary,
      fontFamily: Typography.mono,
    },
    duration: { fontSize: Typography.sm, fontWeight: '600', fontFamily: Typography.mono },
    time:     { fontSize: Typography.xs, color: c.textMuted, fontFamily: Typography.mono },
    status:   { fontSize: Typography.xs, fontWeight: '600', fontFamily: Typography.mono },

    detail: {
      marginTop: Spacing.sm,
      paddingTop: Spacing.sm,
      borderTopWidth: 1,
      borderTopColor: c.border,
      gap: Spacing.sm,
    },
    detailLabel:     { fontSize: Typography.xs, fontWeight: '600', color: c.textMuted },
    detailValue:     { fontSize: Typography.xs, color: c.textPrimary },
    detailValueMono: { fontSize: Typography.xs, color: c.textPrimary, fontFamily: Typography.mono },
  });
}
