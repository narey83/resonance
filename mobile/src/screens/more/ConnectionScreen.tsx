// <copyright file="ConnectionScreen.tsx" company="John Narey">
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

// Basic connection/server/system status — open to every signed-in user,
// matching the backend's own permission boundary (GET /application and
// GET /telemetry/metrics/kpis are both [Authorize(Policy = AuthPolicy.Any)],
// unlike the admin-only analytics in OverviewScreen). Split out of Overview
// so that screen could become admin-only without hiding this from everyone.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../context/ThemeContext';
import { Spacing, Typography, ThemeColors } from '../../theme';
import { getApplicationState, getKpis, AppState, KpiMetric } from '../../api/application';
import { useAuthStore } from '../../store/auth';
import { fmtBytes, fmtDate, fmtNum, SectionHeader, StatTileGrid } from '../../components/overview/shared';

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

function sampleValueByLabel(metric: KpiMetric | undefined, labelKey: string, labelValue: string): number | null {
  if (!metric?.samples) return null;
  const s = metric.samples.find((s) => s.labels?.[labelKey] === labelValue);
  return s?.value ?? null;
}

// Strips the scheme for display and reports whether it was https — a
// successful request over https from React Native's networking stack
// already implies the OS validated the certificate chain (untrusted/expired
// certs fail the request outright), so this doubles as a basic SSL check
// without needing a native TLS-inspection module.
function parseServerUrl(url: string | null): { host: string; secure: boolean } {
  if (!url) return { host: '—', secure: false };
  const secure = url.startsWith('https://');
  const host = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return { host, secure };
}

export default function ConnectionScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { serverUrl, sessionId, role, tokenExpiresAt } = useAuthStore();

  const [appState, setAppState]     = useState<AppState | null>(null);
  const [kpis, setKpis]             = useState<Record<string, KpiMetric> | null>(null);
  const [latencyMs, setLatencyMs]   = useState<number | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    const startedAt = Date.now();
    try {
      const [state, metrics] = await Promise.all([getApplicationState(), getKpis()]);
      setLatencyMs(Date.now() - startedAt);
      setAppState(state);
      setKpis(metrics);
    } catch {
      setLatencyMs(null);
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

  const cpu = sampleValue(kpis?.system_runtime_cpu_usage);
  const ws = sampleValue(kpis?.process_working_set_bytes);
  const managed = sampleValue(kpis?.dotnet_total_memory_bytes);
  const diskFree = sampleValueByLabel(kpis?.node_filesystem_avail_bytes, 'mountpoint', '/')
                ?? sampleValue(kpis?.node_filesystem_avail_bytes);
  const tcpConn = sampleValue(kpis?.system_net_sockets_established_total);

  const { host, secure } = parseServerUrl(serverUrl);
  const latencyColor = latencyMs === null ? colors.textMuted : latencyMs < 300 ? colors.success : latencyMs < 1000 ? colors.warning : colors.danger;

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetch(); }} tintColor={colors.accent} />}
    >
      <SectionHeader title="Session" colors={colors} />
      <StatTileGrid
        colors={colors}
        tiles={[
          { key: 'host', label: 'Connected To', value: host },
          {
            key: 'secure',
            label: 'Security',
            value: secure ? 'Secure (HTTPS)' : 'Insecure (HTTP)',
            valueColor: secure ? colors.success : colors.danger,
            sub: secure ? 'Certificate verified by OS' : 'Traffic is not encrypted',
          },
          {
            key: 'latency',
            label: 'Latency',
            value: latencyMs !== null ? `${latencyMs} ms` : '—',
            valueColor: latencyColor,
          },
          { key: 'role', label: 'Role', value: role ?? '—' },
          ...(sessionId ? [{ key: 'session', label: 'Session ID', value: `${sessionId.slice(0, 8)}…` }] : []),
          {
            key: 'expires',
            label: 'Token Expires',
            value: tokenExpiresAt ? fmtDate(new Date(tokenExpiresAt).toISOString()) : '—',
          },
        ]}
      />

      <SectionHeader title="Server" colors={colors} />
      <StatTileGrid
        colors={colors}
        tiles={[
          {
            key: 'connection',
            label: 'Connection',
            value: appState?.server.isConnected ? 'Connected' : 'Disconnected',
            valueColor: appState?.server.isConnected ? colors.success : colors.danger,
          },
          ...(appState?.user.username ? [{ key: 'account', label: 'Account', value: appState.user.username }] : []),
          ...(appState?.server.address ? [{ key: 'address', label: 'Address', value: appState.server.address }] : []),
          appState?.user.privileges.isPrivileged
            ? { key: 'privileges', label: 'Privileges', value: fmtPrivileges(appState.user.privileges.privilegesRemaining), valueColor: colors.success }
            : { key: 'privileges', label: 'Privileges', value: 'None', valueColor: colors.textMuted },
        ]}
      />

      <SectionHeader title="Library" colors={colors} />
      <StatTileGrid
        colors={colors}
        tiles={[
          { key: 'directories', label: 'Directories', value: fmtNum(appState?.shares.directories ?? 0) },
          { key: 'files', label: 'Files', value: fmtNum(appState?.shares.files ?? 0) },
          {
            key: 'scan',
            label: 'Scan',
            value:
              appState?.shares.scanning    ? 'Scanning…'  :
              appState?.shares.scanPending ? 'Pending'    :
              appState?.shares.faulted     ? 'Faulted'    :
              appState?.shares.ready       ? 'Ready'      : 'Unknown',
            valueColor:
              appState?.shares.scanning    ? colors.warning  :
              appState?.shares.faulted     ? colors.danger   :
              appState?.shares.ready       ? colors.success  : colors.textMuted,
          },
        ]}
      />

      <SectionHeader title="System" colors={colors} />
      <StatTileGrid
        colors={colors}
        tiles={
          cpu === null && ws === null && managed === null && diskFree === null
            ? [{ key: 'metrics', label: 'Metrics', value: 'Unavailable', valueColor: colors.textMuted }]
            : [
                ...(cpu !== null ? [{ key: 'cpu', label: 'CPU', value: `${(cpu * 100).toFixed(1)}%` }] : []),
                ...(ws !== null ? [{ key: 'ws', label: 'Working Set', value: fmtBytes(ws) }] : []),
                ...(managed !== null ? [{ key: 'managed', label: 'Managed Heap', value: fmtBytes(managed) }] : []),
                ...(tcpConn !== null ? [{ key: 'tcp', label: 'TCP Connections', value: fmtNum(tcpConn) }] : []),
                ...(diskFree !== null ? [{ key: 'disk', label: 'Disk Free', value: fmtBytes(diskFree) }] : []),
              ]
        }
      />

      <SectionHeader title="Version" colors={colors} />
      <StatTileGrid
        colors={colors}
        tiles={[
          { key: 'running', label: 'Running', value: appState?.version.current ?? '—' },
          appState?.version.isUpdateAvailable && appState.version.latest
            ? { key: 'update', label: 'Update Available', value: appState.version.latest, valueColor: colors.warning }
            : { key: 'update', label: 'Up To Date', value: 'Yes', valueColor: colors.success },
        ]}
      />
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll:    { flex: 1, backgroundColor: c.bgPrimary },
    container: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxl },
    center:    { flex: 1, backgroundColor: c.bgPrimary, justifyContent: 'center', alignItems: 'center', gap: Spacing.md },
    errorText: { fontSize: Typography.base, color: c.textMuted, textAlign: 'center', paddingHorizontal: Spacing.xl },
  });
}
