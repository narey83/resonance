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
import { SectionHeader } from './shared';
import TransferFlow from './TransferFlow';

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

  return (
    <View style={{ padding: Spacing.lg, gap: Spacing.sm }}>
      <SectionHeader title="My Activity" colors={colors} />
      {/* No prior window to compare against here: the admin dashboard picks a
          range and can fetch the one before it, this endpoint just returns the
          server's default window. */}
      <TransferFlow summary={summary} caption="Last 7 days" colors={colors} />
    </View>
  );
}
