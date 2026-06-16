import './YtDlp.css';
import { urlBase } from '../../config';
import { createYtDlpHubConnection } from '../../lib/hubFactory';
import * as ytdlp from '../../lib/ytdlp';
import AddPane from './AddPane';
import EventsPane from './EventsPane';
import JobList from './JobList';
import SearchPane from './SearchPane';
import TagErrorList from './TagErrorList';
import { AlertTriangle, List, ScrollText } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { toast } from 'react-toastify';

const TABS = [
  { icon: List, id: 'downloads', label: 'Downloads' },
  { icon: ScrollText, id: 'events', label: 'Events' },
  { icon: AlertTriangle, id: 'tag-errors', label: 'Tag Errors' },
];

const EVENT_BUFFER_MAX = 1_000;

// Matches the search filter buckets (under 4 min / 4–20 min / over 20 min)
const DURATION_FILTERS = {
  long: { minTrackDurationSeconds: 1_200 },
  medium: { maxTrackDurationSeconds: 1_200, minTrackDurationSeconds: 240 },
  short: { maxTrackDurationSeconds: 240 },
};

// Resubmits the same URL with the job's original settings; skip-existing-files
// means only failed or newly added tracks actually download
const handleRetryJob = async (job) => {
  try {
    await ytdlp.submitJob({
      url: job.url,
      outputDirectory: job.outputDirectory,
      audioFormat: job.audioFormatOverride,
      audioQuality: job.audioQualityOverride,
      defaultGenre: job.defaultGenreOverride,
      minTrackDurationSeconds: job.minTrackDurationSecondsOverride,
      maxTrackDurationSeconds: job.maxTrackDurationSecondsOverride,
    });
    toast.success(`Re-running: ${job.title || job.url}`);
  } catch (error) {
    toast.error(`Retry failed: ${error.response?.data || error.message}`);
  }
};

const handleRemoveJob = async (jobId) => {
  try {
    await ytdlp.removeJob(jobId);
  } catch (error) {
    toast.error(`Remove failed: ${error.message}`);
  }
};

const handleCancelJob = async (jobId) => {
  try {
    await ytdlp.cancelJob(jobId);
  } catch (error) {
    toast.error(`Stop failed: ${error.message}`);
  }
};

const handlePauseJob = async (jobId) => {
  try {
    await ytdlp.pauseJob(jobId);
  } catch (error) {
    toast.error(`Pause failed: ${error.message}`);
  }
};

const handleResumeJob = async (jobId) => {
  try {
    await ytdlp.resumeJob(jobId);
  } catch (error) {
    toast.error(`Resume failed: ${error.message}`);
  }
};

const handleRetryFailed = async (jobId) => {
  try {
    await ytdlp.retryFailedTracks(jobId);
  } catch (error) {
    toast.error(`Retry failed: ${error.message}`);
  }
};

const handleRetryTags = async (trackId) => {
  try {
    await ytdlp.retryTags(trackId);
  } catch (error) {
    toast.error(`Retry tags failed: ${error.message}`);
  }
};

const handleReconcileJob = async (jobId) => {
  try {
    await ytdlp.reconcileJob(jobId);
  } catch (error) {
    toast.error(`Recheck failed: ${error.message}`);
  }
};

const YtDlp = ({ view }) => {
  const history = useHistory();
  const isSearchView = view !== 'downloads';
  const [activeTab, setActiveTab] = useState('downloads');
  const [jobs, setJobs] = useState([]);
  const [jobLogs, setJobLogs] = useState({});
  const [events, setEvents] = useState([]);
  const [unseenErrors, setUnseenErrors] = useState(0);
  const hubRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const handleJobs = useCallback((incoming) => {
    if (!mountedRef.current) return;
    setJobs(Array.isArray(incoming) ? incoming : []);
  }, []);

  // Optimistically upsert a freshly-submitted job so it shows immediately,
  // without waiting on the JOBS broadcast (client-side nav never re-runs the
  // hub's OnConnectedAsync, so a dropped broadcast would otherwise leave the
  // list stale until a full page refresh). ListJobs orders newest-first.
  const mergeJob = useCallback((job) => {
    if (!mountedRef.current || !job?.id) return;
    setJobs((previous) =>
      previous.some((j) => j.id === job.id)
        ? previous.map((j) => (j.id === job.id ? { ...j, ...job } : j))
        : [job, ...previous],
    );
  }, []);

  const handleTrackProgress = useCallback((track) => {
    if (!mountedRef.current) return;
    setJobs((previous) =>
      previous.map((index) => {
        if (index.id !== track.jobId) return index;
        return {
          ...index,
          _tracks: (index._tracks || []).map((t) =>
            t.id === track.id ? { ...t, ...track } : t,
          ),
        };
      }),
    );
  }, []);

  const handleJobLog = useCallback(({ isError, jobId, line }) => {
    if (!mountedRef.current) return;
    setJobLogs((previous) => {
      const existing = previous[jobId] || [];
      const next = [...existing, { line, isError }];
      return {
        ...previous,
        [jobId]: next.length > 300 ? next.slice(-300) : next,
      };
    });
  }, []);

  const appendEvent = useCallback((event_) => {
    if (!mountedRef.current) return;
    setEvents((previous) => {
      const next = [...previous, event_];
      return next.length > EVENT_BUFFER_MAX
        ? next.slice(-EVENT_BUFFER_MAX)
        : next;
    });
    if (event_.level === 'error') {
      setUnseenErrors((n) => n + 1);
    }
  }, []);

  const handleEventSnapshot = useCallback((snapshot) => {
    if (!mountedRef.current) return;
    setEvents(Array.isArray(snapshot) ? snapshot.slice(-EVENT_BUFFER_MAX) : []);
  }, []);

  useEffect(() => {
    const hub = createYtDlpHubConnection();
    hubRef.current = hub;

    hub.on('JOBS', handleJobs);
    hub.on('TRACK_PROGRESS', handleTrackProgress);
    hub.on('JOB_LOG', handleJobLog);
    hub.on('EVENT', appendEvent);
    hub.on('EVENT_SNAPSHOT', handleEventSnapshot);

    hub.start().catch((error) => {
      if (mountedRef.current) toast.error(`YtDlp hub error: ${error.message}`);
    });

    return () => {
      hub.stop();
    };
  }, [
    appendEvent,
    handleEventSnapshot,
    handleJobLog,
    handleJobs,
    handleTrackProgress,
  ]);

  const tagErrorCount = jobs.reduce(
    (n, index) => n + (index.tagFailedTracks || 0),
    0,
  );

  const handleTabChange = (tabId) => {
    if (tabId === 'events') setUnseenErrors(0);
    setActiveTab(tabId);
  };

  const handleSubmit = async (parameters) => {
    try {
      const res = await ytdlp.submitJob(parameters);
      mergeJob(res.data);
      history.push(`${urlBase}/ytdlp/downloads`);
    } catch (error) {
      toast.error(`Failed to submit: ${error.response?.data || error.message}`);
    }
  };

  // Stays on the search page so more results can be queued; the job is merged
  // into state immediately and is visible on the Downloads page
  const handleSearchDownload = useCallback(
    async (result, duration) => {
      try {
        const res = await ytdlp.submitJob({
          url: result.url,
          ...DURATION_FILTERS[duration],
        });
        mergeJob(res.data);
        toast.success(`Added: ${result.title}`);
      } catch (error) {
        toast.error(`Failed: ${error.response?.data || error.message}`);
      }
    },
    [mergeJob],
  );

  const renderPanel = () => {
    if (activeTab === 'downloads')
      return (
        <JobList
          jobLogs={jobLogs}
          jobs={jobs}
          onCancel={handleCancelJob}
          onPause={handlePauseJob}
          onReconcile={handleReconcileJob}
          onRemove={handleRemoveJob}
          onResume={handleResumeJob}
          onRetryFailed={handleRetryFailed}
          onRetryJob={handleRetryJob}
          onRetryTags={handleRetryTags}
        />
      );
    if (activeTab === 'events')
      return (
        <EventsPane
          events={events}
          onClear={() => setEvents([])}
        />
      );
    if (activeTab === 'tag-errors')
      return (
        <TagErrorList
          jobs={jobs}
          onRetryTags={handleRetryTags}
        />
      );
    return null;
  };

  if (isSearchView) {
    return (
      <div className="ytdlp-root">
        <div className="ytdlp-panel">
          <SearchPane onDownload={handleSearchDownload} />
          <div className="ytdlp-section-divider">Add by URL</div>
          <AddPane onSubmit={handleSubmit} />
        </div>
      </div>
    );
  }

  return (
    <div className="ytdlp-root">
      <div className="ytdlp-tabs">
        {TABS.map(({ icon: Icon, id, label }) => {
          const badge =
            id === 'tag-errors'
              ? tagErrorCount
              : id === 'events'
                ? unseenErrors
                : 0;
          return (
            <button
              className={`ytdlp-tab${activeTab === id ? ' ytdlp-tab--active' : ''}`}
              key={id}
              onClick={() => handleTabChange(id)}
              type="button"
            >
              <Icon
                size={14}
                strokeWidth={1.75}
              />
              {label}
              {badge > 0 && <span className="ytdlp-tab-badge">{badge}</span>}
            </button>
          );
        })}
      </div>
      <div className="ytdlp-panel">{renderPanel()}</div>
    </div>
  );
};

export default YtDlp;
