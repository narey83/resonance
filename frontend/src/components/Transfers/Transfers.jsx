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
    toast.error(error?.response?.data ?? error?.message ?? error);
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
      toast.error(error?.response?.data ?? error?.message ?? error);
    }
  }
};

const cancelDirectory = async ({ directory, files, username }) => {
  const activeCount = files.filter(
    (f) => !f.state?.startsWith('Completed'),
  ).length;
  const message =
    activeCount > 0
      ? `Cancel ${activeCount} queued/active download${activeCount === 1 ? '' : 's'} and delete this folder? This cannot be undone.`
      : 'Delete this folder and all its files? This cannot be undone.';
  if (!window.confirm(message)) return;

  await Promise.all(
    files.map((f) =>
      transfersLibrary
        .cancel({ direction: 'download', id: f.id, remove: true, username })
        .catch(() => {}),
    ),
  );

  const localDir = directory.split(/[/\\]/).filter(Boolean).at(-1);
  if (localDir) {
    await Promise.all([
      filesLibrary
        .deleteDirectory({ root: 'downloads', path: localDir })
        .catch(() => {}),
      filesLibrary
        .deleteDirectory({ root: 'incomplete', path: localDir })
        .catch(() => {}),
    ]);
  }
};

const Transfers = ({ direction }) => {
  const cancel = async ({ file }) => {
    const { id, username } = file;
    try {
      await transfersLibrary.cancel({ direction, id, username });
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data ?? error?.message ?? error);
    }
  };

  const remove = async ({ file }) => {
    const { id, username } = file;
    try {
      await transfersLibrary.cancel({ direction, id, remove: true, username });
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data ?? error?.message ?? error);
    }
  };

  const clearCompleted = async () => {
    try {
      await transfersLibrary.clearCompleted({ direction });
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data ?? error?.message ?? error);
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
          toast.error(error?.response?.data ?? error?.message ?? error);
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
      toast.error(error?.response?.data ?? error?.message ?? error);
    }
  };

  if (connecting) {
    return <LoaderSegment />;
  }

  if (direction === 'upload') {
    return (
      <UploadsTable
        onCancel={cancel}
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
