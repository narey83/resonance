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

// Basic connection/server/disk status — open to every signed-in user, matching
// the backend's own permission boundary (GET /application is
// [Authorize(Policy = AuthPolicy.Any)], unlike the admin-only analytics in
// OverviewScreen). Split out of Overview so that screen could become
// admin-only without hiding this from everyone.
//
// The screen is built around *two separate connections* that users kept
// confusing, because the old layout listed them as sibling "Session"/"Server"
// tile grids:
//
//   phone ──hop A──> Resonance server ──hop B──> Soulseek network
//
// Hop A (this app ⇄ Resonance) is the phone's own HTTP link and is owned by
// connectionMonitor, which already pings the server app-wide — reused here
// rather than timing our own request. Hop B (Resonance ⇄ Soulseek) is the
// backend's socket to the Soulseek server and only /application knows about
// it. Either can be down while the other is fine, so the chain diagram gives
// each hop its own rail, colour and live packet, and every detail tile below
// belongs to exactly one hop.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { useDeferredFocusEffect } from '../../hooks/useDeferredEffect';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, Typography, ThemeColors } from '../../theme';
import { getApplicationState, AppState } from '../../api/application';
import { useConnectionStore } from '../../services/connectionMonitor';
import { useAuthStore } from '../../store/auth';
import { fmtBytes, fmtDate, fmtNum, fmtSpeed, Card, SectionHeader, StatRow, StatTileGrid, TravellingPacket } from '../../components/overview/shared';

const NODE     = 44;   // node circle diameter
const GUTTER   = 56;   // width of the rail column the nodes/links sit in
const LINK_H   = 66;   // height of a connector between two nodes
const PACKET_H = 20;   // travelling "data" streak
const RING     = 116;  // disk gauge diameter
const RING_W   = 11;

// The Soulseek server reports privileges as seconds remaining (protocol
// CheckPrivileges), not days. Render the largest sensible unit.
function fmtPrivileges(seconds: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} remaining`;
  if (seconds >= 86_400) return plural(Math.floor(seconds / 86_400), 'day');
  if (seconds >= 3_600) return plural(Math.floor(seconds / 3_600), 'hour');
  if (seconds >= 60) return plural(Math.floor(seconds / 60), 'minute');
  return plural(seconds, 'second');
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

// ── Chain diagram ───────────────────────────────────────────────────────────

function ChainNode({ icon, title, sub, color, colors }: {
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
function ChainLink({ title, status, chips, color, live, colors }: {
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
      <View style={[s.gutter, { height: LINK_H }]}>
        <View style={[s.rail, { backgroundColor: color + (live ? '44' : '99') }]} />
        <TravellingPacket
          live={live}
          distance={LINK_H - PACKET_H}
          length={PACKET_H}
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
    gutter:    { width: GUTTER, alignItems: 'center', justifyContent: 'center' },
    node:      { width: NODE, height: NODE, borderRadius: NODE / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    nodeText:  { flex: 1, paddingRight: Spacing.sm },
    nodeTitle: { fontSize: Typography.md, fontWeight: '700', color: c.textPrimary },
    nodeSub:   { fontSize: Typography.sm, color: c.textMuted },
    // Left is pinned rather than left to alignItems: an absolutely positioned
    // child's static position is easy to get wrong across platforms, and the
    // rail has to line up with the node circles above and below it to the pixel.
    rail:      { position: 'absolute', top: 0, bottom: 0, left: (GUTTER - 3) / 2, width: 3, borderRadius: Radius.full },
    packet:    { left: (GUTTER - 3) / 2 },
    hop:       { flex: 1, paddingRight: Spacing.sm, paddingVertical: Spacing.xs, gap: 3 },
    hopTitle:  { fontSize: Typography.xs, color: c.textMuted, fontWeight: '600', letterSpacing: 0.8 },
    hopStatus: { fontSize: Typography.base, fontWeight: '600' },
    chipRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: 2 },
    chip:      { borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 1 },
    chipText:  { fontSize: Typography.xs, fontWeight: '600', fontVariant: ['tabular-nums'] },
  });
}

// ── Download folder gauge ───────────────────────────────────────────────────

function DiskGauge({ disk, colors }: { disk: NonNullable<AppState['disk']>; colors: ThemeColors }) {
  const s = useMemo(() => makeDiskStyles(colors), [colors]);
  const used     = Math.max(0, disk.totalBytes - disk.availableBytes);
  const usedFrac = disk.totalBytes > 0 ? Math.min(1, used / disk.totalBytes) : 0;
  const freeFrac = 1 - usedFrac;
  const color = disk.downloadsBlocked || freeFrac < 0.05 ? colors.danger
              : freeFrac < 0.15 ? colors.warning
              : colors.success;

  const r = (RING - RING_W) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <Card colors={colors}>
      <View style={s.gaugeRow}>
        <View>
          <Svg width={RING} height={RING}>
            <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={colors.bgElevated} strokeWidth={RING_W} fill="none" />
            <Circle
              cx={RING / 2}
              cy={RING / 2}
              r={r}
              stroke={color}
              strokeWidth={RING_W}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - usedFrac)}
              fill="none"
              // Start at 12 o'clock and sweep clockwise, like the player ring.
              transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
          </Svg>
          <View style={s.gaugeCentre} pointerEvents="none">
            <Text style={s.gaugeValue} numberOfLines={1}>{fmtBytes(disk.availableBytes)}</Text>
            <Text style={s.gaugeCaption}>free</Text>
          </View>
        </View>
        <View style={s.gaugeStats}>
          <StatRow label="Used"  value={`${fmtBytes(used)} (${(usedFrac * 100).toFixed(0)}%)`} colors={colors} />
          <StatRow label="Total" value={fmtBytes(disk.totalBytes)} colors={colors} />
          <StatRow
            label="Downloads"
            value={disk.downloadsBlocked ? 'Blocked' : 'Allowed'}
            valueColor={disk.downloadsBlocked ? colors.danger : colors.success}
            colors={colors}
            last
          />
        </View>
      </View>
      {disk.downloadsBlocked && (
        <Text style={s.blockedNote}>
          Free space is below the configured minimum — new downloads are being rejected.
        </Text>
      )}
    </Card>
  );
}

function makeDiskStyles(c: ThemeColors) {
  return StyleSheet.create({
    gaugeRow:     { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: Spacing.md },
    gaugeCentre:  { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    gaugeValue:   { fontSize: Typography.lg, fontWeight: '700', color: c.textPrimary },
    gaugeCaption: { fontSize: Typography.xs, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    gaugeStats:   { flex: 1 },
    blockedNote:  {
      fontSize: Typography.sm,
      color: c.danger,
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.md,
    },
  });
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function ConnectionScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { serverUrl, sessionId, role, tokenExpiresAt } = useAuthStore();
  const { status: linkStatus, latencyMs, lastError, isCellular } = useConnectionStore();

  const [appState, setAppState]     = useState<AppState | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      setAppState(await getApplicationState());
    } catch {
      setError('Could not load server status.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useDeferredFocusEffect(useCallback(() => { fetch(); }, [fetch]));

  useEffect(() => {
    const interval = setInterval(() => fetch(true), 15_000);
    return () => clearInterval(interval);
  }, [fetch]);

  const { host, secure } = parseServerUrl(serverUrl);

  // Hop A — this app ⇄ Resonance. connectionMonitor is the authority: it
  // separates "device has no network" (offline) from "server not answering"
  // (down), which the tiles alone could never distinguish.
  const appUp     = linkStatus === 'connected' || linkStatus === 'slow';
  const appColor  = linkStatus === 'connected' ? colors.success
                  : linkStatus === 'slow'      ? colors.warning
                  : colors.danger;
  const appStatus = linkStatus === 'connected' ? 'Connected'
                  : linkStatus === 'slow'      ? 'Connected, slow'
                  : linkStatus === 'offline'   ? 'This device is offline'
                  : 'Server unreachable';

  // Hop B — Resonance ⇄ Soulseek. Unknown until /application answers, which is
  // itself only possible when hop A is up.
  const srv       = appState?.server;
  const slUp      = !!srv?.isLoggedIn;
  const slPending = !!srv && !srv.isLoggedIn && (srv.isConnecting || srv.isTransitioning || !!appState?.connectionWatchdog?.isAttemptingConnection);
  const slColor   = !srv ? colors.textMuted : slUp ? colors.success : slPending ? colors.warning : colors.danger;
  const slStatus  = !srv      ? 'Unknown'
                  : slUp      ? 'Signed in'
                  : slPending ? 'Connecting…'
                  : 'Disconnected';

  const searchLatency = appState?.health?.search.incoming.latency;
  const nextAttempt   = appState?.connectionWatchdog?.nextAttemptAt;

  const appChips = [
    latencyMs !== null ? `${latencyMs} ms` : null,
    secure ? 'HTTPS' : 'HTTP',
    linkStatus === 'offline' ? 'No network' : isCellular ? 'Cellular' : 'Wi-Fi',
    !appUp && lastError ? lastError : null,
  ].filter(Boolean) as string[];

  const slChips = [
    srv?.state ?? null,
    slUp && searchLatency !== undefined ? `${searchLatency.toFixed(0)} ms search` : null,
    appState?.upnp?.isMapped && appState.upnp.mappedPort ? `Port ${appState.upnp.mappedPort}` : null,
    !slUp && nextAttempt ? `Retry ${fmtDate(nextAttempt)}` : null,
  ].filter(Boolean) as string[];

  // Only block on a spinner during a genuine cold load. If the link is down
  // there is nothing to wait for — the chain itself is the answer.
  if (loading && !appState && appUp) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetch(); }} tintColor={colors.accent} />}
    >
      <Card colors={colors}>
        <View style={s.chain}>
          <ChainNode
            icon="phone-portrait-outline"
            title="This device"
            sub={role ? `Signed in as ${role.toLowerCase()}` : 'Mobile app'}
            color={linkStatus === 'offline' ? colors.danger : colors.accent}
            colors={colors}
          />
          <ChainLink
            title="APP CONNECTION"
            status={appStatus}
            chips={appChips}
            color={appColor}
            live={appUp}
            colors={colors}
          />
          <ChainNode
            icon="server-outline"
            title="Resonance"
            sub={host}
            color={appUp ? appColor : colors.danger}
            colors={colors}
          />
          <ChainLink
            title="SOULSEEK CONNECTION"
            status={slStatus}
            chips={slChips}
            color={slColor}
            live={slUp}
            colors={colors}
          />
          <ChainNode
            icon="globe-outline"
            title="Soulseek"
            sub={srv?.address ?? 'Not connected'}
            color={slColor}
            colors={colors}
          />
        </View>
        {error && <Text style={s.cardError}>{error}</Text>}
      </Card>

      <SectionHeader title="App Connection" colors={colors} />
      <StatTileGrid
        colors={colors}
        tiles={[
          { key: 'host', label: 'Server', value: host },
          {
            key: 'secure',
            label: 'Transport',
            value: secure ? 'HTTPS' : 'HTTP',
            valueColor: secure ? colors.success : colors.danger,
            sub: secure ? 'Certificate verified by OS' : 'Traffic is not encrypted',
          },
          {
            key: 'latency',
            label: 'Round Trip',
            value: latencyMs !== null ? `${latencyMs} ms` : '—',
            valueColor: appColor,
            sub: linkStatus === 'offline' ? 'Device offline' : isCellular ? 'Over cellular' : 'Over Wi-Fi',
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

      <SectionHeader title="Soulseek Connection" colors={colors} />
      <StatTileGrid
        colors={colors}
        tiles={[
          { key: 'state', label: 'Status', value: slStatus, valueColor: slColor },
          ...(appState?.user.username ? [{ key: 'account', label: 'Account', value: appState.user.username, sub: appState.user.presence }] : []),
          ...(srv?.address ? [{ key: 'address', label: 'Server', value: srv.address, sub: srv.ipEndPoint ?? undefined }] : []),
          {
            key: 'privileges',
            label: 'Privileges',
            value: appState?.user.privileges.isPrivileged
              ? fmtPrivileges(appState.user.privileges.privilegesRemaining)
              : 'None',
            valueColor: appState?.user.privileges.isPrivileged ? colors.success : colors.textMuted,
          },
          {
            key: 'port',
            label: 'Listening Port',
            value: appState?.upnp?.mappedPort ? String(appState.upnp.mappedPort) : '—',
            valueColor: appState?.upnp?.isMapped ? colors.success : colors.textMuted,
            sub: appState?.upnp?.isMapped ? 'Mapped via UPnP' : appState?.upnp?.isEnabled ? 'Not mapped' : 'UPnP disabled',
          },
          ...(appState?.distributedNetwork ? [{
            key: 'distributed',
            label: 'Distributed',
            value: appState.distributedNetwork.hasParent ? `Level ${appState.distributedNetwork.branchLevel}` : 'No parent',
            valueColor: appState.distributedNetwork.hasParent ? colors.textPrimary : colors.warning,
            sub: appState.distributedNetwork.parent ? `via ${appState.distributedNetwork.parent}` : undefined,
          }] : []),
          ...(appState?.user.statistics ? [{
            key: 'speed',
            label: 'Average Speed',
            value: fmtSpeed(appState.user.statistics.averageSpeed),
            sub: 'Reported to peers',
          }] : []),
        ]}
      />

      <SectionHeader title="Download Folder" colors={colors} />
      {appState?.disk && appState.disk.totalBytes > 0 ? (
        <DiskGauge disk={appState.disk} colors={colors} />
      ) : (
        <Card colors={colors}>
          <StatRow label="Free space" value="Unavailable" valueColor={colors.textMuted} colors={colors} last />
        </Card>
      )}

      <SectionHeader title="Shared Library" colors={colors} />
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
    chain:     { paddingVertical: Spacing.md, paddingRight: Spacing.sm },
    cardError: { fontSize: Typography.sm, color: c.danger, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
  });
}
