import { lookupIp } from '../../lib/network';
import { isStateCancellable, isStateRemovable } from '../../lib/transfers';
import { getStatus } from '../../lib/users';
import { formatBytes, getFileName } from '../../lib/util';
import { UsernameLink } from '../Shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderOpen,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

const pageSize_OPTIONS = [15, 30, 50, 100, 150];

/* Cap file rows rendered per expanded directory — a single directory can hold
   thousands of files and rendering them all freezes the page on every poll. */
const FILE_RENDER_CHUNK = 200;

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

/* ─── Module-level caches ────────────────────────────────────────────────── */

const netInfoCache = {};
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

const byRecent = (a, b) => getTime(b) - getTime(a);

const isActiveState = (state) => !state?.startsWith('Completed');
const isCompletedState = (state) => Boolean(state?.startsWith('Completed'));

const buildGroups = (transfers, stateFilter) =>
  (transfers ?? [])
    .map((user) => ({
      ...user,
      directories: (user.directories ?? [])
        .map((directory) => ({
          ...directory,
          files: (directory.files ?? [])
            .filter((file) => file.direction?.toLowerCase() === 'upload')
            .filter((file) => stateFilter(file.state))
            .sort(byRecent),
        }))
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

const FileRow = ({ file, onCancel, onRemove }) => {
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
        {file.averageSpeed > 0 ? `${formatBytes(file.averageSpeed)}/s` : '—'}
      </td>
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

const DirectoryGroup = ({ cacheKey, directory, onCancel, onRemove }) => {
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
  const totalSpeed = files
    .filter((f) => f.state === 'InProgress')
    .reduce((s, f) => s + (f.averageSpeed ?? 0), 0);
  const overallPercent =
    totalSize > 0 ? Math.round((totalTransferred / totalSize) * 100) : 0;
  const completedCount = files.filter((f) =>
    f.state?.startsWith('Completed'),
  ).length;
  const allCompleted = completedCount === files.length;
  const allSucceeded = files.every((f) => f.state === 'Completed, Succeeded');
  const anyActive = files.some((f) => f.state === 'InProgress');

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
            {completedCount} / {files.length} done
          </span>
        </td>
        <td className="dl-cell dl-cell--progress">
          <ProgressBar
            background={progressColor}
            percent={overallPercent}
          />
        </td>
        <td className="dl-cell dl-cell--size">
          {allCompleted
            ? formatBytes(totalSize)
            : `${formatBytes(totalTransferred)} / ${formatBytes(totalSize)}`}
        </td>
        <td className="dl-cell dl-cell--speed">
          {totalSpeed > 0 ? `${formatBytes(totalSpeed)}/s` : '—'}
        </td>
        <td className="dl-cell dl-cell--actions" />
      </tr>
      {!collapsed &&
        files.slice(0, visibleCount).map((file) => (
          <FileRow
            file={file}
            key={file.id}
            onCancel={onCancel}
            onRemove={onRemove}
          />
        ))}
      {!collapsed && files.length > visibleCount && (
        <tr className="dl-show-more-row">
          <td colSpan={6}>
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

const UserGroup = ({
  cacheKey,
  defaultCollapsed = false,
  onCancel,
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
  const [netInfo, setNetInfo] = useState(netInfoCache[user.username] ?? null);
  const [presence, setPresence] = useState(
    presenceCache[user.username] ?? null,
  );
  const allFiles = user.directories.flatMap((directory) => directory.files);

  const inProgressCount = allFiles.filter(
    (file) => file.state === 'InProgress',
  ).length;
  const queuedCount = allFiles.filter((file) => isQueued(file.state)).length;
  const succeededCount = allFiles.filter(
    (file) => file.state === 'Completed, Succeeded',
  ).length;
  const totalSpeed = allFiles
    .filter((f) => f.state === 'InProgress')
    .reduce((sum, file) => sum + (file.averageSpeed ?? 0), 0);

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
          {netInfo && (
            <div className="dl-user-net">
              <span className="dl-user-net-ip">{netInfo.ip}</span>
              {netInfo.isVpn ? (
                <span className="dl-user-net-vpn dl-user-net-vpn--good">
                  VPN
                </span>
              ) : (
                <span className="dl-user-net-vpn dl-user-net-vpn--bad">
                  No VPN
                </span>
              )}
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
              {inProgressCount} uploading
            </span>
          )}
          {queuedCount > 0 && (
            <span className="dl-user-stat dl-user-stat--queued">
              {queuedCount} queued
            </span>
          )}
          {succeededCount > 0 && (
            <span
              className="dl-user-stat"
              style={{ color: 'var(--success)' }}
            >
              {succeededCount} done
            </span>
          )}
          {totalSpeed > 0 && (
            <span className="dl-user-stat dl-user-stat--speed">
              {formatBytes(totalSpeed)}/s
            </span>
          )}
          <span className="dl-user-stat">
            {allFiles.length} file{allFiles.length === 1 ? '' : 's'}
          </span>
        </div>
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
                <th className="dl-cell dl-cell--actions" />
              </tr>
            </thead>
            {user.directories.map((directory) => (
              <DirectoryGroup
                cacheKey={cacheKey}
                directory={directory}
                key={directory.directory}
                onCancel={onCancel}
                onRemove={onRemove}
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
  pageSize,
}) => {
  const cancellableFiles = allFiles.filter((file) =>
    isStateCancellable(file.state),
  );
  const succeededFiles = allFiles.filter(
    (file) => file.state === 'Completed, Succeeded',
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
            {pageSize_OPTIONS.map((n) => (
              <option
                key={n}
                value={n}
              >
                {n}
              </option>
            ))}
          </select>
        </label>
        {cancellableFiles.length > 0 && (
          <button
            className="ul-quick-btn ul-quick-btn--cancel"
            onClick={() => {
              for (const file of cancellableFiles) onCancel({ file });
            }}
            type="button"
          >
            <X
              size={12}
              strokeWidth={2}
            />
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
            />
            Clear done
          </button>
        )}
      </div>
    </div>
  );
};

/* ─── Main component ─────────────────────────────────────────────────────── */

const SectionHeader = ({ children }) => (
  <div className="transfer-section-header">{children}</div>
);

const UploadsTable = ({ onCancel, onClearCompleted, onRemove, transfers }) => {
  const [completedPage, setCompletedPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const activeGroups = useMemo(
    () => buildGroups(transfers, isActiveState),
    [transfers],
  );
  const completedGroups = useMemo(
    () => buildGroups(transfers, isCompletedState),
    [transfers],
  );

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
        user.directories.flatMap((directory) => directory.files),
      ),
    [activeGroups, completedGroups],
  );

  /* Flatten sections, groups, and pagination into one list so the whole
     scroll area can be virtualized. A user can appear in both sections,
     hence the per-section key prefix. */
  const rows = useMemo(() => {
    const result = [];
    if (activeGroups.length > 0) {
      result.push({
        key: 'section-active',
        label: 'Uploading',
        type: 'section',
      });
      for (const user of activeGroups) {
        result.push({
          defaultCollapsed: false,
          key: `group-active-${user.username}`,
          type: 'group',
          user,
        });
      }
    }

    if (completedGroups.length > 0) {
      result.push({
        key: 'section-done',
        label: 'Uploaded',
        pageInfo:
          totalCompletedPages > 1
            ? `${completedPage + 1} / ${totalCompletedPages}`
            : null,
        type: 'section',
      });
      for (const user of completedPageGroups) {
        result.push({
          defaultCollapsed: true,
          key: `group-done-${user.username}`,
          type: 'group',
          user,
        });
      }

      if (totalCompletedPages > 1)
        result.push({ key: 'pagination', type: 'pagination' });
    }

    return result;
  }, [
    activeGroups,
    completedGroups,
    completedPage,
    completedPageGroups,
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
        <Upload
          opacity={0.15}
          size={40}
          strokeWidth={1.25}
        />
        <p style={{ color: 'var(--text-muted)', marginTop: 12 }}>No uploads</p>
      </div>
    );
  }

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
        />
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
        Next
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
            cacheKey={row.key}
            defaultCollapsed={row.defaultCollapsed}
            onCancel={onCancel}
            onRemove={onRemove}
            user={row.user}
          />
        );
      default:
        return renderPagination();
    }
  };

  return (
    <div className="dl-root">
      <Toolbar
        allFiles={allFiles}
        onCancel={onCancel}
        onClearCompleted={onClearCompleted}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setCompletedPage(0);
        }}
        onRemove={onRemove}
        pageSize={pageSize}
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

export default UploadsTable;
