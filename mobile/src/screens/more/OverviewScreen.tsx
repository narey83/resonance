// <copyright file="OverviewScreen.tsx" company="John Narey">
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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, Typography, ThemeColors } from '../../theme';
import { getApplicationState, getKpis, AppState, KpiMetric } from '../../api/application';

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 ** 2)   return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)   return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

// The Soulseek server reports privileges as seconds remaining (protocol
// CheckPrivileges), not days. Render the largest sensible unit.
function fmtPrivileges(seconds: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} remaining`;
  if (seconds >= 86_400) return plural(Math.floor(seconds / 86_400), 'day');
  if (seconds >= 3_600) return plural(Math.floor(seconds / 3_600), 'hour');
  if (seconds >= 60) return plural(Math.floor(seconds / 60), 'minute');
  return plural(seconds, 'second');
}

function sampleValue(metric: KpiMetric | undefined): number | null {
  if (!metric) return null;
  const v = metric.samples?.[0]?.value;
  return v !== undefined ? v : (metric.sum ?? null);
}

function sampleValueByLabel(
  metric: KpiMetric | undefined,
  labelKey: string,
  labelValue: string,
): number | null {
  if (!metric?.samples) return null;
  const s = metric.samples.find(s => s.labels?.[labelKey] === labelValue);
  return s?.value ?? null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ title, colors }: { title: string; colors: ThemeColors }) {
  return (
    <Text style={[sectionHeaderStyle, { color: colors.textMuted }]}>
      {title.toUpperCase()}
    </Text>
  );
}

const sectionHeaderStyle = {
  fontSize: Typography.xs,
  fontWeight: '600' as const,
  letterSpacing: 0.8,
  paddingHorizontal: Spacing.sm,
  paddingBottom: Spacing.xs,
};

function StatRow({
  label,
  value,
  valueColor,
  last = false,
  colors,
}: {
  label: string;
  value: string | React.ReactNode;
  valueColor?: string;
  last?: boolean;
  colors: ThemeColors;
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
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: Spacing.md,
      borderBottomWidth: last ? 0 : 1,
      borderBottomColor: c.border,
    },
    label: { fontSize: Typography.base, color: c.textMuted, flex: 1 },
    value: { fontSize: Typography.base, color: c.textPrimary, fontWeight: '500', textAlign: 'right', flexShrink: 1, marginLeft: Spacing.sm },
  });
}

function Card({ children, colors }: { children: React.ReactNode; colors: ThemeColors }) {
  return (
    <View style={{
      backgroundColor: colors.bgSurface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    }}>
      {children}
    </View>
  );
}

function StatusBadge({ connected, colors }: { connected: boolean; colors: ThemeColors }) {
  const color = connected ? colors.success : colors.danger;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontSize: Typography.base, color, fontWeight: '500' }}>
        {connected ? 'Connected' : 'Disconnected'}
      </Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function OverviewScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [appState, setAppState]   = useState<AppState | null>(null);
  const [kpis, setKpis]           = useState<Record<string, KpiMetric> | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [state, metrics] = await Promise.all([getApplicationState(), getKpis()]);
      setAppState(state);
      setKpis(metrics);
    } catch {
      setError('Could not load stats. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetch(); }, [fetch]));

  useEffect(() => {
    const interval = setInterval(() => fetch(true), 15_000);
    return () => clearInterval(interval);
  }, [fetch]);

  if (loading && !appState) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (error && !appState) {
    return (
      <View style={s.center}>
        <Ionicons name="alert-circle-outline" size={40} color={colors.danger} />
        <Text style={s.errorText}>{error}</Text>
      </View>
    );
  }

  const cpu    = sampleValue(kpis?.system_runtime_cpu_usage);
  const ws     = sampleValue(kpis?.process_working_set_bytes);
  const managed = sampleValue(kpis?.dotnet_total_memory_bytes);
  const diskFree = sampleValueByLabel(kpis?.node_filesystem_avail_bytes, 'mountpoint', '/')
                ?? sampleValue(kpis?.node_filesystem_avail_bytes);
  const tcpConn = sampleValue(kpis?.system_net_sockets_established_total);

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); fetch(); }}
          tintColor={colors.accent}
        />
      }
    >
      {/* Server */}
      <SectionHeader title="Server" colors={colors} />
      <Card colors={colors}>
        <StatRow
          label="Connection"
          value={<StatusBadge connected={appState?.server.isConnected ?? false} colors={colors} />}
          colors={colors}
        />
        {appState?.user.username ? (
          <StatRow label="Account" value={appState.user.username} colors={colors} />
        ) : null}
        {appState?.server.address ? (
          <StatRow label="Address" value={appState.server.address} colors={colors} />
        ) : null}
        {appState?.user.privileges.isPrivileged ? (
          <StatRow
            label="Privileges"
            value={fmtPrivileges(appState.user.privileges.privilegesRemaining)}
            valueColor={colors.success}
            colors={colors}
            last
          />
        ) : (
          <StatRow label="Privileges" value="None" valueColor={colors.textMuted} colors={colors} last />
        )}
      </Card>

      {/* Shares */}
      <SectionHeader title="Library" colors={colors} />
      <Card colors={colors}>
        <StatRow
          label="Directories"
          value={fmtNum(appState?.shares.directories ?? 0)}
          colors={colors}
        />
        <StatRow
          label="Files"
          value={fmtNum(appState?.shares.files ?? 0)}
          colors={colors}
        />
        <StatRow
          label="Scan"
          value={
            appState?.shares.scanning    ? 'Scanning…'  :
            appState?.shares.scanPending ? 'Pending'    :
            appState?.shares.faulted     ? 'Faulted'    :
            appState?.shares.ready       ? 'Ready'      : 'Unknown'
          }
          valueColor={
            appState?.shares.scanning    ? colors.warning  :
            appState?.shares.faulted     ? colors.danger   :
            appState?.shares.ready       ? colors.success  : colors.textMuted
          }
          colors={colors}
          last
        />
      </Card>

      {/* System Resources */}
      <SectionHeader title="System" colors={colors} />
      <Card colors={colors}>
        {cpu !== null && (
          <StatRow
            label="CPU"
            value={`${(cpu * 100).toFixed(1)}%`}
            colors={colors}
          />
        )}
        {ws !== null && (
          <StatRow label="Working Set" value={fmtBytes(ws)} colors={colors} />
        )}
        {managed !== null && (
          <StatRow label="Managed Heap" value={fmtBytes(managed)} colors={colors} />
        )}
        {tcpConn !== null && (
          <StatRow label="TCP Connections" value={fmtNum(tcpConn)} colors={colors} />
        )}
        {diskFree !== null && (
          <StatRow label="Disk Free" value={fmtBytes(diskFree)} colors={colors} last />
        )}
        {cpu === null && ws === null && managed === null && diskFree === null && (
          <StatRow label="Metrics" value="Unavailable" valueColor={colors.textMuted} colors={colors} last />
        )}
      </Card>

      {/* Version */}
      <SectionHeader title="Version" colors={colors} />
      <Card colors={colors}>
        <StatRow label="Running" value={appState?.version.current ?? '—'} colors={colors} />
        {appState?.version.isUpdateAvailable && appState.version.latest ? (
          <StatRow
            label="Update Available"
            value={appState.version.latest}
            valueColor={colors.warning}
            colors={colors}
            last
          />
        ) : (
          <StatRow label="Up to date" value="Yes" valueColor={colors.success} colors={colors} last />
        )}
      </Card>
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll:     { flex: 1, backgroundColor: c.bgPrimary },
    container:  { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxl },
    center:     { flex: 1, backgroundColor: c.bgPrimary, justifyContent: 'center', alignItems: 'center', gap: Spacing.md },
    errorText:  { fontSize: Typography.base, color: c.textMuted, textAlign: 'center', paddingHorizontal: Spacing.xl },
  });
}
