// <copyright file="AnalysisBadge.tsx" company="John Narey">
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

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTrackAnalysisStatus } from '../store/analysisProgressStore';

/**
 * A track row's analysis indicator: a spinner while the server is analysing the track, a clock
 * while it waits its turn, and nothing otherwise. Subscribes to this one track's status, so a
 * scan's progress only re-renders the rows it concerns.
 */
export default function AnalysisBadge({ path, color }: { path: string; color: string }) {
  const status = useTrackAnalysisStatus(path);
  if (!status) return null;

  return (
    <View style={styles.badge}>
      {status === 'analysing'
        ? <ActivityIndicator accessibilityLabel="Analysing" color={color} size="small" style={styles.spinner} />
        : <Ionicons accessibilityLabel="Queued for analysis" color={color} name="time-outline" size={15} />}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  spinner: { transform: [{ scale: 0.75 }] },
});
