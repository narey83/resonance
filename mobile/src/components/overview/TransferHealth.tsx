// <copyright file="TransferHealth.tsx" company="John Narey">
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

// Simplified mobile counterpart of the web's Recharts donut: stat rows +
// a top-exceptions list instead of a pie chart, to avoid a charting
// dependency for one card.

import React from 'react';
import { ThemeColors } from '../../theme';
import { TransferExceptionSummaryEntry, TransferSummary } from '../../api/analytics';
import { BarRow, Card, EmptyState, fmtNum, fmtPct, SectionHeader } from './shared';

const cleanException = (message: string): string => {
  let m = message ?? '';
  m = m.replace(/\s+to\s+\S.*\(\d{1,3}(?:\.\d{1,3}){3}:\d+\)\s*$/u, '').trim();
  m = m.replace(/^\d+\s+bytes\s+(?:from|to)\s+[\d.]+:\d+:\s*/iu, '').trim();
  return m || message;
};

function aggregate(byState: Record<string, TransferSummary> | undefined) {
  const states = Object.values(byState ?? {});
  const count = states.reduce((sum, s) => sum + (s.count ?? 0), 0);
  const succeeded = byState?.Succeeded?.count ?? 0;
  return { count, succeeded, errored: count - succeeded };
}

export default function TransferHealth({
  summary,
  exceptions,
  colors,
}: {
  summary:    Record<string, Record<string, TransferSummary>> | null;
  exceptions: TransferExceptionSummaryEntry[];
  colors:     ThemeColors;
}) {
  const dl = aggregate(summary?.Download);
  const ul = aggregate(summary?.Upload);
  const total = dl.count + ul.count;
  const succeeded = dl.succeeded + ul.succeeded;

  const top = [...exceptions].sort((a, b) => b.count - a.count).slice(0, 5);
  const maxCount = Math.max(1, ...top.map((e) => e.count));

  return (
    <>
      <Card colors={colors}>
        <BarRow label="Succeeded" value={fmtNum(succeeded)} fraction={total > 0 ? succeeded / total : 0} color={colors.success} colors={colors} />
        <BarRow
          label="Failed / cancelled"
          value={`${fmtNum(total - succeeded)} (${fmtPct(total > 0 ? (total - succeeded) / total : 0)})`}
          fraction={total > 0 ? (total - succeeded) / total : 0}
          color={colors.danger}
          colors={colors}
          last
        />
      </Card>
      <SectionHeader title="Top Exceptions" colors={colors} />
      <Card colors={colors}>
        {top.length === 0 ? (
          <EmptyState text="No exceptions in this window." colors={colors} />
        ) : (
          top.map((e, i) => (
            <BarRow
              key={e.exception}
              label={cleanException(e.exception)}
              value={fmtNum(e.count)}
              fraction={e.count / maxCount}
              color={colors.danger}
              colors={colors}
              last={i === top.length - 1}
            />
          ))
        )}
      </Card>
    </>
  );
}
