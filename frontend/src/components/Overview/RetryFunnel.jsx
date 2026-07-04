// <copyright file="RetryFunnel.jsx" company="John Narey">
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

const label = (attempts) => {
  if (attempts <= 1) return '1st try';
  if (attempts >= 5) return '5+ tries';
  return `${attempts} tries`;
};

// Distribution of terminal downloads by how many attempts they took.
const RetryFunnel = ({ data }) => {
  const buckets = Array.isArray(data) ? data : [];
  const total = buckets.reduce((s, b) => s + (b.count ?? 0), 0);
  const succeeded = buckets.reduce((s, b) => s + (b.succeeded ?? 0), 0);

  // collapse attempts 0 and 1 into a single "first try" bucket
  const merged = {};
  for (const b of buckets) {
    const key = Math.min(Math.max(b.attempts ?? 1, 1), 5);
    if (!merged[key]) merged[key] = { attempts: key, count: 0, succeeded: 0 };
    merged[key].count += b.count ?? 0;
    merged[key].succeeded += b.succeeded ?? 0;
  }

  const rows = Object.values(merged).sort((a, b) => a.attempts - b.attempts);
  const max = Math.max(...rows.map((r) => r.count), 1);

  const eventualRate = total > 0 ? (succeeded / total) * 100 : null;

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Download Retries</span>
        {eventualRate != null && (
          <span className="retry-rate">
            {eventualRate.toFixed(1)}% eventually succeed
          </span>
        )}
      </div>
      {total === 0 ? (
        <div className="dir-empty">No download data for this period</div>
      ) : (
        <div className="dir-list">
          {rows.map((r) => {
            const pct = Math.max(4, (r.count / max) * 100);
            const failPct =
              r.count > 0 ? ((r.count - r.succeeded) / r.count) * 100 : 0;
            return (
              <div
                className="dir-item"
                key={r.attempts}
              >
                <div className="dir-item-header">
                  <span className="dir-name">{label(r.attempts)}</span>
                  <span className="dir-stats">
                    {r.count.toLocaleString()}
                    {r.count - r.succeeded > 0 &&
                      ` · ${(r.count - r.succeeded).toLocaleString()} failed`}
                  </span>
                </div>
                <div
                  className="retry-track"
                  style={{ width: `${pct}%` }}
                >
                  <div
                    className="retry-success"
                    style={{ width: `${100 - failPct}%` }}
                  />
                  <div
                    className="retry-fail"
                    style={{ width: `${failPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RetryFunnel;
