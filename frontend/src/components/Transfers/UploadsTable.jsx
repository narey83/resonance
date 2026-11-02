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

const pageSize_OPTIONS = [15, 30, 50, 100, 150];

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
                {files.length} track{files.length === 1 ? '' : 's'}
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
          {allFiles.length}{' '}
          {mode === 'waiting'
            ? 'waiting'
            : mode === 'sending'
              ? 'uploading or connecting'
              : 'finished'}
        </strong>
        <span>
          {mode === 'history' ? 'in recent history' : 'on this queue page'}
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

/* Queue pages contain unfinished requests; recent history is independent. */
const UploadsTable = ({
  onCancel,
  onCancelDirectory,
  onCancelUser,
  onClearCompleted,
  onPendingPageChange,
  onRemove,
  pendingPage = 0,
  totalPending,
  transfers,
}) => {
  const [view, setView] = useState('queue');
  const [completedPage, setCompletedPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const sending = useMemo(() => buildGroups(transfers, isSending), [transfers]);
  const waiting = useMemo(() => buildGroups(transfers, isWaiting), [transfers]);
  const history = useMemo(
    () => buildGroups(transfers, (file) => isCompletedState(file.state)),
    [transfers],
  );
  const pendingFiles = [...sending, ...waiting].flatMap((user) =>
    user.directories.flatMap((directory) => directory.files),
  );
  const historyFiles = history.flatMap((user) =>
    user.directories.flatMap((directory) => directory.files),
  );
  const historyPages = Math.max(1, Math.ceil(history.length / pageSize));
  useEffect(() => {
    setCompletedPage((page) => Math.min(page, historyPages - 1));
  }, [historyPages]);
  const rows = useMemo(() => {
    const result = [];
    const section = (groups, mode, title, description) => {
      result.push({ key: mode, type: 'section', title, description });
      if (groups.length === 0)
        result.push({
          key: `${mode}-empty`,
          type: 'empty',
          title:
            mode === 'sending'
              ? 'No tracks uploading on this page.'
              : mode === 'waiting'
                ? 'No waiting tracks on this page.'
                : 'No recent upload history.',
        });
      for (const user of groups)
        result.push({
          key: `${mode}-${user.username}`,
          type: 'person',
          mode,
          user,
        });
    };

    if (view === 'queue') {
      section(
        sending,
        'sending',
        'Uploading now',
        'Tracks currently sending or connecting on this queue page.',
      );
      section(
        waiting,
        'waiting',
        'Waiting to upload',
        'These requested tracks have not started sending yet.',
      );
    } else {
      section(
        history.slice(completedPage * pageSize, (completedPage + 1) * pageSize),
        'history',
        'Recent history',
        'The most recent 500 finished requests, including sent, failed and cancelled tracks.',
      );
    }

    return result;
  }, [completedPage, history, pageSize, sending, view, waiting]);
  const scrollRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getItemKey: (index) => rows[index].key,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index].type === 'person' ? 240 : 76),
    overscan: 3,
  });
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [completedPage, pendingPage, view]);
  return (
    <div className="dl-root ul-redesign">
      <header className="ul-page-heading">
        <div>
          <h1>Uploads</h1>
          <p>Tracks you share with other people.</p>
        </div>
        <div className="ul-queue-total">
          <strong>
            {(totalPending ?? pendingFiles.length).toLocaleString()}
          </strong>
          <span>tracks left to send</span>
        </div>
      </header>
      <div
        aria-label="Upload views"
        className="ul-view-tabs"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
            return;
          event.preventDefault();
          const nextView =
            event.key === 'Home'
              ? 'queue'
              : event.key === 'End'
                ? 'history'
                : view === 'queue'
                  ? 'history'
                  : 'queue';
          setView(nextView);
          event.currentTarget.querySelector(`#ul-${nextView}-tab`).focus();
        }}
        role="tablist"
        tabIndex={-1}
      >
        <button
          aria-controls="ul-upload-panel"
          aria-selected={view === 'queue'}
          id="ul-queue-tab"
          onClick={() => setView('queue')}
          role="tab"
          tabIndex={view === 'queue' ? 0 : -1}
          type="button"
        >
          Upload queue
        </button>
        <button
          aria-controls="ul-upload-panel"
          aria-selected={view === 'history'}
          id="ul-history-tab"
          onClick={() => setView('history')}
          role="tab"
          tabIndex={view === 'history' ? 0 : -1}
          type="button"
        >
          History
        </button>
      </div>
      <div className="ul-view-tools">
        {view === 'queue' ? (
          <>
            <p>
              Track counts below belong to the person and folder shown. Larger
              queues continue on the next page.
            </p>
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
          </>
        ) : (
          <>
            <label>
              People per history page{' '}
              <select
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setCompletedPage(0);
                }}
                value={pageSize}
              >
                {pageSize_OPTIONS.map((size) => (
                  <option
                    key={size}
                    value={size}
                  >
                    {size}
                  </option>
                ))}
              </select>
            </label>
            {historyFiles.length > 0 && (
              <button
                className="ul-quick-btn ul-quick-btn--remove"
                onClick={onClearCompleted}
                type="button"
              >
                Clear all finished history
              </button>
            )}
          </>
        )}
      </div>
      <div
        aria-labelledby={`ul-${view}-tab`}
        className="dl-groups"
        id="ul-upload-panel"
        ref={scrollRef}
        role="tabpanel"
        tabIndex={0}
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
                    <p>{row.description}</p>
                  </div>
                ) : row.type === 'empty' ? (
                  <p className="ul-section-empty">{row.title}</p>
                ) : (
                  <UserGroup
                    cacheKey={row.key}
                    defaultCollapsed={row.mode === 'history'}
                    mode={row.mode}
                    onCancel={onCancel}
                    onCancelDirectory={onCancelDirectory}
                    onCancelUser={onCancelUser}
                    onRemove={onRemove}
                    user={row.user}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <footer className="ul-view-footer">
        {view === 'queue' && Number.isInteger(totalPending) ? (
          <UploadQueuePagination
            onPageChange={onPendingPageChange}
            page={pendingPage}
            total={totalPending}
          />
        ) : view === 'history' ? (
          <nav
            aria-label="History pages"
            className="ul-pagination"
          >
            <button
              className="ul-page-btn"
              disabled={completedPage === 0}
              onClick={() => setCompletedPage((page) => page - 1)}
              type="button"
            >
              Previous
            </button>
            <span>
              History page {completedPage + 1} of {historyPages}
            </span>
            <button
              className="ul-page-btn"
              disabled={completedPage + 1 >= historyPages}
              onClick={() => setCompletedPage((page) => page + 1)}
              type="button"
            >
              Next
            </button>
          </nav>
        ) : null}
      </footer>
    </div>
  );
};

export default UploadsTable;
