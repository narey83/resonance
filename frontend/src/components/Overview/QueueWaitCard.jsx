// <copyright file="QueueWaitCard.jsx" company="John Narey">
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

const formatDuration = (seconds) => {
  if (seconds == null || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3_600);
  const m = Math.round((seconds % 3_600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

// How long peers waited in our upload queue before their transfer started.
// The median is the honest "typical" figure; the upper percentiles are dominated
// by remote peers who queue then download later, so they're shown as muted context.
const QueueWaitCard = ({ stats }) => {
  const count = Number(stats?.count ?? 0);
  const tail = [
    { key: 'p90', label: '90th' },
    { key: 'p99', label: '99th' },
    { key: 'max', label: 'Worst' },
  ];

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Upload Queue Wait</span>
        {count > 0 && (
          <span className="queue-count">{count.toLocaleString()} uploads</span>
        )}
      </div>
      {count === 0 ? (
        <div className="dir-empty">No queued uploads for this period</div>
      ) : (
        <div className="queue-body">
          <div className="queue-headline">
            <span className="queue-value">{formatDuration(stats?.p50)}</span>
            <span className="queue-caption">
              typical wait — half of peers start sooner
            </span>
          </div>

          <div className="queue-tail">
            {tail.map((t) => (
              <div
                className="queue-tail-stat"
                key={t.key}
              >
                <span className="queue-tail-value">
                  {formatDuration(stats?.[t.key])}
                </span>
                <span className="queue-tail-label">{t.label} pct</span>
              </div>
            ))}
          </div>

          <p className="queue-note">
            Long waits are mostly remote peers who queue a file then download it
            later — not a local slot limit.
          </p>
        </div>
      )}
    </div>
  );
};

export default QueueWaitCard;
