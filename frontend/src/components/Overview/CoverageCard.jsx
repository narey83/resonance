// <copyright file="CoverageCard.jsx" company="John Narey">
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

// Catalog reach: how much of the shared library has ever been uploaded at least once.
const CoverageCard = ({ pending, totalFiles, uploadedFiles }) => {
  const uploaded = Number(uploadedFiles ?? 0);
  const total = Number(totalFiles ?? 0);
  const pct = total > 0 ? Math.min(100, (uploaded / total) * 100) : 0;
  const untouched = Math.max(0, total - uploaded);

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Catalog Reach</span>
      </div>
      <div className="coverage-body">
        {total === 0 ? (
          <div className="dir-empty">No share data available</div>
        ) : pending ? (
          // Counted in the background from the full upload history; can take a minute after a restart.
          <div className="dir-empty">Calculating…</div>
        ) : (
          <>
            <div className="coverage-headline">
              <span className="coverage-pct">{pct.toFixed(1)}%</span>
              <span className="coverage-caption">
                of your library has been shared at least once
              </span>
            </div>
            <div className="coverage-track">
              <div
                className="coverage-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="coverage-stats">
              <span>
                <strong>{uploaded.toLocaleString()}</strong> shared
              </span>
              <span className="coverage-untouched">
                <strong>{untouched.toLocaleString()}</strong> never touched
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CoverageCard;
