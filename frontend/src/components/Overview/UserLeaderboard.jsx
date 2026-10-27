// <copyright file="UserLeaderboard.jsx" company="John Narey">
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

import { formatBitrate, formatBytes } from '../../lib/util';
import UsernameLink from '../Shared/UsernameLink';
import React from 'react';

const formatSpeed = (speed) => (speed > 0 ? formatBitrate(speed) : '—');

const LeaderboardTable = ({ entries }) => {
  if (!entries || entries.length === 0) {
    return <div className="leaderboard-empty">No data for this period</div>;
  }

  return (
    <table className="leaderboard-table">
      <thead>
        <tr>
          <th className="leaderboard-rank">#</th>
          <th>User</th>
          <th className="leaderboard-num">Data</th>
          <th className="leaderboard-num">Files</th>
          <th className="leaderboard-num">Avg Speed</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => (
          <tr key={entry.username ?? index}>
            <td className="leaderboard-rank">{index + 1}</td>
            <td className="leaderboard-username">
              {entry.username ? (
                <UsernameLink username={entry.username} />
              ) : (
                '—'
              )}
            </td>
            <td className="leaderboard-num">
              {formatBytes(entry.totalBytes ?? 0)}
            </td>
            <td className="leaderboard-num">
              {(entry.count ?? 0).toLocaleString()}
            </td>
            <td className="leaderboard-num">
              {formatSpeed(entry.averageSpeed ?? 0)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

// A directional view must never display the opposite peer list.
const UserLeaderboard = ({ direction, leaderboard }) => (
  <>
    {direction !== 'upload' && (
      <div className="section-card">
        <div className="section-card-header">
          <span className="section-card-title">Download sources</span>
        </div>
        <LeaderboardTable entries={leaderboard?.download ?? []} />
      </div>
    )}
    {direction !== 'download' && (
      <div className="section-card">
        <div className="section-card-header">
          <span className="section-card-title">Upload recipients</span>
        </div>
        <LeaderboardTable entries={leaderboard?.upload ?? []} />
      </div>
    )}
  </>
);

export default UserLeaderboard;
