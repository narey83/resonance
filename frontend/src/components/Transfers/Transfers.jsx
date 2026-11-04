// <copyright file="Transfers.jsx" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import './Transfers.css';
import { toast } from '../../lib/activityNotices';
import { getCompleteUploadsQueue } from '../../lib/completeUploadQueue';
import * as filesLibrary from '../../lib/files';
import * as transfersLibrary from '../../lib/transfers';
import AppContext from '../AppContext';
import DownloadsTable from './DownloadsTable';
import FindAlternateModal from './FindAlternateModal';
import UploadsTable from './UploadsTable';
import { Loader2 } from 'lucide-react';
import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

const findTransferByFilename = (transfers, username, filename) => {
  const user = transfers.find((u) => u.username === username);
  if (!user) return null;
  for (const dir of user.directories ?? []) {
    const file = (dir.files ?? []).find((f) => f.filename === filename);
    if (file) return file;
  }

  return null;
};

const retry = async ({ file }) => {
  const { filename, size, username } = file;
  try {
    await transfersLibrary.download({
      files: [{ filename, size }],
      username,
    });
  } catch (error) {
    console.error(error);
  }
};

const retryBatch = async (files) => {
  const byUsername = new Map();
  for (const f of files) {
    if (!byUsername.has(f.username)) byUsername.set(f.username, []);
    byUsername.get(f.username).push({ filename: f.filename, size: f.size });
  }

  for (const [username, batch] of byUsername) {
    try {
      await transfersLibrary.download({ files: batch, username });
    } catch (error) {
      console.error(error);
    }
  }
};

const deleteLocalFolder = async (directory) => {
  const localDir = directory.split(/[/\\]/).filter(Boolean).at(-1);
  if (!localDir) return;
  await Promise.all([
    filesLibrary
      .deleteDirectory({ root: 'downloads', path: localDir })
      .catch(() => {}),
    filesLibrary
      .deleteDirectory({ root: 'incomplete', path: localDir })
      .catch(() => {}),
  ]);
};

const isActive = (f) => !f.state?.startsWith('Completed');

const cancelDirectory = async ({ directory, files, username }) => {
  const activeCount = files.filter(isActive).length;
  const message =
    activeCount > 0
      ? `Cancel ${activeCount} queued/active download${activeCount === 1 ? '' : 's'} and delete this folder? This cannot be undone.`
      : 'Delete this folder and all its files? This cannot be undone.';
  if (!window.confirm(message)) return;

  await transfersLibrary
    .cancelAll({ direction: 'download', directory, remove: true, username })
    .catch(() => {});

  // completed files were left alone by the cancel above; drop their records too
  await Promise.all(
    files
      .filter((f) => !isActive(f))
      .map((f) =>
        transfersLibrary
          .cancel({ direction: 'download', id: f.id, remove: true, username })
          .catch(() => {}),
      ),
  );

  await deleteLocalFolder(directory);
};

// Kill switch: everything in flight from/to one user, in one request.
const cancelUserDownloads = async ({ directories, username }) => {
  const active = directories.filter((d) => d.files.some(isActive));
  const count = active.reduce((n, d) => n + d.files.filter(isActive).length, 0);
  if (count === 0) return;
  if (
    !window.confirm(
      `Cancel all ${count} queued/active download${count === 1 ? '' : 's'} from ${username} and delete ${active.length} unfinished folder${active.length === 1 ? '' : 's'}? This cannot be undone.`,
    )
  )
    return;

  await transfersLibrary
    .cancelAll({ direction: 'download', remove: true, username })
    .catch(() => {});
  await Promise.all(active.map((d) => deleteLocalFolder(d.directory)));
};

const cancelUploadDirectory = async ({ directory, fileCount, username }) => {
  if (fileCount === 0) return;
  if (
    !window.confirm(
      `Cancel all queued/active uploads of this folder to ${username}? This folder will be permanently denied to them — they won't be able to request it again.`,
    )
  )
    return;

  await transfersLibrary
    .cancelAll({ deny: true, direction: 'upload', directory, username })
    .catch(() => {});
};

const cancelUserUploads = async ({ fileCount, username }) => {
  if (fileCount === 0) return;
  if (
    !window.confirm(
      `Cancel all queued/active uploads to ${username}? They can request them again later.`,
    )
  )
    return;

  await transfersLibrary
    .cancelAll({ direction: 'upload', username })
    .catch(() => {});
};

const Transfers = ({ direction }) => {
  const { setUploadQueueCount } = useContext(AppContext) ?? {};
  useEffect(() => {
    if (direction !== 'upload') return undefined;
    return () => setUploadQueueCount?.(null);
  }, [direction, setUploadQueueCount]);
  const cancel = async ({ file }) => {
    const { id, username } = file;
    try {
      await transfersLibrary.cancel({ direction, id, username });
    } catch (error) {
      console.error(error);
    }
  };

  const remove = async ({ file }) => {
    const { id, username } = file;
    try {
      await transfersLibrary.cancel({ direction, id, remove: true, username });
    } catch (error) {
      console.error(error);
    }
  };

  const clearCompleted = async () => {
    try {
      await transfersLibrary.clearCompleted({ direction });
    } catch (error) {
      console.error(error);
    }
  };

  const [connecting, setConnecting] = useState(true);
  const [transfers, setTransfers] = useState([]);
  const [uploadFolders, setUploadFolders] = useState(null);
  const [queueUsers, setQueueUsers] = useState([]);
  const [requestedUploadUser, setRequestedUploadUser] = useState(null);
  const [selectedUploadUser, setSelectedUploadUser] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [findAlternate, setFindAlternate] = useState(null);
  const replacementsRef = useRef([]);
  const uploadQueueRef = useRef(null);
  const rememberUploadQueue = useCallback((snapshot) => {
    uploadQueueRef.current = snapshot;
  }, []);

  useEffect(() => {
    let mounted = true;
    let hasCompleteUpload = false;
    const scheduled = new Set();
    const inFlight = new Set();
    let controller;
    setConnecting(true);
    setTransfers([]);
    setUploadFolders(null);
    setLoadError(false);

    const poll = async () => {
      if (!mounted || inFlight.size > 0) return;
      for (const timer of scheduled) clearTimeout(timer);
      scheduled.clear();
      if (document.visibilityState === 'hidden') {
        scheduled.add(setTimeout(poll, 2_000));
        return;
      }

      controller = new AbortController();
      inFlight.add(controller);
      try {
        let response;
        if (direction === 'upload') {
          const updateSummary = ({ username, users }) => {
            setQueueUsers(users);
            setUploadQueueCount?.(
              users.reduce((sum, user) => sum + user.waitingCount, 0),
            );
            setSelectedUploadUser(username);
          };

          const previous = uploadQueueRef.current;
          const recipient = requestedUploadUser ?? previous?.username;
          let result;
          if (!previous || Array.isArray(previous.folders)) {
            result = await transfersLibrary.getUploadsQueue({
              folders: true,
              pageSize: 1,
              signal: controller.signal,
              username: recipient,
            });
          }

          // The web and backend can be updated independently.
          if (mounted && !Array.isArray(result?.folders)) {
            result = await getCompleteUploadsQueue({
              onSummary: (summary) => {
                if (mounted && !hasCompleteUpload) updateSummary(summary);
              },
              previous,
              signal: controller.signal,
              username: recipient,
            });
          }

          response = result?.transfers;
          if (mounted) {
            rememberUploadQueue(result);
            setUploadFolders(result.folders ?? null);
            hasCompleteUpload = true;
            updateSummary(result);
          }
        } else {
          response = await transfersLibrary.getAll({
            direction,
            signal: controller.signal,
          });
        }

        if (mounted) {
          setLoadError(false);
          setTransfers(response);

          const pending = replacementsRef.current;
          if (pending.length > 0 && response) {
            const stillPending = [];
            for (const replacement of pending) {
              const allSucceeded = replacement.newFilenames.every(
                (filename) => {
                  const t = findTransferByFilename(
                    response,
                    replacement.newUsername,
                    filename,
                  );
                  return t?.state === 'Completed, Succeeded';
                },
              );

              if (allSucceeded) {
                for (const original of replacement.originalFiles) {
                  transfersLibrary
                    .cancel({
                      direction: 'download',
                      id: original.id,
                      remove: true,
                      username: original.username,
                    })
                    .catch(() => {});
                }

                toast.success(
                  `Cleaned up ${replacement.newFilenames.length} failed download${replacement.newFilenames.length === 1 ? '' : 's'} — replaced by ${replacement.newUsername}`,
                );
              } else {
                stillPending.push(replacement);
              }
            }

            replacementsRef.current = stillPending;
          }
        }
      } catch (error) {
        if (mounted && !controller.signal.aborted) {
          setLoadError(true);
          console.error(error);
        }
      } finally {
        inFlight.delete(controller);
        if (mounted && (direction !== 'upload' || hasCompleteUpload))
          setConnecting(false);
      }

      if (mounted) scheduled.add(setTimeout(poll, 2_000));
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void poll();
    };

    document.addEventListener('visibilitychange', onVisibility);
    void poll();
    return () => {
      mounted = false;
      controller?.abort();
      for (const timer of scheduled) clearTimeout(timer);
      scheduled.clear();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [direction, requestedUploadUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFindAlternate = ({ directory, files, folderName, username }) => {
    setFindAlternate({ directory, files, folderName, username });
  };

  const handleAlternateDownload = async ({ files, username }) => {
    const originalFiles = findAlternate.files.map((f) => ({
      id: f.id,
      username: f.username,
    }));
    setFindAlternate(null);
    try {
      await transfersLibrary.download({
        files: files.map((f) => ({ filename: f.filename, size: f.size })),
        username,
      });
      replacementsRef.current = [
        ...replacementsRef.current,
        {
          newFilenames: files.map((f) => f.filename),
          newUsername: username,
          originalFiles,
        },
      ];
      toast.success(
        `Queued ${files.length} file${files.length === 1 ? '' : 's'} from ${username} — will remove failed downloads on completion`,
      );
    } catch (error) {
      console.error(error);
    }
  };

  if (
    connecting &&
    (direction !== 'upload' || (queueUsers.length === 0 && !loadError))
  ) {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className="transfers-loading"
        role="status"
      >
        <Loader2
          aria-hidden="true"
          className="transfers-loading__spinner"
          size={40}
        />
        <span>
          {direction === 'upload' ? 'Loading uploads…' : 'Loading downloads…'}
        </span>
      </div>
    );
  }

  if (direction === 'upload') {
    return (
      <>
        {loadError && (
          <div role="status">
            {connecting
              ? 'Unable to load the complete upload queue. Retrying automatically.'
              : 'Unable to refresh uploads. Retrying automatically.'}
          </div>
        )}
        {(!loadError || queueUsers.length > 0) && (
          <UploadsTable
            folders={uploadFolders}
            onCancel={cancel}
            onCancelDirectory={cancelUploadDirectory}
            onCancelUser={cancelUserUploads}
            onRemove={remove}
            onSelectUploadUser={(username) => {
              setRequestedUploadUser(username);
            }}
            queueLoading={connecting}
            queueUsers={queueUsers}
            selectedUsername={selectedUploadUser}
            transfers={transfers}
          />
        )}
      </>
    );
  }

  return (
    <>
      {findAlternate && (
        <FindAlternateModal
          folderName={findAlternate.folderName}
          onClose={() => setFindAlternate(null)}
          onDownload={handleAlternateDownload}
          originalFiles={findAlternate.files}
          originalUsername={findAlternate.username}
        />
      )}
      <DownloadsTable
        onCancel={cancel}
        onCancelDirectory={cancelDirectory}
        onCancelUser={cancelUserDownloads}
        onClearCompleted={clearCompleted}
        onFindAlternate={handleFindAlternate}
        onRemove={remove}
        onRetry={retry}
        onRetryBatch={retryBatch}
        transfers={transfers}
      />
    </>
  );
};

export default Transfers;
