import './TagSanitization.css';
import * as api from '../../lib/tagSanitization';
import PageInfo from '../Shared/PageInfo';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

const POLL_INTERVAL = 1_500;

const defaultState = {
  scanning: false,
  completed: false,
  cancelled: false,
  total: 0,
  processed: 0,
  sanitized: 0,
  skipped: 0,
  failed: 0,
  progress: 0,
  results: [],
};

const handleCancel = async () => {
  try {
    await api.cancelScan();
  } catch {
    // ignore — polling will pick up the cancelled state
  }
};

const TagSanitization = () => {
  const [scanState, setScanState] = useState(defaultState);
  const [workers, setWorkers] = useState(2);
  const [dryRun, setDryRun] = useState(false);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(null);

  const fetchState = useCallback(async () => {
    try {
      const s = await api.getScanState();
      setScanState(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const s = await fetchState();
      if (s && !s.scanning) stopPolling();
    }, POLL_INTERVAL);
  };

  // Initial load
  useEffect(() => {
    void (async () => {
      const s = await fetchState();
      setLoading(false);
      if (s?.scanning) startPolling();
    })();

    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = async () => {
    try {
      await api.startScan({ workers, dryRun });
      setScanState((previous) => ({
        ...previous,
        scanning: true,
        completed: false,
        cancelled: false,
      }));
      startPolling();
    } catch (error) {
      toast.error(error?.response?.data ?? 'Failed to start scan');
    }
  };

  const {
    cancelled,
    completed,
    failed,
    processed,
    progress,
    results,
    sanitized,
    scanning,
    skipped,
    total,
  } = scanState;
  const pct = total > 0 ? Math.round(progress * 100) : 0;

  const statusText = () => {
    if (loading) return null;
    if (scanning) return `Scanning… ${processed} / ${total}`;
    if (cancelled) return 'Scan cancelled';
    if (completed)
      return dryRun
        ? `Dry run complete — ${sanitized} file${sanitized === 1 ? '' : 's'} would be changed`
        : `Scan complete — ${sanitized} file${sanitized === 1 ? '' : 's'} sanitized`;
    return null;
  };

  return (
    <div className="ts-root">
      <PageInfo storageKey="tagsanitization">
        <p>
          Consolidates all ID3 tag versions on each MP3/WAV/AIFF file into a
          single clean <strong>ID3v2.3</strong> tag — the industry standard for
          maximum compatibility across DJ software, hardware, and media players.
        </p>
        <p>
          <strong>About ID3v1 vs ID3v2</strong>
        </p>
        <p>
          MP3 files can contain two completely separate tag systems.{' '}
          <strong>ID3v2</strong> (at the start of the file) is the modern format
          used by virtually all software — it holds your artist name, track
          title, album, artwork, key, and more. <strong>ID3v1</strong> is a tiny
          128-byte legacy block appended to the end of the file, originally from
          the 1990s. Most rippers and editors have written both for years,
          meaning the same artist/title data is duplicated in two places.
        </p>
        <p>
          When this scan removes the ID3v1 block,{' '}
          <strong>no metadata is lost</strong> — everything that was in it is
          already in ID3v2, which is what every modern application reads. It is
          purely removing the redundant copy.
        </p>
        <p>What else gets fixed:</p>
        <ul>
          <li>
            <strong>Version upgrade/downgrade</strong> — files tagged with the
            older ID3v2.2 format or the newer ID3v2.4 are rewritten as ID3v2.3.
          </li>
          <li>
            <strong>Missing field promotion</strong> — if ID3v2 is missing a
            field that ID3v1 has (rare, but possible on very old files), the
            value is copied across before v1 is removed.
          </li>
          <li>
            <strong>Key frame consolidation</strong> — key data written by some
            software into <code>TXXX:KEY</code> or comment frames is moved into
            the standard <code>TKEY</code> frame and normalised to musical
            notation.
          </li>
        </ul>
        <p>
          Enable <strong>Dry Run</strong> to see exactly what would change on
          each file before anything is written.
        </p>
      </PageInfo>

      {/* Stats bar */}
      <div className="ts-stats-bar">
        <div className="ts-stat">
          <span className="ts-stat-value">{total}</span>
          <span className="ts-stat-label">Total</span>
        </div>
        <div className="ts-stat ts-stat--sanitized">
          <span className="ts-stat-value">{sanitized}</span>
          <span className="ts-stat-label">
            {dryRun ? 'Would change' : 'Sanitized'}
          </span>
        </div>
        <div className="ts-stat ts-stat--skipped">
          <span className="ts-stat-value">{skipped}</span>
          <span className="ts-stat-label">Clean</span>
        </div>
        {failed > 0 && (
          <div className="ts-stat ts-stat--failed">
            <span className="ts-stat-value">{failed}</span>
            <span className="ts-stat-label">Failed</span>
          </div>
        )}
        <div className="ts-spacer" />
        {statusText() && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {statusText()}
          </span>
        )}
      </div>

      {/* Settings */}
      <div className="ts-settings">
        <div className="ts-settings-group">
          <span className="ts-settings-label">Workers</span>
          <input
            disabled={scanning}
            max={8}
            min={1}
            onChange={({ target }) => setWorkers(Number(target.value))}
            type="range"
            value={workers}
          />
          <span className="ts-settings-val">{workers}</span>
        </div>

        <div className="ts-settings-group">
          <span className="ts-settings-label">Dry run</span>
          <label className="ts-toggle">
            <input
              checked={dryRun}
              disabled={scanning}
              onChange={({ target }) => setDryRun(target.checked)}
              type="checkbox"
            />
            <span className="ts-toggle-track" />
            <span className="ts-toggle-thumb" />
          </label>
        </div>

        {dryRun && (
          <span className="ts-dry-run-badge">
            analyse only — no files will be written
          </span>
        )}
      </div>

      {/* Progress bar (only when scanning) */}
      {scanning && (
        <div className="ts-progress">
          <div className="ts-progress-bar">
            <div
              className="ts-progress-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="ts-progress-pct">{pct}%</span>
        </div>
      )}

      {/* Action bar */}
      <div className="ts-action-bar">
        {scanning ? (
          <button
            className="ts-btn ts-btn--cancel"
            onClick={handleCancel}
            type="button"
          >
            Cancel Scan
          </button>
        ) : (
          <button
            className="ts-btn ts-btn--primary"
            disabled={loading}
            onClick={handleStart}
            type="button"
          >
            {dryRun ? 'Analyse Library' : 'Sanitize Tags'}
          </button>
        )}
      </div>

      {/* Results list */}
      <div className="ts-results">
        {results.length === 0 ? (
          <div className="ts-empty">
            {completed || cancelled
              ? `${sanitized === 0 ? 'No files needed changes.' : ''}`
              : 'Run a scan to see results.'}
          </div>
        ) : (
          results.map((r) => (
            <div
              className="ts-result-row"
              key={r.maskedFilename}
            >
              <div className="ts-result-filename">
                {r.directory && (
                  <span className="ts-result-folder">{r.directory}</span>
                )}
                {r.filename}
              </div>
              <div className="ts-result-changes">
                {r.changes.map((c, index) => (
                  <span
                    className={`ts-change-chip${c.startsWith('Error:') ? ' ts-change-chip--error' : ''}`}
                    // eslint-disable-next-line react/no-array-index-key
                    key={index}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default TagSanitization;
