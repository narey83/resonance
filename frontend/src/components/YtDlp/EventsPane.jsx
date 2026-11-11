// <copyright file="EventsPane.jsx" company="John Narey">
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

import { parseUtcDate } from '../../lib/util';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';

const LEVEL_COLOR = {
  info: 'var(--text-secondary)',
  success: '#48bb78',
  warning: '#d69e2e',
  error: '#fc8181',
  raw: 'var(--text-muted, #4a5568)',
};

const LEVEL_DOT = {
  info: '#4299e1',
  success: '#48bb78',
  warning: '#d69e2e',
  error: '#fc8181',
  raw: '#4a5568',
};

const untitledJobLabel = (url) => {
  if (!url) return 'Untitled download';
  try {
    const parsed = new URL(url);
    const id =
      parsed.searchParams.get('v') ||
      parsed.searchParams.get('list') ||
      parsed.pathname.split('/').filter(Boolean).pop();
    return id ? `Untitled · ${id}` : `Untitled · ${parsed.hostname}`;
  } catch {
    return 'Untitled download';
  }
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const EventTime = ({ summary = false, timestamp }) => {
  const date = parseUtcDate(timestamp);
  return (
    <time
      className={summary ? 'ytdlp-event-when' : 'ytdlp-event-ts'}
      dateTime={date.toISOString()}
      title={date.toLocaleString()}
    >
      <span className="ytdlp-event-date">{dateFormatter.format(date)}</span>
      <span className="ytdlp-event-time">{timeFormatter.format(date)}</span>
    </time>
  );
};

const useAvailableHeight = (ref) => {
  const [height, setHeight] = useState(400);
  useLayoutEffect(() => {
    const measure = () => {
      if (!ref.current) return;
      const top = ref.current.getBoundingClientRect().top;
      setHeight(Math.max(120, window.innerHeight - top - 16));
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref]);
  return height;
};

const EventRow = ({ ev }) => (
  <div className="ytdlp-event-row">
    <EventTime timestamp={ev.timestamp} />
    <span
      className="ytdlp-event-dot"
      style={{ background: LEVEL_DOT[ev.level] || LEVEL_DOT.raw }}
    />
    <span
      className="ytdlp-event-msg"
      style={{ color: LEVEL_COLOR[ev.level] || LEVEL_COLOR.raw }}
    >
      {ev.message}
    </span>
  </div>
);

const TrackGroup = ({ track }) => {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  const last = track.events.at(-1);
  const hasError = track.events.some((e) => e.level === 'error');
  const hasWarning = track.events.some((e) => e.level === 'warning');

  return (
    <div className="ytdlp-event-track">
      <div
        className="ytdlp-event-track-header"
        onClick={() => setOpen((o) => !o)}
      >
        <Chevron
          size={12}
          strokeWidth={1.75}
        />
        <span
          className="ytdlp-event-dot"
          style={{ background: LEVEL_DOT[last.level] || LEVEL_DOT.raw }}
        />
        <span className="ytdlp-event-track-title">{track.title}</span>
        <span
          className="ytdlp-event-track-summary"
          style={{ color: LEVEL_COLOR[last.level] || LEVEL_COLOR.raw }}
        >
          {last.message}
        </span>
        <EventTime
          summary
          timestamp={last.timestamp}
        />
        {track.events.length > 1 && (
          <span className="ytdlp-event-group-count">{track.events.length}</span>
        )}
        {hasError && <span className="ytdlp-event-group-errors">error</span>}
        {hasWarning && !hasError && (
          <span className="ytdlp-event-group-warns">warning</span>
        )}
      </div>
      {open && (
        <div className="ytdlp-event-track-body">
          {track.events.map((event_, index) => (
            <EventRow
              ev={event_}
              // eslint-disable-next-line react/no-array-index-key
              key={index}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const JobGroup = ({ defaultOpen, group, onClearJob }) => {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;

  // System events (null jobId) have no per-job route — they clear with "Clear all".
  const canClear = onClearJob && group.id !== '__system__';

  return (
    <div className="ytdlp-event-group">
      <div
        className="ytdlp-event-group-header"
        onClick={() => setOpen((o) => !o)}
      >
        <Chevron
          size={13}
          strokeWidth={1.75}
        />
        <span className="ytdlp-event-group-title">{group.title}</span>
        <EventTime
          summary
          timestamp={group.latestTimestamp}
        />
        <span className="ytdlp-event-group-count">{group.count}</span>
        {group.errorCount > 0 && (
          <span className="ytdlp-event-group-errors">
            {group.errorCount} error{group.errorCount > 1 ? 's' : ''}
          </span>
        )}
        {group.warnCount > 0 && !group.errorCount && (
          <span className="ytdlp-event-group-warns">
            {group.warnCount} warning{group.warnCount > 1 ? 's' : ''}
          </span>
        )}
        {canClear && (
          <button
            className="ytdlp-event-group-clear hover-fx"
            onClick={(e) => {
              e.stopPropagation();
              onClearJob(group.id);
            }}
            title="Clear this job's log"
            type="button"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {open && (
        <div className="ytdlp-event-group-body">
          {group.generalEvents.map((event_, index) => (
            <EventRow
              ev={event_}
              // eslint-disable-next-line react/no-array-index-key
              key={index}
            />
          ))}
          {group.trackGroups.map((track) => (
            <TrackGroup
              key={track.title}
              track={track}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const EventsPane = ({ events, jobs = [], onClear, onClearJob }) => {
  const [levelFilter, setLevelFilter] = useState('structured');
  const [activeJob, setActiveJob] = useState('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef(null);
  const endRef = useRef(null);
  const logHeight = useAvailableHeight(logRef);

  const groups = useMemo(() => {
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const eventNames = new Map();
    for (const event_ of events) {
      if (!event_.jobId || !event_.jobTitle) continue;
      const names = eventNames.get(event_.jobId) || {};
      if (/^https?:\/\//iu.test(event_.jobTitle)) {
        names.sourceUrl = event_.jobTitle;
      } else {
        names.title = event_.jobTitle;
      }

      eventNames.set(event_.jobId, names);
    }

    const filtered = events.filter((event_) => {
      if (levelFilter === 'structured' && event_.level === 'raw') return false;
      if (
        levelFilter === 'warnings' &&
        event_.level !== 'warning' &&
        event_.level !== 'error'
      )
        return false;
      if (levelFilter === 'errors' && event_.level !== 'error') return false;
      return true;
    });

    const groupMap = new Map();
    for (const event_ of filtered) {
      const key = event_.jobId || '__system__';
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          id: key,
          generalEvents: [],
          trackMap: new Map(),
          latestTimestamp: event_.timestamp,
          errorCount: 0,
          warnCount: 0,
        });
      }

      const g = groupMap.get(key);
      g.latestTimestamp = event_.timestamp;
      if (event_.level === 'error') g.errorCount++;
      if (event_.level === 'warning') g.warnCount++;

      // Several tracks download concurrently within one job, so their Downloading/ID3/Completed
      // lines interleave in plain chronological order — cluster by track so each one reads as its
      // own thread instead of a shuffled deck (this was confusing enough that a user reported it).
      if (event_.trackTitle) {
        if (!g.trackMap.has(event_.trackTitle)) {
          g.trackMap.set(event_.trackTitle, {
            title: event_.trackTitle,
            events: [],
          });
        }

        g.trackMap.get(event_.trackTitle).events.push(event_);
      } else {
        g.generalEvents.push(event_);
      }
    }

    return Array.from(groupMap.values()).map((g) => {
      const trackGroups = Array.from(g.trackMap.values()).sort((a, b) => {
        const aLast = a.events.at(-1).timestamp;
        const bLast = b.events.at(-1).timestamp;
        return new Date(bLast) - new Date(aLast);
      });
      const count =
        g.generalEvents.length +
        trackGroups.reduce((n, t) => n + t.events.length, 0);
      const job = jobsById.get(g.id);
      const names = eventNames.get(g.id);
      const title =
        (g.id === '__system__' && 'System') ||
        job?.title ||
        names?.title ||
        untitledJobLabel(job?.url || names?.sourceUrl);
      return { ...g, title, trackGroups, count };
    });
  }, [events, jobs, levelFilter]);

  // Fall back to "All" if the selected job's events have aged out of the buffer.
  React.useEffect(() => {
    if (activeJob !== 'all' && !groups.some((g) => g.id === activeJob)) {
      setActiveJob('all');
    }
  }, [groups, activeJob]);

  const visibleGroups =
    activeJob === 'all' ? groups : groups.filter((g) => g.id === activeJob);

  const previousGroupCount = useRef(0);
  React.useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'auto' });
    }

    previousGroupCount.current = groups.reduce((n, g) => n + g.count, 0);
  }, [groups, autoScroll]);

  const handleScroll = (e) => {
    const { clientHeight, scrollHeight, scrollTop } = e.target;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 60);
  };

  const totalEvents = groups.reduce((n, g) => n + g.count, 0);

  return (
    <div className="ytdlp-events-root">
      <div className="ytdlp-events-toolbar">
        <select
          onChange={(e) => setLevelFilter(e.target.value)}
          value={levelFilter}
        >
          <option value="structured">Structured</option>
          <option value="all">All (incl. raw)</option>
          <option value="warnings">Warnings+</option>
          <option value="errors">Errors only</option>
        </select>
        <span className="ytdlp-events-count">
          {totalEvents} events · {groups.length} job
          {groups.length !== 1 ? 's' : ''}
        </span>
        <button
          className="ytdlp-btn hover-fx"
          onClick={onClear}
          title="Clear events"
          type="button"
        >
          <Trash2 size={13} /> Clear
        </button>
      </div>
      {groups.length > 0 && (
        <div className="ytdlp-events-tabs">
          <button
            className={`ytdlp-tab hover-fx${activeJob === 'all' ? ' ytdlp-tab--active' : ''}`}
            onClick={() => setActiveJob('all')}
            type="button"
          >
            All
          </button>
          {groups.map((group) => (
            <button
              className={`ytdlp-tab hover-fx${activeJob === group.id ? ' ytdlp-tab--active' : ''}`}
              key={group.id}
              onClick={() => setActiveJob(group.id)}
              title={group.title}
              type="button"
            >
              {group.title}
              {group.errorCount > 0 && (
                <span className="ytdlp-tab-badge">{group.errorCount}</span>
              )}
            </button>
          ))}
        </div>
      )}
      <div
        className="ytdlp-events-log"
        onScroll={handleScroll}
        ref={logRef}
        style={{ height: logHeight }}
      >
        {groups.length === 0 && (
          <div className="ytdlp-events-empty">
            No events yet. Start a download to see activity here.
          </div>
        )}
        {visibleGroups.map((group) => (
          <JobGroup
            defaultOpen
            group={group}
            key={group.id}
            onClearJob={onClearJob}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
};

export default EventsPane;
