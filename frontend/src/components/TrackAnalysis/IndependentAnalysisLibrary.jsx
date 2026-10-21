import api from '../../lib/api';
import {
  fullTrackJobs,
  independentSummary,
} from '../../lib/independentSummary';
import * as musicLibraryApi from '../../lib/musicLibrary';
import { usePagedList } from '../../lib/usePagedList';
import CandidateAnalysisPanel from './CandidateAnalysisPanel';
import React, { useEffect, useMemo, useState } from 'react';

const IndependentAnalysisLibrary = () => {
  const [revision, setRevision] = useState(0);
  const query = useMemo(() => ({ sort: 'title' }), []);
  const { items, loadMore, loading, loadingMore, total } = usePagedList(
    musicLibraryApi.getTrackPage,
    query,
    { pageSize: 200, refreshToken: revision },
  );
  const [summaries, setSummaries] = useState({});
  const [checking, setChecking] = useState(false);
  const [selected, setSelected] = useState('');
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setSummaries({});
    let cursor = 0;
    const found = {};
    const worker = async () => {
      while (cursor < items.length) {
        if (cancelled) break;
        const track = items[cursor++];
        try {
          const { data } = await api.get('/analysis/candidates', {
            params: { path: track.path },
          });
          const jobs = fullTrackJobs(data.jobs || []);
          for (const job of jobs) {
            const response = await api.get(
              `/analysis/candidates/${encodeURIComponent(job.jobId)}`,
            );
            const summary = independentSummary(response.data);
            if (summary) {
              found[track.path] = summary;
              break;
            }
          }

          if (!found[track.path]) found[track.path] = { missing: true };
        } catch {
          found[track.path] = { error: true };
        }

        if (!cancelled) setSummaries({ ...found });
      }
    };

    Promise.all(
      Array.from({ length: Math.min(4, items.length) }, worker),
    ).finally(() => {
      if (!cancelled) setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [items, revision]);
  const complete = Object.values(summaries).filter(
    (row) => row.available === row.total && row.total > 0,
  ).length;
  return (
    <section
      aria-label="Independent library analysis"
      style={{ padding: '1rem' }}
    >
      <h3>Independent full-track analysis</h3>
      <p>
        {complete} of {items.length} loaded tracks have all independent features
        available{checking ? ' — checking…' : '.'} Library: {total} tracks.
      </p>
      <p>
        These results are stored separately from file tags. The library tag scan
        can show fewer analysed tracks because BPM/key tags are not overwritten.
      </p>
      <button
        onClick={() => setRevision((v) => v + 1)}
        type="button"
      >
        Refresh results
      </button>
      {loading && <p>Loading tracks…</p>}
      <table style={{ width: '100%', marginTop: '1rem' }}>
        <thead>
          <tr>
            <th>Track</th>
            <th>Independent BPM</th>
            <th>Independent key</th>
            <th>Features</th>
            <th>Results</th>
          </tr>
        </thead>
        <tbody>
          {items.map((track) => {
            const row = summaries[track.path];
            return (
              <tr key={track.path}>
                <td>{track.title || track.filename}</td>
                <td>{row?.bpm ? row.bpm.toFixed(1) : '—'}</td>
                <td>{row?.key || '—'}</td>
                <td>
                  {!row
                    ? 'Checking…'
                    : row.error
                      ? 'Unavailable — retry'
                      : row.missing
                        ? 'No full-track result'
                        : `${row.available} / ${row.total}`}
                </td>
                <td>
                  <button
                    onClick={() => setSelected(track.path)}
                    type="button"
                  >
                    Inspect analysis
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {items.length < total && (
        <button
          disabled={loadingMore}
          onClick={loadMore}
          type="button"
        >
          Load more tracks
        </button>
      )}
      {selected && (
        <CandidateAnalysisPanel
          initialJobId={summaries[selected]?.jobId}
          key={selected}
          path={selected}
        />
      )}
    </section>
  );
};

export default IndependentAnalysisLibrary;
