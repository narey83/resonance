// <copyright file="NotificationsScreen.tsx" company="John Narey">
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
import { Editorial, Spacing, ThemeColors, Typography } from '../../theme';

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useAppSettings } from '../../store/appSettingsStore';
import { useTheme } from '../../context/ThemeContext';

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { notifications, setNotification, loaded } = useAppSettings();

  return (
    <ScrollView contentContainerStyle={s.container} style={s.scroll}>
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
          label="Private messages"
          subtitle="Play a sound for new private messages"
          colors={colors}
        >
          <Switch
            disabled={!loaded}
            onValueChange={(v) => setNotification('privateMessage', v)}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={notifications.privateMessage}
          />
        </SettingRow>
        <SettingRow
          label="Room mentions"
          subtitle="Play a sound when you're mentioned in a room"
          colors={colors}
        >
          <Switch
            disabled={!loaded}
            onValueChange={(v) => setNotification('roomMention', v)}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={notifications.roomMention}
          />
        </SettingRow>
        <SettingRow
          label="Blocked-user alerts"
          subtitle="Alert when a user is auto-blocked for ban evasion"
          colors={colors}
        >
          <Switch
            disabled={!loaded}
            onValueChange={(v) => setNotification('userBlocked', v)}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={notifications.userBlocked}
          />
        </SettingRow>
        <SettingRow
          label="Restart required"
          subtitle="Alert when a config change needs a backend restart (administrators only)"
          colors={colors}
          last
        >
          <Switch
            disabled={!loaded}
            onValueChange={(v) => setNotification('restartRequired', v)}
            thumbColor={colors.textPrimary}
            trackColor={{ false: colors.bgElevated, true: colors.accent }}
            value={notifications.restartRequired}
          />
        </SettingRow>
      </View>
    </ScrollView>
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

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll:    { flex: 1, backgroundColor: c.bgPrimary },
    container: { padding: Spacing.lg, gap: Spacing.sm },
    group: {
      backgroundColor: c.bgSurface,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
      ...Editorial.panel,
    },
  });
}
