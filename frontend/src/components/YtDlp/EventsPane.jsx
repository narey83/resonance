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

const fmt = (iso) => {
  const d = parseUtcDate(iso);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
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
    <span className="ytdlp-event-ts">{fmt(ev.timestamp)}</span>
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
        <span className="ytdlp-event-group-count">{group.events.length}</span>
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
          {group.events.map((event_, index) => (
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

const EventsPane = ({ events, onClear, onClearJob }) => {
  const [levelFilter, setLevelFilter] = useState('structured');
  const [activeJob, setActiveJob] = useState('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef(null);
  const endRef = useRef(null);
  const logHeight = useAvailableHeight(logRef);

  const groups = useMemo(() => {
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
          title:
            event_.jobTitle ||
            (key === '__system__' ? 'System' : key.slice(0, 8)),
          events: [],
          errorCount: 0,
          warnCount: 0,
        });
      }

      const g = groupMap.get(key);
      g.events.push(event_);
      if (event_.level === 'error') g.errorCount++;
      if (event_.level === 'warning') g.warnCount++;
    }

    return Array.from(groupMap.values());
  }, [events, levelFilter]);

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

    previousGroupCount.current = groups.reduce(
      (n, g) => n + g.events.length,
      0,
    );
  }, [groups, autoScroll]);

  const handleScroll = (e) => {
    const { clientHeight, scrollHeight, scrollTop } = e.target;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 60);
  };

  const totalEvents = groups.reduce((n, g) => n + g.events.length, 0);

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
