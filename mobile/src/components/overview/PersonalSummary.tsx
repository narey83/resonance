// <copyright file="PersonalSummary.tsx" company="John Narey">
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

// Non-admin landing content for OverviewScreen: just "My Activity", since
// Session/Server/Library/System/Version already live on ConnectionScreen
// (open to everyone). Backend enforces self-or-admin on this endpoint — see
// ReportsController.GetTransferSummary's IsAdminOrSelf check.

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Spacing, ThemeColors } from '../../theme';
import { getApplicationState } from '../../api/application';
import { getSummary, TransferSummary } from '../../api/analytics';
import { fmtBytes, fmtNum, fmtPct, SectionHeader, StatTileGrid } from './shared';

function aggregate(byState: Record<string, TransferSummary> | undefined) {
  const states = Object.values(byState ?? {});
  const totalBytes = states.reduce((sum, s) => sum + (s.totalBytes ?? 0), 0);
  const count = states.reduce((sum, s) => sum + (s.count ?? 0), 0);
  const succeeded = byState?.Succeeded?.count ?? 0;
  return { totalBytes, count, successRate: count > 0 ? succeeded / count : 0 };
}

export default function PersonalSummary({ colors }: { colors: ThemeColors }) {
  const [summary, setSummary] = useState<Record<string, Record<string, TransferSummary>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApplicationState()
      .then((state) => getSummary({ username: state.user.username }))
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const dl = aggregate(summary?.Download);
  const ul = aggregate(summary?.Upload);

  return (
    <View style={{ padding: Spacing.lg, gap: Spacing.sm }}>
      <SectionHeader title="My Activity (last 7 days)" colors={colors} />
      <StatTileGrid
        colors={colors}
        tiles={[
          { key: 'dl', label: 'Downloaded', value: summary ? fmtBytes(dl.totalBytes) : '—', sub: summary ? `${fmtNum(dl.count)} files` : undefined },
          { key: 'ul', label: 'Uploaded', value: summary ? fmtBytes(ul.totalBytes) : '—', sub: summary ? `${fmtNum(ul.count)} files` : undefined },
          { key: 'dl-rate', label: 'Download Success', value: summary ? fmtPct(dl.successRate) : '—' },
          { key: 'ul-rate', label: 'Upload Success', value: summary ? fmtPct(ul.successRate) : '—' },
        ]}
      />
    </View>
  );
}
