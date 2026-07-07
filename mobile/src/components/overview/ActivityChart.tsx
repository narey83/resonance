// <copyright file="ActivityChart.tsx" company="John Narey">
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
import { ThemeColors } from '../../theme';
import { BarRow, Card, EmptyState, fmtBytes } from './shared';
import { Histogram, bucketTotals, fmtBucketLabel } from './histogramUtils';

export default function ActivityChart({ data, colors }: { data: Histogram | null; colors: ThemeColors }) {
  const buckets = bucketTotals(data).filter((b) => b.bytes > 0).slice(-12);
  const max = Math.max(1, ...buckets.map((b) => b.bytes));

  if (buckets.length === 0) {
    return <Card colors={colors}><EmptyState text="No transfer activity in this window." colors={colors} /></Card>;
  }

  return (
    <Card colors={colors}>
      {buckets.map((b, i) => (
        <BarRow
          key={b.bucket}
          label={fmtBucketLabel(b.bucket)}
          value={fmtBytes(b.bytes)}
          fraction={b.bytes / max}
          colors={colors}
          last={i === buckets.length - 1}
        />
      ))}
    </Card>
  );
}
