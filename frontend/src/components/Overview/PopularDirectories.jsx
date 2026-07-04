// <copyright file="PopularDirectories.jsx" company="John Narey">
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

const truncateDirectory = (path) => {
  if (!path) return '—';
  const separator = path.includes('\\') ? '\\' : '/';
  const parts = path.split(separator).filter(Boolean).slice(1);
  if (parts.length === 0) return path;
  if (parts.length <= 2) return parts.join(separator);
  return `…${separator}${parts.slice(-2).join(separator)}`;
};

const PopularDirectories = ({ directories }) => {
  const list = Array.isArray(directories) ? directories : [];
  const max = list[0]?.distinctUsers ?? 1;

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Popular Directories</span>
      </div>
      {list.length === 0 ? (
        <div className="dir-empty">No upload data for this period</div>
      ) : (
        <div className="dir-list">
          {list.map((item, index) => {
            const pct = Math.max(
              4,
              ((item.distinctUsers ?? 0) / Math.max(max, 1)) * 100,
            );
            return (
              <div
                className="dir-item"
                key={item.directory ?? index}
              >
                <div className="dir-item-header">
                  <span
                    className="dir-name"
                    title={item.directory}
                  >
                    {truncateDirectory(item.directory)}
                  </span>
                  <span className="dir-stats">
                    {(item.distinctUsers ?? 0).toLocaleString()} users
                    {' · '}
                    {(item.count ?? 0).toLocaleString()} files
                  </span>
                </div>
                <div className="dir-bar-track">
                  <div
                    className="dir-bar-fill"
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

export default PopularDirectories;
