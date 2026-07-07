// <copyright file="GeographyCard.tsx" company="John Narey">
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

import React from 'react';
import { Text, View } from 'react-native';
import { Spacing, Typography, ThemeColors } from '../../theme';
import { GeographyReport } from '../../api/analytics';
import { BarRow, Card, EmptyState, fmtBytes, fmtPct } from './shared';

export default function GeographyCard({ geography, colors }: { geography: GeographyReport | null; colors: ThemeColors }) {
  const countries = geography?.countries ?? [];
  const max = Math.max(1, ...countries.map((c) => c.bytes));
  const vpnFraction = geography && geography.totalUsers > 0 ? geography.vpnUsers / geography.totalUsers : 0;

  if (countries.length === 0) {
    return <Card colors={colors}><EmptyState text="No geography data in this window." colors={colors} /></Card>;
  }

  return (
    <>
      {geography && geography.totalUsers > 0 && (
        <View style={{ paddingHorizontal: Spacing.sm, paddingBottom: Spacing.sm }}>
          <Text style={{ fontSize: Typography.xs, color: colors.textMuted }}>
            {fmtPct(vpnFraction)} of {geography.totalUsers} peers via VPN/proxy
          </Text>
        </View>
      )}
      <Card colors={colors}>
        {countries.map((c, i) => (
          <BarRow
            key={c.country}
            label={c.country || 'Unknown'}
            value={`${fmtBytes(c.bytes)} · ${c.users} users`}
            fraction={c.bytes / max}
            colors={colors}
            last={i === countries.length - 1}
          />
        ))}
      </Card>
    </>
  );
}
