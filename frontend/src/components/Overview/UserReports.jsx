// <copyright file="UserReports.jsx" company="John Narey">
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

import * as reportsAPI from '../../lib/reports';
import { onTransferComplete } from '../../lib/transferEvents';
import { formatBytes, formatDate } from '../../lib/util';
import UsernameLink from '../Shared/UsernameLink';
import {
  Building2,
  Clock,
  FileMusic,
  Flag,
  Gauge,
  HardDrive,
  Network,
  RotateCcw,
  TriangleAlert,
  User,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 50;
const AUTO_REFRESH_MS = 30_000;
// A busy server can complete many transfers per second; coalesce the resulting
// live-refresh triggers so we never refetch the list more than once per window.
const LIVE_REFRESH_COOLDOWN_MS = 2_500;

// Every column is sortable; `num` right-aligns and picks the numeric sort key.
// Keys match the backend UserReportSortBy enum (parsed case-insensitively).
const COLUMNS = [
  { key: 'Username', label: 'User', Icon: User },
  { key: 'IpAddress', label: 'IP', Icon: Network },
  { key: 'Country', label: 'Country', Icon: Flag },
  { key: 'City', label: 'City', Icon: Building2 },
  { key: 'LastSeen', label: 'Last Seen', Icon: Clock, num: true },
  { key: 'UploadCount', label: 'UL Files', Icon: FileMusic, num: true },
  { key: 'UploadBytes', label: 'UL Data', Icon: HardDrive, num: true },
  { key: 'DownloadCount', label: 'DL Files', Icon: FileMusic, num: true },
  { key: 'DownloadBytes', label: 'DL Data', Icon: HardDrive, num: true },
  { key: 'Errors', label: 'Errors', Icon: TriangleAlert, num: true },
  { key: 'UploadSpeed', label: 'UL Speed', Icon: Gauge, num: true },
  { key: 'DownloadSpeed', label: 'DL Speed', Icon: Gauge, num: true },
];

const formatSpeed = (speed) => (speed > 0 ? `${formatBytes(speed)}/s` : '—');

const SortHeader = ({ col, onSort, sortBy, sortOrder }) => {
  const active = sortBy === col.key;
  const arrow = active ? (sortOrder === 'DESC' ? ' ▼' : ' ▲') : '';
  const { Icon } = col;
  return (
    <th
      className={`user-reports-th${col.num ? ' user-reports-num' : ''}${active ? ' active' : ''}`}
      onClick={() => onSort(col.key)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      <span className="user-reports-th-inner">
        <Icon
          className="user-reports-th-icon"
          size={13}
          strokeWidth={1.75}
        />
        {col.label}
        {arrow}
      </span>
    </th>
  );
};

const UserReports = () => {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState('LastSeen');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [search, setSearch] = useState(
    () => new URLSearchParams(window.location.search).get('user') ?? '',
  );
  const [searchInput, setSearchInput] = useState(
    () => new URLSearchParams(window.location.search).get('user') ?? '',
  );
  const [loading, setLoading] = useState(true);
  // Non-destructive in-flight flag for user-initiated page navigation. Unlike
  // `loading` (which clears the table on search/sort), this dims the existing
  // rows and shows a spinner so flicking pages has immediate feedback. It is
  // deliberately not set by the silent 30s background refresh.
  const [paging, setPaging] = useState(false);
  const [page, setPage] = useState(0);
  // Local text for the editable page-number box; kept in sync with `page` so
  // programmatic navigation (prev/next/reset) updates the field too.
  const [pageInput, setPageInput] = useState('1');
  const [tick, setTick] = useState(0);
  const [newUsernames, setNewUsernames] = useState(() => new Set());
  const debounceRef = useRef(null);
  const scrollRef = useRef(null);
  // Tracks the usernames last seen for the current view (page/search/sort).
  // Used to flash rows that appear on a background auto-refresh; reset to null
  // whenever the view context changes so we don't flash the whole list.
  const seenRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const ctxKey = `${page}|${search}|${sortBy}|${sortOrder}`;
    reportsAPI
      .getUserList({
        search: search || undefined,
        sortBy,
        sortOrder,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then(({ items: rows, total: t }) => {
        if (!cancelled) {
          const keys = rows
            .map((r) => r.username ?? r.Username)
            .filter(Boolean);
          const prev = seenRef.current;
          // Only flash on refreshes within the same view; a fresh context
          // (first load, new search/sort/page) seeds the baseline silently.
          if (prev && prev.ctx === ctxKey) {
            const fresh = keys.filter((k) => !prev.set.has(k));
            setNewUsernames(new Set(fresh));
          } else {
            setNewUsernames(new Set());
          }

          seenRef.current = { ctx: ctxKey, set: new Set(keys) };
          setItems(rows);
          setTotal(t);
          setLoading(false);
          setPaging(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setTotal(0);
          setLoading(false);
          setPaging(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [page, search, sortBy, sortOrder, tick]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [page]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Live refresh: a completed peer transfer means the user list just changed,
  // so refetch immediately instead of waiting for the poll. Leading-edge
  // throttle — refresh at once on the first event, then coalesce any burst
  // into a single trailing refresh per cooldown window.
  useEffect(() => {
    let cooldownTimer = null;
    let pending = false;

    const settle = () => {
      if (pending) {
        pending = false;
        setTick((t) => t + 1);
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

      setTick((t) => t + 1);
      cooldownTimer = setTimeout(settle, LIVE_REFRESH_COOLDOWN_MS);
    });

    return () => {
      off();
      if (cooldownTimer) clearTimeout(cooldownTimer);
    };
  }, []);

  const pageCount = Math.ceil(total / PAGE_SIZE);

  // Reflect the current page in the editable box whenever it changes for any
  // reason (prev/next buttons, reset, search clamping back to page 0).
  useEffect(() => {
    setPageInput(String(page + 1));
  }, [page]);

  // Navigate to a 0-based page, clamped to range and skipping no-op jumps.
  const goToPage = (target) => {
    const clamped = Math.max(0, Math.min(target, pageCount - 1));
    if (clamped === page) {
      setPageInput(String(page + 1));
      return;
    }

    setPaging(true);
    setPage(clamped);
  };

  // Parse the page box (1-based) and jump; revert to the current page if the
  // entry is blank or not a number.
  const commitPageInput = () => {
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isNaN(parsed)) {
      setPageInput(String(page + 1));
      return;
    }

    goToPage(parsed - 1);
  };

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(value);
      setLoading(true);
      setItems([]);
      setPage(0);
    }, 300);
  };

  const handleSort = (col) => {
    setLoading(true);
    setItems([]);
    setPage(0);
    if (col === sortBy) {
      setSortOrder((o) => (o === 'DESC' ? 'ASC' : 'DESC'));
    } else {
      setSortBy(col);
      setSortOrder('DESC');
    }
  };

  // Back to the pristine view: no filter, sorted by most recently seen.
  const isDefaultView =
    searchInput === '' && sortBy === 'LastSeen' && sortOrder === 'DESC';

  const handleReset = () => {
    clearTimeout(debounceRef.current);
    setSearchInput('');
    setSearch('');
    setSortBy('LastSeen');
    setSortOrder('DESC');
    setLoading(true);
    setItems([]);
    setPage(0);
  };

  return (
    <div className="section-card user-reports-card">
      <div className="section-card-header">
        <span className="section-card-title">User Activity</span>
        <span className="user-reports-total">
          {total.toLocaleString()} users
        </span>
      </div>

      <div className="user-reports-search-row">
        <input
          className="user-reports-search"
          onChange={handleSearchChange}
          placeholder="Filter by username, IP, country, city…"
          type="text"
          value={searchInput}
        />
        <button
          className="user-reports-reset hover-fx"
          disabled={isDefaultView}
          onClick={handleReset}
          title="Clear the filter and sort by Last Seen"
          type="button"
        >
          <RotateCcw
            size={13}
            strokeWidth={1.75}
          />
          Reset
        </button>
      </div>

      {loading ? (
        <div className="leaderboard-empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="leaderboard-empty">No users found</div>
      ) : (
        <div
          className={`user-reports-scroll${paging ? ' user-reports-scroll--paging' : ''}`}
          ref={scrollRef}
        >
          {paging && (
            <div
              aria-hidden="true"
              className="user-reports-paging-overlay"
            >
              <div className="overview-glass-spinner" />
            </div>
          )}
          <table className="leaderboard-table user-reports-table">
            <thead className="user-reports-thead">
              <tr>
                {COLUMNS.map((col) => (
                  <SortHeader
                    col={col}
                    key={col.key}
                    onSort={handleSort}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((u, index) => {
                const errors =
                  (u.uploadErrorCount ?? u.UploadErrorCount ?? 0) +
                  (u.downloadErrorCount ?? u.DownloadErrorCount ?? 0);
                const lastSeen = u.lastSeen ?? u.LastSeen;
                const username = u.username ?? u.Username;
                return (
                  <tr
                    className={
                      newUsernames.has(username)
                        ? 'user-reports-row--new'
                        : undefined
                    }
                    key={username ?? index}
                  >
                    <td className="leaderboard-username">
                      <UsernameLink username={u.username ?? u.Username} />
                    </td>
                    <td className="user-reports-network">
                      {u.ipAddress ?? u.IpAddress ?? '—'}
                    </td>
                    <td className="user-reports-network">
                      {u.country ?? u.Country ?? '—'}
                    </td>
                    <td className="user-reports-network">
                      {u.city ?? u.City ?? '—'}
                    </td>
                    <td className="user-reports-num">
                      {lastSeen ? formatDate(lastSeen) : '—'}
                    </td>
                    <td className="user-reports-num">
                      {(u.uploadCount ?? u.UploadCount ?? 0).toLocaleString()}
                    </td>
                    <td className="user-reports-num">
                      {formatBytes(u.uploadBytes ?? u.UploadBytes ?? 0)}
                    </td>
                    <td className="user-reports-num">
                      {(
                        u.downloadCount ??
                        u.DownloadCount ??
                        0
                      ).toLocaleString()}
                    </td>
                    <td className="user-reports-num">
                      {formatBytes(u.downloadBytes ?? u.DownloadBytes ?? 0)}
                    </td>
                    <td
                      className="user-reports-num"
                      style={{
                        color: errors > 0 ? 'var(--danger)' : undefined,
                      }}
                    >
                      {errors > 0 ? errors.toLocaleString() : '—'}
                    </td>
                    <td className="user-reports-num">
                      {formatSpeed(
                        u.uploadAverageSpeed ?? u.UploadAverageSpeed ?? 0,
                      )}
                    </td>
                    <td className="user-reports-num">
                      {formatSpeed(
                        u.downloadAverageSpeed ?? u.DownloadAverageSpeed ?? 0,
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="user-reports-pagination">
          <button
            className="user-report-page-btn"
            disabled={page === 0 || paging}
            onClick={() => goToPage(0)}
            title="First page"
            type="button"
          >
            «
          </button>
          <button
            className="user-report-page-btn"
            disabled={page === 0 || paging}
            onClick={() => goToPage(page - 1)}
            title="Previous page"
            type="button"
          >
            ‹
          </button>
          <span className="user-report-page-info">
            <input
              aria-label="Page number"
              className="user-report-page-input"
              disabled={paging}
              inputMode="numeric"
              onBlur={commitPageInput}
              onChange={(e) =>
                setPageInput(e.target.value.replaceAll(/\D/g, ''))
              }
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              value={pageInput}
            />
            <span className="user-report-page-total">/ {pageCount}</span>
          </span>
          <button
            className="user-report-page-btn"
            disabled={page >= pageCount - 1 || paging}
            onClick={() => goToPage(page + 1)}
            title="Next page"
            type="button"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
};

export default UserReports;
