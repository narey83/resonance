// <copyright file="SettingsScreen.tsx" company="John Narey">
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

import { Text } from '../../components/Typography';
import { Editorial, Radius, Spacing, ThemeColors, Typography, themes } from '../../theme';

import { useRemoteAccess } from '../../lib/remoteAccess';
import React, { useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { floatingOverlay } from '../../native/floatingOverlay';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getDeviceName } from '../../store/auth';
import { useAppSettings } from '../../store/appSettingsStore';
import type { StreamQuality } from '../../store/appSettingsStore';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeName } from '../../theme';
import { ACCENT_OPTIONS } from '../../lib/appearance';
import type { MoreStackParamList } from '../../navigation/MainTabs';

type Props = NativeStackScreenProps<MoreStackParamList, 'Settings'>;

// ── Theme options ─────────────────────────────────────────────────────────────

const THEMES: { name: ThemeName; label: string; swatch: string; swatch2?: string }[] = [
  { name: 'dark',     label: 'Dark',     swatch: themes.dark.bgPrimary },
  { name: 'amoled',   label: 'Amoled',   swatch: themes.amoled.bgPrimary },
  { name: 'midnight', label: 'Midnight', swatch: themes.midnight.bgPrimary },
  { name: 'light',    label: 'Light',    swatch: themes.light.bgPrimary },
];

const STREAM_QUALITIES: { value: StreamQuality; label: string }[] = [
  { value: 'auto',     label: 'Auto' },
  { value: 'original', label: 'Original' },
  { value: 'saver',    label: 'Data saver' },
];

const STREAM_QUALITY_SUBTITLE: Record<StreamQuality, string> = {
  auto:     'Full quality on Wi-Fi, reduced on cellular to save data',
  original: 'Always stream the original file (best quality, seekable)',
  saver:    'Always transcode to a smaller size (uses least data)',
};

// ── Main screen ───────────────────────────────────────────────────────────────

export default function SettingsScreen({ navigation }: Props) {
  const { colors, palette, isDark } = useTheme();
  const remote = useRemoteAccess();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const {
    theme, setTheme, accentColour, setAccentColour,
    remoteLogging, loaded, setRemoteLogging,
    librarySyncDebug, setLibrarySyncDebug,
    perfProbe, setPerfProbe,
    backendLogs, setBackendLogs,
    streamQuality, setStreamQuality,
    playerMode, setPlayerMode,
    showTrackNumbers, setShowTrackNumbers,
  } = useAppSettings();

  const [deviceName, setDeviceName] = useState<string>('');

  useEffect(() => {
    if (remote) getDeviceName().then(setDeviceName);
  }, [remote]);

  return (
    <ScrollView contentContainerStyle={s.container} style={s.scroll}>

      {/* Appearance */}
      <SectionHeader title="Appearance" colors={colors} />
      <View style={s.group}>
        <SettingRow label="Match handset" subtitle={theme === 'system' ? `Follows your phone. Currently ${isDark ? 'dark' : 'light'}.` : 'Switch automatically with your phone’s light or dark mode.'} colors={colors}>
          <Switch accessibilityLabel="Match handset light and dark mode" disabled={!loaded} value={theme === 'system'} onValueChange={enabled => setTheme(enabled ? 'system' : palette)} thumbColor={colors.textPrimary} trackColor={{ false: colors.bgElevated, true: colors.accent }} />
        </SettingRow>
        <View style={s.themeRow}>
          <Text style={s.rowLabel}>Appearance</Text>
          <View style={s.swatchRow}>
            {THEMES.map(({ name, label, swatch, swatch2 }) => (
              <Pressable
                key={name}
                accessibilityRole="radio"
                accessibilityLabel={`${label} appearance`}
                accessibilityState={{ checked: theme === name, disabled: !loaded }}
                disabled={!loaded}
                onPress={() => setTheme(name)}
                style={[s.swatchBtn, theme === name && s.swatchBtnActive]}
              >
                {swatch2 ? (
                  // Split swatch for System/Auto
                  <View style={[s.swatch, s.swatchSplit]}>
                    <View style={{ flex: 1, backgroundColor: swatch }} />
                    <View style={{ flex: 1, backgroundColor: swatch2 }} />
                  </View>
                ) : (
                  <View style={[s.swatch, { backgroundColor: swatch }]} />
                )}
                <Text style={[s.swatchLabel, theme === name && s.swatchLabelActive]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <View style={s.group}>
        <View style={s.themeRow}>
          <Text style={s.rowLabel}>Theme colour</Text>
          <Text style={s.segmentHint}>Your accent colour adapts to light and dark appearances.</Text>
          <View style={s.colourGrid}>
            {ACCENT_OPTIONS.map(option => {
              const selected = accentColour === option.name;
              const swatch = option.name === 'default' ? themes[palette].accent : isDark ? option.dark : option.light;
              return <Pressable key={option.name} accessibilityRole="radio" accessibilityLabel={`${option.label} theme colour`} accessibilityState={{ checked: selected, disabled: !loaded }} disabled={!loaded} onPress={() => setAccentColour(option.name)} style={[s.colourOption, selected && { borderColor: colors.accent }]}>
                <View style={[s.colourChip, { backgroundColor: swatch }]}>{selected && <Ionicons name="checkmark" size={16} color={isDark ? themes.dark.bgPrimary : '#FFFFFF'} />}</View>
                <Text style={[s.swatchLabel, selected && s.swatchLabelActive]}>{option.label}</Text>
              </Pressable>;
            })}
          </View>
        </View>
      </View>

      <SectionHeader title="Library" colors={colors} />
      <View style={s.group}>
        <SettingRow
          label="Show track numbers"
          subtitle="Display numbers beside tracks. Track order stays the same."
          colors={colors}
          last
        >
          <Switch
            accessibilityLabel="Show track numbers"
            disabled={!loaded}
            onValueChange={setShowTrackNumbers}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={showTrackNumbers}
          />
        </SettingRow>
      </View>

      {/* Playback */}
      <SectionHeader title="Playback" colors={colors} />
      <View style={s.group}>
        {remote && <View style={s.themeRow}>
          <Text style={s.rowLabel}>Streaming quality</Text>
          <View style={s.segmentRow}>
            {STREAM_QUALITIES.map(({ value, label }) => (
              <Pressable
                key={value}
                disabled={!loaded}
                onPress={() => setStreamQuality(value)}
                style={[s.segmentBtn, streamQuality === value && s.segmentBtnActive]}
              >
                <Text style={[s.segmentLabel, streamQuality === value && s.segmentLabelActive]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.segmentHint}>{STREAM_QUALITY_SUBTITLE[streamQuality]}</Text>
        </View>}
        <SettingRow
          label="Floating player"
          subtitle="Draggable bubble instead of the docked mini-bar"
          colors={colors}
          last
        >
          <Switch
            disabled={!loaded}
            onValueChange={(v) => setPlayerMode(v ? 'bubble' : 'bar')}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={playerMode === 'bubble'}
          />
        </SettingRow>
        {Platform.OS === 'android' && floatingOverlay.supported && playerMode === 'bubble' && (
          <OverlayPermissionRow colors={colors} />
        )}
      </View>

      {/* Debugging */}
      {remote && <>
      <SectionHeader title="Debugging" colors={colors} />
      <View style={s.group}>
        <SettingRow
          label="Remote Logging"
          subtitle={
            remoteLogging && deviceName
              ? `Streaming as "Mobile / ${deviceName}"`
              : 'Stream console logs to the server log viewer'
          }
          colors={colors}
        >
          <Switch
            disabled={!loaded}
            onValueChange={setRemoteLogging}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={remoteLogging}
          />
        </SettingRow>
        <SettingRow
          label="Library sync debug"
          subtitle="Log library load/sync timing to the server log viewer"
          colors={colors}
        >
          <Switch
            disabled={!loaded}
            onValueChange={setLibrarySyncDebug}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={librarySyncDebug}
          />
        </SettingRow>
        <SettingRow
          label="Performance probe"
          subtitle="Log JS stalls, render cost and request queueing every 10s"
          colors={colors}
        >
          <Switch
            disabled={!loaded}
            onValueChange={setPerfProbe}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={perfProbe}
          />
        </SettingRow>
        <SettingRow
          label="Backend logs"
          subtitle="Fetch and stream server logs in the System screen"
          colors={colors}
        >
          <Switch
            disabled={!loaded}
            onValueChange={setBackendLogs}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={backendLogs}
          />
        </SettingRow>
        <Pressable
          onPress={() => navigation.navigate('NetworkLog')}
          style={({ pressed }) => [rowStyle, pressed && { backgroundColor: colors.bgElevated }]}
        >
          <View style={rowTextStyle}>
            <Text style={{ fontSize: Typography.base, fontWeight: '500', color: colors.textPrimary }}>
              Network log
            </Text>
            <Text style={{ fontSize: Typography.xs, color: colors.textMuted }}>
              Inspect recent requests &amp; latency
            </Text>
          </View>
          <Ionicons color={colors.textDim} name="chevron-forward" size={16} />
        </Pressable>
      </View>

      </>}
    </ScrollView>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function SectionHeader({ title, colors }: { title: string; colors: ThemeColors }) {
  return (
    <Text style={{
      fontSize: Typography.xs,
      fontWeight: '600',
      color: colors.textMuted,
      letterSpacing: 0.8,
      paddingHorizontal: Spacing.sm,
      paddingBottom: Spacing.xs,
    }}>
      {title.toUpperCase()}
    </Text>
  );
}

function OverlayPermissionRow({ colors }: { colors: ThemeColors }) {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    let mounted = true;
    const check = () => floatingOverlay.hasPermission().then((v) => { if (mounted) setGranted(v); });
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => { mounted = false; sub.remove(); };
  }, []);

  return (
    <SettingRow
      label="Display over other apps"
      subtitle={granted ? 'Enabled — the player floats over other apps and the home screen' : 'Let the player float over other apps and the home screen'}
      colors={colors}
      last
    >
      {granted ? (
        <Text style={{ fontSize: Typography.sm, fontWeight: '600', color: colors.accent }}>On</Text>
      ) : (
        <Pressable
          onPress={() => floatingOverlay.requestPermission()}
          style={{ paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.sm, backgroundColor: colors.accent }}
        >
          <Text style={{ fontSize: Typography.sm, fontWeight: '600', color: '#fff' }}>Enable</Text>
        </Pressable>
      )}
    </SettingRow>
  );
}

function SettingRow({
  label,
  subtitle,
  last = false,
  colors,
  children,
}: {
  label: string;
  subtitle?: string;
  last?: boolean;
  colors: ThemeColors;
  children: React.ReactNode;
}) {
  return (
    <View style={[
      rowStyle,
      { borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border },
    ]}>
      <View style={rowTextStyle}>
        <Text style={{ fontSize: Typography.base, fontWeight: '500', color: colors.textPrimary }}>
          {label}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: Typography.xs, color: colors.textMuted }}>{subtitle}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const rowStyle = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: Spacing.md,
  padding: Spacing.md,
};

const rowTextStyle = { flex: 1, gap: 2 };

// ── Styles ────────────────────────────────────────────────────────────────────

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll:     { flex: 1, backgroundColor: c.bgPrimary },
    container:  { padding: Spacing.lg, gap: Spacing.sm },
    group: {
      backgroundColor: c.bgSurface,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
      ...Editorial.panel,
    },
    themeRow: {
      padding: Spacing.md,
      gap: Spacing.sm,
    },
    rowLabel: { fontSize: Typography.base, color: c.textPrimary, ...Editorial.heading },
    colourGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    colourOption: { minWidth: 88, flexGrow: 1, flexBasis: '28%', minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, borderWidth: 1, borderColor: c.border },
    colourChip: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
    swatchRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    swatchBtn: {
      flex: 1,
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.xs,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    swatchBtnActive: {
      borderColor: c.accent,
      backgroundColor: c.bgElevated,
    },
    swatch: {
      width: 28,
      height: 28,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: c.borderStrong,
      overflow: 'hidden',
    },
    swatchSplit: {
      flexDirection: 'row',
    },
    swatchLabel: {
      fontSize: Typography.xs,
      color: c.textMuted,
    },
    swatchLabelActive: {
      color: c.accent,
      fontWeight: '600',
    },
    segmentRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    segmentBtn: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: Spacing.sm,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: c.borderStrong,
      backgroundColor: c.bgPrimary,
    },
    segmentBtnActive: {
      borderColor: c.accent,
      backgroundColor: c.bgElevated,
    },
    segmentLabel: {
      fontSize: Typography.sm,
      color: c.textMuted,
    },
    segmentLabelActive: {
      color: c.accent,
      fontWeight: '600',
    },
    segmentHint: {
      fontSize: Typography.xs,
      color: c.textMuted,
    },
  });
}
