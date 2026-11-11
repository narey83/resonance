import '../LibraryWorkspace.css';
import { urlBase } from '../../../config';
import { usePlayer } from '../../../context/PlayerContext';
import useDebounce from '../../../hooks/useDebounce';
import {
  getPreparationPage,
  preparationLabel,
  retryPreparation,
  workspaceError,
} from '../../../lib/libraryWorkspace';
import { usePagedList } from '../../../lib/usePagedList';
import AppContext from '../../AppContext';
import AlbumArt from './AlbumArt';
import {
  Activity,
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  Play,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import React, { useContext, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const playable = (track) => ({
  ...track,
  filename: track.path,
  localRelativePath: track.path,
  length: track.duration,
});
const totals = (status) => {
  const counts = status?.counts || {};
  return {
    waiting: (counts.queued || 0) + (counts.retrying || 0),
    running: counts.running || 0,
    failed: counts.failed || 0,
  };
};

const BackgroundAnalysisQueue = ({ onRefresh, status, statusError }) => {
  const isAdmin = useContext(AppContext)?.isAdmin;
  const refresh = onRefresh;
  const { playQueue } = usePlayer();
  const [state, setState] = useState('');
  const [filter, setFilter] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const search = useDebounce(filter, 250);
  const query = useMemo(() => ({ state, search }), [search, state]);
  const refreshToken = JSON.stringify([
    revision,
    status?.counts,
    status?.lastCheckedAt,
  ]);
  const page = usePagedList(getPreparationPage, query, {
    pageSize: 50,
    refreshToken,
  });
  const count = totals(status);
  const enriched = status?.enrichment;
  const act = async (key, action) => {
    setBusy(key);
    setError('');
    try {
      await action();
      refresh();
      setRevision((n) => n + 1);
    } catch (error_) {
      setError(workspaceError(error_));
    } finally {
      setBusy('');
    }
  };

  return (
    <section
      aria-label="Background analysis queue"
      className="library-workspace preparation-view"
    >
      <header className="workspace-heading">
        <div>
          <h2>Background analysis queue</h2>
          <p>
            Queue stages below describe background jobs only. Library readiness
            and manual scan progress are shown above.
          </p>
        </div>
      </header>
      <div className="preparation-overview">
        {status?.analysisError && <p role="alert">{status.analysisError}</p>}
        <div className="preparation-progress-heading">
          <span className="workspace-state">
            {status
              ? status.paused
                ? 'Background scheduling off'
                : 'Background scheduling on'
              : 'Checking background queue…'}
          </span>
          <small>{status?.waitingReason}</small>
        </div>
        <div className="preparation-metrics">
          {[
            {
              label: 'Background waiting',
              value: count.waiting,
              icon: Clock3,
              filter: 'waiting',
            },
            {
              label: 'Background in progress',
              value: count.running,
              icon: Activity,
              filter: 'running',
            },
            {
              label: 'Background needs attention',
              value: count.failed,
              icon: CircleAlert,
              filter: 'failed',
            },
          ].map((metric) => {
            const Icon = metric.icon;
            return (
              <button
                aria-pressed={state === metric.filter}
                key={metric.label}
                onClick={() =>
                  setState((current) =>
                    current === metric.filter ? '' : metric.filter,
                  )
                }
                type="button"
              >
                <Icon size={17} />
                <strong>{status ? metric.value : '—'}</strong>
                <span>{metric.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="preparation-enrichment">
        <Sparkles size={19} />
        <div>
          <strong>Metadata enrichment</strong>
          <p>
            {!enriched
              ? 'Checking your existing enrichment service…'
              : enriched.scanning
                ? enriched.total > 0
                  ? `Enriching ${enriched.total} tracks · ${enriched.written} updated`
                  : 'Checking for tracks with missing metadata…'
                : enriched.enabled
                  ? 'Automatic metadata lookup is on. Saved audio analysis is separate and is not repeated by this check.'
                  : 'Automatic enrichment is off in your current settings. Audio analysis is controlled separately.'}
          </p>
        </div>
        {isAdmin && (
          <Link
            className="jb-btn"
            to={`${urlBase}/system/options`}
          >
            Enrichment settings <ArrowRight size={14} />
          </Link>
        )}
      </div>
      {!status?.enhancedEnabled && status && (
        <div className="workspace-notice">
          Basic audio analysis is available. Enhanced analysis needs its worker
          configured in this installation.
        </div>
      )}
      {(error || statusError || page.error) && (
        <div
          className="workspace-error"
          role="alert"
        >
          {error || statusError || 'Could not load background queue tracks.'}
          <button
            className="jb-btn"
            onClick={() => {
              refresh();
              setRevision((n) => n + 1);
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      )}
      <div className="preparation-toolbar">
        <div className="workspace-search">
          <Search size={15} />
          <input
            aria-label="Search background analysis tracks"
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a track…"
            value={filter}
          />
        </div>
        <select
          aria-label="Background analysis stage"
          onChange={(e) => setState(e.target.value)}
          value={state}
        >
          <option value="">All background stages</option>
          {[
            'analysed',
            'waiting',
            'complete',
            'basic',
            'queued',
            'running',
            'retrying',
            'failed',
          ].map((stage) => (
            <option
              key={stage}
              value={stage}
            >
              {preparationLabel(stage)}
            </option>
          ))}
        </select>
        <button
          aria-label="Refresh background queue"
          className="jb-btn"
          onClick={() => {
            refresh();
            setRevision((n) => n + 1);
          }}
          type="button"
        >
          <RefreshCw size={15} />
        </button>
        <span>
          {page.total} {page.total === 1 ? 'track' : 'tracks'}
        </span>
      </div>
      {page.loading && <p role="status">Loading background queue…</p>}
      {!page.loading && !page.items.length && !page.error && (
        <div className="workspace-empty">
          <Check size={28} />
          <h3>
            {state === 'failed'
              ? 'No background jobs need attention'
              : 'No tracks in this view'}
          </h3>
          <p>
            {state || search
              ? 'Try another stage or clear your search.'
              : 'New tracks will appear here when Resonance finds them.'}
          </p>
        </div>
      )}
      <div
        aria-label="Background analysis tracks"
        className="preparation-tracks"
      >
        {page.items.map((item) => {
          const track = item.track;
          const missing = [
            !track.title && 'title',
            !track.artist && 'artist',
            !track.hasArtwork && 'artwork',
          ].filter(Boolean);
          return (
            <article
              className="preparation-track"
              key={track.path}
            >
              <button
                aria-label={`Play ${track.title || track.filename}`}
                className="preparation-track-art"
                onClick={() => playQueue([playable(track)], 0)}
                type="button"
              >
                <AlbumArt
                  hasArtwork={track.hasArtwork}
                  path={track.path}
                  size={42}
                />
                <span>
                  <Play size={17} />
                </span>
              </button>
              <div className="preparation-track-name">
                <strong title={track.title || track.filename}>
                  {track.title || track.filename}
                </strong>
                <span>{track.artist || 'Unknown artist'}</span>
                <div className="preparation-track-facts">
                  <span>{track.bpm ? `${track.bpm} BPM` : 'BPM pending'}</span>
                  <span>{track.key || 'Key pending'}</span>
                  {missing.length > 0 && (
                    <small>
                      Missing {missing.join(', ')} · enrichment handles metadata
                    </small>
                  )}
                </div>
              </div>
              <div className="preparation-track-status">
                <span className={`workspace-state is-${item.state}`}>
                  {preparationLabel(item.state)}
                </span>
                <p>
                  {item.state === 'retrying'
                    ? `Attempt ${item.attempts} of 3 · retry ${new Date(item.nextAttemptAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : item.state === 'complete'
                      ? 'Waveform, beatgrid, key, vocals and phrases available'
                      : item.state === 'basic'
                        ? 'BPM, key, waveform and loudness available'
                        : item.detail}
                </p>
              </div>
              {item.state === 'failed' && (
                <button
                  className="jb-btn"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    act(track.path, () => retryPreparation(track.path))
                  }
                  type="button"
                >
                  <RefreshCw size={14} />
                  {busy === track.path ? 'Queuing…' : 'Retry analysis'}
                </button>
              )}
            </article>
          );
        })}
      </div>
      {page.items.length < page.total && (
        <button
          className="jb-btn preparation-load-more"
          disabled={page.loadingMore}
          onClick={() => page.loadMore()}
          type="button"
        >
          {page.loadingMore ? 'Loading…' : 'Load more tracks'}
        </button>
      )}
      <p className="workspace-footnote">
        Background stages are independent of manual scans and saved library
        coverage. Metadata enrichment uses your existing settings and schedule.
      </p>
    </section>
  );
};

export default BackgroundAnalysisQueue;
