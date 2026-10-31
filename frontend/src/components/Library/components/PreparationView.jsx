import '../LibraryWorkspace.css';
import { urlBase } from '../../../config';
import { usePlayer } from '../../../context/PlayerContext';
import useDebounce from '../../../hooks/useDebounce';
import usePreparationStatus from '../../../hooks/usePreparationStatus';
import {
  getPreparationPage,
  pausePreparation,
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
  AudioWaveform,
  Check,
  CircleAlert,
  Clock3,
  Pause,
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
    analysed: (counts.complete || 0) + (counts.basic || 0),
    waiting: (counts.queued || 0) + (counts.retrying || 0),
    running: counts.running || 0,
    failed: counts.failed || 0,
  };
};

export const PreparationHomeCard = ({ onCrates, onOpen }) => {
  const { error, status } = usePreparationStatus();
  const count = totals(status);
  return (
    <div className="preparation-home-card">
      <span className="preparation-home-icon">
        <AudioWaveform size={22} />
      </span>
      <div>
        <span className="workspace-eyebrow">Automatic preparation</span>
        <strong>
          {error
            ? 'Preparation status unavailable'
            : status?.analysisError
              ? 'Analysis stopped'
              : !status
                ? 'Checking your library…'
                : status.paused
                  ? 'Preparation is paused'
                  : count.waiting || count.running
                    ? `${count.waiting + count.running} tracks getting ready`
                    : `${count.analysed} tracks analysed`}
        </strong>
        <p role={status?.analysisError ? 'alert' : undefined}>
          {status?.analysisError ||
            'Analysis and your existing enrichment, together in one view.'}
        </p>
      </div>
      <div className="workspace-actions">
        <button
          className="jb-btn"
          onClick={onOpen}
          type="button"
        >
          Preparation <ArrowRight size={14} />
        </button>
        <button
          className="jb-btn"
          onClick={onCrates}
          type="button"
        >
          Smart crates <Sparkles size={14} />
        </button>
      </div>
    </div>
  );
};

const PreparationView = () => {
  const isAdmin = useContext(AppContext)?.isAdmin;
  const { error: statusError, refresh, status } = usePreparationStatus();
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

  const percentage = status?.total
    ? Math.round((count.analysed / status.total) * 100)
    : 0;
  return (
    <section className="library-workspace preparation-view">
      <header className="workspace-heading">
        <div>
          <span className="workspace-eyebrow">
            <AudioWaveform size={13} /> Quietly working on your collection
          </span>
          <h2>Preparation</h2>
          <p>
            New tracks are analysed automatically. Follow their progress here
            and keep discovering.
          </p>
        </div>
        <button
          className="jb-btn"
          disabled={!status || Boolean(busy)}
          onClick={() => act('pause', () => pausePreparation(!status.paused))}
          type="button"
        >
          {status?.paused ? <Play size={15} /> : <Pause size={15} />}
          {status?.paused ? 'Resume preparation' : 'Pause after active tracks'}
        </button>
      </header>
      <div className="preparation-overview">
        {status?.analysisError && <p role="alert">{status.analysisError}</p>}
        <div className="preparation-progress-heading">
          <span
            className={`workspace-state ${status?.paused ? '' : 'is-complete'}`}
          >
            {status?.paused ? 'Paused' : 'Automatic'}
          </span>
          <span>
            {status
              ? `${count.analysed} of ${status.total} tracks analysed`
              : 'Checking library…'}
          </span>
          <small>
            {((count.waiting || count.running) && status?.waitingReason) ||
              (status?.lastCheckedAt
                ? count.waiting
                  ? 'Waiting for the next analysis slot'
                  : count.failed
                    ? 'Some tracks need attention'
                    : 'Up to date · new tracks are picked up automatically'
                : 'Checking existing tracks')}
          </small>
        </div>
        <div
          aria-label="Library analysis progress"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={percentage}
          className="preparation-progress-track"
          role="progressbar"
        >
          <span style={{ width: `${percentage}%` }} />
        </div>
        <div className="preparation-metrics">
          {[
            {
              label: 'Analysed',
              value: count.analysed,
              icon: Check,
              filter: 'analysed',
            },
            {
              label: 'Waiting',
              value: count.waiting,
              icon: Clock3,
              filter: 'waiting',
            },
            {
              label: 'In progress',
              value: count.running,
              icon: Activity,
              filter: 'running',
            },
            {
              label: 'Needs attention',
              value: count.failed,
              icon: CircleAlert,
              filter: 'failed',
            },
          ].map(({ icon: Icon, ...metric }) => (
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
          ))}
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
                ? `Enriching your library · ${enriched.written} updated${enriched.total ? ` of ${enriched.total} candidates` : ''}`
                : enriched.enabled
                  ? 'Your existing enrichment runs automatically with its current settings.'
                  : 'Automatic enrichment is off in your current settings. Audio analysis still runs.'}
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
          {error || statusError || 'Could not load preparation tracks.'}
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
            aria-label="Search preparation tracks"
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a track…"
            value={filter}
          />
        </div>
        <select
          aria-label="Preparation stage"
          onChange={(e) => setState(e.target.value)}
          value={state}
        >
          <option value="">All stages</option>
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
          aria-label="Refresh preparation"
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
      {page.loading && <p role="status">Loading preparation…</p>}
      {!page.loading && !page.items.length && !page.error && (
        <div className="workspace-empty">
          <Check size={28} />
          <h3>
            {state === 'failed'
              ? 'Nothing needs attention'
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
        aria-label="Preparation tracks"
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
        Analysed means the results are available. Metadata enrichment uses your
        existing settings and schedule.
      </p>
    </section>
  );
};

export default PreparationView;
