// <copyright file="RetryFunnel.tsx" company="John Narey">
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
import { RetryBucket } from '../../api/analytics';
import { BarRow, Card, EmptyState, fmtNum, fmtPct } from './shared';

export default function RetryFunnel({ data, colors }: { data: RetryBucket[] | null; colors: ThemeColors }) {
  const buckets = data ?? [];
  const max = Math.max(1, ...buckets.map((b) => b.count));

  if (buckets.length === 0) {
    return <Card colors={colors}><EmptyState text="No download attempts recorded." colors={colors} /></Card>;
  }

  return (
    <Card colors={colors}>
      {buckets.map((b, i) => {
        const rate = b.count > 0 ? b.succeeded / b.count : 0;
        const label = b.attempts >= 5 ? '5+ tries' : `${b.attempts} ${b.attempts === 1 ? 'try' : 'tries'}`;
        return (
          <BarRow
            key={b.attempts}
            label={label}
            value={`${fmtNum(b.count)} · ${fmtPct(rate)} succeeded`}
            fraction={b.count / max}
            colors={colors}
            last={i === buckets.length - 1}
          />
        );
      })}
    </Card>
  );
}
