import * as reportsAPI from '../../lib/reports';
import { formatBytes, formatDate } from '../../lib/util';
import UsernameLink from '../Shared/UsernameLink';
import UserReportModal from './UserReportModal';
import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useEffect, useRef, useState } from 'react';

const ROW_HEIGHT = 33;
const FETCH_LIMIT = 500;
const AUTO_REFRESH_MS = 30_000;
const COL_COUNT = 12;

const SORT_COLS = [
  { key: 'LastSeen', label: 'Last Seen' },
  { key: 'UploadCount', label: 'UL Files' },
  { key: 'UploadBytes', label: 'UL Data' },
  { key: 'DownloadCount', label: 'DL Files' },
  { key: 'DownloadBytes', label: 'DL Data' },
  { key: 'Errors', label: 'Errors' },
];

const formatSpeed = (speed) => (speed > 0 ? `${formatBytes(speed)}/s` : '—');

const SortHeader = ({ col, onSort, sortBy, sortOrder }) => {
  const active = sortBy === col.key;
  const arrow = active ? (sortOrder === 'DESC' ? ' ▼' : ' ▲') : '';
  return (
    <th
      className={`user-reports-th user-reports-num${active ? ' active' : ''}`}
      onClick={() => onSort(col.key)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      {col.label}
      {arrow}
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
  const [selectedUser, setSelectedUser] = useState(null);
  const [tick, setTick] = useState(0);
  const debounceRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    reportsAPI
      .getUserList({
        search: search || undefined,
        sortBy,
        sortOrder,
        limit: FETCH_LIMIT,
        offset: 0,
      })
      .then(({ items: rows, total: t }) => {
        if (!cancelled) {
          setItems(rows);
          setTotal(t);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setTotal(0);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [search, sortBy, sortOrder, tick]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchInput(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(value);
      setLoading(true);
      setItems([]);
    }, 300);
  };

  const handleSort = (col) => {
    setLoading(true);
    setItems([]);
    if (col === sortBy) {
      setSortOrder((o) => (o === 'DESC' ? 'ASC' : 'DESC'));
    } else {
      setSortBy(col);
      setSortOrder('DESC');
    }
  };

  return (
    <>
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
        </div>

        {loading ? (
          <div className="leaderboard-empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="leaderboard-empty">No users found</div>
        ) : (
          <div
            className="user-reports-scroll"
            ref={scrollRef}
          >
            <table className="leaderboard-table user-reports-table">
              <thead className="user-reports-thead">
                <tr>
                  <th className="user-reports-th">User</th>
                  <th className="user-reports-th">IP</th>
                  <th className="user-reports-th">Country</th>
                  <th className="user-reports-th">City</th>
                  {SORT_COLS.map((col) => (
                    <SortHeader
                      col={col}
                      key={col.key}
                      onSort={handleSort}
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                    />
                  ))}
                  <th className="user-reports-th user-reports-num">UL Speed</th>
                  <th className="user-reports-th user-reports-num">DL Speed</th>
                </tr>
              </thead>
              <tbody>
                {paddingTop > 0 && (
                  <tr>
                    <td
                      colSpan={COL_COUNT}
                      style={{ height: paddingTop, padding: 0, border: 'none' }}
                    />
                  </tr>
                )}
                {virtualItems.map((vRow) => {
                  const u = items[vRow.index];
                  const errors =
                    (u.uploadErrorCount ?? u.UploadErrorCount ?? 0) +
                    (u.downloadErrorCount ?? u.DownloadErrorCount ?? 0);
                  const lastSeen = u.lastSeen ?? u.LastSeen;
                  return (
                    <tr
                      key={vRow.key}
                      onClick={() => setSelectedUser(u.username ?? u.Username)}
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
                {paddingBottom > 0 && (
                  <tr>
                    <td
                      colSpan={COL_COUNT}
                      style={{
                        height: paddingBottom,
                        padding: 0,
                        border: 'none',
                      }}
                    />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedUser && (
        <UserReportModal
          onClose={() => setSelectedUser(null)}
          username={selectedUser}
        />
      )}
    </>
  );
};

export default UserReports;
