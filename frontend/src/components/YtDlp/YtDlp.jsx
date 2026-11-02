// <copyright file="YtDlp.jsx" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import './YtDlp.css';
import { toast } from '../../lib/activityNotices';
import { createYtDlpHubConnection } from '../../lib/hubFactory';
import * as ytdlp from '../../lib/ytdlp';
import EventsPane from './EventsPane';
import JobList from './JobList';
import SearchPane from './SearchPane';
import SubscriptionsPane from './SubscriptionsPane';
import TagErrorList from './TagErrorList';
import { AlertTriangle, Bell, List, RotateCcw, ScrollText } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

const TABS = [
  { icon: List, id: 'downloads', label: 'Downloads' },
  { icon: Bell, id: 'subscriptions', label: 'Subscriptions' },
  { icon: ScrollText, id: 'events', label: 'Events' },
  { icon: AlertTriangle, id: 'tag-errors', label: 'Tag Errors' },
];

const EVENT_BUFFER_MAX = 1_000;

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

const handleRetryAllFailed = async () => {
  try {
    const res = await ytdlp.retryAllFailed();
    const { jobsRetried } = res.data;
    toast.success(
      jobsRetried > 0
        ? `Retrying failed tracks in ${jobsRetried} job${jobsRetried === 1 ? '' : 's'}`
        : 'No failed tracks to retry',
    );
  } catch (error) {
    toast.error(`Retry all failed: ${error.response?.data || error.message}`);
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

const handleClearEvents = async () => {
  try {
    await ytdlp.clearEvents();
  } catch (error) {
    toast.error(`Clear events failed: ${error.message}`);
  }
};

const handleClearJobEvents = async (jobId) => {
  try {
    await ytdlp.clearJobEvents(jobId);
  } catch (error) {
    toast.error(`Clear events failed: ${error.message}`);
  }
};

const YtDlp = ({ view }) => {
  const isSearchView = view !== 'downloads';
  const [activeTab, setActiveTab] = useState('downloads');
  const [jobs, setJobs] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
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

  const handleSubscriptions = useCallback((incoming) => {
    if (!mountedRef.current) return;
    setSubscriptions(Array.isArray(incoming) ? incoming : []);
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

  // Optimistically drop the job so removal is reflected instantly, independent of the JOBS
  // broadcast (a missed broadcast would otherwise leave the deleted job on screen).
  const handleRemoveJob = useCallback(async (jobId) => {
    setJobs((previous) => previous.filter((j) => j.id !== jobId));
    try {
      await ytdlp.removeJob(jobId);
    } catch (error) {
      toast.error(`Remove failed: ${error.response?.data || error.message}`);
    }
  }, []);

  const handleTrackProgress = useCallback((track) => {
    if (!mountedRef.current) return;
    setJobs((previous) => {
      // Only a job that has its rows loaded in shared state needs a live update.
      // Returning the same array reference when nothing matches lets React skip the
      // re-render, so progress ticks no longer rebuild large virtualized lists.
      let changed = false;
      const next = previous.map((job) => {
        if (job.id !== track.jobId || !job._tracks) return job;
        changed = true;
        return {
          ...job,
          _tracks: job._tracks.map((t) =>
            t.id === track.id ? { ...t, ...track } : t,
          ),
        };
      });
      return changed ? next : previous;
    });
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
    hub.on('SUBSCRIPTIONS', handleSubscriptions);
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
    handleSubscriptions,
    handleTrackProgress,
  ]);

  const tagErrorCount = jobs.reduce(
    (n, index) => n + (index.tagFailedTracks || 0),
    0,
  );

  const failedJobCount = jobs.filter((j) => j.failedTracks > 0).length;

  const handleTabChange = (tabId) => {
    if (tabId === 'events') setUnseenErrors(0);
    setActiveTab(tabId);
  };

  // Subscribe to the channel/playlist of an in-progress download, inheriting the job's settings.
  const handleJobSubscribe = useCallback(async (job) => {
    try {
      await ytdlp.addSubscription({
        channelUrl: job.url,
        audioFormat: job.audioFormatOverride,
        audioQuality: job.audioQualityOverride,
        defaultGenre: job.defaultGenreOverride,
        minTrackDurationSeconds: job.minTrackDurationSecondsOverride,
        maxTrackDurationSeconds: job.maxTrackDurationSecondsOverride,
        convertOnCompletionFormat: job.convertOnCompletionFormatOverride,
        uploadedAfter: job.uploadedAfterOverride,
      });
      toast.success(`Subscribed: ${job.title || job.url}`);
    } catch (error) {
      toast.error(`Subscribe failed: ${error.response?.data || error.message}`);
    }
  }, []);

  const handleSearchSubscribe = useCallback(async (result, overrides) => {
    try {
      await ytdlp.addSubscription({
        channelUrl: result.url,
        ...overrides,
      });
      toast.success(`Subscribed: ${result.title}`);
    } catch (error) {
      toast.error(`Subscribe failed: ${error.response?.data || error.message}`);
    }
  }, []);

  // Stays on the search page so more results can be queued; the job is merged
  // into state immediately and is visible on the Downloads page
  const handleSearchDownload = useCallback(
    async (result, overrides) => {
      try {
        const res = await ytdlp.submitJob({
          url: result.url,
          ...overrides,
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
        <>
          {failedJobCount > 0 && (
            <div className="ytdlp-downloads-toolbar">
              <span className="ytdlp-events-count">
                {failedJobCount} job{failedJobCount === 1 ? '' : 's'} with
                failed tracks
              </span>
              <button
                className="ytdlp-btn hover-fx"
                onClick={handleRetryAllFailed}
                title="Retry every failed track across all jobs"
                type="button"
              >
                <RotateCcw size={13} /> Retry All Failed
              </button>
            </div>
          )}
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
            onSubscribe={handleJobSubscribe}
            subscriptions={subscriptions}
          />
        </>
      );
    if (activeTab === 'subscriptions')
      return <SubscriptionsPane subscriptions={subscriptions} />;
    if (activeTab === 'events')
      return (
        <EventsPane
          events={events}
          onClear={handleClearEvents}
          onClearJob={handleClearJobEvents}
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
      <div className="ytdlp-root ytdlp-root--search">
        <div className="ytdlp-panel">
          <SearchPane
            onDownload={handleSearchDownload}
            onSubscribe={handleSearchSubscribe}
          />
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
              className={`ytdlp-tab hover-fx${activeTab === id ? ' ytdlp-tab--active' : ''}`}
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
