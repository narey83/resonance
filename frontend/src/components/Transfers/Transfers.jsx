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
import * as filesLibrary from '../../lib/files';
import * as transfersLibrary from '../../lib/transfers';
import { LoaderSegment } from '../Shared';
import DownloadsTable from './DownloadsTable';
import FindAlternateModal from './FindAlternateModal';
import UploadsTable from './UploadsTable';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';

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

const cancelUploadDirectory = async ({ directory, files, username }) => {
  const count = files.filter(isActive).length;
  if (count === 0) return;
  if (
    !window.confirm(
      `Cancel ${count} queued/active upload${count === 1 ? '' : 's'} of this folder to ${username}? They can request it again later.`,
    )
  )
    return;

  await transfersLibrary
    .cancelAll({ direction: 'upload', directory, username })
    .catch(() => {});
};

const cancelUserUploads = async ({ directories, username }) => {
  const count = directories.reduce(
    (n, d) => n + d.files.filter(isActive).length,
    0,
  );
  if (count === 0) return;
  if (
    !window.confirm(
      `Cancel all ${count} queued/active upload${count === 1 ? '' : 's'} to ${username}? They can request them again later.`,
    )
  )
    return;

  await transfersLibrary
    .cancelAll({ direction: 'upload', username })
    .catch(() => {});
};

const Transfers = ({ direction }) => {
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
  const [findAlternate, setFindAlternate] = useState(null);
  const replacementsRef = useRef([]);

  useEffect(() => {
    let mounted = true;
    let timeoutId;
    setConnecting(true);

    const poll = async () => {
      try {
        const response = await transfersLibrary.getAll({ direction });
        if (mounted) {
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
        if (mounted) {
          console.error(error);
        }
      }

      if (mounted) timeoutId = setTimeout(poll, 2_000);
    };

    poll().then(() => {
      if (mounted) setConnecting(false);
    });

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [direction]); // eslint-disable-line react-hooks/exhaustive-deps

  useMemo(() => {
    setConnecting(true);
  }, [direction]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (connecting) {
    return <LoaderSegment />;
  }

  if (direction === 'upload') {
    return (
      <UploadsTable
        onCancel={cancel}
        onCancelDirectory={cancelUploadDirectory}
        onCancelUser={cancelUserUploads}
        onClearCompleted={clearCompleted}
        onRemove={remove}
        transfers={transfers}
      />
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
