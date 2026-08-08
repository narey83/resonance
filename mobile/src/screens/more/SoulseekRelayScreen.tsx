// <copyright file="SoulseekRelayScreen.tsx" company="John Narey">
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

// Previously a tab buried inside the admin-only Overview dashboard. The data behind it
// (getApplicationState().distributedNetwork) isn't actually admin-restricted — ConnectionScreen
// already surfaces one summary row from the same call for every user — so this stands alone here,
// open to everyone, rather than living inside an admin analytics screen.

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { Spacing, Typography, ThemeColors } from '../../theme';
import { useDeferredFocusEffect } from '../../hooks/useDeferredEffect';
import { getApplicationState, AppState } from '../../api/application';
import DistributedNetworkCard from '../../components/overview/DistributedNetworkCard';
import { SkeletonCard, SkeletonRows } from '../../components/Skeleton';

export default function SoulseekRelayScreen() {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [distributedNetwork, setDistributedNetwork] = useState<AppState['distributedNetwork'] | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const fetch = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const state = await getApplicationState();
      setDistributedNetwork(state.distributedNetwork ?? null);
    } catch {
      setError('Could not load relay status.');
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

  const onRefresh = () => { setRefreshing(true); fetch(); };

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {loading && !distributedNetwork ? (
        <>
          <SkeletonCard height={90} />
          <SkeletonCard height={140} />
          <SkeletonRows rows={3} />
        </>
      ) : error && !distributedNetwork ? (
        <>
          <Ionicons name="alert-circle-outline" size={32} color={colors.danger} style={s.errorIcon} />
          <Text style={s.errorText}>{error}</Text>
          <Text style={s.errorHint}>Pull down to retry.</Text>
        </>
      ) : (
        <DistributedNetworkCard data={distributedNetwork ?? null} colors={colors} />
      )}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll:    { flex: 1, backgroundColor: c.bgPrimary },
    container: { padding: Spacing.lg, gap: Spacing.sm },
    errorIcon: { alignSelf: 'center', marginTop: Spacing.xl },
    errorText: { fontSize: Typography.base, color: c.textPrimary, textAlign: 'center', marginTop: Spacing.sm },
    errorHint: { fontSize: Typography.sm, color: c.textMuted, textAlign: 'center', marginTop: Spacing.xs },
  });
}
