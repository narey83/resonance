// <copyright file="DownloadsTable.jsx" company="John Narey">
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

import { lookupIp } from '../../lib/network';
import {
  isStateCancellable,
  isStateRemovable,
  isStateRetryable,
} from '../../lib/transfers';
import { getStatus } from '../../lib/users';
import {
  formatBitrate,
  formatBytes,
  formatSeconds,
  getFileName,
} from '../../lib/util';
import { UsernameLink } from '../Shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Folder,
  FolderOpen,
  RotateCcw,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

/* ─── State helpers ──────────────────────────────────────────────────────── */

const STATE_META = {
  Completed: { cls: 'succeeded', dot: '#3fb950', label: 'Completed' },
  'Completed, Cancelled': {
    cls: 'cancelled',
    dot: '#7d8590',
    label: 'Cancelled',
  },
  'Completed, Errored': { cls: 'error', dot: '#f85149', label: 'Errored' },
  'Completed, Rejected': { cls: 'error', dot: '#f85149', label: 'Rejected' },
  'Completed, Succeeded': {
    cls: 'succeeded',
    dot: '#3fb950',
    label: 'Succeeded',
  },
  'Completed, TimedOut': { cls: 'error', dot: '#f85149', label: 'Timed Out' },
  Initializing: { cls: 'initializing', dot: '#39d5d5', label: 'Initializing' },
  InProgress: { cls: 'inprogress', dot: '#388bfd', label: 'Downloading' },
  Queued: { cls: 'queued', dot: '#a371f7', label: 'Queued' },
  'Queued, Locally': { cls: 'queued', dot: '#a371f7', label: 'Queued (local)' },
  'Queued, Remotely': {
    cls: 'queued',
    dot: '#a371f7',
    label: 'Queued (remote)',
  },
  Requested: { cls: 'queued', dot: '#a371f7', label: 'Requested' },
};

const getMeta = (state) =>
  STATE_META[state] ?? { cls: 'error', dot: '#f85149', label: state };

const isQueued = (state) =>
  Boolean(state?.includes('Queued') || state === 'Requested');

/* ─── Data helpers ───────────────────────────────────────────────────────── */

const getTime = (file) =>
  file.requestedAt ? new Date(file.requestedAt).getTime() : 0;

const maxTime = (files) =>
  files.reduce((max, f) => Math.max(max, getTime(f)), 0);

const STATE_SORT_ORDER = {
  InProgress: 0,
  Initializing: 1,
  Requested: 2,
  Queued: 3,
  'Queued, Locally': 3,
  'Queued, Remotely': 3,
};
const getStatePriority = (state) => STATE_SORT_ORDER[state] ?? 4;

const byStateThenTime = (a, b) => {
  const p = getStatePriority(a.state) - getStatePriority(b.state);
  return p !== 0 ? p : getTime(a) - getTime(b);
};

const isDirectoryActive = (files) =>
  files.some((f) => !f.state?.startsWith('Completed'));
const isDirectoryCompleted = (files) =>
  files.every((f) => f.state?.startsWith('Completed'));

const buildGroups = (transfers, directoryFilter) =>
  (transfers ?? [])
    .map((user) => ({
      ...user,
      directories: (user.directories ?? [])
        .map((directory) => ({
          ...directory,
          files: (directory.files ?? [])
            .filter((file) => file.direction?.toLowerCase() === 'download')
            .sort(byStateThenTime),
        }))
        .filter((directory) => directory.files.length > 0)
        .filter((directory) => directoryFilter(directory.files))
        .sort((a, b) => maxTime(b.files) - maxTime(a.files)),
    }))
    .filter((user) => user.directories.length > 0)
    .sort((a, b) => {
      const aMax = maxTime(a.directories.flatMap((d) => d.files));
      const bMax = maxTime(b.directories.flatMap((d) => d.files));
      return bMax - aMax;
    });

const PAGE_SIZE_OPTIONS = [15, 30, 50, 100, 150];

/* Cap file rows rendered per expanded directory — a single directory can hold
   thousands of files (e.g. bulk-errored downloads) and rendering them all
   freezes the page on every poll. */
const FILE_RENDER_CHUNK = 200;

/* Collapse state lives outside the components so virtualized rows keep their
   expanded/collapsed state when they scroll out of view and unmount. */
const userCollapsedCache = {};
const directoryCollapsedCache = {};

/* ─── Sub-components ─────────────────────────────────────────────────────── */

const StateBadge = ({ file }) => {
  const meta = getMeta(file.state);
  return (
    <span className={`state-badge ${meta.cls}`}>
      <span
        style={{
          background: meta.dot,
          borderRadius: '50%',
          display: 'inline-block',
          flexShrink: 0,
          height: 6,
          width: 6,
        }}
      />
      {meta.label}
      {file.attempts > 1 ? ` ×${file.attempts}` : ''}
      {isQueued(file.state) && file.placeInQueue
        ? ` #${file.placeInQueue}`
        : ''}
    </span>
  );
};

const ProgressBar = ({ background, percent }) => (
  <div className="mini-progress">
    <div className="mini-progress-track">
      <div
        className="mini-progress-fill"
        style={{ background, width: `${percent}%` }}
      />
    </div>
    <span className="mini-progress-pct">{percent}%</span>
  </div>
);

const FileProgress = ({ file }) => {
  if (file.state === 'InProgress')
    return (
      <ProgressBar
        background="var(--accent)"
        percent={Math.round(file.percentComplete ?? 0)}
      />
    );
  if (file.state === 'Completed, Succeeded')
    return (
      <ProgressBar
        background="var(--success)"
        percent={100}
      />
    );
  const rawPct = file.percentComplete;
  if (rawPct == null || rawPct <= 0)
    return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>;
  return (
    <ProgressBar
      background="var(--text-muted)"
      percent={Math.round(rawPct)}
    />
  );
};

const FileRow = ({ file, onCancel, onRemove, onRetry }) => {
  const meta = getMeta(file.state);
  const canRetry = isStateRetryable(file.state);
  const canCancel = isStateCancellable(file.state);
  const canRemove = isStateRemovable(file.state);

  return (
    <tr className={`dl-file-row dl-file-row--${meta.cls}`}>
      <td
        className="dl-cell dl-cell--file"
        title={file.filename}
      >
        <span className="dl-filename">{getFileName(file.filename)}</span>
        <span
          className="dl-filepath"
          title={file.filename}
        >
          {file.filename}
        </span>
      </td>
      <td className="dl-cell dl-cell--state">
        <StateBadge file={file} />
      </td>
      <td className="dl-cell dl-cell--progress">
        <FileProgress file={file} />
      </td>
      <td className="dl-cell dl-cell--size">
        {file.state === 'InProgress'
          ? `${formatBytes(file.bytesTransferred)} / ${formatBytes(file.size)}`
          : formatBytes(file.size)}
      </td>
      <td className="dl-cell dl-cell--speed">
        {file.averageSpeed > 0 ? formatBitrate(file.averageSpeed) : '—'}
      </td>
      <td className="dl-cell dl-cell--eta">
        {file.remainingTime > 0
          ? formatSeconds(file.remainingTime / 1_000)
          : '—'}
      </td>
      <td className="dl-cell dl-cell--actions">
        {canRetry && (
          <button
            className="dl-action-btn dl-action-btn--retry"
            onClick={() => onRetry({ file })}
            title="Retry"
            type="button"
          >
            <RotateCcw
              size={13}
              strokeWidth={2}
            />
          </button>
        )}
        {canCancel && (
          <button
            className="dl-action-btn dl-action-btn--cancel"
            onClick={() => onCancel({ file })}
            title="Cancel"
            type="button"
          >
            <X
              size={13}
              strokeWidth={2}
            />
          </button>
        )}
        {canRemove && (
          <button
            className="dl-action-btn dl-action-btn--remove"
            onClick={() => onRemove({ file })}
            title="Remove"
            type="button"
          >
            <Trash2
              size={13}
              strokeWidth={2}
            />
          </button>
        )}
      </td>
    </tr>
  );
};

const DirectoryGroup = ({
  cacheKey,
  directory,
  onCancel,
  onCancelDirectory,
  onFindAlternate,
  onRemove,
  onRetry,
  onRetryBatch,
  username,
}) => {
  const collapseKey = `${cacheKey}|${directory.directory}`;
  const [collapsed, setCollapsed] = useState(
    directoryCollapsedCache[collapseKey] ?? true,
  );
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      directoryCollapsedCache[collapseKey] = !c;
      return !c;
    });
  const [visibleCount, setVisibleCount] = useState(FILE_RENDER_CHUNK);
  const { files } = directory;
  const directoryName =
    directory.directory.split(/[/\\]/u).filter(Boolean).at(-1) ??
    directory.directory;

  const totalSize = files.reduce((s, f) => s + (f.size ?? 0), 0);
  const totalTransferred = files.reduce(
    (s, f) => s + (f.bytesTransferred ?? 0),
    0,
  );
  const overallPercent =
    totalSize > 0 ? Math.round((totalTransferred / totalSize) * 100) : 0;
  // "Completed" is Soulseek's terminal flag, not a verdict -- Completed, Errored and
  // Completed, Cancelled carry it too. Counting all of them as done reported "222 / 319 done"
  // for a folder that had transferred zero bytes, because every one of those 222 had failed.
  const completedCount = files.filter((f) =>
    f.state?.startsWith('Completed'),
  ).length;
  const succeededCount = files.filter(
    (f) => f.state === 'Completed, Succeeded',
  ).length;
  const failedCount = files.filter((f) => isStateRetryable(f.state)).length;

  // Track folder-level speed from byte progress between polls rather than per-file averageSpeed,
  // which is often 0 when only 1 file is active and completes within a single poll interval.
  const bytesRef = useRef(null);
  const [folderSpeed, setFolderSpeed] = useState(0);

  useEffect(() => {
    if (bytesRef.current === null) {
      bytesRef.current = { bytes: totalTransferred, time: Date.now() };
      return;
    }

    const { bytes: previousBytes, time: previousTime } = bytesRef.current;
    const now = Date.now();
    const elapsed = (now - previousTime) / 1_000;
    const delta = totalTransferred - previousBytes;
    bytesRef.current = { bytes: totalTransferred, time: now };
    if (elapsed >= 1 && delta > 0) {
      setFolderSpeed(delta / elapsed);
    } else if (completedCount === files.length) {
      setFolderSpeed(0);
    }
  }, [totalTransferred, completedCount, files.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const folderEta =
    folderSpeed > 0 && totalSize > totalTransferred
      ? Math.round((totalSize - totalTransferred) / folderSpeed) * 1_000
      : 0;
  const allCompleted = completedCount === files.length;
  const allSucceeded = files.every((f) => f.state === 'Completed, Succeeded');
  const anyActive = files.some((f) => f.state === 'InProgress');
  const allFailed =
    files.length > 0 && files.every((f) => isStateRetryable(f.state));
  const retryableFiles = files.filter((f) => isStateRetryable(f.state));

  const progressColor = allSucceeded
    ? 'var(--success)'
    : anyActive
      ? 'var(--accent)'
      : 'var(--text-muted)';

  return (
    <tbody>
      <tr className="dl-dir-row">
        <td className="dl-cell dl-cell--file dl-dir-name">
          <button
            className="dl-dir-toggle"
            onClick={toggleCollapsed}
            type="button"
          >
            {collapsed ? (
              <Folder
                color="var(--warning)"
                size={13}
                strokeWidth={1.75}
              />
            ) : (
              <FolderOpen
                color="var(--warning)"
                size={13}
                strokeWidth={1.75}
              />
            )}
            <span className="dl-dir-label">{directoryName}</span>
            <span className="dl-dir-count">
              {files.length} file{files.length === 1 ? '' : 's'}
            </span>
          </button>
        </td>
        <td className="dl-cell dl-cell--state">
          <span className="dl-dir-stat">
            {succeededCount} / {files.length} done
            {failedCount > 0 && (
              <span className="dl-dir-stat-failed">
                {' '}
                &middot; {failedCount} failed
              </span>
            )}
          </span>
        </td>
        <td className="dl-cell dl-cell--progress">
          <ProgressBar
            background={progressColor}
            percent={overallPercent}
          />
        </td>
        <td className="dl-cell dl-cell--size">
          {/* Only collapse to the folder size once it has actually arrived. Collapsing on
              "completed" showed the full size for a folder that had failed every file. */}
          {allSucceeded
            ? formatBytes(totalSize)
            : `${formatBytes(totalTransferred)} / ${formatBytes(totalSize)}`}
        </td>
        <td className="dl-cell dl-cell--speed">
          {folderSpeed > 0 ? formatBitrate(folderSpeed) : '—'}
        </td>
        <td className="dl-cell dl-cell--eta">
          {folderEta > 0 ? formatSeconds(folderEta / 1_000) : '—'}
        </td>
        <td className="dl-cell dl-cell--actions">
          {retryableFiles.length > 0 && (
            <button
              className="dl-action-btn dl-action-btn--retry"
              onClick={() => onRetryBatch(retryableFiles)}
              title={`Retry ${retryableFiles.length} file${retryableFiles.length === 1 ? '' : 's'}`}
              type="button"
            >
              <RotateCcw
                size={13}
                strokeWidth={2}
              />
            </button>
          )}
          {allFailed && (
            <button
              className="dl-action-btn dl-action-btn--find"
              onClick={() =>
                onFindAlternate({
                  directory: directory.directory,
                  files,
                  folderName: directoryName,
                  username,
                })
              }
              title="Find folder from another source"
              type="button"
            >
              <Search
                size={13}
                strokeWidth={2}
              />
            </button>
          )}
          <button
            className={`dl-action-btn ${allCompleted ? 'dl-action-btn--remove' : 'dl-action-btn--cancel'}`}
            onClick={() =>
              onCancelDirectory({
                directory: directory.directory,
                files,
                username,
              })
            }
            title={allCompleted ? 'Remove folder' : 'Cancel and delete folder'}
            type="button"
          >
            {allCompleted ? (
              <Trash2
                size={13}
                strokeWidth={2}
              />
            ) : (
              <X
                size={13}
                strokeWidth={2}
              />
            )}
          </button>
        </td>
      </tr>
      {!collapsed &&
        files.slice(0, visibleCount).map((file) => (
          <FileRow
            file={file}
            key={file.id}
            onCancel={onCancel}
            onRemove={onRemove}
            onRetry={onRetry}
          />
        ))}
      {!collapsed && files.length > visibleCount && (
        <tr className="dl-show-more-row">
          <td colSpan={7}>
            <button
              className="dl-show-more-btn"
              onClick={() => setVisibleCount((n) => n + FILE_RENDER_CHUNK)}
              type="button"
            >
              Show {Math.min(FILE_RENDER_CHUNK, files.length - visibleCount)}{' '}
              more ({files.length - visibleCount} hidden)
            </button>
          </td>
        </tr>
      )}
    </tbody>
  );
};

const netInfoCache = {};
const presenceCache = {};

const PresenceDot = ({ presence }) => {
  const color =
    presence === 'Online'
      ? '#48bb78'
      : presence === 'Away'
        ? '#ecc94b'
        : 'var(--text-dim, #666)';
  return (
    <span
      className="dl-presence-dot"
      style={{ background: color }}
      title={presence ?? 'Offline'}
    />
  );
};

const UserGroup = ({
  cacheKey,
  onCancel,
  onCancelDirectory,
  onCancelUser,
  onFindAlternate,
  onRemove,
  onRetry,
  onRetryBatch,
  startCollapsed = true,
  user,
}) => {
  const [collapsed, setCollapsed] = useState(
    userCollapsedCache[cacheKey] ?? startCollapsed,
  );
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      userCollapsedCache[cacheKey] = !c;
      return !c;
    });
  const [netInfo, setNetInfo] = useState(netInfoCache[user.username] ?? null);
  const [presence, setPresence] = useState(
    presenceCache[user.username] ?? null,
  );
  const allFiles = user.directories.flatMap((d) => d.files);

  const inProgressCount = allFiles.filter(
    (f) => f.state === 'InProgress',
  ).length;
  const queuedCount = allFiles.filter((f) => isQueued(f.state)).length;
  const totalSpeed = allFiles
    .filter((f) => f.state === 'InProgress')
    .reduce((s, f) => s + (f.averageSpeed ?? 0), 0);
  const retryableFiles = allFiles.filter((f) => isStateRetryable(f.state));
  const activeCount = allFiles.filter(
    (f) => !f.state?.startsWith('Completed'),
  ).length;

  useEffect(() => {
    const ip = user.peerAddress;
    if (!ip) return undefined;
    if (netInfoCache[user.username]) {
      setNetInfo(netInfoCache[user.username]);
      return undefined;
    }

    let cancelled = false;
    lookupIp(ip)
      .then((info) => {
        if (!cancelled) {
          netInfoCache[user.username] = info;
          setNetInfo(info);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user.username, user.peerAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (presenceCache[user.username]) {
      setPresence(presenceCache[user.username]);
      return undefined;
    }

    let cancelled = false;
    getStatus({ username: user.username })
      .then(({ data }) => {
        const p = data?.presence ?? 'Unknown';
        if (!cancelled) {
          presenceCache[user.username] = p;
          setPresence(p);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user.username]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dl-user-group">
      <div
        className="dl-user-header"
        onClick={toggleCollapsed}
      >
        <button
          className="dl-user-toggle"
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapsed();
          }}
          type="button"
        >
          {collapsed ? (
            <ChevronRight
              size={13}
              strokeWidth={2}
              style={{ opacity: 0.5 }}
            />
          ) : (
            <ChevronDown
              size={13}
              strokeWidth={2}
              style={{ opacity: 0.5 }}
            />
          )}
        </button>
        <User
          color="var(--accent)"
          size={15}
          strokeWidth={1.75}
        />
        <div className="dl-user-info">
          <div className="dl-user-name-row">
            {presence && <PresenceDot presence={presence} />}
            <span onClick={(e) => e.stopPropagation()}>
              <UsernameLink
                className="dl-user-name"
                username={user.username}
              />
            </span>
          </div>
          {netInfo && (
            <div className="dl-user-net">
              <span className="dl-user-net-ip">{netInfo.ip}</span>
              <span className="dl-user-net-sep">·</span>
              <span className="dl-user-net-isp">{netInfo.isp}</span>
              <span className="dl-user-net-sep">·</span>
              <span className="dl-user-net-loc">
                {[netInfo.city, netInfo.country].filter(Boolean).join(', ')}
              </span>
            </div>
          )}
        </div>
        <div className="dl-user-stats">
          {inProgressCount > 0 && (
            <span className="dl-user-stat dl-user-stat--active">
              <span className="dl-user-stat-dot" />
              {inProgressCount} active
            </span>
          )}
          {queuedCount > 0 && (
            <span className="dl-user-stat dl-user-stat--queued">
              {queuedCount} queued
            </span>
          )}
          {totalSpeed > 0 && (
            <span className="dl-user-stat dl-user-stat--speed">
              {formatBitrate(totalSpeed)}
            </span>
          )}
          <span className="dl-user-stat">
            {allFiles.length} file{allFiles.length === 1 ? '' : 's'}
          </span>
        </div>
        {retryableFiles.length > 0 && (
          <button
            className="dl-action-btn dl-action-btn--retry"
            onClick={(e) => {
              e.stopPropagation();
              onRetryBatch(retryableFiles);
            }}
            title={`Retry ${retryableFiles.length} file${retryableFiles.length === 1 ? '' : 's'}`}
            type="button"
          >
            <RotateCcw
              size={13}
              strokeWidth={2}
            />
          </button>
        )}
        {activeCount > 0 && (
          <button
            className="dl-action-btn dl-action-btn--cancel"
            onClick={(e) => {
              e.stopPropagation();
              onCancelUser({
                directories: user.directories,
                username: user.username,
              });
            }}
            title={`Cancel all ${activeCount} download${activeCount === 1 ? '' : 's'} from this user and delete their unfinished folders`}
            type="button"
          >
            <Ban
              size={14}
              strokeWidth={2}
            />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="dl-user-body">
          <table className="dl-table">
            <thead>
              <tr className="dl-thead-row">
                <th className="dl-cell dl-cell--file">File</th>
                <th className="dl-cell dl-cell--state">State</th>
                <th className="dl-cell dl-cell--progress">Progress</th>
                <th className="dl-cell dl-cell--size">Size</th>
                <th className="dl-cell dl-cell--speed">Speed</th>
                <th className="dl-cell dl-cell--eta">ETA</th>
                <th className="dl-cell dl-cell--actions" />
              </tr>
            </thead>
            {user.directories.map((directory) => (
              <DirectoryGroup
                cacheKey={cacheKey}
                directory={directory}
                key={directory.directory}
                onCancel={onCancel}
                onCancelDirectory={onCancelDirectory}
                onFindAlternate={onFindAlternate}
                onRemove={onRemove}
                onRetry={onRetry}
                onRetryBatch={onRetryBatch}
                username={user.username}
              />
            ))}
          </table>
        </div>
      )}
    </div>
  );
};

/* ─── Toolbar ────────────────────────────────────────────────────────────── */

const Toolbar = ({
  allFiles,
  onCancel,
  onClearCompleted,
  onPageSizeChange,
  onRetryBatch,
  pageSize,
}) => {
  const cancellableFiles = allFiles.filter((f) => isStateCancellable(f.state));
  const retryableFiles = allFiles.filter((f) => isStateRetryable(f.state));
  const succeededFiles = allFiles.filter(
    (f) => f.state === 'Completed, Succeeded',
  );

  return (
    <div className="ul-toolbar">
      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        {allFiles.length} file{allFiles.length === 1 ? '' : 's'}
      </span>
      <div className="ul-toolbar-actions">
        <label className="ul-page-size-label">
          Per page
          <select
            className="ul-page-size-select"
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            value={pageSize}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option
                key={n}
                value={n}
              >
                {n}
              </option>
            ))}
          </select>
        </label>
        {retryableFiles.length > 0 && (
          <button
            className="ul-quick-btn ul-quick-btn--retry"
            onClick={() => onRetryBatch(retryableFiles)}
            type="button"
          >
            <RotateCcw
              size={12}
              strokeWidth={2}
            />{' '}
            Retry failed
          </button>
        )}
        {cancellableFiles.length > 0 && (
          <button
            className="ul-quick-btn ul-quick-btn--cancel"
            onClick={() => {
              for (const f of cancellableFiles) onCancel({ file: f });
            }}
            type="button"
          >
            <X
              size={12}
              strokeWidth={2}
            />{' '}
            Cancel active
          </button>
        )}
        {succeededFiles.length > 0 && (
          <button
            className="ul-quick-btn ul-quick-btn--remove"
            onClick={onClearCompleted}
            type="button"
          >
            <Trash2
              size={12}
              strokeWidth={2}
            />{' '}
            Clear done
          </button>
        )}
      </div>
    </div>
  );
};

/* ─── Filter pills ───────────────────────────────────────────────────────── */

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'downloading', label: 'Downloading' },
  { id: 'queued', label: 'Queued' },
  { id: 'failed', label: 'Failed' },
  { id: 'done', label: 'Done' },
  { id: 'offline', label: 'Offline' },
];

const matchesFilter = (directory, username, presences, filterId) => {
  const { files } = directory;
  switch (filterId) {
    case 'downloading':
      return files.some(
        (f) =>
          f.state === 'InProgress' ||
          f.state === 'Initializing' ||
          f.state === 'Requested',
      );
    case 'queued':
      return (
        !files.some(
          (f) => f.state === 'InProgress' || f.state === 'Initializing',
        ) && files.some((f) => isQueued(f.state))
      );
    case 'failed':
      return files.some((f) => isStateRetryable(f.state));
    case 'done':
      return (
        files.length > 0 &&
        files.every((f) => f.state === 'Completed, Succeeded')
      );
    case 'offline':
      return presences[username] === 'Offline';
    default:
      return true;
  }
};

const FilterPills = ({ activeFilter, counts, onChange }) => (
  <div className="dl-filter-pills">
    {FILTERS.map(({ id, label }) => (
      <button
        className={`dl-filter-pill dl-filter-pill--${id}${activeFilter === id ? ' dl-filter-pill--active' : ''}`}
        key={id}
        onClick={() => onChange(id)}
        type="button"
      >
        {label}
        <span className="dl-filter-pill-count">{counts[id] ?? 0}</span>
      </button>
    ))}
  </div>
);

/* ─── Main component ─────────────────────────────────────────────────────── */

const SectionHeader = ({ children }) => (
  <div className="transfer-section-header">{children}</div>
);

const DownloadsTable = ({
  onCancel,
  onCancelDirectory,
  onCancelUser,
  onClearCompleted,
  onFindAlternate,
  onRemove,
  onRetry,
  onRetryBatch,
  transfers,
}) => {
  const [completedPage, setCompletedPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [activeFilter, setActiveFilter] = useState('all');
  const [presences, setPresences] = useState({});
  const fetchedRef = useRef(new Set());

  useEffect(() => {
    let isMounted = true;
    const applyPresence = (username, data) => {
      if (!isMounted) return;
      const p = data?.presence ?? 'Unknown';
      presenceCache[username] = p;
      setPresences((previous) => ({ ...previous, [username]: p }));
    };

    for (const user of transfers ?? []) {
      const { username } = user;
      if (fetchedRef.current.has(username)) continue;
      fetchedRef.current.add(username);
      if (presenceCache[username]) {
        setPresences((p) => ({ ...p, [username]: presenceCache[username] }));
        continue;
      }

      getStatus({ username })
        .then(({ data }) => applyPresence(username, data))
        .catch(() => {});
    }

    return () => {
      isMounted = false;
    };
  }, [transfers]);

  const activeGroups = useMemo(
    () => buildGroups(transfers, isDirectoryActive),
    [transfers],
  );
  const completedGroups = useMemo(() => {
    const activeUsernames = new Set(activeGroups.map((u) => u.username));
    return buildGroups(transfers, isDirectoryCompleted).filter(
      (u) => !activeUsernames.has(u.username),
    );
  }, [activeGroups, transfers]);

  const allGroups = useMemo(
    () => buildGroups(transfers, () => true),
    [transfers],
  );

  const counts = useMemo(() => {
    const result = {};
    for (const { id } of FILTERS) {
      result[id] = allGroups.reduce(
        (n, user) =>
          n +
          user.directories.filter((d) =>
            matchesFilter(d, user.username, presences, id),
          ).length,
        0,
      );
    }

    return result;
  }, [allGroups, presences]);

  const filteredGroups = useMemo(() => {
    if (activeFilter === 'all') return null;
    return allGroups
      .map((user) => ({
        ...user,
        directories: user.directories.filter((d) =>
          matchesFilter(d, user.username, presences, activeFilter),
        ),
      }))
      .filter((user) => user.directories.length > 0);
  }, [activeFilter, allGroups, presences]);

  const totalCompletedPages = Math.ceil(completedGroups.length / pageSize);

  useEffect(() => {
    if (totalCompletedPages > 0 && completedPage >= totalCompletedPages) {
      setCompletedPage(totalCompletedPages - 1);
    }
  }, [completedPage, totalCompletedPages]);

  const completedPageGroups = useMemo(
    () =>
      completedGroups.slice(
        completedPage * pageSize,
        completedPage * pageSize + pageSize,
      ),
    [completedGroups, completedPage, pageSize],
  );

  const allFiles = useMemo(
    () =>
      [...activeGroups, ...completedGroups].flatMap((user) =>
        user.directories.flatMap((d) => d.files),
      ),
    [activeGroups, completedGroups],
  );

  /* Flatten sections, groups, and pagination into one list so the whole
     scroll area can be virtualized. */
  const rows = useMemo(() => {
    if (filteredGroups) {
      if (filteredGroups.length === 0)
        return [{ key: 'filter-empty', type: 'empty' }];
      return filteredGroups.map((user) => ({
        key: `group-${user.username}`,
        startCollapsed: false,
        type: 'group',
        user,
      }));
    }

    const result = [];
    if (activeGroups.length > 0) {
      result.push({
        key: 'section-active',
        label: 'Downloading',
        type: 'section',
      });
      for (const user of activeGroups)
        result.push({
          key: `group-${user.username}`,
          startCollapsed: false,
          type: 'group',
          user,
        });
    }

    if (completedGroups.length > 0) {
      result.push({
        key: 'section-done',
        // Not "Downloaded": this section is everything that reached a terminal state, and a
        // transfer that failed is in it too. A peer that refused all 26 of its files was being
        // listed under "Downloaded" having sent nothing.
        label: 'Finished',
        pageInfo:
          totalCompletedPages > 1
            ? `${completedPage + 1} / ${totalCompletedPages}`
            : null,
        type: 'section',
      });
      for (const user of completedPageGroups)
        result.push({
          key: `group-${user.username}`,
          startCollapsed: true,
          type: 'group',
          user,
        });
      if (totalCompletedPages > 1)
        result.push({ key: 'pagination', type: 'pagination' });
    }

    return result;
  }, [
    activeGroups,
    completedGroups,
    completedPage,
    completedPageGroups,
    filteredGroups,
    totalCompletedPages,
  ]);

  const scrollRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (index) => (rows[index].type === 'group' ? 64 : 36),
    getItemKey: (index) => rows[index].key,
    getScrollElement: () => scrollRef.current,
    overscan: 6,
  });

  if (activeGroups.length === 0 && completedGroups.length === 0) {
    return (
      <div className="dl-empty">
        <Download
          opacity={0.15}
          size={40}
          strokeWidth={1.25}
        />
        <p style={{ color: 'var(--text-muted)', marginTop: 12 }}>
          No downloads
        </p>
      </div>
    );
  }

  const handlePageSizeChange = (n) => {
    setPageSize(n);
    setCompletedPage(0);
  };

  const handleFilterChange = (f) => {
    setActiveFilter(f);
    setCompletedPage(0);
  };

  const renderPagination = () => (
    <div className="ul-pagination">
      <button
        className="ul-page-btn"
        disabled={completedPage === 0}
        onClick={() => setCompletedPage((p) => p - 1)}
        type="button"
      >
        <ChevronLeft
          size={14}
          strokeWidth={2}
        />{' '}
        Prev
      </button>
      {totalCompletedPages <= 10 && (
        <div className="ul-page-numbers">
          {Array.from({ length: totalCompletedPages }, (_, index) => (
            <button
              className={`ul-page-num${index === completedPage ? ' ul-page-num--active' : ''}`}
              key={index}
              onClick={() => setCompletedPage(index)}
              type="button"
            >
              {index + 1}
            </button>
          ))}
        </div>
      )}
      <button
        className="ul-page-btn"
        disabled={completedPage === totalCompletedPages - 1}
        onClick={() => setCompletedPage((p) => p + 1)}
        type="button"
      >
        Next{' '}
        <ChevronRight
          size={14}
          strokeWidth={2}
        />
      </button>
    </div>
  );

  const renderRow = (row) => {
    switch (row.type) {
      case 'section':
        return (
          <SectionHeader>
            {row.label}
            {row.pageInfo && (
              <span className="ul-page-info">{row.pageInfo}</span>
            )}
          </SectionHeader>
        );
      case 'group':
        return (
          <UserGroup
            cacheKey={row.user.username}
            onCancel={onCancel}
            onCancelDirectory={onCancelDirectory}
            onCancelUser={onCancelUser}
            onFindAlternate={onFindAlternate}
            onRemove={onRemove}
            onRetry={onRetry}
            onRetryBatch={onRetryBatch}
            startCollapsed={row.startCollapsed}
            user={row.user}
          />
        );
      case 'pagination':
        return renderPagination();
      default:
        return <p className="dl-filter-empty">No folders match this filter.</p>;
    }
  };

  return (
    <div className="dl-root">
      <Toolbar
        allFiles={allFiles}
        onCancel={onCancel}
        onClearCompleted={onClearCompleted}
        onPageSizeChange={handlePageSizeChange}
        onRemove={onRemove}
        onRetry={onRetry}
        onRetryBatch={onRetryBatch}
        pageSize={pageSize}
      />
      <FilterPills
        activeFilter={activeFilter}
        counts={counts}
        onChange={handleFilterChange}
      />
      <div
        className="dl-groups"
        ref={scrollRef}
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => (
            <div
              className="dl-virtual-row"
              data-index={vi.index}
              key={vi.key}
              ref={virtualizer.measureElement}
              style={{
                left: 0,
                position: 'absolute',
                top: 0,
                transform: `translateY(${vi.start}px)`,
                width: '100%',
              }}
            >
              {renderRow(rows[vi.index])}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DownloadsTable;
