import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { getDeviceName } from '../../store/auth';
import { useAppSettings } from '../../store/appSettingsStore';
import type { StreamQuality } from '../../store/appSettingsStore';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import type { ThemeName } from '../../theme';

// ── Theme options ─────────────────────────────────────────────────────────────

const THEMES: { name: ThemeName; label: string; swatch: string; swatch2?: string }[] = [
  { name: 'system',   label: 'Auto',     swatch: '#0d1117', swatch2: '#f6f8fa' },
  { name: 'dark',     label: 'Dark',     swatch: '#0d1117' },
  { name: 'amoled',   label: 'Amoled',   swatch: '#000000' },
  { name: 'midnight', label: 'Midnight', swatch: '#0a0f1e' },
  { name: 'light',    label: 'Light',    swatch: '#f6f8fa' },
];

const STREAM_QUALITIES: { value: StreamQuality; label: string }[] = [
  { value: 'auto',     label: 'Auto' },
  { value: 'original', label: 'Original' },
  { value: 'saver',    label: 'Data saver' },
];

const STREAM_QUALITY_SUBTITLE: Record<StreamQuality, string> = {
  auto:     'Full quality on Wi-Fi, reduced on cellular or slow links',
  original: 'Always stream the original file (best quality, seekable)',
  saver:    'Always transcode to a smaller size (uses least data)',
};

// ── Main screen ───────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const {
    theme, setTheme,
    remoteLogging, loaded, setRemoteLogging,
    streamQuality, setStreamQuality,
    notifications, setNotification,
  } = useAppSettings();

  const [deviceName, setDeviceName] = useState<string>('');

  useEffect(() => {
    getDeviceName().then(setDeviceName);
  }, []);

  return (
    <ScrollView contentContainerStyle={s.container} style={s.scroll}>

      {/* Appearance */}
      <SectionHeader title="Appearance" colors={colors} />
      <View style={s.group}>
        <View style={s.themeRow}>
          <Text style={s.rowLabel}>Theme</Text>
          <View style={s.swatchRow}>
            {THEMES.map(({ name, label, swatch, swatch2 }) => (
              <Pressable
                key={name}
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

      {/* Playback */}
      <SectionHeader title="Playback" colors={colors} />
      <View style={s.group}>
        <View style={s.themeRow}>
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
        </View>
      </View>

      {/* Notifications */}
      <SectionHeader title="Notifications" colors={colors} />
      <View style={s.group}>
        <SettingRow
          label="Downloads complete"
          subtitle="Alert when a download finishes"
          colors={colors}
        >
          <Switch
            disabled={!loaded}
            onValueChange={(v) => setNotification('downloadsComplete', v)}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={notifications.downloadsComplete}
          />
        </SettingRow>
        <SettingRow
          label="Uploads complete"
          subtitle="Alert when an upload finishes"
          colors={colors}
        >
          <Switch
            disabled={!loaded}
            onValueChange={(v) => setNotification('uploadComplete', v)}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={notifications.uploadComplete}
          />
        </SettingRow>
        <SettingRow
          label="Share scan complete"
          subtitle="Alert when the library re-scan finishes"
          colors={colors}
        >
          <Switch
            disabled={!loaded}
            onValueChange={(v) => setNotification('shareScanComplete', v)}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={notifications.shareScanComplete}
          />
        </SettingRow>
        <SettingRow
          label="Server disconnect"
          subtitle="Alert when the server loses its connection"
          colors={colors}
          last
        >
          <Switch
            disabled={!loaded}
            onValueChange={(v) => setNotification('serverDisconnect', v)}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={notifications.serverDisconnect}
          />
        </SettingRow>
      </View>

      {/* Debugging */}
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
          last
        >
          <Switch
            disabled={!loaded}
            onValueChange={setRemoteLogging}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={remoteLogging}
          />
        </SettingRow>
      </View>

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
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
    },
    themeRow: {
      padding: Spacing.md,
      gap: Spacing.sm,
    },
    rowLabel: { fontSize: Typography.base, fontWeight: '500', color: c.textPrimary },
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
