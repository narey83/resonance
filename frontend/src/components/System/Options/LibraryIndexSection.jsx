// Copyright (c) 2026 John Narey. SPDX-License-Identifier: AGPL-3.0-only

import {
  createIndexSnapshot,
  deleteAndRebuildIndex,
  getIndexSnapshots,
  getLibraryStats,
  getSyncState,
  restoreIndexSnapshot,
} from '../../../lib/musicLibrary';
import React, { useEffect, useState } from 'react';

const CONFIRMATION = 'DELETE LIBRARY INDEX';
const messageOf = (error) =>
  error.response?.data?.error ?? error.message ?? 'The request failed.';

const LibraryIndexSection = () => {
  const [snapshots, setSnapshots] = useState([]);
  const [stats, setStats] = useState(null);
  const [sync, setSync] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async () => {
    const [stored, library, state] = await Promise.all([
      getIndexSnapshots(),
      getLibraryStats(),
      getSyncState(),
    ]);
    setSnapshots(stored);
    setStats(library);
    setSync(state);
  };

  useEffect(() => {
    refresh().catch((error_) => setError(messageOf(error_)));
    const timer = setInterval(() => {
      Promise.all([getLibraryStats(), getSyncState()])
        .then(([library, state]) => {
          setStats(library);
          setSync(state);
        })
        .catch(() => {});
    }, 5_000);
    return () => clearInterval(timer);
  }, []);

  const run = async (action, success) => {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      setNotice(success(result));
      await refresh();
    } catch (error_) {
      setError(messageOf(error_));
    } finally {
      setWorking(false);
    }
  };

  const restore = (snapshot) => {
    if (
      !window.confirm(
        `Restore the library index from ${new Date(snapshot.createdAtUtc).toLocaleString()}? This replaces the current index, including added dates.`,
      )
    )
      return;
    run(
      () => restoreIndexSnapshot(snapshot.id),
      ({ trackCount }) =>
        `Restored and verified ${trackCount.toLocaleString()} indexed tracks. A file sync has been requested.`,
    );
  };

  return (
    <div className="library-index-settings">
      <div className="info-section">
        <div className="info-section-title">Current index</div>
        <div className="library-index-body">
          <p>
            {stats
              ? `${stats.total.toLocaleString()} indexed tracks`
              : 'Loading index…'}
          </p>
          {sync?.running && (
            <p>Rebuilding from music files: {Math.round(sync.progress)}%</p>
          )}
          <p className="library-index-muted">
            The index contains track metadata and added dates. Track analysis
            and music files are stored separately.
          </p>
        </div>
      </div>

      <div className="info-section">
        <div className="info-section-title">Server snapshots</div>
        <div className="library-index-body">
          <p>
            Save a private index snapshot on this server. Restore checks its
            integrity before replacing the current index.
          </p>
          <button
            className="ui button primary"
            disabled={working || !stats?.total}
            onClick={() =>
              run(
                createIndexSnapshot,
                ({ trackCount }) =>
                  `Saved ${trackCount.toLocaleString()} indexed tracks.`,
              )
            }
            type="button"
          >
            Back up index now
          </button>
          {snapshots.length === 0 ? (
            <p className="library-index-muted">No index snapshots yet.</p>
          ) : (
            <div className="library-index-snapshots">
              {snapshots.map((snapshot) => (
                <div
                  className="library-index-snapshot"
                  key={snapshot.id}
                >
                  <span>
                    {new Date(snapshot.createdAtUtc).toLocaleString()} ·{' '}
                    {snapshot.trackCount.toLocaleString()} tracks
                  </span>
                  <button
                    className="ui button"
                    disabled={working || sync?.running}
                    onClick={() => restore(snapshot)}
                    type="button"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="info-section">
        <div className="info-section-title">Delete and rebuild</div>
        <div className="library-index-body">
          <p>
            Clears only indexed track metadata, verifies the index is empty,
            then immediately rebuilds it from the configured music files. Added
            dates will be reset unless you restore a snapshot.
          </p>
          <label htmlFor="library-index-confirmation">
            Type <strong>{CONFIRMATION}</strong> to confirm
          </label>
          <input
            autoComplete="off"
            className="library-index-confirmation"
            id="library-index-confirmation"
            onChange={(event) => setConfirmation(event.target.value)}
            value={confirmation}
          />
          <button
            className="ui button negative"
            disabled={working || sync?.running || confirmation !== CONFIRMATION}
            onClick={() =>
              run(
                () => deleteAndRebuildIndex(confirmation),
                ({ removed }) => {
                  setConfirmation('');
                  return `Verified empty after deleting ${removed.toLocaleString()} rows. Rebuild requested from music files.`;
                },
              )
            }
            type="button"
          >
            Delete index and rebuild
          </button>
        </div>
      </div>
      {error && (
        <div
          className="opt-error"
          role="alert"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          className="library-index-notice"
          role="status"
        >
          {notice}
        </div>
      )}
    </div>
  );
};

export default LibraryIndexSection;
