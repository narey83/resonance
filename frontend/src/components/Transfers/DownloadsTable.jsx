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
import * as prefs from '../../lib/prefs';
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
import PeerUploadSlots from './PeerUploadSlots';
import RecipientStatusDropdown from './RecipientStatusDropdown';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Ban,
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

const isReceiving = (file) =>
  ['InProgress', 'Initializing'].includes(file.state);
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

const FileRow = ({ file, onCancel, onRemove, onRetry, sourceFolder }) => {
  const meta = getMeta(file.state);
  const canRetry = isStateRetryable(file.state);
  const canCancel = isStateCancellable(file.state);
  const canRemove = isStateRemovable(file.state);

  return (
    <tr
      className={`dl-file-row dl-file-row--${meta.cls}`}
      data-download-id={file.id}
    >
      <td
        className="dl-cell dl-cell--file"
        title={file.filename}
      >
        <span className="dl-filename">{getFileName(file.filename)}</span>
        {sourceFolder && (
          <span className="dl-filepath">
            From: {getFileName(sourceFolder.replace(/[/\\]+$/u, ''))}
          </span>
        )}
      </td>
      <td
        className="dl-cell dl-cell--state"
        data-label="Status"
      >
        <StateBadge file={file} />
      </td>
      <td
        className="dl-cell dl-cell--progress"
        data-label="Progress"
      >
        <FileProgress file={file} />
      </td>
      <td
        className="dl-cell dl-cell--size"
        data-label="Size"
      >
        {file.state === 'InProgress'
          ? `${formatBytes(file.bytesTransferred)} / ${formatBytes(file.size)}`
          : formatBytes(file.size)}
      </td>
      <td
        className="dl-cell dl-cell--speed"
        data-label="Speed"
      >
        {file.averageSpeed > 0 ? formatBitrate(file.averageSpeed) : '—'}
      </td>
      <td
        className="dl-cell dl-cell--eta"
        data-label="ETA"
      >
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
  collapsed,
  directory,
  onCancelDirectory,
  onFindAlternate,
  onRetryBatch,
  onToggle,
  username,
}) => {
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
  const completedCount = files.filter((f) =>
    f.state?.startsWith('Completed'),
  ).length;
  const succeededCount = files.filter(
    (file) => file.state === 'Completed, Succeeded',
  ).length;

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
            aria-expanded={!collapsed}
            className="dl-dir-toggle"
            onClick={onToggle}
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
        <td
          className="dl-cell dl-cell--state"
          data-label="Status"
        >
          <span className="dl-dir-stat">
            {succeededCount} / {files.length} received
            {retryableFiles.length > 0
              ? ` · ${retryableFiles.length} failed`
              : ''}
          </span>
        </td>
        <td
          className="dl-cell dl-cell--progress"
          data-label="Progress"
        >
          <ProgressBar
            background={progressColor}
            percent={overallPercent}
          />
        </td>
        <td
          className="dl-cell dl-cell--size"
          data-label="Size"
        >
          {allCompleted
            ? formatBytes(totalSize)
            : `${formatBytes(totalTransferred)} / ${formatBytes(totalSize)}`}
        </td>
        <td
          className="dl-cell dl-cell--speed"
          data-label="Speed"
        >
          {folderSpeed > 0 ? formatBitrate(folderSpeed) : '—'}
        </td>
        <td
          className="dl-cell dl-cell--eta"
          data-label="ETA"
        >
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

const TableHead = ({ visuallyHidden = false }) => (
  <thead className={visuallyHidden ? 'dl-screenreader-head' : undefined}>
    <tr className="dl-thead-row">
      <th className="dl-cell dl-cell--file">Track</th>
      <th className="dl-cell dl-cell--state">Status</th>
      <th className="dl-cell dl-cell--progress">Progress</th>
      <th className="dl-cell dl-cell--size">Size</th>
      <th className="dl-cell dl-cell--speed">Speed</th>
      <th className="dl-cell dl-cell--eta">ETA</th>
      <th
        aria-label="Actions"
        className="dl-cell dl-cell--actions"
      />
    </tr>
  </thead>
);

const TableColumns = () => (
  <colgroup>
    {['file', 'state', 'progress', 'size', 'speed', 'eta', 'actions'].map(
      (name) => (
        <col
          className={`dl-cell--${name}`}
          key={name}
        />
      ),
    )}
  </colgroup>
);

const UserGroup = ({
  filters,
  onCancel,
  onCancelDirectory,
  onCancelUser,
  onFindAlternate,
  onRemove,
  onRetry,
  onRetryBatch,
  presence,
  user,
  visibleDirectories,
}) => {
  const [netInfo, setNetInfo] = useState(netInfoCache[user.username] ?? null);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set());
  const allFiles = user.directories.flatMap((d) => d.files);
  const activeFiles = user.directories.flatMap((d) =>
    d.files.filter(isReceiving).map((file) => ({ file, folder: d.directory })),
  );
  const inProgressCount = activeFiles.length;
  const queuedCount = user.summary.waiting;
  const totalSpeed = activeFiles.reduce(
    (sum, { file }) => sum + (file.averageSpeed ?? 0),
    0,
  );
  const retryableFiles = allFiles.filter((f) => isStateRetryable(f.state));
  const activeCount = user.summary.pending;
  const scrollRef = useRef(null);
  const rows = useMemo(
    () =>
      visibleDirectories.flatMap((directory) => [
        { key: `folder-${directory.directory}`, type: 'folder', directory },
        ...(expandedFolders.has(directory.directory)
          ? directory.files.map((file) => ({
              key: `file-${file.id}`,
              type: 'file',
              file,
            }))
          : []),
      ]),
    [expandedFolders, visibleDirectories],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getItemKey: (index) => rows[index].key,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index].type === 'folder' ? 44 : 56),
    overscan: 6,
  });
  const toggleFolder = (folder) =>
    setExpandedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
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

  return (
    <div className="dl-user-group dl-selected-user">
      <div className="dl-user-header">
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
          <PeerUploadSlots username={user.username} />
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

      <section
        aria-label="Downloading now"
        className="ul-current-uploads"
      >
        <h2>
          Downloading now
          {activeFiles.length > 0 ? ` · ${activeFiles.length}` : ''}
        </h2>
        {activeFiles.length === 0 ? (
          <p>Nothing downloading from this user right now.</p>
        ) : (
          <div className="ul-current-list dl-current-list">
            <table
              aria-label="Current downloads"
              className="dl-table"
            >
              <TableColumns />
              <TableHead />
              <tbody>
                {activeFiles.map(({ file, folder }) => (
                  <FileRow
                    file={file}
                    key={file.id}
                    onCancel={onCancel}
                    onRemove={onRemove}
                    onRetry={onRetry}
                    sourceFolder={folder}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="dl-folders-heading">
        <h2>Folders</h2>
        <span>
          {visibleDirectories.length.toLocaleString()} folders ·{' '}
          {visibleDirectories
            .reduce((sum, d) => sum + d.files.length, 0)
            .toLocaleString()}{' '}
          tracks
        </span>
      </div>
      {filters}
      <div className="dl-folder-list">
        <table
          aria-hidden="true"
          className="dl-table dl-folder-columns"
        >
          <TableColumns />
          <TableHead />
        </table>
        <div
          aria-label="Download folders"
          className="dl-folder-scroll"
          ref={scrollRef}
        >
          {visibleDirectories.length === 0 ? (
            <p className="dl-filter-empty">No folders match this filter.</p>
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: 'relative',
                width: '100%',
              }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                return (
                  <div
                    className="dl-folder-virtual-row"
                    data-index={item.index}
                    key={item.key}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    <table
                      aria-label={
                        row.type === 'folder'
                          ? `${getFileName(row.directory.directory)} downloads`
                          : getFileName(row.file.filename)
                      }
                      className="dl-table"
                    >
                      <TableColumns />
                      <TableHead visuallyHidden />
                      {row.type === 'folder' ? (
                        <DirectoryGroup
                          collapsed={
                            !expandedFolders.has(row.directory.directory)
                          }
                          directory={row.directory}
                          onCancelDirectory={onCancelDirectory}
                          onFindAlternate={onFindAlternate}
                          onRetryBatch={onRetryBatch}
                          onToggle={() => toggleFolder(row.directory.directory)}
                          username={user.username}
                        />
                      ) : (
                        <tbody>
                          <FileRow
                            file={row.file}
                            onCancel={onCancel}
                            onRemove={onRemove}
                            onRetry={onRetry}
                          />
                        </tbody>
                      )}
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─── Toolbar ────────────────────────────────────────────────────────────── */

const Toolbar = ({ allFiles, onCancel, onClearCompleted, onRetryBatch }) => {
  const cancellableFiles = allFiles.filter((f) => isStateCancellable(f.state));
  const retryableFiles = allFiles.filter((f) => isStateRetryable(f.state));
  const succeededFiles = allFiles.filter(
    (f) => f.state === 'Completed, Succeeded',
  );

  return (
    <div className="ul-toolbar">
      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        All downloads: {allFiles.length.toLocaleString()} tracks
      </span>
      <div className="ul-toolbar-actions">
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
            Retry all failed
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
            Cancel all unfinished
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
            Clear finished
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
  <div
    aria-label="Filter folders for selected user"
    className="dl-filter-pills"
  >
    {FILTERS.map(({ id, label }) => (
      <button
        aria-pressed={activeFilter === id}
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

const summarizeFiles = (files) => {
  const active = files.filter(isReceiving).length;
  const pending = files.filter(
    (file) => !file.state?.startsWith('Completed'),
  ).length;
  const failed = files.filter((file) => isStateRetryable(file.state)).length;
  return {
    active,
    hasDownloading: files.some((file) => file.state === 'InProgress'),
    hasConnecting: files.some((file) =>
      ['Initializing', 'Requested'].includes(file.state),
    ),
    pending,
    waiting: pending - active,
    failed,
    finished: files.length - pending - failed,
    total: files.length,
  };
};

const summaryText = (summary) =>
  [
    summary.waiting > 0 && `${summary.waiting.toLocaleString()} waiting`,
    summary.active > 0 &&
      `${summary.active.toLocaleString()} downloading/connecting`,
    summary.failed > 0 && `${summary.failed.toLocaleString()} failed`,
    summary.finished > 0 && `${summary.finished.toLocaleString()} finished`,
  ]
    .filter(Boolean)
    .join(' · ');

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
  const [selectedUsername, setSelectedUsername] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [sourceStatus, setSourceStatus] = useState(() => {
    try {
      const saved = prefs.get('resonance-downloads-source-status');
      if (['Downloading', 'Connecting', 'Waiting', 'All'].includes(saved))
        return saved;
    } catch {
      // Keep the page usable if browser storage is unavailable.
    }

    return 'All';
  });
  const [presences, setPresences] = useState({});
  const fetchedRef = useRef(new Set());
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const allGroups = useMemo(
    () =>
      buildGroups(transfers, () => true)
        .map((source) => ({
          ...source,
          summary: summarizeFiles(source.directories.flatMap((d) => d.files)),
        }))
        .sort(
          (a, b) =>
            Number(b.summary.active > 0) - Number(a.summary.active > 0) ||
            Number(b.summary.pending > 0) - Number(a.summary.pending > 0),
        ),
    [transfers],
  );
  const downloadingUsers = [];
  const connectingUsers = [];
  const waitingUsers = [];
  for (const source of allGroups) {
    if (source.summary.hasDownloading) downloadingUsers.push(source);
    else if (source.summary.hasConnecting) connectingUsers.push(source);
    else if (source.summary.pending > 0) waitingUsers.push(source);
  }

  const sourceGroups = [
    {
      label: 'Downloading',
      users: downloadingUsers,
      empty: 'No users downloading.',
    },
    {
      label: 'Connecting',
      users: connectingUsers,
      empty: 'No users connecting.',
    },
    { label: 'Waiting', users: waitingUsers, empty: 'No users waiting.' },
    { label: 'All', users: allGroups, empty: 'No downloads.' },
  ];
  const visibleSources = sourceGroups.find(
    (group) => group.label === sourceStatus,
  );
  const user =
    allGroups.find((group) => group.username === selectedUsername) ??
    allGroups[0];
  useEffect(() => {
    if (!allGroups.some((group) => group.username === selectedUsername)) {
      setSelectedUsername(allGroups[0]?.username ?? null);
      setActiveFilter('all');
    }
  }, [allGroups, selectedUsername]);
  useEffect(() => {
    for (const group of allGroups) {
      const name = group.username;
      if (fetchedRef.current.has(name)) continue;
      fetchedRef.current.add(name);
      getStatus({ username: name })
        .then(({ data }) => {
          const presence = data?.presence ?? 'Unknown';
          presenceCache[name] = presence;
          if (mountedRef.current)
            setPresences((previous) => ({ ...previous, [name]: presence }));
        })
        .catch(() => {
          fetchedRef.current.delete(name);
        });
    }
  }, [allGroups]);
  const allFiles = useMemo(
    () =>
      allGroups.flatMap((group) => group.directories.flatMap((d) => d.files)),
    [allGroups],
  );
  const counts = Object.fromEntries(
    FILTERS.map(({ id }) => [
      id,
      (user?.directories ?? []).filter((d) =>
        matchesFilter(d, user.username, presences, id),
      ).length,
    ]),
  );
  const directories = (user?.directories ?? []).filter((d) =>
    matchesFilter(d, user.username, presences, activeFilter),
  );
  return (
    <div className="ul-complete dl-workspace-root">
      <header className="ul-complete-header">
        <h1>Downloads</h1>
        <Toolbar
          allFiles={allFiles}
          onCancel={onCancel}
          onClearCompleted={onClearCompleted}
          onRetryBatch={onRetryBatch}
        />
      </header>
      <div className="ul-live-workspace">
        <aside
          aria-label="Download users"
          className="ul-live-users"
        >
          <RecipientStatusDropdown
            groups={sourceGroups}
            label="Download source status"
            onChange={(status) => {
              setSourceStatus(status);
              prefs.set('resonance-downloads-source-status', status);
            }}
            value={sourceStatus}
          />
          {visibleSources.users.length === 0 && <p>{visibleSources.empty}</p>}
          <div className="ul-live-user-list">
            {visibleSources.users.map((group) => (
              <button
                aria-pressed={user?.username === group.username}
                className="ul-live-user"
                key={group.username}
                onClick={() => {
                  setSelectedUsername(group.username);
                  setActiveFilter('all');
                }}
                type="button"
              >
                <strong>{group.username}</strong>
                <span>
                  {group.summary.total.toLocaleString()} tracks ·{' '}
                  {summaryText(group.summary)}
                </span>
              </button>
            ))}
          </div>
        </aside>
        <div className="ul-live-track-pane">
          {user ? (
            <UserGroup
              filters={
                <FilterPills
                  activeFilter={activeFilter}
                  counts={counts}
                  onChange={setActiveFilter}
                />
              }
              key={user.username}
              onCancel={onCancel}
              onCancelDirectory={onCancelDirectory}
              onCancelUser={onCancelUser}
              onFindAlternate={onFindAlternate}
              onRemove={onRemove}
              onRetry={onRetry}
              onRetryBatch={onRetryBatch}
              presence={
                presences[user.username] ?? presenceCache[user.username]
              }
              user={user}
              visibleDirectories={directories}
            />
          ) : (
            <div className="dl-empty">
              <Download
                opacity={0.3}
                size={40}
              />
              <p>
                No downloads. New users will appear here when you queue music.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DownloadsTable;
