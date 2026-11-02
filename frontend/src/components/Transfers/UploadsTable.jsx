// <copyright file="UploadsTable.jsx" company="John Narey">
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
import { isStateCancellable, isStateRemovable } from '../../lib/transfers';
import { getStatus } from '../../lib/users';
import { formatBitrate, formatBytes, getFileName } from '../../lib/util';
import { UsernameLink } from '../Shared';
import UploadQueuePagination from './UploadQueuePagination';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Ban,
  ChevronDown,
  ChevronRight,
  Folder,
  Trash2,
  User,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

/* Cap file rows rendered per expanded directory — a single directory can hold
   thousands of files and rendering them all freezes the page on every poll. */
const FILE_RENDER_CHUNK = 20;

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
  InProgress: { cls: 'inprogress', dot: '#388bfd', label: 'Uploading' },
  Queued: { cls: 'queued', dot: '#a371f7', label: 'Waiting' },
  'Queued, Locally': { cls: 'queued', dot: '#a371f7', label: 'Waiting' },
  'Queued, Remotely': {
    cls: 'queued',
    dot: '#a371f7',
    label: 'Waiting',
  },
  Requested: { cls: 'queued', dot: '#a371f7', label: 'Waiting' },
};

const getMeta = (state) =>
  STATE_META[state] ?? { cls: 'error', dot: '#f85149', label: state };

/* ─── Module-level caches ────────────────────────────────────────────────── */

const presenceCache = {};

/* Collapse state lives outside the components so virtualized rows keep their
   expanded/collapsed state when they scroll out of view and unmount. */
const userCollapsedCache = {};
const directoryCollapsedCache = {};

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

const isCompletedState = (state) => Boolean(state?.startsWith('Completed'));
const isSending = (file) =>
  file.state === 'InProgress' || file.state === 'Initializing';
const isWaiting = (file) => !isCompletedState(file.state) && !isSending(file);

const buildGroups = (transfers, fileFilter) =>
  (transfers ?? [])
    .map((user) => ({
      ...user,
      directories: (user.directories ?? [])
        .map((directory) => {
          const uploads = (directory.files ?? []).filter(
            (file) =>
              file.direction?.toLowerCase() === 'upload' && fileFilter(file),
          );
          return {
            ...directory,
            files: uploads.sort(byStateThenTime),
          };
        })
        .filter((directory) => directory.files.length > 0)
        .sort((a, b) => maxTime(b.files) - maxTime(a.files)),
    }))
    .filter((user) => user.directories.length > 0)
    .sort((a, b) => {
      const aMax = maxTime(a.directories.flatMap((d) => d.files));
      const bMax = maxTime(b.directories.flatMap((d) => d.files));
      return bMax - aMax;
    });

/* ─── Sub-components ─────────────────────────────────────────────────────── */

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
  if (file.state === 'InProgress') {
    return (
      <ProgressBar
        background="var(--accent)"
        percent={Math.round(file.percentComplete ?? 0)}
      />
    );
  }

  if (file.state === 'Completed, Succeeded') {
    return (
      <ProgressBar
        background="var(--success)"
        percent={100}
      />
    );
  }

  const rawPct = file.percentComplete;
  if (rawPct == null || rawPct <= 0) {
    return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>;
  }

  return (
    <ProgressBar
      background="var(--text-muted)"
      percent={Math.round(rawPct)}
    />
  );
};

const FileRow = ({ file, mode, onCancel, onRemove }) => {
  const meta = getMeta(file.state);
  const canCancel = isStateCancellable(file.state);
  const canRemove = isStateRemovable(file.state);

  return (
    <tr className={`dl-file-row dl-file-row--${meta.cls}`}>
      <td
        className="dl-cell dl-cell--file"
        title={file.filename}
      >
        <span className="dl-filename">{getFileName(file.filename)}</span>
      </td>
      {mode !== 'waiting' && (
        <td
          className="dl-cell dl-cell--state"
          data-label="Status"
        >
          <StateBadge file={file} />
        </td>
      )}
      {mode === 'sending' && (
        <td
          className="dl-cell dl-cell--progress"
          data-label="Progress"
        >
          <FileProgress file={file} />
        </td>
      )}
      <td
        className="dl-cell dl-cell--size"
        data-label="Size"
      >
        {file.state === 'InProgress'
          ? `${formatBytes(file.bytesTransferred)} / ${formatBytes(file.size)}`
          : formatBytes(file.size)}
      </td>
      {mode === 'sending' && (
        <td
          className="dl-cell dl-cell--speed"
          data-label="Speed"
        >
          {file.averageSpeed > 0 ? formatBitrate(file.averageSpeed) : '—'}
        </td>
      )}
      <td className="dl-cell dl-cell--actions">
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
  mode,
  onCancel,
  onCancelDirectory,
  onRemove,
  username,
}) => {
  const collapseKey = `${cacheKey}|${directory.directory}`;
  const [collapsed, setCollapsed] = useState(
    directoryCollapsedCache[collapseKey] ?? false,
  );
  const [visibleCount, setVisibleCount] = useState(FILE_RENDER_CHUNK);
  const { files } = directory;
  const directoryName =
    directory.directory.split(/[/\\]/u).filter(Boolean).at(-1) ??
    directory.directory;
  const columns = mode === 'sending' ? 6 : mode === 'history' ? 4 : 3;
  return (
    <tbody>
      <tr className="ul-folder-row">
        <td colSpan={columns}>
          <div className="ul-folder-heading">
            <button
              aria-expanded={!collapsed}
              className="dl-dir-toggle"
              onClick={() =>
                setCollapsed((value) => {
                  directoryCollapsedCache[collapseKey] = !value;
                  return !value;
                })
              }
              type="button"
            >
              {collapsed ? (
                <ChevronRight size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
              <Folder size={15} />
              <span className="ul-folder-name">{directoryName}</span>
              <span className="ul-folder-count">
                {files.length} track{files.length === 1 ? '' : 's'} on this page
              </span>
              <span className="ul-track-toggle">
                {collapsed ? 'Show tracks' : 'Hide tracks'}
              </span>
            </button>
            {mode !== 'history' && (
              <button
                className="ul-folder-block"
                onClick={() =>
                  onCancelDirectory({
                    directory: directory.directory,
                    files,
                    username,
                  })
                }
                title="Cancel all requests for this folder and permanently block it for this person"
                type="button"
              >
                Block folder
              </button>
            )}
          </div>
        </td>
      </tr>
      {!collapsed &&
        files.slice(0, visibleCount).map((file) => (
          <FileRow
            file={file}
            key={file.id}
            mode={mode}
            onCancel={onCancel}
            onRemove={onRemove}
          />
        ))}
      {!collapsed && files.length > visibleCount && (
        <tr className="dl-show-more-row">
          <td colSpan={columns}>
            <button
              className="dl-show-more-btn"
              onClick={() => setVisibleCount((n) => n + FILE_RENDER_CHUNK)}
              type="button"
            >
              Show {Math.min(FILE_RENDER_CHUNK, files.length - visibleCount)}{' '}
              more tracks · {Math.min(visibleCount, files.length)} of{' '}
              {files.length} shown
            </button>
          </td>
        </tr>
      )}
    </tbody>
  );
};

const UserGroup = ({
  cacheKey,
  defaultCollapsed = false,
  mode,
  onCancel,
  onCancelDirectory,
  onCancelUser,
  onRemove,
  queueUser,
  user,
}) => {
  const [collapsed, setCollapsed] = useState(
    userCollapsedCache[cacheKey] ?? defaultCollapsed,
  );
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      userCollapsedCache[cacheKey] = !c;
      return !c;
    });
  const [presence, setPresence] = useState(
    presenceCache[user.username] ?? null,
  );
  const allFiles = user.directories.flatMap((directory) => directory.files);
  const totalCount =
    mode === 'waiting'
      ? queueUser?.waitingCount ?? allFiles.length
      : queueUser?.activeCount ?? allFiles.length;

  const totalSpeed = allFiles.reduce(
    (sum, file) =>
      sum + (file.state === 'InProgress' ? file.averageSpeed ?? 0 : 0),
    0,
  );

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
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Show' : 'Hide'} tracks for ${user.username}`}
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
          style={{ marginRight: 6 }}
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
        </div>
        {mode !== 'history' && (
          <button
            aria-label={`Cancel all uploads to ${user.username}`}
            className="dl-action-btn dl-action-btn--cancel"
            onClick={(e) => {
              e.stopPropagation();
              onCancelUser({
                directories: user.directories,
                username: user.username,
              });
            }}
            title="Cancel all uploads to this person, including other pages"
            type="button"
          >
            <Ban
              size={14}
              strokeWidth={2}
            />
          </button>
        )}
      </div>

      <div className="ul-person-summary">
        <strong>
          {totalCount.toLocaleString()}{' '}
          {mode === 'waiting' ? 'waiting in total' : 'uploading or connecting'}
        </strong>
        <span>
          {allFiles.length} track{allFiles.length === 1 ? '' : 's'} on this page
        </span>
        {totalSpeed > 0 && <span>{formatBitrate(totalSpeed)}</span>}
      </div>

      {!collapsed && (
        <div className={`dl-user-body ul-tracks--${mode}`}>
          <table className="dl-table">
            <thead>
              <tr className="dl-thead-row">
                <th className="dl-cell dl-cell--file">Track</th>
                {mode !== 'waiting' && (
                  <th className="dl-cell dl-cell--state">
                    {mode === 'history' ? 'Outcome' : 'Status'}
                  </th>
                )}
                {mode === 'sending' && (
                  <th className="dl-cell dl-cell--progress">Progress</th>
                )}
                <th className="dl-cell dl-cell--size">Size</th>
                {mode === 'sending' && (
                  <th className="dl-cell dl-cell--speed">Speed</th>
                )}
                <th className="dl-cell dl-cell--actions" />
              </tr>
            </thead>
            {user.directories.map((directory) => (
              <DirectoryGroup
                cacheKey={cacheKey}
                directory={directory}
                key={directory.directory}
                mode={mode}
                onCancel={onCancel}
                onCancelDirectory={onCancelDirectory}
                onRemove={onRemove}
                username={user.username}
              />
            ))}
          </table>
        </div>
      )}
    </div>
  );
};

/* Full recipient counts reconcile the whole queue; details remain bounded. */
const UploadsTable = ({
  onCancel,
  onCancelDirectory,
  onCancelUser,
  onPendingPageChange,
  onRemove,
  onSelectUploadUser,
  pendingPage = 0,
  queueUsers = [],
  selectedUsername,
  transfers,
  userTotalPending = 0,
}) => {
  const sending = useMemo(() => buildGroups(transfers, isSending), [transfers]);
  const waiting = useMemo(() => buildGroups(transfers, isWaiting), [transfers]);
  const pendingFiles = [...sending, ...waiting].flatMap((user) =>
    user.directories.flatMap((directory) => directory.files),
  );
  const totalWaiting = queueUsers.reduce(
    (sum, user) => sum + user.waitingCount,
    0,
  );
  const totalActive = queueUsers.reduce(
    (sum, user) => sum + user.activeCount,
    0,
  );
  const rows = useMemo(() => {
    const result = [];
    for (const [groups, mode, title] of [
      [sending, 'sending', 'Uploading now'],
      [waiting, 'waiting', 'Waiting to upload'],
    ]) {
      result.push({ key: mode, type: 'section', title });
      if (!groups.length)
        result.push({
          key: `${mode}-empty`,
          type: 'empty',
          title:
            mode === 'sending'
              ? 'No tracks uploading on this page.'
              : 'No waiting tracks on this page.',
        });
      for (const user of groups)
        result.push({
          key: `${mode}-${user.username}`,
          type: 'person',
          mode,
          user,
        });
    }

    return result;
  }, [sending, waiting]);
  const scrollRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getItemKey: (index) => rows[index].key,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index].type === 'person' ? 240 : 60),
    overscan: 3,
  });
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [pendingPage, selectedUsername]);
  return (
    <div className="dl-root ul-redesign">
      <header className="ul-page-heading">
        <div>
          <h1>Uploads</h1>
          <p>Choose a person to see the tracks they requested.</p>
        </div>
        <div className="ul-queue-total">
          <strong>{totalWaiting.toLocaleString()}</strong>
          <span>uploads waiting</span>
          <span>{totalActive} uploading or connecting</span>
        </div>
      </header>
      <div className="ul-queue-workspace">
        <aside
          aria-label="Everyone in the upload queue"
          className="ul-people"
        >
          <h2>Waiting by person</h2>
          <p>
            {queueUsers.length} people · {totalWaiting.toLocaleString()} waiting
            in total
          </p>
          {queueUsers.length === 0 && <p>No queued uploads.</p>}
          <div className="ul-people-list">
            {queueUsers.map((user) => (
              <button
                aria-pressed={user.username === selectedUsername}
                className="ul-person-choice"
                key={user.username}
                onClick={() => onSelectUploadUser(user.username)}
                type="button"
              >
                <strong>{user.username}</strong>
                <span>
                  <b>{user.waitingCount.toLocaleString()}</b> waiting
                  {user.activeCount > 0
                    ? ` · ${user.activeCount} sending/connecting`
                    : ''}
                </span>
                <span className="ul-person-open">View tracks →</span>
              </button>
            ))}
          </div>
        </aside>
        <div className="ul-person-tracks">
          <div className="ul-selected-heading">
            <h2>
              {selectedUsername
                ? `${selectedUsername}’s tracks`
                : 'Upload queue is empty'}
            </h2>
            {pendingFiles.length > 0 && (
              <button
                className="ul-quick-btn ul-quick-btn--cancel"
                onClick={() => {
                  if (
                    window.confirm(
                      `Cancel the ${pendingFiles.length} unfinished requests on this page? Requests on other pages will stay queued.`,
                    )
                  )
                    for (const file of pendingFiles)
                      if (isStateCancellable(file.state)) onCancel({ file });
                }}
                type="button"
              >
                Cancel requests on this page
              </button>
            )}
          </div>
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
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                return (
                  <div
                    className="dl-virtual-row"
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
                    {row.type === 'section' ? (
                      <div className="ul-section-heading">
                        <h2>{row.title}</h2>
                      </div>
                    ) : row.type === 'empty' ? (
                      <p className="ul-section-empty">{row.title}</p>
                    ) : (
                      <UserGroup
                        cacheKey={row.key}
                        mode={row.mode}
                        onCancel={onCancel}
                        onCancelDirectory={onCancelDirectory}
                        onCancelUser={onCancelUser}
                        onRemove={onRemove}
                        queueUser={queueUsers.find(
                          (user) => user.username === row.user.username,
                        )}
                        user={row.user}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <footer className="ul-view-footer">
            <UploadQueuePagination
              onPageChange={onPendingPageChange}
              page={pendingPage}
              total={userTotalPending}
              username={selectedUsername}
            />
          </footer>
        </div>
      </div>
    </div>
  );
};

export default UploadsTable;
