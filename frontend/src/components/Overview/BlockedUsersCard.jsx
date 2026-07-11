// <copyright file="BlockedUsersCard.jsx" company="John Narey">
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

import { fetchBlockedUsers, useBlockedUsers } from '../../lib/blockedUsers';
import { parseUtcDate } from '../../lib/util';
import { Ban } from 'lucide-react';
import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

// Live blocked-list summary; data arrives over the application hub and updates
// in real time (including same-IP auto-blocks).
const BlockedUsersCard = () => {
  const { ips, places, users } = useBlockedUsers();

  useEffect(() => {
    fetchBlockedUsers().catch(() => {});
  }, []);

  const autoBlocked = users.filter((u) =>
    (u.reason ?? '').startsWith('Auto-blocked'),
  ).length;

  const recent = [...users]
    .sort(
      (a, b) =>
        (parseUtcDate(b.blockedAt)?.getTime() ?? 0) -
        (parseUtcDate(a.blockedAt)?.getTime() ?? 0),
    )
    .slice(0, 6);

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">
          <Ban
            size={14}
            style={{ marginRight: 6, verticalAlign: '-2px' }}
          />
          Blocked
        </span>
        <Link
          className="blocked-card-manage"
          to="/system/blocked"
        >
          Manage
        </Link>
      </div>
      <div className="coverage-body">
        <div className="blocked-stat-row">
          <div className="blocked-stat">
            <strong>{users.length.toLocaleString()}</strong>
            <span>users</span>
          </div>
          <div className="blocked-stat">
            <strong>{ips.length.toLocaleString()}</strong>
            <span>IPs</span>
          </div>
          <div className="blocked-stat">
            <strong>{places.length.toLocaleString()}</strong>
            <span>locations</span>
          </div>
          <div className="blocked-stat">
            <strong>{autoBlocked.toLocaleString()}</strong>
            <span>ban evasions</span>
          </div>
        </div>
        {recent.length === 0 ? (
          <div className="dir-empty">No blocked users</div>
        ) : (
          <ul className="blocked-recent">
            {recent.map((u) => (
              <li key={u.username}>
                <span
                  className="blocked-recent-name"
                  title={u.username}
                >
                  {u.username}
                </span>
                {(u.reason ?? '').startsWith('Auto-blocked') && (
                  <span className="blocked-recent-tag">evasion</span>
                )}
                <span className="blocked-recent-when">
                  {parseUtcDate(u.blockedAt)?.toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default BlockedUsersCard;
