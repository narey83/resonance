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
import * as prefs from '../../lib/prefs';
import { getUploadFolder, isStateCancellable } from '../../lib/transfers';
import { getStatuses } from '../../lib/users';
import { formatBitrate, formatBytes, getFileName } from '../../lib/util';
import { UsernameLink } from '../Shared';
import RecipientStatusDropdown from './RecipientStatusDropdown';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Folder, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

const recipientStatusPreference = 'resonance-uploads-recipient-status';

const isSending = (file) => ['InProgress', 'Initializing'].includes(file.state);
const isPending = (file) =>
  file.direction?.toLowerCase() === 'upload' &&
  !file.state?.startsWith('Completed');
const byStateThenTime = (a, b) =>
  Number(isSending(b)) - Number(isSending(a)) ||
  new Date(a.requestedAt ?? 0).getTime() -
    new Date(b.requestedAt ?? 0).getTime();

const FileCells = ({ file, onCancel, sourceFolder }) => {
  const sending = isSending(file);
  const percent = Math.max(
    0,
    Math.min(100, Math.round(file.percentComplete ?? 0)),
  );
  return (
    <>
      <div
        className="ul-complete-name"
        role="cell"
        title={file.filename}
      >
        {getFileName(file.filename)}
        {sourceFolder && (
          <span className="ul-current-source">
            From: {getFileName(sourceFolder.replace(/[/\\]+$/u, ''))}
          </span>
        )}
      </div>
      <div
        className="ul-complete-state"
        data-label="Status"
        role="cell"
      >
        <span className={`state-badge ${sending ? 'inprogress' : 'queued'}`}>
          {file.state === 'InProgress'
            ? 'Uploading'
            : file.state === 'Initializing'
              ? 'Connecting'
              : 'Waiting'}
        </span>
      </div>
      <div
        className="ul-complete-progress"
        data-label="Progress"
        role="cell"
      >
        {file.state === 'InProgress' ? (
          <div className="mini-progress">
            <div className="mini-progress-track">
              <div
                className="mini-progress-fill"
                style={{ background: 'var(--accent)', width: `${percent}%` }}
              />
            </div>
            <span className="mini-progress-pct">{percent}%</span>
          </div>
        ) : (
          '—'
        )}
      </div>
      <div
        className="ul-complete-size"
        data-label="Size"
        role="cell"
      >
        {file.state === 'InProgress'
          ? `${formatBytes(file.bytesTransferred)} / `
          : ''}
        {formatBytes(file.size)}
      </div>
      <div
        className="ul-complete-speed"
        data-label="Speed"
        role="cell"
      >
        {file.averageSpeed > 0 && sending
          ? formatBitrate(file.averageSpeed)
          : '—'}
      </div>
      <div
        className="ul-complete-actions"
        role="cell"
      >
        {isStateCancellable(file.state) && (
          <button
            aria-label={`Cancel ${getFileName(file.filename)}`}
            className="dl-action-btn dl-action-btn--cancel"
            onClick={() => onCancel({ file })}
            title="Cancel upload"
            type="button"
          >
            <X size={13} />
          </button>
        )}
      </div>
    </>
  );
};

const useWaitingPresence = (waitingUsers) => {
  const [statuses, setStatuses] = useState({});
  const usernamesKey = JSON.stringify(
    waitingUsers.map((recipient) => recipient.username).sort(),
  );

  useEffect(() => {
    const usernames = JSON.parse(usernamesKey);
    if (usernames.length === 0) return undefined;
    const controller = new AbortController();
    let timer;
    const refresh = async () => {
      if (!document.hidden) {
        try {
          const next = await getStatuses({
            signal: controller.signal,
            usernames,
          });
          if (!controller.signal.aborted) setStatuses(next);
        } catch {
          if (!controller.signal.aborted) setStatuses({});
        }
      }

      if (!controller.signal.aborted) timer = setTimeout(refresh, 30_000);
    };

    refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [usernamesKey]);

  return statuses;
};

const useFolderTracks = (username, expanded, folders) => {
  const openFolders = JSON.stringify(
    (folders ?? []).filter(({ directory }) => expanded.folders.has(directory)),
  );
  const [details, setDetails] = useState(null);

  useEffect(() => {
    const open = JSON.parse(openFolders);
    if (expanded.username !== username || open.length === 0) return undefined;

    const controller = new AbortController();
    let timer;
    const refresh = async () => {
      let failed = false;
      for (const { directory } of open) {
        if (controller.signal.aborted || document.hidden) break;
        let result;
        try {
          const files = await getUploadFolder({
            directory,
            signal: controller.signal,
            username,
          });
          result = { files: files.filter(isPending).sort(byStateThenTime) };
        } catch {
          failed = true;
          result = { failed: true };
        }

        if (controller.signal.aborted) return;
        setDetails((previous) => {
          const loaded = new Map(
            previous?.username === username ? previous.folders : [],
          );
          const files = result.files ?? loaded.get(directory)?.files;
          loaded.set(directory, { ...result, files });
          return { folders: loaded, username };
        });
      }

      if (!controller.signal.aborted)
        timer = setTimeout(refresh, failed ? 2_000 : 30_000);
    };

    refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [expanded.username, openFolders, username]);

  return details?.username === username ? details?.folders : null;
};

const UploadsTable = ({
  folders,
  onCancel,
  onCancelDirectory,
  onCancelUser,
  onSelectUploadUser,
  queueLoading = false,
  queueUsers = [],
  selectedUsername,
  transfers,
}) => {
  const selected = queueUsers.find(
    (recipient) => recipient.username === selectedUsername,
  );
  const downloadingUsers = [];
  const connectingUsers = [];
  const waitingUsers = [];
  for (const recipient of queueUsers) {
    const sending = recipient.sendingCount ?? recipient.activeCount;
    const group =
      sending > 0
        ? downloadingUsers
        : recipient.activeCount > 0
          ? connectingUsers
          : waitingUsers;
    group.push(recipient);
  }

  const waitingPresence = useWaitingPresence(waitingUsers);
  const userGroups = [
    {
      label: 'Downloading',
      empty: 'No users downloading.',
      users: downloadingUsers,
    },
    {
      label: 'Connecting',
      empty: 'No users connecting.',
      users: connectingUsers,
    },
    { label: 'Waiting', empty: 'No users waiting.', users: waitingUsers },
  ];
  const selectedGroup = userGroups.find((group) =>
    group.users.some((recipient) => recipient.username === selectedUsername),
  )?.label;
  const [recipientStatus, setRecipientStatus] = useState(() => {
    try {
      const saved = prefs.get(recipientStatusPreference);
      if (userGroups.some((group) => group.label === saved)) return saved;
    } catch {
      // Browser storage may be unavailable; the dropdown must still work.
    }

    return selectedGroup ?? 'Waiting';
  });
  const visibleGroup = userGroups.find(
    (group) => group.label === recipientStatus,
  );
  const transferDetails = useMemo(
    () => ({
      username: selectedUsername,
      directories: (transfers ?? [])
        .filter((recipient) => recipient.username === selectedUsername)
        .flatMap((recipient) => recipient.directories ?? [])
        .map((directory) => ({
          ...directory,
          files: (directory.files ?? [])
            .filter(isPending)
            .sort(byStateThenTime),
        }))
        .filter((directory) => directory.files.length > 0),
    }),
    [selectedUsername, transfers],
  );
  const activeFiles = useMemo(
    () =>
      transferDetails.directories.flatMap((directory) =>
        directory.files
          .filter(isSending)
          .map((file) => ({ file, sourceFolder: directory.directory })),
      ),
    [transferDetails],
  );
  const [expanded, setExpanded] = useState({
    username: null,
    folders: new Set(),
  });
  const toggleFolder = (directory) => {
    setExpanded((previous) => {
      const open = new Set(
        previous.username === selectedUsername ? previous.folders : [],
      );
      if (open.has(directory)) open.delete(directory);
      else open.add(directory);
      return { username: selectedUsername, folders: open };
    });
  };

  const folderTracks = useFolderTracks(selectedUsername, expanded, folders);
  const directories = useMemo(
    () =>
      folders ??
      transferDetails.directories.map((directory) => ({
        ...directory,
        activeCount: directory.files.filter(isSending).length,
        fileCount: directory.files.length,
      })),
    [folders, transferDetails],
  );
  const activeById = useMemo(
    () => new Map(activeFiles.map(({ file }) => [file.id, file])),
    [activeFiles],
  );
  const rows = useMemo(
    () =>
      directories.flatMap((directory) => [
        { key: `folder-${directory.directory}`, type: 'folder', directory },
        ...(expanded.username === selectedUsername &&
        expanded.folders.has(directory.directory)
          ? (folders
              ? folderTracks?.get(directory.directory)?.files
              : directory.files) ?? []
          : []
        ).map((file) => ({
          key: file.id,
          type: 'file',
          file: activeById.get(file.id) ?? file,
        })),
      ]),
    [
      activeById,
      directories,
      expanded,
      folderTracks,
      folders,
      selectedUsername,
    ],
  );
  const fileCount = directories.reduce(
    (sum, directory) => sum + directory.fileCount,
    0,
  );
  const scrollRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getItemKey: (index) => rows[index].key,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index].type === 'folder' ? 42 : 56),
    overscan: 8,
  });
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setExpanded({ username: selectedUsername, folders: new Set() });
  }, [selectedUsername]);
  return (
    <div
      className="ul-complete"
      data-total-tracks={fileCount}
    >
      <div className="ul-live-workspace">
        <aside
          aria-label="Users requesting uploads"
          className="ul-live-users"
        >
          <RecipientStatusDropdown
            groups={userGroups}
            label="Upload recipient status"
            onChange={(status) => {
              setRecipientStatus(status);
              prefs.set(recipientStatusPreference, status);
            }}
            value={recipientStatus}
          />
          <div className="ul-live-user-list">
            {[visibleGroup].map(({ empty, label, users }) => (
              <section
                aria-label={label}
                className="ul-live-user-group"
                key={label}
              >
                {users.length === 0 && <p>{empty}</p>}
                {users.map((recipient) => {
                  const { activeCount, sendingCount, waitingCount } = recipient;
                  const connectingCount = activeCount - (sendingCount ?? 0);
                  const summary = [
                    sendingCount > 0 && `${sendingCount} downloading`,
                    connectingCount > 0 &&
                      `${connectingCount} ${sendingCount == null ? 'sending/connecting' : 'connecting'}`,
                    waitingCount > 0 &&
                      `${waitingCount.toLocaleString()} waiting`,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  const presence =
                    waitingPresence?.[recipient.username]?.presence;
                  const status = ['Online', 'Offline', 'Away'].includes(
                    presence,
                  )
                    ? presence
                    : 'Status unknown';

                  return (
                    <button
                      aria-pressed={recipient.username === selectedUsername}
                      className="ul-live-user"
                      key={recipient.username}
                      onClick={() => onSelectUploadUser(recipient.username)}
                      type="button"
                    >
                      <strong>{recipient.username}</strong>
                      <span>
                        {summary}
                        {label === 'Waiting' && ` · ${status}`}
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        </aside>
        <div
          aria-busy={queueLoading}
          className="ul-live-track-pane"
        >
          <header className="ul-complete-header">
            {selectedUsername && (
              <div className="ul-recipient-controls">
                <UsernameLink username={selectedUsername} />
              </div>
            )}
            {selectedUsername && (
              <span className="ul-complete-count">
                <strong>
                  {(selected?.waitingCount ?? fileCount).toLocaleString()}{' '}
                  waiting
                </strong>
                {selected?.activeCount > 0
                  ? ` · ${selected.activeCount} sending/connecting`
                  : ''}
              </span>
            )}
            {selected?.retryAt &&
              Number.isFinite(Date.parse(selected.retryAt)) && (
                <span className="ul-complete-count">
                  Paused after repeated transfer failures. Retry from{' '}
                  <time dateTime={selected.retryAt}>
                    {new Date(selected.retryAt).toLocaleString()}
                  </time>
                </span>
              )}
            {fileCount > 0 && (
              <button
                className="ul-quick-btn ul-quick-btn--cancel"
                onClick={() =>
                  onCancelUser({ fileCount, username: selectedUsername })
                }
                type="button"
              >
                Cancel all uploads
              </button>
            )}
          </header>
          {!queueLoading && selectedUsername && (
            <section
              aria-label="Uploading now"
              className="ul-current-uploads"
            >
              <h2>
                Uploading now
                {activeFiles.length > 0 ? ` · ${activeFiles.length}` : ''}
              </h2>
              {activeFiles.length === 0 ? (
                <p>Nothing uploading to this user right now.</p>
              ) : (
                <div
                  aria-colcount={6}
                  aria-label="Current uploads"
                  className="ul-current-list"
                  role="table"
                >
                  {activeFiles.map(({ file, sourceFolder }) => (
                    <div
                      className="ul-complete-file ul-current-file"
                      data-current-upload-id={file.id}
                      key={file.id}
                      role="row"
                    >
                      <FileCells
                        file={file}
                        onCancel={onCancel}
                        sourceFolder={sourceFolder}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {queueLoading ? (
            <p
              className="ul-complete-empty"
              role="status"
            >
              Loading complete upload queue…
            </p>
          ) : fileCount === 0 ? (
            <p className="ul-complete-empty">
              {selectedUsername
                ? 'No unfinished uploads for this user.'
                : 'No queued uploads.'}
            </p>
          ) : (
            <div
              aria-colcount={6}
              aria-label="Complete upload queue"
              aria-rowcount={rows.length + 1}
              className="ul-complete-table"
              role="table"
            >
              <div
                className="ul-complete-columns"
                role="row"
              >
                <div role="columnheader">Track</div>
                <div role="columnheader">Status</div>
                <div role="columnheader">Progress</div>
                <div role="columnheader">Size</div>
                <div role="columnheader">Speed</div>
                <div
                  aria-label="Actions"
                  role="columnheader"
                />
              </div>
              <div
                aria-label="All requested tracks"
                className="ul-complete-scroll"
                ref={scrollRef}
                role="rowgroup"
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
                        aria-rowindex={item.index + 2}
                        className={`ul-flat-row ${row.type === 'folder' ? 'ul-complete-folder' : `ul-complete-file ${isSending(row.file) ? '' : 'ul-complete-file--waiting'}`}`}
                        data-file-id={
                          row.type === 'file' ? row.file.id : undefined
                        }
                        data-index={item.index}
                        key={item.key}
                        ref={virtualizer.measureElement}
                        role="row"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${item.start}px)`,
                        }}
                      >
                        {row.type === 'folder' ? (
                          <div
                            aria-colspan={6}
                            className="ul-folder-content"
                            role="cell"
                          >
                            <button
                              aria-expanded={
                                expanded.username === selectedUsername &&
                                expanded.folders.has(row.directory.directory)
                              }
                              className="ul-folder-toggle"
                              onClick={() =>
                                toggleFolder(row.directory.directory)
                              }
                              title={row.directory.directory}
                              type="button"
                            >
                              {expanded.username === selectedUsername &&
                              expanded.folders.has(row.directory.directory) ? (
                                <ChevronDown size={15} />
                              ) : (
                                <ChevronRight size={15} />
                              )}
                              <Folder size={15} />
                              <strong>
                                {row.directory.directory
                                  .split(/[/\\]/u)
                                  .filter(Boolean)
                                  .at(-1) ?? row.directory.directory}
                              </strong>
                              <span>
                                {row.directory.fileCount.toLocaleString()}{' '}
                                tracks
                              </span>
                              {folders &&
                                expanded.username === selectedUsername &&
                                expanded.folders.has(
                                  row.directory.directory,
                                ) && (
                                  <span role="status">
                                    {folderTracks?.get(row.directory.directory)
                                      ?.failed
                                      ? 'Unable to load tracks. Retrying…'
                                      : !folderTracks?.get(
                                            row.directory.directory,
                                          )?.files
                                        ? 'Loading tracks…'
                                        : null}
                                  </span>
                                )}
                              {row.directory.activeCount > 0 && (
                                <span>
                                  {row.directory.activeCount} sending/connecting
                                </span>
                              )}
                            </button>
                            {(folders || row.directory.directory.trim()) && (
                              <button
                                className="ul-folder-block"
                                onClick={() =>
                                  onCancelDirectory({
                                    directory: row.directory.directory,
                                    fileCount: row.directory.fileCount,
                                    username: selectedUsername,
                                  })
                                }
                                title="Cancel all requests for this folder and permanently block it for this person"
                                type="button"
                              >
                                Block folder
                              </button>
                            )}
                          </div>
                        ) : (
                          <FileCells
                            file={row.file}
                            onCancel={onCancel}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UploadsTable;
