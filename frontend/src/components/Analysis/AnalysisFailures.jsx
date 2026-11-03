import './AnalysisFailures.css';
import { failedTracksFromLogs } from '../../lib/analysisFailures';
import { resolveFailedTrackPaths } from '../../lib/analysisRetry';
import { getLogs } from '../../lib/logs';
import AppContext from '../AppContext';
import React, { useContext, useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 100;
const FailureHistory = ({
  enhancedAvailable = true,
  onRetry,
  retryDisabled = false,
  retryReason = '',
  standalone = false,
}) => {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryStatus, setRetryStatus] = useState('');
  const [retryError, setRetryError] = useState('');
  const retryLock = useRef(false);
  const retryController = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      retryController.current?.abort();
    };
  }, []);
  const finishRetry = () => {
    retryLock.current = false;
    if (alive.current) setRetrying(false);
  };

  const retry = async (rows) => {
    if (retryLock.current || retryDisabled || !onRetry) return;
    retryLock.current = true;
    setRetrying(true);
    setRetryStatus('Resolving tracks in the library…');
    setRetryError('');
    const controller = new AbortController();
    retryController.current = controller;
    try {
      const paths = await resolveFailedTrackPaths(rows, {
        signal: controller.signal,
      });
      if (!alive.current) return;
      await onRetry({ paths, enhanced: rows[0].mode === 'Enhanced' });
      if (alive.current)
        setRetryStatus(
          `Retry scan requested for ${paths.length} track${paths.length === 1 ? '' : 's'}. Follow progress above.`,
        );
    } catch (error_) {
      if (alive.current) {
        setRetryStatus('');
        const detail = error_?.response?.data;
        setRetryError(
          (typeof detail === 'string' && detail) ||
            detail?.message ||
            error_.message ||
            'Could not start retry. Please try again.',
        );
      }
    } finally {
      finishRetry();
    }
  };

  useEffect(() => {
    if (!open && !standalone) return undefined;
    let disposed = false;
    let busy = false;
    const finish = () => {
      busy = false;
      if (!disposed) setLoading(false);
    };

    const load = async () => {
      if (busy) return;
      busy = true;
      setLoading(true);
      try {
        const next = await getLogs({
          offset,
          limit: PAGE_SIZE,
          level: ['Warning', 'Error'],
          context: ['Music / Analysis', 'Music / Enhanced Analysis'],
        });
        if (!disposed) {
          setData({ ...next, offset });
          setError(false);
        }
      } catch {
        if (!disposed) setError(true);
      } finally {
        finish();
      }
    };

    void load();
    const timer = offset === 0 ? setInterval(load, 10_000) : null;
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, [offset, open, revision, standalone]);
  const tracks = data?.offset === offset ? failedTracksFromLogs(data.logs) : [];
  const Container = standalone ? 'section' : 'details';
  return (
    <Container
      className="ka-failures"
      onToggle={
        standalone ? undefined : (event) => setOpen(event.currentTarget.open)
      }
    >
      {standalone ? (
        <h2 className="ka-section-title">Failed tracks</h2>
      ) : (
        <summary>Failed tracks · measurements and reasons</summary>
      )}
      {(standalone || open) && (
        <div>
          <p>
            Failed tracks across all retained logs, newest first. A track may
            have succeeded since its failure was logged. Older logs may omit the
            measurement.
          </p>
          <button
            aria-busy={loading}
            aria-label="Refresh failures"
            className="ka-failure-refresh"
            disabled={loading || retrying}
            onClick={() => setRevision((value) => value + 1)}
            type="button"
          >
            <span style={loading ? { visibility: 'hidden' } : undefined}>
              Refresh failures
            </span>
            {loading && (
              <span
                aria-label="Loading failure details"
                className="ka-failure-refresh-status"
                role="status"
              >
                Loading…
              </span>
            )}
          </button>
          {error && (
            <p role="alert">
              Could not refresh failed tracks. Previously loaded details are
              retained; try Refresh failures.
            </p>
          )}
          {!error && data?.offset === offset && tracks.length === 0 && (
            <p>No failed tracks in this page of analysis logs.</p>
          )}
          {onRetry && (
            <div className="ka-failure-retry-controls">
              <p>
                {retryReason ||
                  'Rerun measurements in the original Basic or Enhanced mode. Previous failures remain in the history.'}
              </p>
              {['Basic', 'Enhanced'].map((mode) => {
                const rows = tracks.filter((track) => track.mode === mode);
                return (
                  rows.length > 1 && (
                    <button
                      disabled={
                        retryDisabled ||
                        retrying ||
                        loading ||
                        (mode === 'Enhanced' && !enhancedAvailable)
                      }
                      key={mode}
                      onClick={() => retry(rows)}
                      type="button"
                    >
                      Retry {mode} failures shown ({rows.length})
                    </button>
                  )
                );
              })}
              {!enhancedAvailable &&
                tracks.some((track) => track.mode === 'Enhanced') && (
                  <p>Enhanced retries require an available Enhanced worker.</p>
                )}
              {retryStatus && <p role="status">{retryStatus}</p>}
              {retryError && <p role="alert">{retryError}</p>}
            </div>
          )}
          <ul className="ka-failure-list">
            {tracks.map((track) => (
              <li key={track.key}>
                <div className="ka-failure-row">
                  <div className="ka-failure-track">
                    <strong>
                      {track.path.replaceAll('\\', '/').split('/').pop()}
                    </strong>
                    <span className="ka-failure-meta">
                      {track.mode} ·{' '}
                      <time
                        dateTime={track.timestamp}
                        title={new Date(track.timestamp).toLocaleString()}
                      >
                        {new Date(track.timestamp).toLocaleString()}
                      </time>
                    </span>
                  </div>
                  <ul className="ka-failure-measurements">
                    {track.failures.map((failure) => (
                      <li key={`${failure.measurement}:${failure.reason}`}>
                        <strong>{failure.measurement}:</strong> {failure.reason}
                      </li>
                    ))}
                  </ul>
                  {onRetry && (
                    <button
                      aria-label={`Retry ${track.mode} analysis for ${track.path}`}
                      disabled={
                        retryDisabled ||
                        retrying ||
                        (track.mode === 'Enhanced' && !enhancedAvailable)
                      }
                      onClick={() => retry([track])}
                      type="button"
                    >
                      Retry
                    </button>
                  )}{' '}
                </div>
                <details>
                  <summary aria-label={`Failure details for ${track.path}`}>
                    Details
                  </summary>
                  <p className="ka-failure-path">{track.path}</p>
                  <ul>
                    {track.failures.map((failure) => (
                      <li key={`${failure.measurement}:${failure.reason}`}>
                        <strong>{failure.measurement}:</strong> {failure.reason}
                      </li>
                    ))}
                  </ul>
                  <p>Original log entries</p>
                  {track.entries.map((entry) => (
                    <p key={entry}>{entry}</p>
                  ))}
                </details>
              </li>
            ))}
          </ul>
          <div className="ka-failure-pages">
            <button
              disabled={loading || retrying || offset === 0}
              onClick={() =>
                setOffset((value) => Math.max(0, value - PAGE_SIZE))
              }
              type="button"
            >
              Newer entries
            </button>
            <span>Page {offset / PAGE_SIZE + 1}</span>
            <button
              disabled={
                loading ||
                retrying ||
                !data ||
                offset + PAGE_SIZE >= data.totalCount
              }
              onClick={() => setOffset((value) => value + PAGE_SIZE)}
              type="button"
            >
              Older entries
            </button>
          </div>
        </div>
      )}
    </Container>
  );
};

const AnalysisFailures = ({
  enhancedAvailable,
  onRetry,
  retryDisabled,
  retryReason,
  standalone = false,
}) => {
  const { isAdmin } = useContext(AppContext) || {};
  return isAdmin ? (
    <FailureHistory
      enhancedAvailable={enhancedAvailable}
      onRetry={onRetry}
      retryDisabled={retryDisabled}
      retryReason={retryReason}
      standalone={standalone}
    />
  ) : standalone ? (
    <p>Failure details are available to administrators.</p>
  ) : null;
};

export default AnalysisFailures;
