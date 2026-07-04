// <copyright file="index.jsx" company="JP Dillingham">
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

import { list } from '../../../lib/events';
import { LoaderSegment } from '../../Shared';
import React, { useEffect, useRef, useState } from 'react';
import { Icon, Pagination, Popup, Table } from 'semantic-ui-react';

const PER_PAGE = 10;

const EVENT_TYPES = [
  'DownloadFileComplete',
  'DownloadDirectoryComplete',
  'UploadFileComplete',
  'PrivateMessageReceived',
  'RoomMessageReceived',
  'SoulseekClientConnected',
  'SoulseekClientDisconnected',
  'Noop',
];

const replaceHyphensWithNonBreakingEquivalent = (string) =>
  string?.replaceAll('-', '‑');

const Events = () => {
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState([]);

  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filtersRef = useRef({ typeFilter, dateFrom, dateTo });
  filtersRef.current = { typeFilter, dateFrom, dateTo };

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetch = async (pg = page) => {
    setLoading(true);

    const { dateFrom: from, dateTo: to, typeFilter: type } = filtersRef.current;

    const { events: items, totalCount } = await list({
      limit: PER_PAGE,
      offset: (pg - 1) * PER_PAGE,
      type: type || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to + 'T23:59:59').toISOString() : undefined,
    });

    if (!mountedRef.current) return;

    const tp = Math.ceil(totalCount / PER_PAGE);

    setEvents(items);
    setTotalPages(Number.isNaN(tp) ? 0 : tp);
    setLoading(false);
  };

  useEffect(() => {
    fetch(page);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = () => {
    if (page === 1) {
      fetch(1);
    } else {
      setPage(1);
    }
  };

  const clearFilters = () => {
    setTypeFilter('');
    setDateFrom('');
    setDateTo('');
    setTimeout(() => {
      if (page === 1) fetch(1);
      else setPage(1);
    }, 0);
  };

  const hasFilters = typeFilter || dateFrom || dateTo;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        <select
          className="opt-select"
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{ fontSize: 12 }}
          value={typeFilter}
        >
          <option value="">All types</option>
          {EVENT_TYPES.map((t) => (
            <option
              key={t}
              value={t}
            >
              {t}
            </option>
          ))}
        </select>
        <input
          className="opt-input"
          onChange={(e) => setDateFrom(e.target.value)}
          style={{ fontSize: 12, width: 140 }}
          title="From date"
          type="date"
          value={dateFrom}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>–</span>
        <input
          className="opt-input"
          onChange={(e) => setDateTo(e.target.value)}
          style={{ fontSize: 12, width: 140 }}
          title="To date"
          type="date"
          value={dateTo}
        />
        <button
          className="shares-add-btn hover-fx"
          onClick={applyFilters}
          style={{ fontSize: 12 }}
          type="button"
        >
          Apply
        </button>
        {hasFilters && (
          <button
            className="shares-add-btn hover-fx"
            onClick={clearFilters}
            style={{ fontSize: 12 }}
            type="button"
          >
            Clear
          </button>
        )}
        <div style={{ flex: 1 }} />
        <Pagination
          activePage={page}
          onPageChange={(_, data) => {
            if (data.activePage >= 1) setPage(data.activePage);
          }}
          totalPages={totalPages}
        />
      </div>

      {loading ? (
        <LoaderSegment />
      ) : (
        <Table
          className="events-table, unstackable"
          compact="very"
        >
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell className="events-list-id">Id</Table.HeaderCell>
              <Table.HeaderCell className="events-list-timestamp">
                Timestamp
              </Table.HeaderCell>
              <Table.HeaderCell className="events-list-type">
                Type
              </Table.HeaderCell>
              <Table.HeaderCell className="events-list-data">
                Data
              </Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body className="events-table-body">
            {events?.length === 0 ? (
              <Table.Row>
                <Table.Cell
                  colSpan={99}
                  style={{
                    opacity: 0.5,
                    padding: '10px !important',
                    textAlign: 'center',
                  }}
                >
                  No events
                </Table.Cell>
              </Table.Row>
            ) : (
              events.map((event) => (
                <Table.Row key={event.id}>
                  <Table.Cell>
                    <Popup
                      content={event.id}
                      on="hover"
                      style={{ fontFamily: 'monospace', width: '400px' }}
                      trigger={<Icon name="info circle" />}
                      wide="very"
                    />
                  </Table.Cell>
                  <Table.Cell>
                    {replaceHyphensWithNonBreakingEquivalent(event.timestamp)}
                  </Table.Cell>
                  <Table.Cell>{event.type}</Table.Cell>
                  <Table.Cell className="events-table-data">
                    {JSON.stringify(JSON.parse(event.data), null, 2)}
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      )}
    </>
  );
};

export default Events;
