import * as ytdlp from '../../lib/ytdlp';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Bell,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const STATE_LABELS = {
  enumerating: 'Finding tracks…',
  active: 'Downloading',
  paused: 'Paused',
  completed: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const TRACK_STATE_CLASS = {
  queued: 'ytdlp-track-state-queued',
  inprogress: 'ytdlp-track-state-inprogress',
  completed: 'ytdlp-track-state-completed',
  failed: 'ytdlp-track-state-failed',
  skipped: 'ytdlp-track-state-skipped',
  cancelled: 'ytdlp-track-state-cancelled',
};

const TRACK_ROW_HEIGHT = 30;

// Channel (/@handle, /channel/, /c/, /user/) or playlist (list=) URLs can be subscribed to;
// a single-video job cannot.
const SUBSCRIBABLE_URL = /\/(?:channel|c|user)\/|\/@|[?&]list=/iu;
const isSubscribable = (url) => SUBSCRIBABLE_URL.test(url || '');

// Normalize a channel/playlist URL for comparison: the backend appends a tab (e.g. /videos)
// to channel URLs, so strip those and trailing slashes before matching against subscriptions.
const canonicalChannel = (url) =>
  (url || '')
    .toLowerCase()
    .replace(/\/+$/u, '')
    .replace(/\/(?:videos|streams|shorts|playlists|featured|community)$/u, '');

// Jobs that never got past enumeration (e.g. a cookie/auth failure) have no title and no
// tracks — showing the raw URL as if it were a title reads as a real completed download, so
// fall back to a compact, clearly-untitled label instead.
const jobDisplayTitle = (job) => {
  if (job.title) {
    return job.title;
  }

  let videoId = job.url;
  try {
    const u = new URL(job.url);
    videoId =
      u.searchParams.get('v') ||
      u.pathname.split('/').filter(Boolean).pop() ||
      job.url;
  } catch {
    // not a valid URL; fall through to using it as-is
  }

  return `(untitled — ${videoId})`;
};

const useAvailableHeight = (ref) => {
  const [height, setHeight] = useState(400);
  useLayoutEffect(() => {
    const measure = () => {
      if (!ref.current) return;
      const top = ref.current.getBoundingClientRect().top;
      setHeight(Math.max(100, window.innerHeight - top - 16));
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref]);
  return height;
};

const formatDuration = (secs) => {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const jobProgress = (job) => {
  if (!job.totalTracks) return 0;
  return Math.round(
    ((job.completedTracks + job.skippedTracks) / job.totalTracks) * 100,
  );
};

const TRACK_STATE_LABEL = {
  queued: { text: 'Queued', cls: 'ytdlp-tsl-queued' },
  completed: { text: '✓ Done', cls: 'ytdlp-tsl-done' },
  skipped: { text: 'Skipped', cls: 'ytdlp-tsl-skipped' },
  cancelled: { text: 'Cancelled', cls: 'ytdlp-tsl-cancelled' },
};

const TrackRow = ({ onRetryTags, style, track }) => {
  const tStateKey = (track.state || '').toLowerCase().replace('_', '');
  const hasTagError = Boolean(track.tagWritingError);
  const isActive = tStateKey === 'inprogress';
  const isFailed = tStateKey === 'failed';
  const isSkipped = tStateKey === 'skipped';
  const isAgeRestricted =
    isFailed && track.error?.toLowerCase().includes('age-restricted');
  const stateLabel = TRACK_STATE_LABEL[tStateKey];
  return (
    <div
      className={`ytdlp-track${hasTagError ? ' ytdlp-track--tag-error' : ''}${tStateKey === 'completed' ? ' ytdlp-track--done' : ''}`}
      style={style}
      title={track.error || track.tagWritingError || undefined}
    >
      <div
        className={`ytdlp-track-state ${TRACK_STATE_CLASS[tStateKey] || ''}`}
      />
      {track.playlistIndex != null && (
        <span className="ytdlp-track-index">{track.playlistIndex}</span>
      )}
      <span className="ytdlp-track-title">{track.title}</span>
      {track.duration > 0 && (
        <span className="ytdlp-track-duration">
          {formatDuration(track.duration)}
        </span>
      )}
      {isActive && (
        <span className="ytdlp-track-progress-wrap">
          <span className="ytdlp-track-progress-bar-bg">
            <span
              className="ytdlp-track-progress-bar-fill"
              style={{ width: `${track.progress || 0}%` }}
            />
          </span>
          <span className="ytdlp-track-progress-text">
            {Math.round(track.progress || 0)}%
            {track.speed ? ` · ${track.speed}` : ''}
          </span>
        </span>
      )}
      {isFailed && (
        <span
          className="ytdlp-tsl ytdlp-tsl-failed"
          title={track.error}
        >
          {isAgeRestricted
            ? 'Age-restricted — add cookie file in Settings'
            : track.error
              ? `✕ ${track.error}`
              : '✕ Failed'}
        </span>
      )}
      {isSkipped && (
        <span className="ytdlp-tsl ytdlp-tsl-skipped">
          {track.error ? `— ${track.error}` : 'Skipped'}
        </span>
      )}
      {!isActive && !isFailed && !isSkipped && stateLabel && (
        <span className={`ytdlp-tsl ${stateLabel.cls}`}>{stateLabel.text}</span>
      )}
      {hasTagError && (
        <button
          className="ytdlp-btn ytdlp-btn--xs"
          onClick={() => onRetryTags(track.id)}
          title={`Tag error: ${track.tagWritingError}`}
          type="button"
        >
          <RefreshCw size={11} /> Tags
        </button>
      )}
    </div>
  );
};

const VirtualTrackList = ({ onRetryTags, tracks }) => {
  const parentRef = useRef(null);
  const availableHeight = useAvailableHeight(parentRef);
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => TRACK_ROW_HEIGHT,
    overscan: 10,
  });

  const listHeight = Math.min(
    tracks.length * TRACK_ROW_HEIGHT,
    availableHeight,
  );

  return (
    <div>
      <div className="ytdlp-track-header">
        <div
          className="ytdlp-track-state"
          style={{ background: 'none' }}
        />
        <span className="ytdlp-track-index ytdlp-col-header">#</span>
        <span className="ytdlp-track-title ytdlp-col-header">Title</span>
        <span className="ytdlp-track-duration ytdlp-col-header">Time</span>
        <span className="ytdlp-track-progress-wrap ytdlp-col-header">
          Progress
        </span>
      </div>
      <div
        ref={parentRef}
        style={{ height: listHeight, overflowY: 'auto' }}
      >
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((vItem) => (
            <TrackRow
              key={tracks[vItem.index].id}
              onRetryTags={onRetryTags}
              style={{
                position: 'absolute',
                top: vItem.start,
                left: 0,
                right: 0,
                height: vItem.size,
              }}
              track={tracks[vItem.index]}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

const JobRow = ({
  job,
  jobLog,
  onCancel,
  onPause,
  onReconcile,
  onRemove,
  onResume,
  onRetryFailed,
  onRetryJob,
  onRetryTags,
  onSubscribe,
  subscriptions,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [tracks, setTracks] = useState(job._tracks || []);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const logEndRef = useRef(null);

  const subscribed = (subscriptions || []).some(
    (s) => canonicalChannel(s.channelUrl) === canonicalChannel(job.url),
  );

  const handleSubscribe = async (e) => {
    e.stopPropagation();
    setSubscribing(true);
    try {
      await onSubscribe(job);
    } finally {
      setSubscribing(false);
    }
  };

  useEffect(() => {
    if (job._tracks) setTracks(job._tracks);
  }, [job._tracks]);

  useEffect(() => {
    if (showLog && logEndRef.current)
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [jobLog, showLog]);

  const handleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && tracks.length === 0) {
      setLoadingTracks(true);
      try {
        const res = await ytdlp.getJobTracks(job.id);
        setTracks(res.data || []);
      } finally {
        setLoadingTracks(false);
      }
    }
  };

  const stateKey = (job.state || '').toLowerCase();
  const pct = jobProgress(job);
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;
  // A single-video job always has exactly one track whose title mirrors the job's own
  // title — expanding it just repeats the same title back. Jobs with zero tracks (including
  // older records that never got a track count backfilled) have nothing to expand into either.
  const isExpandable = job.totalTracks > 1;
  const isActive = stateKey === 'active';
  const isComplete = stateKey === 'completed';
  const remaining = isActive
    ? Math.max(
        0,
        job.totalTracks -
          job.completedTracks -
          job.failedTracks -
          job.skippedTracks,
      )
    : 0;

  return (
    <div className="ytdlp-job">
      <div
        className={`ytdlp-job-header${isExpandable ? '' : ' ytdlp-job-header--static'}`}
        onClick={isExpandable ? handleExpand : undefined}
      >
        {isExpandable ? (
          <ChevronIcon
            size={14}
            strokeWidth={1.75}
          />
        ) : (
          <span className="ytdlp-job-chevron-spacer" />
        )}
        <span className="ytdlp-job-title">{jobDisplayTitle(job)}</span>
        <span className="ytdlp-job-meta">
          {isExpandable && `${job.completedTracks}/${job.totalTracks}`}
          {isActive && remaining > 0 && (
            <span className="ytdlp-job-remaining">
              {' '}
              · {remaining} remaining
            </span>
          )}
          {job.skippedTracks > 0 && ` · ${job.skippedTracks} skipped`}
          {job.failedTracks > 0 && ` · ${job.failedTracks} failed`}
          {job.tagFailedTracks > 0 && ` · ${job.tagFailedTracks} tag errors`}
        </span>
        <span className={`ytdlp-state-badge ytdlp-state-${stateKey}`}>
          {isComplete && (
            <CheckCircle2
              size={11}
              strokeWidth={2.5}
            />
          )}
          {STATE_LABELS[stateKey] || job.state}
        </span>
        <div className="ytdlp-job-actions">
          {stateKey === 'active' && (
            <button
              className="ytdlp-btn"
              onClick={(e) => {
                e.stopPropagation();
                onPause(job.id);
              }}
              title="Pause"
              type="button"
            >
              <Pause size={13} />
            </button>
          )}
          {stateKey === 'paused' && (
            <button
              className="ytdlp-btn"
              onClick={(e) => {
                e.stopPropagation();
                onResume(job.id);
              }}
              title="Resume"
              type="button"
            >
              <Play size={13} />
            </button>
          )}
          {(stateKey === 'active' ||
            stateKey === 'enumerating' ||
            stateKey === 'paused') && (
            <>
              <button
                className="ytdlp-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel(job.id);
                }}
                title="Stop"
                type="button"
              >
                <Square size={13} />
              </button>
              <button
                className="ytdlp-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onReconcile(job.id);
                }}
                title="Recheck — mark complete if no tracks are pending"
                type="button"
              >
                <ScanSearch size={13} />
              </button>
            </>
          )}
          {jobLog && jobLog.length > 0 && (
            <button
              className={`ytdlp-btn${showLog ? ' ytdlp-btn--active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setShowLog((s) => !s);
              }}
              title="Toggle log"
              type="button"
            >
              <Terminal size={13} />
            </button>
          )}
          {job.failedTracks > 0 && (
            <button
              className="ytdlp-btn"
              onClick={(e) => {
                e.stopPropagation();
                onRetryFailed(job.id);
              }}
              title="Retry failed tracks"
              type="button"
            >
              <RefreshCw size={13} />
            </button>
          )}
          {(stateKey === 'completed' ||
            stateKey === 'cancelled' ||
            stateKey === 'failed') && (
            <button
              className="ytdlp-btn"
              onClick={(e) => {
                e.stopPropagation();
                onRetryJob(job);
              }}
              title="Run again — re-enumerates the URL; already-downloaded tracks are skipped"
              type="button"
            >
              <RotateCcw size={13} />
            </button>
          )}
          {onSubscribe &&
            isSubscribable(job.url) &&
            (subscribed ? (
              <button
                className="ytdlp-btn ytdlp-btn--active"
                disabled
                title="Subscribed — new uploads download automatically"
                type="button"
              >
                <BellRing size={13} /> Subscribed
              </button>
            ) : (
              <button
                className="ytdlp-btn"
                disabled={subscribing}
                onClick={handleSubscribe}
                title="Subscribe — auto-download new uploads from this channel"
                type="button"
              >
                <Bell size={13} />
                {subscribing ? 'Subscribing…' : 'Subscribe'}
              </button>
            ))}
          <button
            className="ytdlp-btn ytdlp-btn--danger"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(job.id);
            }}
            title="Remove job"
            type="button"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {(stateKey === 'active' || stateKey === 'enumerating') && (
        <div className="ytdlp-progress-bar">
          <div
            className="ytdlp-progress-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {showLog && jobLog && jobLog.length > 0 && (
        <div className="ytdlp-log-panel">
          {jobLog.map((entry, index) => (
            <div
              className={`ytdlp-log-line${entry.isError ? ' ytdlp-log-line--error' : ''}`}
              // eslint-disable-next-line react/no-array-index-key
              key={index}
            >
              {entry.line}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {expanded && (
        <div className="ytdlp-track-list">
          {loadingTracks && <div className="ytdlp-empty">Loading tracks…</div>}
          {!loadingTracks && tracks.length > 0 && (
            <VirtualTrackList
              onRetryTags={onRetryTags}
              tracks={tracks}
            />
          )}
          {!loadingTracks && tracks.length === 0 && (
            <div className="ytdlp-empty">No tracks loaded</div>
          )}
        </div>
      )}
    </div>
  );
};

const JobList = ({
  jobLogs,
  jobs,
  onCancel,
  onPause,
  onReconcile,
  onRemove,
  onResume,
  onRetryFailed,
  onRetryJob,
  onRetryTags,
  onSubscribe,
  subscriptions,
}) => {
  if (jobs.length === 0) {
    return (
      <div className="ytdlp-empty">
        No downloads yet. Use the Add tab to submit a URL.
      </div>
    );
  }

  return (
    <div className="ytdlp-job-list">
      {jobs.map((job) => (
        <JobRow
          job={job}
          jobLog={jobLogs && jobLogs[job.id]}
          key={job.id}
          onCancel={onCancel}
          onPause={onPause}
          onReconcile={onReconcile}
          onRemove={onRemove}
          onResume={onResume}
          onRetryFailed={onRetryFailed}
          onRetryJob={onRetryJob}
          onRetryTags={onRetryTags}
          onSubscribe={onSubscribe}
          subscriptions={subscriptions}
        />
      ))}
    </div>
  );
};

export default JobList;
