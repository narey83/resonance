import './AnalysisFailures.css';
import { failedTracksFromLogs } from '../../lib/analysisFailures';
import { getLogs } from '../../lib/logs';
import AppContext from '../AppContext';
import React, { useContext, useEffect, useState } from 'react';

const PAGE_SIZE = 100;
const FailureHistory = ({ standalone = false }) => {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
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
          from: `${day}T00:00:00.000Z`,
          to: `${day}T23:59:59.999Z`,
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
    const timer =
      offset === 0 && day === new Date().toISOString().slice(0, 10)
        ? setInterval(load, 10_000)
        : null;
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, [day, offset, open, revision, standalone]);
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
            Recorded Basic and Enhanced failures for the selected day (UTC).
            Older logs may not name the measurement. History follows the
            server’s log retention settings.
          </p>
          <label>
            Failure date (UTC){' '}
            <input
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => {
                if (!event.target.value) return;
                setDay(event.target.value);
                setOffset(0);
                setData(null);
              }}
              type="date"
              value={day}
            />
          </label>{' '}
          <button
            disabled={loading}
            onClick={() => setRevision((value) => value + 1)}
            type="button"
          >
            Refresh failures
          </button>
          {loading && <p role="status">Loading failure details…</p>}
          {error && (
            <p role="alert">
              Could not refresh failed tracks. Previously loaded details are
              retained; try Refresh failures.
            </p>
          )}
          {!loading && !error && tracks.length === 0 && (
            <p>No failed tracks in this page of analysis logs.</p>
          )}
          <ul className="ka-failure-list">
            {tracks.map((track) => (
              <li key={track.key}>
                <strong>
                  {track.path.replaceAll('\\', '/').split('/').pop()}
                </strong>
                <span>
                  {track.mode} · {new Date(track.timestamp).toLocaleString()}
                </span>
                <p className="ka-failure-path">{track.path}</p>
                <ul>
                  {track.failures.map((failure) => (
                    <li key={`${failure.measurement}:${failure.reason}`}>
                      <strong>{failure.measurement}:</strong> {failure.reason}
                    </li>
                  ))}
                </ul>
                <details>
                  <summary>Original log entries</summary>
                  {track.entries.map((entry) => (
                    <p key={entry}>{entry}</p>
                  ))}
                </details>
              </li>
            ))}
          </ul>
          <div className="ka-failure-pages">
            <button
              disabled={loading || offset === 0}
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
                loading || !data || offset + PAGE_SIZE >= data.totalCount
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

const AnalysisFailures = ({ standalone = false }) => {
  const { isAdmin } = useContext(AppContext) || {};
  return isAdmin ? (
    <FailureHistory standalone={standalone} />
  ) : standalone ? (
    <p>Failure details are available to administrators.</p>
  ) : null;
};

export default AnalysisFailures;
