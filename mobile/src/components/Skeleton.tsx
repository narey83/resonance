// <copyright file="Skeleton.tsx" company="John Narey">
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

import { Editorial, Radius, Spacing } from '../theme';

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';

// Pulsing placeholder blocks shown while content loads. The opacity animation runs
// on the native driver so a skeleton never competes with the JS thread for frames —
// exactly when these are visible the JS thread is busy fetching/parsing.

export function Skeleton({ width = '100%', height = 14, radius = Radius.sm, style }: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.5, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.bgElevated, opacity: pulse },
        style,
      ]}
    />
  );
}

/** A card-shaped placeholder: short title bar over a content block. */
export function SkeletonCard({ height = 120 }: { height?: number }) {
  return (
    <View style={s.card}>
      <Skeleton width="40%" height={12} />
      <Skeleton height={height} radius={Radius.md} />
    </View>
  );
}

/** List-row placeholders: two stacked text lines per row. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  const { colors } = useTheme();
  return (
    <View style={s.rows}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[s.row, { borderColor: colors.border, backgroundColor: colors.bgSurface }]}>
          <View style={s.rowText}>
            <Skeleton width="55%" height={13} />
            <Skeleton width="80%" height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { gap: Spacing.sm, marginBottom: Spacing.sm, ...Editorial.panel },
  rows:    { gap: Spacing.xs },
  row:     {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
  },
  rowText: { gap: 6 },
});
