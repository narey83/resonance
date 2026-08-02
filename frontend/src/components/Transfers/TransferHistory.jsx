// <copyright file="TransferHistory.jsx" company="John Narey">
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

import './TransferHistory.css';
import { getTransferHistory } from '../../lib/reports';
import { formatBytes } from '../../lib/util';
import React, { useCallback, useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 50;

const DIRECTIONS = [
  { key: '', label: 'All' },
  { key: 'Upload', label: 'Uploads' },
  { key: 'Download', label: 'Downloads' },
];

// Matched as a substring against StateDescription, which reads like "Completed, Succeeded".
const STATES = [
  { key: '', label: 'Any' },
  { key: 'Succeeded', label: 'Succeeded' },
  { key: 'Errored', label: 'Errored' },
  { key: 'Cancelled', label: 'Cancelled' },
];

const RANGES = [
  { days: 1, label: '24h' },
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 365, label: '1y' },
  { days: 0, label: 'All' },
];

const shortName = (path) => (path ?? '').split(/[/\\]/).pop() || (path ?? '—');

const stateClass = (description = '') => {
  if (description.includes('Succeeded')) return 'th-state-ok';
  if (description.includes('Errored')) return 'th-state-error';
  if (description.includes('Cancelled')) return 'th-state-cancelled';
  return '';
};

const formatSpeed = (bytesPerSecond) =>
  bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : '—';

const formatWhen = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

const TransferHistory = () => {
  const [direction, setDirection] = useState('');
  const [state, setState] = useState('');
  const [rangeDays, setRangeDays] = useState(7);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Only the newest request may write to state. Filter changes arrive faster than a count over
  // 1.6M rows returns, so without this an older, slower response can land last and overwrite the
  // results for the filter the user is actually looking at.
  const requestId = useRef(0);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    try {
      const result = await getTransferHistory({
        direction: direction || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        search: search || undefined,
        start:
          rangeDays > 0
            ? new Date(Date.now() - rangeDays * 86_400_000).toISOString()
            : undefined,
        state: state || undefined,
      });

      if (id !== requestId.current) return;

      setItems(result.items ?? []);
      setTotal(result.total ?? 0);
      setTotalBytes(result.totalBytes ?? 0);
    } catch (loadError) {
      if (id !== requestId.current) return;
      setError(
        loadError?.response?.data ?? loadError?.message ?? 'Request failed',
      );
      setItems([]);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [direction, page, rangeDays, search, state]);

  useEffect(() => {
    load();
  }, [load]);

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const firstRow = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastRow = Math.min(total, (page + 1) * PAGE_SIZE);

  const chooseFilter = (setter) => (value) => {
    setter(value);
    setPage(0);
  };

  return (
    <div className="transfer-history">
      <div className="th-header">
        <div className="th-title">Transfer History</div>
        <div className="th-summary">
          {loading && items.length === 0
            ? 'Loading…'
            : `${total.toLocaleString()} transfers · ${formatBytes(totalBytes)}`}
        </div>
      </div>

      <div className="th-filters">
        <input
          className="th-search"
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search filename or peer…"
          type="text"
          value={searchInput}
        />

        <div className="th-chips">
          {DIRECTIONS.map((option) => (
            <button
              className={
                direction === option.key ? 'th-chip th-chip-on' : 'th-chip'
              }
              key={option.label}
              onClick={() => chooseFilter(setDirection)(option.key)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="th-chips">
          {STATES.map((option) => (
            <button
              className={
                state === option.key ? 'th-chip th-chip-on' : 'th-chip'
              }
              key={option.label}
              onClick={() => chooseFilter(setState)(option.key)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="th-chips">
          {RANGES.map((option) => (
            <button
              className={
                rangeDays === option.days ? 'th-chip th-chip-on' : 'th-chip'
              }
              key={option.label}
              onClick={() => chooseFilter(setRangeDays)(option.days)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className="th-error">{String(error)}</div> : null}

      <div className="th-table-wrap">
        <table className="th-table">
          <thead>
            <tr>
              <th>Finished</th>
              <th>Dir</th>
              <th>Peer</th>
              <th>File</th>
              <th className="th-right">Size</th>
              <th className="th-right">Speed</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="th-nowrap">{formatWhen(item.endedAt)}</td>
                <td>{item.direction}</td>
                <td className="th-nowrap">{item.username}</td>
                <td
                  className="th-file"
                  title={item.filename}
                >
                  {shortName(item.filename)}
                </td>
                <td className="th-right th-nowrap">{formatBytes(item.size)}</td>
                <td className="th-right th-nowrap">
                  {formatSpeed(item.averageSpeed)}
                </td>
                <td className={stateClass(item.stateDescription)}>
                  {item.stateDescription}
                  {item.exception ? (
                    <span
                      className="th-exception"
                      title={item.exception}
                    >
                      {item.exception}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && items.length === 0 && !error ? (
          <div className="th-empty">No transfers match these filters</div>
        ) : null}
      </div>

      <div className="th-pager">
        <button
          disabled={page === 0 || loading}
          onClick={() => setPage(0)}
          type="button"
        >
          « First
        </button>
        <button
          disabled={page === 0 || loading}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          type="button"
        >
          ‹ Prev
        </button>
        <span className="th-pager-info">
          {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of{' '}
          {total.toLocaleString()}
        </span>
        <button
          disabled={page >= lastPage || loading}
          onClick={() => setPage((p) => p + 1)}
          type="button"
        >
          Next ›
        </button>
      </div>
    </div>
  );
};

export default TransferHistory;
