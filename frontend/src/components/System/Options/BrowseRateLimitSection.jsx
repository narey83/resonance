// <copyright file="BrowseRateLimitSection.jsx" company="John Narey">
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

import {
  getBrowseRateLimitUsers,
  unblockBrowseRateLimitUser,
} from '../../../lib/server';
import { parseUtcDate } from '../../../lib/util';
import React, { useCallback, useEffect, useState } from 'react';

const formatTime = (iso) => {
  if (!iso) return '';
  return parseUtcDate(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatDate = (iso) => {
  if (!iso) return '';
  const d = parseUtcDate(iso);
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return isToday ? formatTime(iso) : d.toLocaleString();
};

const BrowseRateLimitSection = () => {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [unblocking, setUnblocking] = useState(null);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await getBrowseRateLimitUsers();
      setUsers(data);
      setError(null);
    } catch {
      setError('Failed to load users');
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    const id = setInterval(fetchUsers, 10_000);
    return () => clearInterval(id);
  }, [fetchUsers]);

  const handleUnblock = async (username) => {
    setUnblocking(username);
    try {
      await unblockBrowseRateLimitUser(username);
      await fetchUsers();
    } catch {
      // ignore
    } finally {
      setUnblocking(null);
    }
  };

  const blocked = users.filter((u) => u.blocked);
  const watching = users.filter((u) => !u.blocked);

  return (
    <div className="brl-users">
      <div className="brl-users-header">
        Active Users
        <span className="brl-users-count">{users.length}</span>
      </div>
      {error && <div className="brl-users-error">{error}</div>}
      {users.length === 0 && !error && (
        <div className="brl-users-empty">No users tracked yet</div>
      )}
      {blocked.length > 0 && (
        <>
          <div className="brl-users-group">Blocked</div>
          {blocked.map((u) => (
            <div
              className="brl-user-row brl-user-row--blocked"
              key={u.username}
            >
              <div className="brl-user-info">
                <span className="brl-user-name">{u.username}</span>
                <span className="brl-user-meta">
                  blocked until {formatDate(u.blockedUntil)}
                </span>
              </div>
              <button
                className="brl-unblock-btn"
                disabled={unblocking === u.username}
                onClick={() => handleUnblock(u.username)}
                type="button"
              >
                {unblocking === u.username ? '…' : 'Unblock'}
              </button>
            </div>
          ))}
        </>
      )}
      {watching.length > 0 && (
        <>
          <div className="brl-users-group">Watching</div>
          {watching.map((u) => (
            <div
              className="brl-user-row"
              key={u.username}
            >
              <div className="brl-user-info">
                <span className="brl-user-name">{u.username}</span>
                <span className="brl-user-meta">
                  {u.requests} request{u.requests !== 1 ? 's' : ''} since{' '}
                  {formatTime(u.windowStart)}
                </span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

export default BrowseRateLimitSection;
