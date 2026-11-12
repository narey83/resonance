import api from '../../lib/api';
import { requireLocalBridge } from '../../lib/bridgePresence';
import React, { useEffect, useMemo, useState } from 'react';

const size = (bytes) => `${(bytes / 1_024 / 1_024).toFixed(1)} MiB`;

const UsbExportInspector = ({ latestJob, onSavedListChange }) => {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState('');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const selectedJob = history.find((job) => job.jobId === selected);
  const filteredTracks = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    return (report?.tracks || []).filter((track) =>
      [track.id, track.title, track.artist, track.album].some((value) =>
        String(value).toLocaleLowerCase().includes(query),
      ),
    );
  }, [filter, report]);
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .get('/analysis/usb-export/history')
      .then(({ data }) => {
        if (!cancelled) setHistory(data);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            'Could not load saved exports. Close and reopen this section to retry.',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, latestJob?.jobId, latestJob?.status, latestJob?.deferred]);
  useEffect(() => {
    if (!open || !selected) return undefined;
    let cancelled = false;
    setReport(null);
    setFilter('');
    setPage(0);
    setError('');
    setLoading(true);
    api
      .get(`/analysis/usb-export/${selected}/inspection`)
      .then(({ data }) => {
        if (!cancelled) setReport(data);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            'Could not read this export’s database inspection. Select another export or reopen this section to retry.',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selected]);
  const openSaved = async () => {
    setLoading(true);
    setError('');
    try {
      await requireLocalBridge();
      const { data } = await api.post(
        `/analysis/usb-export/${selected}/transfer`,
        null,
        { responseType: 'json' },
      );
      if (data?.schemaVersion !== 1 || !data.serverUrl || !data.token)
        throw new Error('Resonance Bridge handoff is incomplete.');
      const target = new URL('http://127.0.0.1:55460/usb');
      target.hash = new URLSearchParams({
        handoff: JSON.stringify(data),
      }).toString();
      window.location.assign(target.toString());
    } catch (error_) {
      setError(error_?.message || 'Could not open this export in Bridge.');
    } finally {
      setLoading(false);
    }
  };

  const deferSaved = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post(`/analysis/usb-export/${selected}/defer`);
      setHistory((current) =>
        current.map((job) => (job.jobId === selected ? data : job)),
      );
    } catch (error_) {
      setError(error_?.message || 'Could not save this export for later.');
    } finally {
      setLoading(false);
    }
  };

  const saveList = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await api.post(`/analysis/usb-export/${selected}/saved-list`);
      setNotice(
        'Track list saved. Choose Saved export list above to make another export.',
      );
      onSavedListChange?.();
    } catch (error_) {
      setError(error_?.message || 'Could not save this track list.');
    } finally {
      setLoading(false);
    }
  };

  const cancelSaved = async () => {
    setLoading(true);
    setError('');
    try {
      await api.delete(`/analysis/usb-export/${selected}`);
      setHistory((current) => current.filter((job) => job.jobId !== selected));
      setSelected('');
      setReport(null);
    } catch (error_) {
      setError(error_?.message || 'Could not cancel this export.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <details
      className="usb-export-inspector"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Saved exports and database inspection</summary>
      {open && (
        <div className="usb-export-inspector-body">
          <p>
            Examine the database readback saved when each export was prepared.
            These are server records; USB copies and hardware playback are
            verified separately.
          </p>
          <label>
            Saved export
            <select
              aria-label="Saved export"
              onChange={(event) => setSelected(event.target.value)}
              value={selected}
            >
              <option value="">Choose an export</option>
              {history.map((job) => (
                <option
                  disabled={!job.downloadAvailable}
                  key={job.jobId}
                  value={job.jobId}
                >
                  {job.playlistName} · {job.total} tracks ·{' '}
                  {job.deferred ? 'saved for later' : job.status} · {job.jobId}
                </option>
              ))}
            </select>
          </label>
          {selectedJob?.downloadAvailable && (
            <div className="usb-export-ready-actions">
              <button
                disabled={loading}
                onClick={openSaved}
                type="button"
              >
                Open in Resonance Bridge
              </button>
              <button
                disabled={loading}
                onClick={saveList}
                type="button"
              >
                Save track list for another export
              </button>
              {!selectedJob.deferred && (
                <button
                  disabled={loading}
                  onClick={deferSaved}
                  type="button"
                >
                  Save for later
                </button>
              )}
              <button
                disabled={loading}
                onClick={cancelSaved}
                type="button"
              >
                Cancel export
              </button>
            </div>
          )}
          {!loading && !history.length && !error && <p>No saved exports.</p>}
          {loading && <p role="status">Loading export records…</p>}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {report && (
            <>
              <h4>{report.playlistName}</h4>
              <p className="usb-export-id">
                Export ID: <code>{selected}</code>
              </p>
              <p>
                {report.tracks.length} tracks · {report.fileCount} files ·{' '}
                {size(report.totalBytes)} ·{' '}
                {report.profile === 'dual'
                  ? 'OPUS-QUAD + legacy'
                  : report.profile}
              </p>
              <p>{report.audioPolicy}</p>
              <p>
                Hardware playback:{' '}
                {report.hardwareVerified ? 'verified' : 'not yet verified'}.
              </p>
              {report.source && (
                <p>
                  Source: {report.source.kind} · {report.source.name} · ID:{' '}
                  {report.source.id} · Captured{' '}
                  {new Date(report.source.resolvedAt).toLocaleString()}
                </p>
              )}
              <h5>Database files</h5>
              <ul>
                {report.databases.map((file) => (
                  <li key={file.path}>
                    <strong>{file.path.split('/').at(-1)}</strong> ·{' '}
                    {size(file.bytes)} ·{' '}
                    {file.matchesManifest
                      ? 'Checksum matches export manifest'
                      : 'Checksum mismatch'}
                    <details>
                      <summary>SHA-256</summary>
                      <code>{file.sha256}</code>
                    </details>
                  </li>
                ))}
              </ul>
              {report.oneLibrary && (
                <p>
                  OneLibrary: {report.oneLibrary.tracks} tracks · Integrity:{' '}
                  {report.oneLibrary.integrity} · Tracks{' '}
                  {report.oneLibrary.tracksMatchLegacy
                    ? 'match'
                    : 'differ from'}{' '}
                  legacy database · Playlist order{' '}
                  {report.oneLibrary.playlistOrderMatchesLegacy
                    ? 'matches'
                    : 'differs'}
                  .
                </p>
              )}
              <h5>Playlists and track IDs</h5>
              <ul>
                {report.playlists.map((playlist) => (
                  <li key={playlist.id}>
                    {playlist.name} (ID {playlist.id}):{' '}
                    {playlist.trackIds.join(', ')}
                  </li>
                ))}
              </ul>
              <label>
                Filter exported tracks
                <input
                  aria-label="Filter exported tracks"
                  onChange={(event) => {
                    setFilter(event.target.value);
                    setPage(0);
                  }}
                  value={filter}
                />
              </label>
              <p>
                {filteredTracks.length} matching tracks · Page {page + 1} of{' '}
                {Math.max(1, Math.ceil(filteredTracks.length / 50))}
              </p>
              <p>
                <button
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                  type="button"
                >
                  Previous tracks
                </button>{' '}
                <button
                  disabled={(page + 1) * 50 >= filteredTracks.length}
                  onClick={() => setPage(page + 1)}
                  type="button"
                >
                  Next tracks
                </button>
              </p>
              <div
                aria-label="Exported database tracks"
                className="usb-export-database-scroll"
                role="region"
              >
                <table>
                  <caption>Tracks read from export.pdb</caption>
                  <thead>
                    <tr>
                      {[
                        'ID',
                        'Title',
                        'Artist',
                        'Album',
                        'BPM',
                        'Key',
                        'Seconds',
                        'Audio',
                        'Size',
                        'USB / analysis paths',
                      ].map((label) => (
                        <th
                          key={label}
                          scope="col"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTracks
                      .slice(page * 50, (page + 1) * 50)
                      .map((track) => (
                        <tr key={track.id}>
                          <td>{track.id}</td>
                          <td>{track.title}</td>
                          <td>{track.artist}</td>
                          <td>{track.album}</td>
                          <td>{track.bpm}</td>
                          <td>{track.key}</td>
                          <td>{track.durationSeconds}</td>
                          <td>
                            {track.bitDepth}-bit / {track.sampleRate} Hz
                          </td>
                          <td>{size(track.bytes)}</td>
                          <td>
                            <code>{track.path}</code>
                            <br />
                            <code>{track.analysisPath}</code>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </details>
  );
};

export default UsbExportInspector;
