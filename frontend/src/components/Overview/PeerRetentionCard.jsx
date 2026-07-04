// <copyright file="PeerRetentionCard.jsx" company="John Narey">
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

// New vs returning peers active in the window (by each peer's first-ever transfer).
const PeerRetentionCard = ({ data }) => {
  const newPeers = Number(data?.newPeers ?? 0);
  const returning = Number(data?.returningPeers ?? 0);
  const total = newPeers + returning;
  const newPct = total > 0 ? (newPeers / total) * 100 : 0;

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Audience</span>
        {total > 0 && (
          <span className="peer-total">{total.toLocaleString()} peers</span>
        )}
      </div>
      <div className="coverage-body">
        {total === 0 ? (
          <div className="dir-empty">No peer activity for this period</div>
        ) : (
          <>
            <div className="peer-split-track">
              <div
                className="peer-split-new"
                style={{ width: `${newPct}%` }}
              />
              <div
                className="peer-split-returning"
                style={{ width: `${100 - newPct}%` }}
              />
            </div>
            <div className="peer-legend">
              <span className="peer-legend-item">
                <span className="peer-dot peer-dot-new" />
                <strong>{newPeers.toLocaleString()}</strong> new
              </span>
              <span className="peer-legend-item">
                <span className="peer-dot peer-dot-returning" />
                <strong>{returning.toLocaleString()}</strong> returning
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PeerRetentionCard;
