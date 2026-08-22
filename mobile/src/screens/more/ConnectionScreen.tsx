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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useDeferredFocusEffect } from '../../hooks/useDeferredEffect';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, Typography, ThemeColors } from '../../theme';
import { getApplicationState, AppState } from '../../api/application';
import {
  connectToSoulseek,
  deleteSoulseekPicture,
  disconnectFromSoulseek,
  getSoulseekStatus,
  setSoulseekStatus,
  soulseekPictureUrl,
  uploadSoulseekPicture,
  SoulseekStatus,
} from '../../api/server';
import { useConnectionStore } from '../../services/connectionMonitor';
import { useAuthStore } from '../../store/auth';
import { fmtBytes, fmtDate, fmtNum, fmtSpeed, Card, SectionHeader, StatRow, StatTileData } from '../../components/overview/shared';

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

// One stat per row rather than the 2-up tile grid used elsewhere — this
// screen packs enough numbers (round trip, transport, ports, privileges…)
// that pairing them side by side made them hard to scan at a glance.
function InfoList({ items, colors }: { items: StatTileData[]; colors: ThemeColors }) {
  return (
    <Card colors={colors}>
      {items.map((t, i) => (
        <StatRow
          key={t.key}
          label={t.label}
          value={t.value}
          valueColor={t.valueColor}
          sub={typeof t.sub === 'string' ? t.sub : undefined}
          colors={colors}
          last={i === items.length - 1}
        />
      ))}
    </Card>
  );
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
  const { serverUrl, sessionId, role, isAdmin, tokenExpiresAt } = useAuthStore();
  const { status: linkStatus, latencyMs, lastError, isCellular } = useConnectionStore();

  const [appState, setAppState]     = useState<AppState | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [serverActionBusy, setServerActionBusy] = useState(false);

  const [profile, setProfile]             = useState<SoulseekStatus | null>(null);
  const [descDraft, setDescDraft]         = useState('');
  const [savingDesc, setSavingDesc]       = useState(false);
  const [pictureVersion, setPictureVersion] = useState(0);
  const [uploadingPicture, setUploadingPicture] = useState(false);
  // Only seed the tagline draft from the server once — every 15s poll below
  // would otherwise stomp on text the user is mid-edit on.
  const descSeededRef = useRef(false);

  const fetch = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    const [appResult, profileResult] = await Promise.allSettled([
      getApplicationState(),
      getSoulseekStatus(),
    ]);
    if (appResult.status === 'fulfilled') {
      setAppState(appResult.value);
    } else {
      setError('Could not load server status.');
    }
    if (profileResult.status === 'fulfilled') {
      setProfile(profileResult.value);
      if (!descSeededRef.current) {
        setDescDraft(profileResult.value.description ?? '');
        descSeededRef.current = true;
      }
    }
    setLoading(false);
    setRefreshing(false);
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

  const handleSignIn = useCallback(async () => {
    setServerActionBusy(true);
    try {
      await connectToSoulseek();
      await fetch(true);
    } catch {
      Alert.alert('Error', 'Could not connect to the Soulseek network.');
    } finally {
      setServerActionBusy(false);
    }
  }, [fetch]);

  const handleSignOut = useCallback(() => {
    Alert.alert(
      'Sign out of Soulseek?',
      'This disconnects from the Soulseek network and stops reconnect attempts. Active transfers will be interrupted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setServerActionBusy(true);
            try {
              await disconnectFromSoulseek();
              await fetch(true);
            } catch {
              Alert.alert('Error', 'Could not disconnect from the Soulseek network.');
            } finally {
              setServerActionBusy(false);
            }
          },
        },
      ],
    );
  }, [fetch]);

  const handlePickPicture = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.92,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;

    setUploadingPicture(true);
    try {
      await uploadSoulseekPicture(result.assets[0].uri);
      setPictureVersion(v => v + 1);
      setProfile(p => (p ? { ...p, hasPicture: true } : p));
    } catch {
      Alert.alert('Error', 'Could not upload your profile photo.');
    } finally {
      setUploadingPicture(false);
    }
  }, []);

  const handleRemovePicture = useCallback(() => {
    Alert.alert(
      'Remove profile photo?',
      'Peers will no longer see a picture for your Soulseek account.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setUploadingPicture(true);
            try {
              await deleteSoulseekPicture();
              setPictureVersion(v => v + 1);
              setProfile(p => (p ? { ...p, hasPicture: false } : p));
            } catch {
              Alert.alert('Error', 'Could not remove your profile photo.');
            } finally {
              setUploadingPicture(false);
            }
          },
        },
      ],
    );
  }, []);

  const handleSaveDescription = useCallback(async () => {
    setSavingDesc(true);
    try {
      const updated = await setSoulseekStatus({ description: descDraft });
      setProfile(updated);
    } catch {
      Alert.alert('Error', 'Could not save your tagline.');
    } finally {
      setSavingDesc(false);
    }
  }, [descDraft]);

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
        <View style={s.chainRow}>
          <View style={s.chainNode}>
            <View style={[s.chainDot, { borderColor: linkStatus === 'offline' ? colors.danger : colors.accent, backgroundColor: (linkStatus === 'offline' ? colors.danger : colors.accent) + '1f' }]}>
              <Ionicons name="phone-portrait-outline" size={16} color={linkStatus === 'offline' ? colors.danger : colors.accent} />
            </View>
            <Text style={s.chainNodeLabel} numberOfLines={1}>This device</Text>
          </View>
          <View style={[s.chainRail, { backgroundColor: appColor + (appUp ? '44' : '99') }]} />
          <View style={s.chainNode}>
            <View style={[s.chainDot, { borderColor: appUp ? appColor : colors.danger, backgroundColor: (appUp ? appColor : colors.danger) + '1f' }]}>
              <Ionicons name="server-outline" size={16} color={appUp ? appColor : colors.danger} />
            </View>
            <Text style={s.chainNodeLabel} numberOfLines={1}>Resonance</Text>
          </View>
          <View style={[s.chainRail, { backgroundColor: slColor + (slUp ? '44' : '99') }]} />
          <View style={s.chainNode}>
            <View style={[s.chainDot, { borderColor: slColor, backgroundColor: slColor + '1f' }]}>
              <Ionicons name="globe-outline" size={16} color={slColor} />
            </View>
            <Text style={s.chainNodeLabel} numberOfLines={1}>Soulseek</Text>
          </View>
        </View>

        <View style={s.hopBlock}>
          <View style={s.hopHeadRow}>
            <Text style={s.hopLabel}>App</Text>
            <Text style={[s.hopStatus, { color: appColor }]} numberOfLines={1}>{appStatus}</Text>
          </View>
          {appChips.length > 0 && (
            <View style={s.chipRow}>
              {appChips.map(c => (
                <View key={c} style={[s.chip, { borderColor: appColor + '55', backgroundColor: appColor + '14' }]}>
                  <Text style={[s.chipText, { color: appColor }]} numberOfLines={1}>{c}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={[s.hopBlock, s.hopBlockLast]}>
          <View style={s.hopHeadRow}>
            <Text style={s.hopLabel}>Soulseek</Text>
            <Text style={[s.hopStatus, { color: slColor }]} numberOfLines={1}>{slStatus}</Text>
          </View>
          {slChips.length > 0 && (
            <View style={s.chipRow}>
              {slChips.map(c => (
                <View key={c} style={[s.chip, { borderColor: slColor + '55', backgroundColor: slColor + '14' }]}>
                  <Text style={[s.chipText, { color: slColor }]} numberOfLines={1}>{c}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        {error && <Text style={s.cardError}>{error}</Text>}
      </Card>

      <Pressable
        onPress={slUp ? handleSignOut : handleSignIn}
        disabled={serverActionBusy || slPending}
        style={({ pressed }) => [
          s.soulseekActionBtn,
          { borderColor: slUp ? colors.danger : colors.border },
          pressed && s.soulseekActionBtnPressed,
        ]}
      >
        {serverActionBusy || slPending ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : (
          <Text style={[s.soulseekActionText, { color: slUp ? colors.danger : colors.accent }]}>
            {slUp ? 'Sign Out of Soulseek' : 'Sign In to Soulseek'}
          </Text>
        )}
      </Pressable>

      <SectionHeader title="App Connection" colors={colors} />
      <InfoList
        colors={colors}
        items={[
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
      <InfoList
        colors={colors}
        items={[
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

      <SectionHeader title="Soulseek Profile" colors={colors} />
      <Card colors={colors}>
        <View style={s.profileRow}>
          <Pressable
            onPress={isAdmin ? handlePickPicture : undefined}
            disabled={!isAdmin || uploadingPicture}
            style={s.avatarWrap}
          >
            {profile?.hasPicture ? (
              <Image
                source={{ uri: soulseekPictureUrl(serverUrl, pictureVersion) ?? undefined }}
                style={s.avatarImg}
              />
            ) : (
              // Matches the web UI's ResonanceMark fallback (frontend/src/components/Shared/ResonanceMark.jsx)
              // rather than an initial-letter avatar, so "no picture set" looks the same on both.
              <View style={[s.avatarImg, s.avatarPlaceholder]}>
                <Svg fill="none" height={28} viewBox="0 0 24 24" width={28}>
                  <Circle cx="12" cy="12" r="8" stroke={colors.textMuted} strokeWidth="2" />
                  <Path
                    d="M4 12 C6 6.5 10 6.5 12 12 C14 17.5 18 17.5 20 12"
                    stroke={colors.textMuted}
                    strokeLinecap="round"
                    strokeWidth="2"
                  />
                </Svg>
              </View>
            )}
            {isAdmin && (
              <View style={s.avatarBadge}>
                {uploadingPicture ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="camera" size={12} color="#fff" />
                )}
              </View>
            )}
          </Pressable>

          <View style={s.profileInfo}>
            <Text style={s.profileUsername} numberOfLines={1}>{appState?.user.username ?? '—'}</Text>
            {isAdmin ? (
              profile?.hasPicture && (
                <Pressable onPress={handleRemovePicture} disabled={uploadingPicture}>
                  <Text style={s.removePictureText}>Remove photo</Text>
                </Pressable>
              )
            ) : (
              <Text style={s.profileHint}>Only administrators can change the photo or tagline</Text>
            )}
          </View>
        </View>

        <View style={s.taglineBlock}>
          <Text style={s.hopLabel}>Tagline</Text>
          {isAdmin ? (
            <View style={s.taglineEditRow}>
              <TextInput
                style={s.taglineInput}
                value={descDraft}
                onChangeText={setDescDraft}
                placeholder="What are you up to?"
                placeholderTextColor={colors.textDim}
                maxLength={120}
              />
              <Pressable
                onPress={handleSaveDescription}
                disabled={savingDesc || descDraft === (profile?.description ?? '')}
                style={s.taglineSaveBtn}
              >
                {savingDesc ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Ionicons
                    name="checkmark"
                    size={18}
                    color={descDraft === (profile?.description ?? '') ? colors.textDim : colors.accent}
                  />
                )}
              </Pressable>
            </View>
          ) : (
            <Text style={s.taglineText}>{profile?.description || 'No tagline set'}</Text>
          )}
        </View>
      </Card>

      <SectionHeader title="Download Folder" colors={colors} />
      {appState?.disk && appState.disk.totalBytes > 0 ? (
        <DiskGauge disk={appState.disk} colors={colors} />
      ) : (
        <Card colors={colors}>
          <StatRow label="Free space" value="Unavailable" valueColor={colors.textMuted} colors={colors} last />
        </Card>
      )}

      <SectionHeader title="Shared Library" colors={colors} />
      <InfoList
        colors={colors}
        items={[
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
      <InfoList
        colors={colors}
        items={[
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
    cardError: { fontSize: Typography.sm, color: c.danger, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },

    // Compact chain: three icon nodes joined by short rails in one row, with
    // each hop's status and detail chips given their own block below (the
    // full detail also lives in the tile sections further down).
    chainRow:       { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, paddingBottom: Spacing.sm },
    chainNode:      { alignItems: 'center', gap: 4 },
    chainDot:       { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    chainNodeLabel: { fontSize: Typography.xs, color: c.textMuted, maxWidth: 72 },
    chainRail:      { flex: 1, height: 2, marginHorizontal: Spacing.xs, borderRadius: Radius.full },
    hopBlock:       { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, gap: 6 },
    hopBlockLast:   { paddingBottom: Spacing.sm },
    hopHeadRow:     { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
    hopLabel:       { fontSize: Typography.xs, color: c.textMuted, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
    hopStatus:      { fontSize: Typography.base, fontWeight: '600', flexShrink: 1 },
    chipRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
    chip:           { borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
    chipText:       { fontSize: Typography.xs, fontWeight: '600', fontVariant: ['tabular-nums'] },

    soulseekActionBtn: {
      backgroundColor: c.bgSurface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      padding: Spacing.sm,
      alignItems: 'center',
    },
    soulseekActionBtnPressed: { opacity: 0.7 },
    soulseekActionText: { fontSize: Typography.base, fontWeight: '600' },

    // Soulseek profile: picture + tagline, editable only by admins (the
    // backend rejects both writes for anyone else).
    profileRow:       { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: Spacing.md },
    avatarWrap:       { width: 56, height: 56 },
    avatarImg:        { width: 56, height: 56, borderRadius: 28 },
    avatarPlaceholder: { backgroundColor: c.bgElevated, alignItems: 'center', justifyContent: 'center' },
    avatarBadge:      {
      position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11,
      backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: c.bgSurface,
    },
    profileInfo:        { flex: 1, gap: 4 },
    profileUsername:    { fontSize: Typography.md, fontWeight: '700', color: c.textPrimary },
    profileHint:        { fontSize: Typography.xs, color: c.textMuted },
    removePictureText:  { fontSize: Typography.xs, color: c.danger, fontWeight: '600' },
    taglineBlock:       { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, gap: 6 },
    taglineEditRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    taglineInput:       {
      flex: 1, fontSize: Typography.base, color: c.textPrimary, backgroundColor: c.bgElevated,
      borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 8,
    },
    taglineSaveBtn:     { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    taglineText:        { fontSize: Typography.base, color: c.textPrimary },
  });
}
