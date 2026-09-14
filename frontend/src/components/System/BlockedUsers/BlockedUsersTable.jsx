// <copyright file="BlockedUsersTable.jsx" company="John Narey">
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

import { blockIp } from '../../../lib/blockedUsers';
import { parseUtcDate } from '../../../lib/util';
import { useVirtualizer } from '@tanstack/react-virtual';
import React, { memo, useMemo, useRef, useState } from 'react';
import { Button, Input, Label, Table } from 'semantic-ui-react';

const COLUMNS = 6;
const ESTIMATED_ROW_HEIGHT = 37;

// Only the rows in (or near) the 320px scroll box are in the DOM. The list runs into the
// thousands, and rendering every row — each with its own IP chips — took seconds on open and
// again on every change. Rows are measured as they render because IP chips wrap to varying
// heights; spacer rows above and below keep the scrollbar honest and the header sticky.
const BlockedUsersTable = ({ onUnblock, users }) => {
  const [filter, setFilter] = useState('');
  const scrollRef = useRef(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        (u.country ?? '').toLowerCase().includes(q) ||
        (u.city ?? '').toLowerCase().includes(q) ||
        (u.reason ?? '').toLowerCase().includes(q) ||
        u.ips?.some((ip) => ip.includes(q)),
    );
  }, [filter, users]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    getItemKey: (index) => filtered[index].username,
    getScrollElement: () => scrollRef.current,
    overscan: 10,
  });

  const items = virtualizer.getVirtualItems();
  const top = items.length > 0 ? items[0].start : 0;
  const bottom =
    items.length > 0
      ? virtualizer.getTotalSize() - items[items.length - 1].end
      : 0;

  return (
    <>
      {users.length > 0 && (
        <Input
          className="blocked-filter"
          icon="search"
          iconPosition="left"
          onChange={(_, { value }) => setFilter(value)}
          placeholder="Filter by username, IP, location or reason…"
          size="small"
          value={filter}
        />
      )}
      <div
        className="blocked-scroll"
        ref={scrollRef}
      >
        <Table
          basic="very"
          compact
        >
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Username</Table.HeaderCell>
              <Table.HeaderCell>Known IPs</Table.HeaderCell>
              <Table.HeaderCell>Location</Table.HeaderCell>
              <Table.HeaderCell>Blocked</Table.HeaderCell>
              <Table.HeaderCell>Reason</Table.HeaderCell>
              <Table.HeaderCell textAlign="right" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {filtered.length === 0 && (
              <Table.Row>
                <Table.Cell
                  colSpan={COLUMNS}
                  textAlign="center"
                >
                  {users.length === 0 ? 'No blocked users' : 'No matches'}
                </Table.Cell>
              </Table.Row>
            )}
            {top > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={COLUMNS}
                  style={{ height: top, padding: 0 }}
                />
              </tr>
            )}
            {items.map((item) => {
              const user = filtered[item.index];
              return (
                <tr
                  data-index={item.index}
                  key={item.key}
                  ref={virtualizer.measureElement}
                >
                  <Table.Cell>{user.username}</Table.Cell>
                  <Table.Cell>
                    {user.ips?.length ? (
                      user.ips.map((ip) => (
                        <Label
                          key={ip}
                          onClick={() => blockIp(ip).catch(() => {})}
                          size="tiny"
                          style={{ cursor: 'pointer', marginBottom: 2 }}
                          title="Block this IP"
                        >
                          {ip}
                        </Label>
                      ))
                    ) : (
                      <span style={{ opacity: 0.4 }}>—</span>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {user.city || user.country ? (
                      [user.city, user.country].filter(Boolean).join(', ')
                    ) : (
                      <span style={{ opacity: 0.4 }}>—</span>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {parseUtcDate(user.blockedAt)?.toLocaleString()}
                  </Table.Cell>
                  <Table.Cell>{user.reason}</Table.Cell>
                  <Table.Cell textAlign="right">
                    <Button
                      className="hover-fx"
                      onClick={() => onUnblock(user.username)}
                      size="mini"
                    >
                      Unblock
                    </Button>
                  </Table.Cell>
                </tr>
              );
            })}
            {bottom > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={COLUMNS}
                  style={{ height: bottom, padding: 0 }}
                />
              </tr>
            )}
          </Table.Body>
        </Table>
      </div>
    </>
  );
};

// Memoised so typing in the block form above doesn't re-render the table.
export default memo(BlockedUsersTable);
