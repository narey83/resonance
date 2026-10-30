// <copyright file="ConnectionBanner.tsx" company="John Narey">
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

import { Text } from './Typography';
import { Editorial, Typography, Spacing } from '../theme';

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppMode } from '../store/appModeStore';
import { useTheme } from '../context/ThemeContext';
import { useConnectionStore, ConnectionStatus } from '../services/connectionMonitor';

const TAB_BAR_HEIGHT  = 49;
const MINI_BAR_HEIGHT = 82; // paddingVertical 16*2 + artwork 48 + progress 2

type Config = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  label: string;
};

function useConfig(status: ConnectionStatus, latencyMs: number | null, lastError: string | null): Config {
  const { colors } = useTheme();
  switch (status) {
    case 'maintenance':
      return { icon: 'construct-outline', color: colors.warning, label: 'Server maintenance · Reconnecting automatically. Local music is available.' };
    case 'offline':
      return { icon: 'wifi-outline',         color: colors.danger,  label: 'No network connection' };
    case 'down':
      return { icon: 'cloud-offline-outline', color: colors.danger,  label: lastError ? `Unreachable: ${lastError} · Retrying…` : 'Server unreachable · Retrying…' };
    case 'slow':
      return { icon: 'time-outline',          color: colors.warning, label: latencyMs != null ? `Slow connection · ${latencyMs}ms` : 'Slow connection' };
    default:
      return { icon: 'checkmark-circle-outline', color: colors.success, label: 'Connected' };
  }
}

export default function ConnectionBanner() {
  const { status, latencyMs, lastError } = useConnectionStore();
  const insets = useSafeAreaInsets();
  const config  = useConfig(status, latencyMs, lastError);

  const mode = useAppMode((s) => s.mode);
  const visible  = mode === 'remote' && status !== 'connected';
  const slideY      = useRef(new Animated.Value(40)).current;
  const fadeAnim    = useRef(new Animated.Value(0)).current;
  const prevVisible = useRef(false);

  useEffect(() => {
    if (visible === prevVisible.current) return;
    prevVisible.current = visible;

    if (visible) {
      Animated.parallel([
        Animated.timing(slideY,  { toValue: 0,  duration: 340, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1,  duration: 220, easing: Easing.out(Easing.ease),         useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideY,  { toValue: 40, duration: 280, easing: Easing.bezier(0.4, 0, 1, 1), useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 0,  duration: 180, easing: Easing.in(Easing.ease),      useNativeDriver: true }),
      ]).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const bottomOffset = insets.bottom + TAB_BAR_HEIGHT + MINI_BAR_HEIGHT + Spacing.md;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrapper, { bottom: bottomOffset, opacity: fadeAnim, transform: [{ translateY: slideY }] }]}
    >
      <View style={[styles.pill, { backgroundColor: config.color }]}>
        <Ionicons color="#fff" name={config.icon} size={14} style={styles.icon} />
        <Text style={styles.label}>{config.label}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 9999,
  },
  pill: {
    maxWidth: '94%',
    alignItems: 'center',
    elevation: 8,
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    ...Editorial.control,
  },
  icon:  { marginRight: Spacing.xs },
  label: { flexShrink: 1, color: '#fff', fontSize: Typography.sm, fontWeight: '600' },
});
