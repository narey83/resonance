// <copyright file="TopFiles.jsx" company="John Narey">
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

const stripExtension = (name) => name.replace(/\.[^./]+$/, '');

const TopFiles = ({ files }) => {
  const list = Array.isArray(files) ? files.slice(0, 10) : [];
  const max = list[0]?.count ?? 1;

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Top Downloaded Tracks</span>
      </div>
      {list.length === 0 ? (
        <div className="dir-empty">No download data for this period</div>
      ) : (
        <div className="dir-list">
          {list.map((item, index) => {
            const pct = Math.max(
              4,
              ((item.count ?? 0) / Math.max(max, 1)) * 100,
            );
            const name = stripExtension(item.filename ?? '—');
            return (
              <div
                className="dir-item"
                key={item.filename ?? index}
              >
                <div className="dir-item-header">
                  <span
                    className="dir-name"
                    title={item.filename}
                  >
                    {name}
                  </span>
                  <span className="dir-stats">
                    {(item.count ?? 0).toLocaleString()} downloads
                    {' · '}
                    {(item.distinctUsers ?? 0).toLocaleString()} user
                    {item.distinctUsers !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="dir-bar-track">
                  <div
                    className="dir-bar-fill top-files-bar"
                    style={{ width: `${pct}%` }}
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

export default TopFiles;
