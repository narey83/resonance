// <copyright file="histogramUtils.ts" company="John Narey">
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

import { TransferSummary } from '../../api/analytics';

export type Histogram = Record<string, Record<string, Record<string, TransferSummary>>>;

export interface BucketTotal {
  bucket: string;
  bytes:  number;
  count:  number;
}

// Sums bytes/count across both directions for each time bucket, either
// across all states or only the non-Succeeded ones (for the error view).
export function bucketTotals(histogram: Histogram | null, { errorsOnly = false } = {}): BucketTotal[] {
  if (!histogram) return [];
  return Object.entries(histogram)
    .map(([bucket, byDirection]) => {
      let bytes = 0;
      let count = 0;
      for (const byState of Object.values(byDirection ?? {})) {
        for (const [state, summary] of Object.entries(byState ?? {})) {
          if (errorsOnly && state === 'Succeeded') continue;
          bytes += summary.totalBytes ?? 0;
          count += summary.count ?? 0;
        }
      }
      return { bucket, bytes, count };
    })
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export function fmtBucketLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
}
