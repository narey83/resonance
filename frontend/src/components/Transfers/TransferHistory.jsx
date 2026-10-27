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
import { getTransferAttempts, getTransferHistory } from '../../lib/reports';
import { onTransferComplete } from '../../lib/transferEvents';
import { formatBitrate, formatBytes } from '../../lib/util';
import UsernameLink from '../Shared/UsernameLink';
import { historyOutcome } from './transferHistoryState';
import { RefreshCw, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { unstable_batchedUpdates as batchUpdates } from 'react-dom';
import { Modal } from 'semantic-ui-react';

const PAGE_SIZE = 50;
const AUTO_REFRESH_MS = 30_000;
const LIVE_REFRESH_COOLDOWN_MS = 2_500;
const COLUMN_WIDTHS_KEY = 'resonance-transfer-history-column-widths';
const MIN_COLUMN_WIDTH = 64;

const COLUMNS = [
  { key: 'finished', label: 'Finished', width: 180 },
  { key: 'direction', label: 'Dir', width: 90 },
  { key: 'peer', label: 'Peer', width: 150 },
  { key: 'file', label: 'File', width: 360 },
  { key: 'size', label: 'Size', numeric: true, width: 110 },
  { key: 'speed', label: 'Speed', numeric: true, width: 120 },
  { key: 'outcome', label: 'Outcome', width: 260 },
];

const defaultColumnWidths = Object.fromEntries(
  COLUMNS.map(({ key, width }) => [key, width]),
);

const loadColumnWidths = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMN_WIDTHS_KEY));
    return Object.fromEntries(
      COLUMNS.map(({ key, width }) => [
        key,
        Math.max(MIN_COLUMN_WIDTH, Number(saved?.[key]) || width),
      ]),
    );
  } catch {
    // A malformed or unavailable preference should never prevent the table loading.
  }

  return defaultColumnWidths;
};

const DIRECTIONS = [
  { key: '', label: 'All' },
  { key: 'Upload', label: 'Uploads' },
  { key: 'Download', label: 'Downloads' },
];

// Outcome filters preserve the backend state names; labels describe the result.
const STATES = [
  { key: '', label: 'Any' },
  { key: 'Succeeded', label: 'Succeeded' },
  { key: 'Failed', label: 'Failed' },
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

const stateClass = (description) => historyOutcome(description).className;

const formatSpeed = (bytesPerSecond) =>
  bytesPerSecond > 0 ? formatBitrate(bytesPerSecond) : '—';

const formatWhen = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

const retryNote = (count) =>
  count === 1
    ? 'Retried — show attempts'
    : `Retried after ${count} failed attempts`;

const transferDuration = (item) => {
  const start = new Date(item.startedAt).getTime();
  const end = new Date(item.endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return '—';

  const seconds = Math.round((end - start) / 1_000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
};

const TransferDetail = ({ item, onClose }) => {
  const details = [
    ['Direction', item.direction],
    ['Outcome', historyOutcome(item.stateDescription).label],
    ['Requested', formatWhen(item.requestedAt)],
    ['Queued', formatWhen(item.enqueuedAt)],
    ['Started', formatWhen(item.startedAt)],
    ['Finished', formatWhen(item.endedAt)],
    ['Duration', transferDuration(item)],
    ['File size', formatBytes(item.size)],
    ['Transferred', formatBytes(item.bytesTransferred)],
    ['Average speed', formatSpeed(item.averageSpeed)],
    ['Transfer ID', item.id],
    ['Retry of', item.retryOfId || '—'],
    ['Prior failed attempts', item.priorFailedAttempts ?? 0],
  ];

  return (
    <Modal
      centered
      onClose={onClose}
      open
      size="small"
    >
      <div className="th-detail">
        <div className="th-detail-header">
          <div>
            <div className="th-detail-title">Transfer details</div>
            <UsernameLink username={item.username} />
          </div>
          <button
            aria-label="Close transfer details"
            className="th-detail-close"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        <div
          className="th-detail-file"
          title={item.filename}
        >
          {item.filename || '—'}
        </div>
        <dl className="th-detail-grid">
          {details.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value ?? '—'}</dd>
            </React.Fragment>
          ))}
        </dl>
        {item.exception ? (
          <div className="th-detail-exception">
            <strong>Error</strong>
            <span>{item.exception}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [columnWidths, setColumnWidths] = useState(loadColumnWidths);
  const [resizingColumn, setResizingColumn] = useState(null);

  // Attempt history for a retried transfer is fetched on demand (one row expanded at a time)
  // rather than bundled into every page load, since most rows have no retries to show.
  const [expandedId, setExpandedId] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);

  // Only the newest request may write to state. Filter changes arrive faster than a count over
  // 1.6M rows returns, so without this an older, slower response can land last and overwrite the
  // results for the filter the user is actually looking at.
  const requestId = useRef(0);
  const attemptsRequestId = useRef(0);
  const resizeRef = useRef(null);
  const activeRequest = useRef(null);
  const attemptsController = useRef(null);
  const windowEnd = useRef(null);

  useEffect(() => {
    if (!resizingColumn) return undefined;

    const resize = (event) => {
      const { key, startWidth, startX } = resizeRef.current;
      setColumnWidths((current) => ({
        ...current,
        [key]: Math.max(MIN_COLUMN_WIDTH, startWidth + event.clientX - startX),
      }));
    };

    const finish = () => {
      setResizingColumn(null);
      setColumnWidths((current) => {
        try {
          localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(current));
        } catch {
          // Resizing still works for this session when storage is unavailable.
        }

        return current;
      });
    };

    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finish, { once: true });
    return () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finish);
    };
  }, [resizingColumn]);

  useEffect(() => {
    if (searchInput.trim() === search) return undefined;
    const handle = setTimeout(() => {
      // React 16 does not automatically batch timer updates: avoid querying the old page first.
      batchUpdates(() => {
        setSearch(searchInput.trim());
        setPage(0);
      });
    }, 350);
    return () => clearTimeout(handle);
  }, [search, searchInput]);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      // Completion events and the fallback timer must share one in-flight request.
      if (silent && (activeRequest.current || document.hidden)) return;
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      const id = ++requestId.current;
      const end =
        page === 0 || !windowEnd.current
          ? new Date().toISOString()
          : windowEnd.current;
      windowEnd.current = end;
      if (silent) setRefreshing(true);
      else {
        setLoading(true);
        setRefreshing(false);
        setItems([]);
        setTotal(0);
      }

      setError(null);

      try {
        const result = await getTransferHistory({
          direction: direction || undefined,
          end,
          signal: controller.signal,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          search: search || undefined,
          start:
            rangeDays > 0
              ? new Date(
                  new Date(end).getTime() - rangeDays * 86_400_000,
                ).toISOString()
              : undefined,
          state: state || undefined,
        });

        if (id !== requestId.current || controller.signal.aborted) return;

        setItems(result.items ?? []);
        setTotal(result.total ?? 0);
        setLastUpdated(new Date());
      } catch (loadError) {
        if (id !== requestId.current || controller.signal.aborted) return;
        setError(
          loadError?.response?.data ?? loadError?.message ?? 'Request failed',
        );
        if (!silent) setItems([]);
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
          // eslint-disable-next-line require-atomic-updates -- The request ID guard above owns this ref.
          activeRequest.current = null;
        }
      }
    },
    [direction, page, rangeDays, search, state],
  );

  useEffect(() => {
    load();
    setExpandedId(null);
    setAttempts([]);
    return () => {
      requestId.current += 1;
      activeRequest.current?.abort();
      activeRequest.current = null;
      attemptsRequestId.current += 1;
      attemptsController.current?.abort();
    };
  }, [load]);

  // The application hub emits transfer-complete events. Refresh promptly on the first event,
  // coalesce bursts from busy queues, and retain a modest poll as a fallback after reconnects.
  useEffect(() => {
    let cooldownTimer = null;
    let pending = false;

    const refresh = () => load({ silent: true });
    const settle = () => {
      if (pending) {
        pending = false;
        refresh();
        cooldownTimer = setTimeout(settle, LIVE_REFRESH_COOLDOWN_MS);
      } else {
        cooldownTimer = null;
      }
    };

    const off = onTransferComplete(() => {
      if (cooldownTimer) {
        pending = true;
        return;
      }

      refresh();
      cooldownTimer = setTimeout(settle, LIVE_REFRESH_COOLDOWN_MS);
    });
    const pollTimer = setInterval(refresh, AUTO_REFRESH_MS);

    return () => {
      off();
      clearInterval(pollTimer);
      if (cooldownTimer) clearTimeout(cooldownTimer);
    };
  }, [load]);

  const toggleAttempts = useCallback(
    async (item) => {
      attemptsController.current?.abort();
      if (expandedId === item.id) {
        attemptsRequestId.current += 1;
        setExpandedId(null);
        return;
      }

      const controller = new AbortController();
      attemptsController.current = controller;
      const id = ++attemptsRequestId.current;
      setExpandedId(item.id);
      setAttempts([]);
      setAttemptsLoading(true);

      try {
        const result = await getTransferAttempts(item.id, {
          signal: controller.signal,
        });
        if (id === attemptsRequestId.current && !controller.signal.aborted)
          setAttempts(result ?? []);
      } catch {
        if (id === attemptsRequestId.current && !controller.signal.aborted)
          setAttempts([]);
      } finally {
        if (id === attemptsRequestId.current && !controller.signal.aborted)
          setAttemptsLoading(false);
      }
    },
    [expandedId],
  );

  const hasMore = total > (page + 1) * PAGE_SIZE;
  const firstRow = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastRow = page * PAGE_SIZE + items.length;

  const chooseFilter = (setter) => (value) => {
    setter(value);
    setPage(0);
  };

  const startColumnResize = (event, key) => {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      key,
      startWidth: columnWidths[key],
      startX: event.clientX,
    };
    setResizingColumn(key);
  };

  const renderCell = (item, key) => {
    switch (key) {
      case 'finished':
        return <td className="th-nowrap">{formatWhen(item.endedAt)}</td>;
      case 'direction':
        return <td>{item.direction}</td>;
      case 'peer':
        return (
          <td className="th-nowrap th-peer">
            <UsernameLink username={item.username} />
          </td>
        );
      case 'file':
        return (
          <td
            className="th-file"
            title={item.filename}
          >
            {shortName(item.filename)}
          </td>
        );
      case 'size':
        return <td className="th-right th-nowrap">{formatBytes(item.size)}</td>;
      case 'speed':
        return (
          <td className="th-right th-nowrap">
            {formatSpeed(item.averageSpeed)}
          </td>
        );
      case 'outcome':
        return (
          <td className={stateClass(item.stateDescription)}>
            {historyOutcome(item.stateDescription).label}
            {item.exception ? (
              <span
                className="th-exception"
                title={item.exception}
              >
                {item.exception}
              </span>
            ) : null}
            {item.priorFailedAttempts > 0 ? (
              <button
                className="th-retry-note"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleAttempts(item);
                }}
                type="button"
              >
                {retryNote(item.priorFailedAttempts)}
                {expandedId === item.id ? ' ▲' : ' ▾'}
              </button>
            ) : null}
          </td>
        );
      default:
        return null;
    }
  };

  return (
    <div className="transfer-history">
      <div className="th-header">
        <div className="th-title">Transfer History</div>
        <div className="th-header-actions">
          <div className="th-summary">
            {loading && items.length === 0
              ? 'Loading…'
              : `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} transfers`}
            {lastUpdated ? (
              <span title={lastUpdated.toLocaleString()}>
                {' · '}Updated {lastUpdated.toLocaleTimeString()}
              </span>
            ) : null}
          </div>
          <button
            aria-label="Refresh transfer history"
            className="th-refresh"
            disabled={loading || refreshing}
            onClick={() => load({ silent: true })}
            title="Refresh now"
            type="button"
          >
            <RefreshCw
              className={
                refreshing ? 'th-refresh-icon th-spinning' : 'th-refresh-icon'
              }
              size={15}
            />
            Refresh
          </button>
        </div>
      </div>

      <div className="th-filters">
        <input
          aria-label="Search transfer history"
          className="th-search"
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search filename or peer…"
          type="text"
          value={searchInput}
        />

        <div className="th-chips">
          {DIRECTIONS.map((option) => (
            <button
              aria-pressed={direction === option.key}
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
              aria-pressed={state === option.key}
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
              aria-pressed={rangeDays === option.days}
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

      <div
        className={refreshing ? 'th-table-wrap th-refreshing' : 'th-table-wrap'}
      >
        <table
          className="th-table"
          style={{
            width: COLUMNS.reduce((sum, { key }) => sum + columnWidths[key], 0),
          }}
        >
          <colgroup>
            {COLUMNS.map(({ key }) => (
              <col
                key={key}
                style={{ width: columnWidths[key] }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  className={column.numeric ? 'th-right' : undefined}
                  key={column.key}
                >
                  {column.label}
                  <span
                    aria-label={`Resize ${column.label} column`}
                    aria-orientation="vertical"
                    className={`th-resize-handle${resizingColumn === column.key ? ' th-resizing' : ''}`}
                    onPointerDown={(event) =>
                      startColumnResize(event, column.key)
                    }
                    role="separator"
                    title={`Drag to resize ${column.label}`}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <React.Fragment key={item.id}>
                <tr
                  className="th-transfer-row"
                  onClick={() => setSelectedItem(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedItem(item);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  title="View transfer details"
                >
                  {COLUMNS.map(({ key }) => (
                    <React.Fragment key={key}>
                      {renderCell(item, key)}
                    </React.Fragment>
                  ))}
                </tr>

                {expandedId === item.id ? (
                  <tr className="th-attempts-row">
                    <td colSpan={COLUMNS.length}>
                      {attemptsLoading ? (
                        <div className="th-attempts-loading">
                          Loading attempts…
                        </div>
                      ) : (
                        <table className="th-attempts-table">
                          <tbody>
                            {attempts.map((attempt) => (
                              <tr key={attempt.id}>
                                <td className="th-nowrap">
                                  {formatWhen(attempt.endedAt)}
                                </td>
                                <td
                                  className={stateClass(
                                    attempt.stateDescription,
                                  )}
                                >
                                  {
                                    historyOutcome(attempt.stateDescription)
                                      .label
                                  }
                                  {attempt.exception ? (
                                    <span
                                      className="th-exception"
                                      title={attempt.exception}
                                    >
                                      {attempt.exception}
                                    </span>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
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
          {loading
            ? 'Loading…'
            : `${firstRow.toLocaleString()}–${lastRow.toLocaleString()}`}
        </span>
        <button
          disabled={!hasMore || loading}
          onClick={() => setPage((p) => p + 1)}
          type="button"
        >
          Next ›
        </button>
      </div>

      {selectedItem ? (
        <TransferDetail
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      ) : null}
    </div>
  );
};

export default TransferHistory;
