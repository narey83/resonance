// <copyright file="AboutScreen.tsx" company="John Narey">
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

import React, { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, Typography, ThemeColors } from '../../theme';
import { useDeferredFocusEffect } from '../../hooks/useDeferredEffect';
import { getApplicationState } from '../../api/application';

const REPO_URL = 'https://github.com/narey83/resonance';
const RELEASES_URL = `${REPO_URL}/releases/latest`;
const DEVELOPER = 'John Narey';

// The server does the release lookup -- it holds the GitHub token, and the app has no business
// carrying one. Its answer covers this app too: backend, web and mobile are cut from one tag.
const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
};

// The bundled JS version (app.json) and the installed binary's version can differ after an
// OTA update, so show the native one when the platform reports it and fall back to the config.
const VERSION = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '—';
const BUILD = Application.nativeBuildVersion;

export default function AboutScreen() {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [latest, setLatest] = useState<string | null>(null);
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  useDeferredFocusEffect(useCallback(() => {
    (async () => {
      try {
        const state = await getApplicationState();
        setServerVersion(state.version?.current ?? null);
        setLatest(state.version?.latest ?? null);
      } catch {
        // Offline or an older server: no update information, and the screen reads fine without it.
      }
    })();
  }, []));

  const updateAvailable = !!latest && compareVersions(latest, VERSION) > 0;

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.container}>
      <View style={s.hero}>
        <View style={s.heroIcon}>
          <Ionicons color={colors.accent} name="musical-notes-outline" size={28} />
        </View>
        <Text style={s.heroTitle}>Resonance</Text>
        <Text style={s.heroSub}>
          Version {VERSION}
          {BUILD ? ` (${BUILD})` : ''}
        </Text>
      </View>

      {updateAvailable && (
        <Pressable
          onPress={() => Linking.openURL(RELEASES_URL)}
          style={({ pressed }) => [s.update, pressed && s.rowPressed]}
        >
          <Ionicons color={colors.accent} name="arrow-up-circle-outline" size={20} />
          <View style={s.rowText}>
            <Text style={s.updateTitle}>Version {latest} is available</Text>
            <Text style={s.rowSub}>Tap to open the release</Text>
          </View>
          <Ionicons color={colors.textDim} name="open-outline" size={14} />
        </Pressable>
      )}

      <View style={s.group}>
        {serverVersion && (
          <View style={s.row}>
            <Text style={s.rowLabel}>Server</Text>
            <Text style={s.rowValue}>{serverVersion}</Text>
          </View>
        )}
        <View style={s.row}>
          <Text style={s.rowLabel}>Developer</Text>
          <Text style={s.rowValue}>{DEVELOPER}</Text>
        </View>
        <Pressable
          onPress={() => Linking.openURL(REPO_URL)}
          style={({ pressed }) => [s.row, s.rowLast, pressed && s.rowPressed]}
        >
          <Text style={s.rowLabel}>Repository</Text>
          <Text style={[s.rowValue, s.rowLink]} numberOfLines={1}>
            {REPO_URL.replace('https://', '')}
          </Text>
          <Ionicons color={colors.textDim} name="open-outline" size={14} />
        </Pressable>
      </View>

      <Text style={s.footer}>
        Licensed under the GNU AGPL v3. Resonance is a modified version of slskd, and is not
        maintained by, endorsed by, or affiliated with the slskd project or its authors.
      </Text>
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll:    { flex: 1, backgroundColor: c.bgPrimary },
    container: { padding: Spacing.lg, gap: Spacing.lg },
    hero:      { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.xl },
    heroIcon: {
      width: 56,
      height: 56,
      borderRadius: Radius.lg,
      backgroundColor: c.bgElevated,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: Spacing.xs,
    },
    heroTitle: { fontSize: Typography.xl, fontWeight: '600', color: c.textPrimary },
    heroSub:   { fontSize: Typography.sm, color: c.textMuted },
    group: {
      backgroundColor: c.bgSurface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      padding: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    rowLast:    { borderBottomWidth: 0 },
    rowText:    { flex: 1, gap: 2 },
    update: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      padding: Spacing.md,
      backgroundColor: c.bgSurface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: c.accent,
    },
    updateTitle: { fontSize: Typography.base, fontWeight: '600', color: c.textPrimary },
    rowSub:     { fontSize: Typography.xs, color: c.textMuted },
    rowPressed: { backgroundColor: c.bgElevated },
    rowLabel:   { fontSize: Typography.base, color: c.textPrimary },
    rowValue:   { flex: 1, fontSize: Typography.base, color: c.textMuted, textAlign: 'right' },
    rowLink:    { color: c.accent },
    footer: {
      fontSize: Typography.xs,
      lineHeight: 16,
      color: c.textMuted,
      textAlign: 'center',
      paddingHorizontal: Spacing.sm,
    },
  });
}
