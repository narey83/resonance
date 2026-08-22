// <copyright file="RoomUserList.jsx" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import './Rooms.css';
import UsernameLink from '../Shared/UsernameLink';
import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useMemo, useRef } from 'react';
import { Flag, Icon, Popup } from 'semantic-ui-react';

const getDetails = (user) => {
  return user.countryCode ?? '?';
};

const ROW_HEIGHT = 30;

const RoomUserList = ({ users }) => {
  const scrollRef = useRef(null);

  const getFlag = (user) => {
    if (!(user || {}).countryCode)
      return (
        <Icon
          className="unknown-user-flag"
          name="question"
        />
      );

    return <Flag name={user.countryCode.toLowerCase()} />;
  };

  const sortedUsers = useMemo(() => {
    const filtered = [...users]
      .sort((a, b) => a.username.localeCompare(b.username))
      .reduce(
        (accumulator, user) => {
          (user.status === 'Online'
            ? accumulator.online
            : accumulator.offline
          ).push(user);
          return accumulator;
        },
        { offline: [], online: [] },
      );

    return [...filtered.online, ...filtered.offline];
  }, [users]);

  const virtualizer = useVirtualizer({
    count: sortedUsers.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  return (
    <div
      className="list"
      ref={scrollRef}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const user = sortedUsers[vRow.index];
          return (
            <div
              className={`item${user.self ? ' room-user-self' : ''}`}
              key={user.username}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              <div
                className="content"
                style={{ opacity: user.status === 'Online' ? 1 : 0.5 }}
              >
                <Popup
                  content={getDetails(user)}
                  trigger={getFlag(user)}
                />
                <UsernameLink
                  self={user.self}
                  username={user.username}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RoomUserList;
