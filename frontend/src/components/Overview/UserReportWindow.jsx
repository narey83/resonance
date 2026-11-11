// <copyright file="UserReportWindow.jsx" company="John Narey">
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
  blockUser,
  isBlocked,
  unblockUser,
  useBlockedUsers,
} from '../../lib/blockedUsers';
import {
  tooltipContentStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from '../../lib/chartTheme';
import * as reportsAPI from '../../lib/reports';
import * as usersAPI from '../../lib/users';
import {
  formatBitrate,
  formatBytes,
  formatDate,
  getFileName,
  parseUtcDate,
} from '../../lib/util';
import {
  dockWindow,
  dropWindow,
  raiseWindow,
  undockWindow,
  useFloatingWindow,
} from '../../lib/windowDock';
import { avatarColor, avatarInitial } from '../Chat/chatUtils';
import {
  Ban,
  ExternalLink,
  Gauge,
  Layers,
  ListMusic,
  MapPin,
  MessageSquare,
  Minus,
  Network,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useHistory } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

const PAGE_SIZE = 25;

// The activity trend covers a fixed trailing window at daily resolution; the
// all-time totals come from the detail endpoint instead, which defaults to the
// application genesis date.
const TREND_DAYS = 90;
const TREND_INTERVAL_MINUTES = 1_440;

// The filename filter runs server-side (a page holds 25 of potentially
// thousands of records), so hold off until typing settles.
const SEARCH_DEBOUNCE_MS = 300;

const stopRowKeyboardActivation = (event) => {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
};

const formatSpeed = (speed) => (speed > 0 ? formatBitrate(speed) : '—');

// Show only the immediate parent folder, dropping the share-root segments
// (e.g. "music\") — matches the Uploads/Downloads tables.
const leafFolder = (fullPath) =>
  fullPath.split(/[/\\]/u).filter(Boolean).slice(0, -1).at(-1) ?? '';

const relativeTime = (value) => {
  const date = parseUtcDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1_000);
  if (seconds < 90) return 'just now';
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86_400)}d ago`;
  return `${Math.floor(seconds / 2_592_000)}mo ago`;
};

const STATE_COLORS = {
  Succeeded: 'var(--success)',
  Errored: 'var(--danger)',
  TimedOut: 'var(--danger)',
  Rejected: 'var(--warning)',
  Aborted: 'var(--warning)',
  Cancelled: 'var(--text-muted)',
};

const stateColor = (desc) => {
  for (const [key, color] of Object.entries(STATE_COLORS)) {
    if (desc && desc.includes(key)) return color;
  }

  return 'var(--text-muted)';
};

// The detail payload is keyed by the C# enum names, but casing depends on the
// serializer settings in play; read both spellings at every level.
const pick = (object, key) =>
  object?.[key] ?? object?.[key[0].toLowerCase() + key.slice(1)];

// Flatten one direction of the detail payload into the numbers the UI needs.
const readDirection = (block) => {
  const stats = pick(block, 'Statistics') ?? {};
  const succeeded = pick(pick(block, 'Summary'), 'Succeeded') ?? {};

  return {
    total: pick(stats, 'Total') ?? 0,
    successful: pick(stats, 'Successful') ?? 0,
    errored: pick(stats, 'Errored') ?? 0,
    cancelled: pick(stats, 'Cancelled') ?? 0,
    bytes: pick(succeeded, 'TotalBytes') ?? 0,
    speed: pick(succeeded, 'AverageSpeed') ?? 0,
    exceptions: pick(block, 'Exceptions') ?? [],
  };
};

const sumDirectionBytes = (directionData) =>
  Object.values(directionData ?? {}).reduce(
    (sum, state) => sum + (pick(state, 'TotalBytes') ?? 0),
    0,
  );

// Histogram → one point per interval with the bytes moved each way.
const buildTrend = (histogram) => {
  if (!histogram || typeof histogram !== 'object') return [];
  return Object.entries(histogram)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, directions]) => ({
      date: parseUtcDate(timestamp).getTime(),
      up: sumDirectionBytes(pick(directions, 'Upload')),
      down: sumDirectionBytes(pick(directions, 'Download')),
    }));
};

const PRESENCE_TONE = {
  Online: 'online',
  Away: 'away',
  Offline: 'offline',
};

// ─── Presentational primitives ──────────────────────────────────────────────

const Chip = ({ children, icon: Icon, title, tone }) => (
  <span
    className={`user-report-chip${tone ? ` user-report-chip--${tone}` : ''}`}
    title={title}
  >
    {Icon ? (
      <Icon
        size={11}
        strokeWidth={2}
      />
    ) : null}
    {children}
  </span>
);

const Kpi = ({ hint, label, tone, value }) => (
  <div className="user-report-kpi">
    <span className="user-report-kpi-label">{label}</span>
    <span
      className={`user-report-kpi-value${tone ? ` user-report-kpi-value--${tone}` : ''}`}
    >
      {value}
    </span>
    {hint ? <span className="user-report-kpi-hint">{hint}</span> : null}
  </div>
);

const Panel = ({ action, children, className, title }) => (
  <section className={`user-report-panel${className ? ` ${className}` : ''}`}>
    <div className="user-report-panel-head">
      <span className="user-report-panel-title">{title}</span>
      {action}
    </div>
    {children}
  </section>
);

const TrendTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div style={tooltipContentStyle}>
      <div style={tooltipLabelStyle}>
        {new Date(point.date).toLocaleDateString('en', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </div>
      <div style={tooltipItemStyle}>↑ {formatBytes(point.up)} sent</div>
      <div style={tooltipItemStyle}>↓ {formatBytes(point.down)} received</div>
    </div>
  );
};

const ActivityTrend = ({ data }) => {
  const empty = data.every((d) => d.up === 0 && d.down === 0);

  if (data.length < 2 || empty) {
    return (
      <div className="user-report-trend-empty">
        No transfer activity in the last {TREND_DAYS} days
      </div>
    );
  }

  return (
    <ResponsiveContainer
      height={110}
      width="100%"
    >
      <AreaChart
        data={data}
        margin={{ bottom: 0, left: 0, right: 0, top: 6 }}
      >
        <defs>
          <linearGradient
            id="userReportUp"
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop
              offset="0%"
              stopColor="var(--success)"
              stopOpacity={0.45}
            />
            <stop
              offset="100%"
              stopColor="var(--success)"
              stopOpacity={0}
            />
          </linearGradient>
          <linearGradient
            id="userReportDown"
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop
              offset="0%"
              stopColor="var(--accent)"
              stopOpacity={0.45}
            />
            <stop
              offset="100%"
              stopColor="var(--accent)"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <XAxis
          axisLine={false}
          dataKey="date"
          minTickGap={48}
          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
          tickFormatter={(t) =>
            new Date(t).toLocaleDateString('en', {
              day: 'numeric',
              month: 'short',
            })
          }
          tickLine={false}
        />
        <Tooltip content={<TrendTooltip />} />
        <Area
          dataKey="up"
          fill="url(#userReportUp)"
          stroke="var(--success)"
          strokeWidth={1.5}
          type="monotone"
        />
        <Area
          dataKey="down"
          fill="url(#userReportDown)"
          stroke="var(--accent)"
          strokeWidth={1.5}
          type="monotone"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

const ExceptionList = ({ exceptions }) => {
  if (!exceptions?.length) return null;
  const top = exceptions.slice(0, 4);
  const max = Math.max(...top.map((ex) => pick(ex, 'Count') ?? 0), 1);

  return (
    <div className="user-report-exceptions">
      <div className="user-report-exceptions-title">Most common errors</div>
      {top.map((ex, index) => {
        const message = pick(ex, 'Exception') ?? 'Unknown';
        const count = pick(ex, 'Count') ?? 0;
        return (
          <div
            className="user-report-error-item"
            // eslint-disable-next-line react/no-array-index-key
            key={index}
          >
            <div className="user-report-error-top">
              <span
                className="user-report-error-msg"
                title={message}
              >
                {message}
              </span>
              <span className="user-report-error-count">
                {count.toLocaleString()}
              </span>
            </div>
            <div className="user-report-error-track">
              <div
                className="user-report-error-fill"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const DirectionPanel = ({ data, label, tone }) => {
  const successRate =
    data.total > 0 ? Math.round((data.successful / data.total) * 100) : null;

  return (
    <Panel
      className={`user-report-dir-panel user-report-dir-panel--${tone}`}
      title={label}
    >
      <div className="user-report-dir-headline">
        <span className="user-report-dir-bytes">{formatBytes(data.bytes)}</span>
        <span className="user-report-dir-sub">
          {data.successful.toLocaleString()} of {data.total.toLocaleString()}{' '}
          transfers
          {successRate == null ? '' : ` · ${successRate}% ok`}
        </span>
      </div>

      <div className="user-report-mix">
        {data.total > 0 ? (
          <>
            <div
              className="user-report-mix-seg user-report-mix-seg--ok"
              style={{ flexGrow: data.successful }}
              title={`${data.successful.toLocaleString()} succeeded`}
            />
            <div
              className="user-report-mix-seg user-report-mix-seg--err"
              style={{ flexGrow: data.errored }}
              title={`${data.errored.toLocaleString()} errored`}
            />
            <div
              className="user-report-mix-seg user-report-mix-seg--cancel"
              style={{ flexGrow: data.cancelled }}
              title={`${data.cancelled.toLocaleString()} cancelled`}
            />
          </>
        ) : (
          <div className="user-report-mix-seg user-report-mix-seg--none" />
        )}
      </div>

      <div className="user-report-dir-stats">
        <div className="user-report-mini-stat">
          <span className="user-report-mini-label">Avg speed</span>
          <span className="user-report-mini-value">
            {formatSpeed(data.speed)}
          </span>
        </div>
        <div className="user-report-mini-stat">
          <span className="user-report-mini-label">Errors</span>
          <span
            className={`user-report-mini-value${data.errored > 0 ? ' user-report-mini-value--danger' : ''}`}
          >
            {data.errored.toLocaleString()}
          </span>
        </div>
        <div className="user-report-mini-stat">
          <span className="user-report-mini-label">Cancelled</span>
          <span className="user-report-mini-value">
            {data.cancelled.toLocaleString()}
          </span>
        </div>
      </div>

      <ExceptionList exceptions={data.exceptions} />
    </Panel>
  );
};

// ─── Tabs ───────────────────────────────────────────────────────────────────

const OverviewTab = ({ detail, loading, trend, trendLoading }) => {
  if (loading) return <div className="user-report-loading">Loading…</div>;
  if (!detail) return <div className="user-report-empty">No transfer data</div>;

  const up = readDirection(pick(detail, 'Upload'));
  const down = readDirection(pick(detail, 'Download'));
  const totalBytes = up.bytes + down.bytes;
  const upPct = totalBytes > 0 ? (up.bytes / totalBytes) * 100 : 50;

  return (
    <div className="user-report-overview-tab">
      <Panel
        action={
          <span className="user-report-panel-note">Last {TREND_DAYS} days</span>
        }
        title="Activity"
      >
        {trendLoading ? (
          <div className="user-report-trend-empty">Loading…</div>
        ) : (
          <ActivityTrend data={trend} />
        )}
        <div className="user-report-legend">
          <span className="user-report-legend-item">
            <i className="user-report-swatch user-report-swatch--up" />
            Sent to them
          </span>
          <span className="user-report-legend-item">
            <i className="user-report-swatch user-report-swatch--down" />
            Received from them
          </span>
        </div>
      </Panel>

      <Panel title="Exchange balance">
        <div className="user-report-balance-track">
          <div
            className="user-report-balance-up"
            style={{ width: `${upPct}%` }}
          />
        </div>
        <div className="user-report-balance-labels">
          <span className="user-report-balance-up-label">
            ↑ {formatBytes(up.bytes)} sent
          </span>
          <span className="user-report-balance-down-label">
            ↓ {formatBytes(down.bytes)} received
          </span>
        </div>
      </Panel>

      <div className="user-report-dir-grid">
        <DirectionPanel
          data={up}
          label="Uploads to them"
          tone="up"
        />
        <DirectionPanel
          data={down}
          label="Downloads from them"
          tone="down"
        />
      </div>
    </div>
  );
};

const Pagination = ({ onPage, page, pageCount }) => {
  if (pageCount <= 1) return null;
  return (
    <div className="user-report-pagination">
      <button
        className="user-report-page-btn"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        type="button"
      >
        ‹
      </button>
      <span className="user-report-page-info">
        {page + 1} / {pageCount}
      </span>
      <button
        className="user-report-page-btn"
        disabled={page >= pageCount - 1}
        onClick={() => onPage(page + 1)}
        type="button"
      >
        ›
      </button>
    </div>
  );
};

const TransfersTab = ({ username }) => {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState('');
  const [loading, setLoading] = useState(true);
  // `input` is what's typed; `search` is what's been sent. Kept apart so the
  // field stays responsive while the request is debounced.
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(input.trim());
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input]);

  useEffect(() => {
    if (!username) return undefined;
    let cancelled = false;
    setLoading(true);
    reportsAPI
      .getUserTransfers({
        username,
        direction: direction || undefined,
        search: search || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then(({ items: rows, total: t }) => {
        if (cancelled) return;
        setItems(rows);
        setTotal(t);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [direction, page, search, username]);

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const filtering = search.length > 0;

  return (
    <div className="user-report-transfers-tab">
      <div className="user-report-tab-controls">
        <div className="user-report-segmented">
          {[
            { id: '', label: 'All' },
            { id: 'upload', label: 'Uploads' },
            { id: 'download', label: 'Downloads' },
          ].map((option) => (
            <button
              className={`user-report-segment${direction === option.id ? ' active' : ''}`}
              key={option.id || 'all'}
              onClick={() => {
                setDirection(option.id);
                setPage(0);
              }}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="user-report-search">
          <Search
            className="user-report-search-icon"
            size={12}
            strokeWidth={2}
          />
          <input
            className="user-report-search-input"
            onChange={(e) => setInput(e.target.value)}
            placeholder="Find a file…"
            type="text"
            value={input}
          />
          {input ? (
            <button
              className="user-report-search-clear"
              onClick={() => setInput('')}
              title="Clear filter"
              type="button"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>

        <span className="user-report-count">
          {total.toLocaleString()} {filtering ? 'matches' : 'records'}
        </span>
      </div>

      {loading ? (
        <div className="user-report-loading">Loading…</div>
      ) : items.length === 0 ? (
        <div className="user-report-empty">
          {filtering ? `No files matching “${search}”` : 'No transfers'}
        </div>
      ) : (
        <>
          <div className="user-report-table-scroll">
            <table className="user-report-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th className="user-report-num">Size</th>
                  <th>State</th>
                  <th className="user-report-num user-report-col-speed">
                    Speed
                  </th>
                  <th className="user-report-num user-report-col-date">Date</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => {
                  const filename = pick(t, 'Filename') ?? '';
                  const state = pick(t, 'StateDescription') ?? 'Unknown';
                  const dir = (pick(t, 'Direction') ?? '?').toLowerCase();
                  const endedAt = pick(t, 'EndedAt');
                  return (
                    <tr key={pick(t, 'Id')}>
                      <td>
                        <div
                          className="user-report-filename"
                          title={filename}
                        >
                          <span
                            className={`user-report-dir-badge user-report-dir-badge--${dir}`}
                          >
                            {dir[0].toUpperCase()}
                          </span>
                          <div className="user-report-filename-cell">
                            <span className="user-report-filename-text">
                              {getFileName(filename)}
                            </span>
                            <span className="user-report-folder-text">
                              {leafFolder(filename)}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="user-report-num">
                        {formatBytes(pick(t, 'Size') ?? 0)}
                      </td>
                      <td>
                        <span
                          className="user-report-state"
                          style={{ color: stateColor(state) }}
                          title={pick(t, 'Exception')}
                        >
                          {state.replace('Completed, ', '')}
                        </span>
                      </td>
                      <td className="user-report-num user-report-col-speed">
                        {state.includes('Succeeded')
                          ? formatSpeed(pick(t, 'AverageSpeed') ?? 0)
                          : '—'}
                      </td>
                      <td className="user-report-num user-report-date user-report-col-date">
                        {endedAt ? formatDate(endedAt) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            onPage={setPage}
            page={page}
            pageCount={pageCount}
          />
        </>
      )}
    </div>
  );
};

const BrowseTab = ({ username }) => {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    reportsAPI
      .getUserBrowseEvents({
        username,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then(({ items: rows, total: t }) => {
        setItems(rows);
        setTotal(t);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [page, username]);

  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="user-report-browse-tab">
      <div className="user-report-tab-controls">
        <span className="user-report-tab-hint">
          Each entry is a time this user requested your share list.
        </span>
        <span className="user-report-count">
          {total.toLocaleString()} events
        </span>
      </div>
      {loading ? (
        <div className="user-report-loading">Loading…</div>
      ) : items.length === 0 ? (
        <div className="user-report-empty">No browse history</div>
      ) : (
        <>
          <div className="user-report-browse-list">
            {items.map((ts) => (
              <div
                className="user-report-browse-item"
                key={ts}
              >
                <span className="user-report-browse-dot" />
                <span className="user-report-browse-when">
                  {formatDate(ts)}
                </span>
                <span className="user-report-browse-rel">
                  {relativeTime(ts)}
                </span>
              </div>
            ))}
          </div>
          <Pagination
            onPage={setPage}
            page={page}
            pageCount={pageCount}
          />
        </>
      )}
    </div>
  );
};

// ─── Modal ──────────────────────────────────────────────────────────────────

const UserReportWindow = ({ initialTab, onClose, seed, username, variant }) => {
  const history = useHistory();
  const [activeTab, setActiveTab] = useState(initialTab || 'overview');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [networkInfo, setNetworkInfo] = useState(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkOffline, setNetworkOffline] = useState(false);
  const [peer, setPeer] = useState(null);
  const [peerState, setPeerState] = useState('loading');
  const [trend, setTrend] = useState([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [events, setEvents] = useState(null);
  const [firstSeen, setFirstSeen] = useState(null);

  const [minimized, setMinimized] = useState(false);

  // Subscribes to the shared stack/dock, so this window re-renders when a
  // sibling is raised, docks, or restores ahead of it.
  const { dockSlot, zIndex } = useFloatingWindow(username);

  useBlockedUsers();
  const blocked = isBlocked(username);

  // Open on top; on close, drop out of both registries — a window left docked
  // would strand its slot and shove the remaining pills along by one.
  useEffect(() => {
    raiseWindow(username);
    return () => {
      undockWindow(username);
      dropWindow(username);
    };
  }, [username]);

  const minimize = () => {
    dockWindow(username);
    setMinimized(true);
  };

  const restore = () => {
    undockWindow(username);
    setMinimized(false);
    raiseWindow(username);
  };

  useEffect(() => {
    if (!username) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, username]);

  // Reset to the requested tab whenever the modal opens for a (new) user.
  useEffect(() => {
    setActiveTab(initialTab || 'overview');
  }, [initialTab, username]);

  useEffect(() => {
    if (!username) return undefined;
    let cancelled = false;
    setDetailLoading(true);
    setTrendLoading(true);
    setTrend([]);
    setEvents(null);
    setFirstSeen(null);

    const load = async () => {
      try {
        const d = await reportsAPI.getUserDetail({ username });
        if (!cancelled) setDetail(d);
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }

      // These panels are secondary. Run their database queries in sequence so opening a user
      // report cannot add its own burst of expensive work when PostgreSQL is already busy.
      const start = new Date(
        Date.now() - TREND_DAYS * 86_400_000,
      ).toISOString();

      try {
        const histogram = await reportsAPI.getHistogram({
          username,
          interval: TREND_INTERVAL_MINUTES,
          start,
        });
        if (!cancelled) setTrend(buildTrend(histogram));
      } catch {
        if (!cancelled) setTrend([]);
      } finally {
        if (!cancelled) setTrendLoading(false);
      }

      try {
        const counts = await reportsAPI.getUserEventCounts({
          usernames: [username],
        });
        if (!cancelled) setEvents(counts?.[username] ?? null);
      } catch {
        // Optional panel; leave it empty when unavailable.
      }

      try {
        const { items } = await reportsAPI.getUserTransfers({
          username,
          includeTotal: false,
          limit: 1,
          sortOrder: 'ASC',
        });
        if (!cancelled && items?.[0]) {
          setFirstSeen(pick(items[0], 'RequestedAt'));
        }
      } catch {
        // Optional field; the rest of the report remains usable.
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Live peer profile straight off the Soulseek network. Every field here can
  // be unavailable — the peer may be offline, or slow enough to time out — so
  // failure just collapses the block rather than surfacing an error.
  useEffect(() => {
    if (!username) return undefined;
    let cancelled = false;
    setPeer(null);
    setPeerState('loading');

    Promise.allSettled([
      usersAPI.getInfo({ username }),
      usersAPI.getStatus({ username }),
    ]).then(([info, status]) => {
      if (cancelled) return;
      if (info.status === 'rejected' && status.status === 'rejected') {
        setPeerState('offline');
        return;
      }

      setPeer({
        ...info.value?.data,
        ...status.value?.data,
      });
      setPeerState('ok');
    });

    return () => {
      cancelled = true;
    };
  }, [username]);

  useEffect(() => {
    if (!username) return undefined;
    let cancelled = false;
    setNetworkOffline(false);

    // The map dot already resolved geo for this peer — seed the bar to skip a
    // redundant lookup. Fall back to the live lookup when no seed is provided.
    if (seed?.ip) {
      setNetworkInfo({
        ipAddress: seed.ip,
        city: seed.city,
        country: seed.country,
        isVpn: seed.isVpn,
      });
      setNetworkLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setNetworkInfo(null);
    setNetworkLoading(true);
    reportsAPI
      .getUserNetworkInfo({ username })
      .then((info) => {
        if (!cancelled) {
          if (info) setNetworkInfo(info);
          else setNetworkOffline(true);
        }
      })
      .finally(() => {
        if (!cancelled) setNetworkLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [seed, username]);

  const totals = useMemo(() => {
    const up = readDirection(pick(detail, 'Upload'));
    const down = readDirection(pick(detail, 'Download'));
    const transfers = up.total + down.total;
    const successful = up.successful + down.successful;
    return {
      up,
      down,
      transfers,
      errors: up.errored + down.errored,
      exchanged: up.bytes + down.bytes,
      ratio: down.bytes > 0 ? up.bytes / down.bytes : null,
      successRate: transfers > 0 ? (successful / transfers) * 100 : null,
    };
  }, [detail]);

  const verdict =
    totals.ratio == null
      ? 'No downloads'
      : totals.ratio >= 1.05
        ? 'You gave more'
        : totals.ratio <= 0.95
          ? 'They gave more'
          : 'Balanced';

  const lastSeen = relativeTime(networkInfo?.endedAt ?? networkInfo?.EndedAt);
  const presence =
    peer?.presence ?? (peerState === 'offline' ? 'Offline' : null);

  const TABS = [
    { id: 'overview', label: 'Overview' },
    {
      id: 'transfers',
      label: 'Transfers',
      badge: totals.transfers || null,
    },
    {
      id: 'browse',
      label: 'Browse History',
      badge: events?.browseCount ?? events?.BrowseCount ?? null,
    },
  ];

  const openBrowse = () => {
    onClose();
    history.push('/browse', { user: username });
  };

  const openChat = () => {
    onClose();
    history.push('/chat', { user: username });
  };

  if (!username) return null;

  // Rendered into <body>: these windows are opened from transient containers
  // (a map tooltip, a table row) whose own subtree can unmount or be clipped by
  // an ancestor's overflow while the window should stay put.
  // The regular report carries the workspace palette into that portal; the map
  // variant supplies its own palette in StreetMap.css.
  // React still bubbles portal events through the source table row. Stop its
  // click and keyboard activation without swallowing Escape or other shortcuts.
  return createPortal(
    <>
      <div
        className={`user-report-window${variant ? ` user-report-window--${variant}` : ' dj-workspace'}${minimized ? ' user-report-window--minimized' : ''}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={stopRowKeyboardActivation}
        onPointerDown={() => raiseWindow(username)}
        style={{ zIndex }}
      >
        <div className="user-report-hero">
          <div className="user-report-identity">
            <div
              className="user-report-avatar"
              style={
                peer?.hasPicture
                  ? undefined
                  : { background: avatarColor(username) }
              }
            >
              {peer?.hasPicture && peer?.picture ? (
                <img
                  alt=""
                  src={`data:image;base64,${peer.picture}`}
                />
              ) : (
                avatarInitial(username)
              )}
              {presence ? (
                <span
                  className={`user-report-presence user-report-presence--${PRESENCE_TONE[presence] ?? 'offline'}`}
                  title={presence}
                />
              ) : null}
            </div>

            <div className="user-report-identity-text">
              <div className="user-report-name-row">
                <h2 className="user-report-name">{username}</h2>
                {presence ? (
                  <Chip tone={PRESENCE_TONE[presence] ?? 'offline'}>
                    {presence}
                  </Chip>
                ) : null}
                {peer?.isPrivileged ? (
                  <Chip
                    icon={ShieldCheck}
                    tone="privileged"
                  >
                    Privileged
                  </Chip>
                ) : null}
                {blocked ? (
                  <Chip
                    icon={Ban}
                    tone="blocked"
                  >
                    Blocked
                  </Chip>
                ) : null}
              </div>

              {peer?.description ? (
                <p
                  className="user-report-description"
                  title={peer.description}
                >
                  {peer.description}
                </p>
              ) : null}

              <div className="user-report-chips">
                {networkLoading ? (
                  <Chip icon={Network}>Looking up IP…</Chip>
                ) : networkOffline ? (
                  <Chip icon={Network}>IP unavailable</Chip>
                ) : networkInfo ? (
                  <>
                    <Chip
                      icon={Network}
                      title="Last known IP address"
                    >
                      <code>{networkInfo.ipAddress}</code>
                    </Chip>
                    {networkInfo.city || networkInfo.country ? (
                      <Chip icon={MapPin}>
                        {[networkInfo.city, networkInfo.country]
                          .filter(Boolean)
                          .join(', ')}
                      </Chip>
                    ) : null}
                    {networkInfo.isVpn ? (
                      <Chip
                        icon={ShieldCheck}
                        title="IP resolves to a VPN, proxy or hosting provider"
                        tone="vpn"
                      >
                        VPN / hosting
                      </Chip>
                    ) : null}
                  </>
                ) : null}

                {peerState === 'ok' && peer?.uploadSlots != null ? (
                  <Chip
                    icon={Layers}
                    title={
                      peer.hasFreeUploadSlot
                        ? 'This user has a free upload slot'
                        : 'All of this user’s upload slots are busy'
                    }
                    tone={peer.hasFreeUploadSlot ? 'free' : undefined}
                  >
                    {peer.uploadSlots} slots · queue {peer.queueLength ?? 0}
                  </Chip>
                ) : null}

                {lastSeen ? (
                  <Chip
                    icon={Gauge}
                    title="Most recent completed transfer"
                  >
                    Last transfer {lastSeen}
                  </Chip>
                ) : null}

                {events?.chatCount || events?.ChatCount ? (
                  <Chip icon={MessageSquare}>
                    {(events.chatCount ?? events.ChatCount).toLocaleString()}{' '}
                    chat messages
                  </Chip>
                ) : null}
              </div>
            </div>

            <div className="user-report-actions">
              <button
                className="user-report-action hover-fx"
                onClick={openChat}
                title="Open chat"
                type="button"
              >
                <MessageSquare size={14} />
              </button>
              <button
                className="user-report-action hover-fx"
                onClick={openBrowse}
                title="Browse shared files"
                type="button"
              >
                <ListMusic size={14} />
              </button>
              <button
                className={`user-report-action hover-fx${blocked ? ' user-report-action--on' : ''}`}
                onClick={() =>
                  blocked ? unblockUser(username) : blockUser(username)
                }
                title={blocked ? 'Unblock user' : 'Block user'}
                type="button"
              >
                <Ban size={14} />
              </button>
              <button
                className="user-report-action user-report-action--minimize hover-fx"
                onClick={minimize}
                title="Minimise"
                type="button"
              >
                <Minus size={15} />
              </button>
              <button
                className="user-report-action user-report-action--close hover-fx"
                onClick={onClose}
                title="Close"
                type="button"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          <div className="user-report-kpis">
            <Kpi
              hint="all time"
              label="Exchanged"
              value={formatBytes(totals.exchanged)}
            />
            <Kpi
              hint={verdict}
              label="Ratio"
              value={totals.ratio == null ? '—' : totals.ratio.toFixed(2)}
            />
            <Kpi
              hint={`${totals.transfers.toLocaleString()} transfers`}
              label="Success"
              tone={
                totals.successRate != null && totals.successRate < 75
                  ? 'warning'
                  : undefined
              }
              value={
                totals.successRate == null
                  ? '—'
                  : `${Math.round(totals.successRate)}%`
              }
            />
            <Kpi
              hint="↑ sent"
              label="Up speed"
              value={formatSpeed(totals.up.speed)}
            />
            <Kpi
              hint="↓ received"
              label="Down speed"
              value={formatSpeed(totals.down.speed)}
            />
            <Kpi
              hint={totals.errors > 0 ? 'see overview' : 'clean'}
              label="Errors"
              tone={totals.errors > 0 ? 'danger' : undefined}
              value={totals.errors.toLocaleString()}
            />
            <Kpi
              hint={firstSeen ? relativeTime(firstSeen) : undefined}
              label="Known since"
              value={
                firstSeen
                  ? parseUtcDate(firstSeen).toLocaleDateString('en', {
                      month: 'short',
                      year: 'numeric',
                    })
                  : '—'
              }
            />
          </div>
        </div>

        <div className="user-report-window-tabs">
          {TABS.map((tab) => (
            <button
              className={`user-report-window-tab${activeTab === tab.id ? ' active' : ''}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
              {tab.badge ? (
                <span className="user-report-tab-badge">
                  {tab.badge.toLocaleString()}
                </span>
              ) : null}
            </button>
          ))}
          <button
            className="user-report-window-tab user-report-window-tab--link"
            onClick={openBrowse}
            title="Open this user's shared files in Browse"
            type="button"
          >
            Files
            <ExternalLink size={11} />
          </button>
        </div>

        <div className="user-report-window-body">
          {activeTab === 'overview' && (
            <OverviewTab
              detail={detail}
              loading={detailLoading}
              trend={trend}
              trendLoading={trendLoading}
            />
          )}
          {activeTab === 'transfers' && <TransfersTab username={username} />}
          {activeTab === 'browse' && <BrowseTab username={username} />}
        </div>
      </div>

      {/* The window stays mounted while minimised (hidden via CSS) so its
          fetched data, active tab and scroll position survive a restore. */}
      {minimized ? (
        <div
          className={`user-report-dock${variant ? ` user-report-dock--${variant}` : ' dj-workspace'}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={stopRowKeyboardActivation}
          style={{ right: 16 + Math.max(dockSlot, 0) * 208 }}
        >
          <button
            className="user-report-dock-restore"
            onClick={restore}
            title={`Restore ${username}`}
            type="button"
          >
            <span
              className="user-report-dock-avatar"
              style={
                peer?.hasPicture
                  ? undefined
                  : { background: avatarColor(username) }
              }
            >
              {peer?.hasPicture && peer?.picture ? (
                <img
                  alt=""
                  src={`data:image;base64,${peer.picture}`}
                />
              ) : (
                avatarInitial(username)
              )}
            </span>
            <span className="user-report-dock-name">{username}</span>
            {presence ? (
              <span
                className={`user-report-presence user-report-presence--${PRESENCE_TONE[presence] ?? 'offline'}`}
                title={presence}
              />
            ) : null}
          </button>
          <button
            className="user-report-dock-close"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}
    </>,
    document.body,
  );
};

export default UserReportWindow;
