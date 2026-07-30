// <copyright file="index.jsx" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import '../System.css';
import { urlBase } from '../../../config';
import { createLogsHubConnection } from '../../../lib/hubFactory';
import {
  getHttpCaptureHar,
  getLogContexts,
  getLogLevel,
  getLogs,
  setLogLevel,
} from '../../../lib/logs';
import { downloadFile, parseUtcDate } from '../../../lib/util';
import { LoaderSegment } from '../../Shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pagination } from 'semantic-ui-react';

const MAX_LOGS = 500;
const PER_PAGE = 50;

const LEVEL_LABELS = {
  Debug: 'DBG',
  Error: 'ERR',
  Information: 'INF',
  Warning: 'WRN',
};

// Loosest → strictest: doubles as display order and as the severity ramp used to work out
// which levels the server is dropping before they reach a sink.
const LEVEL_ORDER = ['Debug', 'Information', 'Warning', 'Error'];

const ALL_LEVELS_ON = {
  Debug: true,
  Error: true,
  Information: true,
  Warning: true,
};

const escapeRegex = (s) => s.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');

const highlight = (text, pattern, isRegex) => {
  if (!pattern || !text) return text;
  try {
    const re = new RegExp(
      `(${isRegex ? pattern : escapeRegex(pattern)})`,
      'gi',
    );
    const parts = text.split(re);
    if (parts.length === 1) return text;
    return parts.map((part, index) =>
      index % 2 === 1 ? (
        <mark
          className="logs-highlight"
          // eslint-disable-next-line react/no-array-index-key
          key={index}
        >
          {part}
        </mark>
      ) : (
        part
      ),
    );
  } catch {
    return text;
  }
};

const formatTimestamp = (ts) =>
  parseUtcDate(ts)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, 'Z');

// Rows carry the time only; the date lives on a separator row, which buys back the ~90px the
// repeated date used to eat on every single line.
const formatTime = (ts) => parseUtcDate(ts).toISOString().slice(11, 19);

const dayOf = (ts) => parseUtcDate(ts).toISOString().slice(0, 10);

const formatDay = (day) => {
  const today = new Date().toISOString().slice(0, 10);

  if (day === today) return `Today · ${day}`;

  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    weekday: 'short',
    year: 'numeric',
  });
};

// Contexts read as "Group / Leaf". Dimming the group lets the eye scan the part that differs.
const ContextLabel = ({ context }) => {
  if (!context) return null;

  const split = context.lastIndexOf(' / ');

  if (split === -1) return <span className="logs-ctx-leaf">{context}</span>;

  return (
    <>
      <span className="logs-ctx-group">{context.slice(0, split + 3)}</span>
      <span className="logs-ctx-leaf">{context.slice(split + 3)}</span>
    </>
  );
};

const groupContexts = (contexts) => {
  const groups = new Map();

  for (const context of contexts) {
    const split = context.lastIndexOf(' / ');
    const group = split === -1 ? 'General' : context.slice(0, split);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(context);
  }

  return [...groups.entries()].sort(([a], [b]) => {
    if (a === 'General') return -1;
    if (b === 'General') return 1;
    return a.localeCompare(b);
  });
};

// ─── Shared row/card renderers ────────────────────────────────────────────────

const copyLog = (log) => {
  const parts = [
    `${formatTimestamp(log.timestamp)} [${LEVEL_LABELS[log.level] ?? log.level}] ${log.context ?? ''}`,
    log.message ?? '',
  ];

  if (log.exception) parts.push(log.exception);

  navigator.clipboard.writeText(parts.join('\n')).catch(() => {});
};

const CopyButton = ({ log }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    copyLog(log);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <button
      className={`logs-copy-btn${copied ? ' logs-copy-btn--copied' : ''}`}
      onClick={handleCopy}
      title="Copy to clipboard"
      type="button"
    >
      {copied ? '✓' : '⎘'}
    </button>
  );
};

const ExceptionBlock = ({ expanded, log, onToggle }) =>
  log.exception ? (
    <>
      <button
        className={`logs-exception-toggle${expanded ? ' logs-exception-toggle--open' : ''}`}
        onClick={onToggle}
        type="button"
      >
        {expanded ? '▾ hide trace' : '▸ stack trace'}
      </button>
      {expanded && <pre className="logs-exception-detail">{log.exception}</pre>}
    </>
  ) : null;

const LogRow = ({ expanded, log, messageFilter, onToggle, regexMode }) => {
  const level = (log.level ?? 'information').toLowerCase();
  return (
    <div className={`logs-row logs-row--${level}`}>
      <div
        className="logs-row-ts"
        title={formatTimestamp(log.timestamp)}
      >
        {formatTime(log.timestamp)}
      </div>
      <div className="logs-row-lvl">
        <span className={`logs-level-tag logs-level-tag--${level}`}>
          {LEVEL_LABELS[log.level] ?? log.level}
        </span>
      </div>
      <div
        className="logs-row-ctx"
        title={log.context}
      >
        <ContextLabel context={log.context} />
      </div>
      <div className="logs-row-msg">
        {highlight(log.message, messageFilter, regexMode)}
        <ExceptionBlock
          expanded={expanded}
          log={log}
          onToggle={onToggle}
        />
      </div>
      <CopyButton log={log} />
    </div>
  );
};

const LogCard = ({ expanded, log, messageFilter, onToggle, regexMode }) => {
  const level = (log.level ?? 'information').toLowerCase();
  return (
    <div className={`logs-card logs-card--${level}`}>
      <div className="logs-card-meta">
        <span className={`logs-level-tag logs-level-tag--${level}`}>
          {LEVEL_LABELS[log.level] ?? log.level}
        </span>
        <span className="logs-card-ts">{formatTimestamp(log.timestamp)}</span>
        {log.context && (
          <span className="logs-card-ctx">
            <ContextLabel context={log.context} />
          </span>
        )}
        <CopyButton log={log} />
      </div>
      <div className="logs-card-msg">
        {highlight(log.message, messageFilter, regexMode)}
        <ExceptionBlock
          expanded={expanded}
          log={log}
          onToggle={onToggle}
        />
      </div>
    </div>
  );
};

const DateSeparator = ({ day }) => (
  <div className="logs-date-sep">
    <span>{formatDay(day)}</span>
  </div>
);

// ─── Shared toolbar controls ──────────────────────────────────────────────────

const LevelFilter = ({ counts, levels, onToggle, suppressedBelow }) => (
  <div className="logs-level-group">
    {LEVEL_ORDER.map((level) => {
      const on = levels[level];
      const suppressed =
        suppressedBelow !== undefined &&
        LEVEL_ORDER.indexOf(level) < suppressedBelow;

      return (
        <button
          className={`logs-level-pill logs-level-pill--${level.toLowerCase()}${on ? ' logs-level-pill--on' : ''}${suppressed ? ' logs-level-pill--suppressed' : ''}`}
          key={level}
          onClick={() => onToggle(level)}
          title={
            suppressed
              ? `The server is not emitting ${level} events — lower the server level to see them`
              : `${on ? 'Hide' : 'Show'} ${level} events`
          }
          type="button"
        >
          <span className="logs-level-pill-label">{LEVEL_LABELS[level]}</span>
          {counts?.[level] > 0 && (
            <span className="logs-level-pill-count">{counts[level]}</span>
          )}
        </button>
      );
    })}
  </div>
);

// Replaces the old horizontally-scrolling chip strip: every context the backend can emit, grouped
// and searchable, rather than only the handful that happened to land in the buffer.
const ContextPicker = ({ active, all, counts, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onDocumentClick = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };

    const onKey = (e) => e.key === 'Escape' && setOpen(false);

    document.addEventListener('mousedown', onDocumentClick);
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('mousedown', onDocumentClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const matching = query
    ? all.filter((c) => c.toLowerCase().includes(query.toLowerCase()))
    : all;

  const toggle = (context) =>
    onChange(
      active.includes(context)
        ? active.filter((c) => c !== context)
        : [...active, context],
    );

  return (
    <div
      className="logs-ctx-picker"
      ref={rootRef}
    >
      <button
        className={`logs-ctx-trigger hover-fx${active.length > 0 ? ' logs-ctx-trigger--active' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        Contexts
        {active.length > 0 && (
          <span className="logs-ctx-trigger-badge">{active.length}</span>
        )}
        <span className="logs-ctx-trigger-caret">▾</span>
      </button>

      {open && (
        <div className="logs-ctx-menu">
          <div className="logs-ctx-menu-head">
            <input
              /* eslint-disable-next-line jsx-a11y/no-autofocus */
              autoFocus
              className="opt-input logs-ctx-search"
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter contexts…"
              type="text"
              value={query}
            />
            {active.length > 0 && (
              <button
                className="logs-ctx-clear"
                onClick={() => onChange([])}
                type="button"
              >
                Clear
              </button>
            )}
          </div>

          <div className="logs-ctx-menu-body">
            {matching.length === 0 && (
              <div className="logs-ctx-empty">No matching contexts</div>
            )}
            {groupContexts(matching).map(([group, contexts]) => (
              <div
                className="logs-ctx-group-block"
                key={group}
              >
                <div className="logs-ctx-group-head">{group}</div>
                {contexts.map((context) => {
                  const split = context.lastIndexOf(' / ');
                  return (
                    <button
                      className={`logs-ctx-item${active.includes(context) ? ' logs-ctx-item--on' : ''}`}
                      key={context}
                      onClick={() => toggle(context)}
                      type="button"
                    >
                      <span className="logs-ctx-item-check">
                        {active.includes(context) ? '✓' : ''}
                      </span>
                      <span className="logs-ctx-item-name">
                        {split === -1 ? context : context.slice(split + 3)}
                      </span>
                      {counts?.[context] > 0 && (
                        <span className="logs-ctx-item-count">
                          {counts[context]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const SearchBox = ({
  onChange,
  onSubmit,
  regexError,
  regexMode,
  toggleRegex,
  value,
}) => (
  <div className="logs-search-wrap">
    <span className="logs-search-icon">⌕</span>
    <input
      className={`opt-input logs-search-input${regexError ? ' opt-input--error' : ''}`}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onSubmit?.()}
      placeholder={regexMode ? 'Regex pattern…' : 'Search messages…'}
      type="text"
      value={value}
    />
    {value && (
      <button
        className="logs-search-clear"
        onClick={() => onChange('')}
        title="Clear search"
        type="button"
      >
        ✕
      </button>
    )}
    <button
      className={`logs-regex-btn hover-fx${regexMode ? ' logs-regex-btn--on' : ''}`}
      onClick={toggleRegex}
      title="Toggle regex mode"
      type="button"
    >
      .*
    </button>
  </div>
);

const ColumnHead = () => (
  <div className="logs-col-head logs-col-head--desktop">
    <div className="logs-row-ts">Time</div>
    <div className="logs-row-lvl">Lvl</div>
    <div className="logs-row-ctx">Context</div>
    <div className="logs-row-msg">Message</div>
  </div>
);

// ─── Live tab ─────────────────────────────────────────────────────────────────

const LiveTab = () => {
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState([]);
  const [levels, setLevels] = useState({
    Debug: true,
    Information: true,
    Warning: true,
    Error: true,
  });
  const [seenContexts, setSeenContexts] = useState([]);
  const [knownContexts, setKnownContexts] = useState([]);
  const [activeContexts, setActiveContexts] = useState([]);
  const [serverLevel, setServerLevel] = useState(null);
  const [messageFilter, setMessageFilter] = useState('');
  const [regexMode, setRegexMode] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [expanded, setExpanded] = useState(new Set());
  const [tick, setTick] = useState(0);

  const scrollRef = useRef(null);
  const mobileScrollRef = useRef(null);
  const isPausedRef = useRef(false);
  const pendingLogsRef = useRef([]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    getLogContexts()
      .then(setKnownContexts)
      .catch(() => {});
    getLogLevel()
      .then(setServerLevel)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let unmounted = false;
    const logsHub = createLogsHubConnection();

    logsHub.on('buffer', (buffer) => {
      const newLogs = buffer.reverse().slice(0, MAX_LOGS);
      setConnected(true);
      setLogs(newLogs);
      setSeenContexts([
        ...new Set(newLogs.map((l) => l.context).filter(Boolean)),
      ]);
    });

    logsHub.on('log', (log) => {
      setConnected(true);

      if (isPausedRef.current) {
        pendingLogsRef.current = [log, ...pendingLogsRef.current].slice(
          0,
          MAX_LOGS,
        );
        setPendingCount((n) => n + 1);
        return;
      }

      setLogs((prev) => [log, ...prev].slice(0, MAX_LOGS));
      setSeenContexts((prev) =>
        log.context && !prev.includes(log.context)
          ? [...prev, log.context]
          : prev,
      );
    });

    logsHub.onreconnecting(() => setConnected(false));
    logsHub.onclose(() => {
      if (!unmounted) setConnected(false);
    });
    logsHub.onreconnected(() => setConnected(true));
    logsHub.start().catch(() => {});

    const tickInterval = setInterval(() => setTick((t) => t + 1), 10_000);

    return () => {
      unmounted = true;
      clearInterval(tickInterval);
      logsHub.stop().catch(() => {});
    };
  }, []);

  const previousLogsLengthRef = useRef(0);
  useEffect(() => {
    if (!isPaused && logs.length > previousLogsLengthRef.current) {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      if (mobileScrollRef.current) mobileScrollRef.current.scrollTop = 0;
    }

    previousLogsLengthRef.current = logs.length;
  }, [logs.length, isPaused]);

  let regexError = false;

  if (regexMode && messageFilter) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(messageFilter, 'i');
    } catch {
      regexError = true;
    }
  }

  // Matching is split from level/context selection so each pill can show how many entries it
  // *would* reveal — the old UI gave no hint what was hiding behind a disabled filter.
  const matched = useMemo(() => {
    let compiledRe = null;
    let reError = false;
    if (regexMode && messageFilter) {
      try {
        compiledRe = new RegExp(messageFilter, 'i');
      } catch {
        reError = true;
      }
    }

    if (!messageFilter) return logs;

    return logs.filter((log) => {
      if (regexMode) return !reError && compiledRe?.test(log.message ?? '');
      return (log.message ?? '')
        .toLowerCase()
        .includes(messageFilter.toLowerCase());
    });
  }, [logs, messageFilter, regexMode, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const levelCounts = useMemo(() => {
    const counts = {};

    for (const log of matched) {
      if (activeContexts.length > 0 && !activeContexts.includes(log.context))
        continue;
      counts[log.level] = (counts[log.level] ?? 0) + 1;
    }

    return counts;
  }, [activeContexts, matched]);

  const contextCounts = useMemo(() => {
    const counts = {};

    for (const log of matched) {
      if (!levels[log.level] || !log.context) continue;
      counts[log.context] = (counts[log.context] ?? 0) + 1;
    }

    return counts;
  }, [levels, matched]);

  const filtered = useMemo(
    () =>
      matched.filter(
        (log) =>
          levels[log.level] &&
          (activeContexts.length === 0 || activeContexts.includes(log.context)),
      ),
    [activeContexts, levels, matched],
  );

  // Flattened list of date separators + log rows, so the virtualizer can measure both.
  const rows = useMemo(() => {
    const out = [];
    let lastDay = null;

    for (const log of filtered) {
      const day = dayOf(log.timestamp);

      if (day !== lastDay) {
        out.push({ day, type: 'date' });
        lastDay = day;
      }

      out.push({ log, type: 'log' });
    }

    return out;
  }, [filtered]);

  // Every context the backend can emit, plus anything streaming in that predates the registry.
  const allContexts = useMemo(
    () =>
      [...new Set([...knownContexts, ...seenContexts])].sort((a, b) =>
        a.localeCompare(b),
      ),
    [knownContexts, seenContexts],
  );

  const desktopVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.type === 'date' ? 26 : 22),
    overscan: 12,
    measureElement:
      typeof window !== 'undefined'
        ? (el) => el?.getBoundingClientRect().height
        : undefined,
  });

  const mobileVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => mobileScrollRef.current,
    estimateSize: (index) => (rows[index]?.type === 'date' ? 26 : 52),
    overscan: 5,
    measureElement:
      typeof window !== 'undefined'
        ? (el) => el?.getBoundingClientRect().height
        : undefined,
  });

  const jumpToLatest = useCallback(() => {
    const pending = pendingLogsRef.current;
    pendingLogsRef.current = [];

    if (pending.length > 0) {
      setLogs((prev) => [...pending, ...prev].slice(0, MAX_LOGS));
      setSeenContexts((prev) => {
        const newCtxs = pending.map((l) => l.context).filter(Boolean);
        const merged = [...new Set([...newCtxs, ...prev])];
        return merged;
      });
    }

    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (mobileScrollRef.current) mobileScrollRef.current.scrollTop = 0;
    setPendingCount(0);
    setIsPaused(false);
  }, []);

  const togglePause = useCallback(() => {
    if (isPaused) jumpToLatest();
    else setIsPaused(true);
  }, [isPaused, jumpToLatest]);

  const toggleLevel = (level) =>
    setLevels((prev) => ({ ...prev, [level]: !prev[level] }));

  const toggleExpanded = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);

      if (next.has(key)) next.delete(key);
      else next.add(key);

      return next;
    });

  const clearAll = () => {
    setLevels({ ...ALL_LEVELS_ON });
    setActiveContexts([]);
    setMessageFilter('');
  };

  const changeServerLevel = (level) => {
    setServerLevel(level);
    setLogLevel(level).catch(() => getLogLevel().then(setServerLevel));
  };

  const hasFilters =
    activeContexts.length > 0 ||
    messageFilter ||
    !Object.values(levels).every(Boolean);

  // Only nag when it is actionable: a level is switched on that the server never emits. Either
  // lowering the server level or switching that filter off clears it, so it can't become wallpaper.
  const serverFloor = serverLevel ? LEVEL_ORDER.indexOf(serverLevel) : 0;
  const suppressedLevels = LEVEL_ORDER.filter(
    (level, index) => levels[level] && index < serverFloor,
  );

  if (!connected) return <LoaderSegment />;

  return (
    <>
      <div className="logs-toolbar">
        <div className="logs-toolbar-row">
          <LevelFilter
            counts={levelCounts}
            levels={levels}
            onToggle={toggleLevel}
            suppressedBelow={serverLevel ? serverFloor : undefined}
          />

          <ContextPicker
            active={activeContexts}
            all={allContexts}
            counts={contextCounts}
            onChange={setActiveContexts}
          />

          <SearchBox
            onChange={setMessageFilter}
            regexError={regexError}
            regexMode={regexMode}
            toggleRegex={() => setRegexMode((prev) => !prev)}
            value={messageFilter}
          />

          {hasFilters && (
            <button
              className="logs-ghost-btn"
              onClick={clearAll}
              title="Reset all filters"
              type="button"
            >
              Reset
            </button>
          )}

          <span className="logs-toolbar-divider" />

          <span
            className="logs-count"
            title="Matching entries out of those buffered"
          >
            <strong>{filtered.length.toLocaleString()}</strong>
            <span className="logs-count-sep">/</span>
            {logs.length.toLocaleString()}
          </span>

          <span
            className={`logs-live-dot${isPaused ? ' logs-live-dot--paused' : ''}`}
            title={isPaused ? 'Stream paused' : 'Streaming live'}
          />

          <button
            className={`logs-pause-btn${isPaused ? ' logs-pause-btn--paused' : ''}`}
            onClick={togglePause}
            title={isPaused ? 'Resume live stream' : 'Pause live stream'}
            type="button"
          >
            {isPaused
              ? `▶ Resume${pendingCount > 0 ? ` · ${pendingCount}` : ''}`
              : '❚❚ Pause'}
          </button>
        </div>

        {suppressedLevels.length > 0 && (
          <div className="logs-server-level">
            <span className="logs-server-level-text">
              No{' '}
              <b>
                {suppressedLevels
                  .map((level) => LEVEL_LABELS[level])
                  .join(' or ')}
              </b>{' '}
              entries will appear — the server discards everything below{' '}
              <b>{serverLevel}</b> before it is recorded. Lower the server level
              to capture them:
            </span>
            <div className="logs-server-level-picker">
              {LEVEL_ORDER.map((level) => (
                <button
                  className={`logs-server-level-btn${serverLevel === level ? ' logs-server-level-btn--on' : ''}`}
                  key={level}
                  onClick={() => changeServerLevel(level)}
                  type="button"
                >
                  {LEVEL_LABELS[level]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <ColumnHead />

      <div
        className="logs-scroll logs-scroll--desktop"
        ref={scrollRef}
      >
        {rows.length === 0 && (
          <div className="logs-history-empty">
            {logs.length === 0
              ? 'Waiting for log events…'
              : 'No entries match the current filters.'}
          </div>
        )}
        <div
          style={{
            height: `${desktopVirtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {desktopVirtualizer.getVirtualItems().map((vRow) => {
            const row = rows[vRow.index];
            const key =
              row.type === 'date'
                ? `date-${row.day}`
                : `${row.log.timestamp}-${row.log.context}-${row.log.level}`;
            return (
              <div
                data-index={vRow.index}
                key={vRow.key}
                ref={desktopVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${vRow.start}px)`,
                }}
              >
                {row.type === 'date' ? (
                  <DateSeparator day={row.day} />
                ) : (
                  <LogRow
                    expanded={expanded.has(key)}
                    log={row.log}
                    messageFilter={messageFilter}
                    onToggle={() => toggleExpanded(key)}
                    regexMode={regexMode}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="logs-scroll logs-scroll--mobile"
        ref={mobileScrollRef}
      >
        <div
          style={{
            height: `${mobileVirtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {mobileVirtualizer.getVirtualItems().map((vRow) => {
            const row = rows[vRow.index];
            const key =
              row.type === 'date'
                ? `date-${row.day}`
                : `${row.log.timestamp}-${row.log.context}-${row.log.level}`;
            return (
              <div
                data-index={vRow.index}
                key={vRow.key}
                ref={mobileVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${vRow.start}px)`,
                }}
              >
                {row.type === 'date' ? (
                  <DateSeparator day={row.day} />
                ) : (
                  <LogCard
                    expanded={expanded.has(key)}
                    log={row.log}
                    messageFilter={messageFilter}
                    onToggle={() => toggleExpanded(key)}
                    regexMode={regexMode}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

// ─── History tab ──────────────────────────────────────────────────────────────

const HistoryTab = () => {
  const today = new Date().toISOString().slice(0, 10);

  const [levels, setLevels] = useState({ ...ALL_LEVELS_ON });
  const [knownContexts, setKnownContexts] = useState([]);
  const [activeContexts, setActiveContexts] = useState([]);
  const [messageFilter, setMessageFilter] = useState('');
  const [regexMode, setRegexMode] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState(today);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(new Set());

  const filtersRef = useRef();
  filtersRef.current = {
    activeContexts,
    dateFrom,
    dateTo,
    levels,
    messageFilter,
    regexMode,
  };

  const fetch = async (pg = page) => {
    setLoading(true);

    const {
      activeContexts: ctx,
      dateFrom: from,
      dateTo: to,
      levels: lvl,
      messageFilter: msg,
      regexMode: rx,
    } = filtersRef.current;

    const activeLevels = Object.entries(lvl)
      .filter(([, on]) => on)
      .map(([name]) => name);

    const allLevels = activeLevels.length === LEVEL_ORDER.length;

    let reError = false;

    if (rx && msg) {
      try {
        // eslint-disable-next-line no-new
        new RegExp(msg, 'i');
      } catch {
        reError = true;
      }
    }

    try {
      const { logs: items, totalCount: tc } = await getLogs({
        offset: (pg - 1) * PER_PAGE,
        limit: PER_PAGE,
        level: allLevels ? undefined : activeLevels,
        context: ctx.length > 0 ? ctx : undefined,
        search: msg && !reError ? msg : undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to + 'T23:59:59').toISOString() : undefined,
      });

      const tp = Math.ceil(tc / PER_PAGE);
      setResults(items);
      setTotalCount(tc);
      setTotalPages(Number.isNaN(tp) ? 0 : tp);
      setExpanded(new Set());
    } catch {
      setResults([]);
      setTotalCount(0);
      setTotalPages(0);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetch(1);
    setPage(1);
    getLogContexts()
      .then(setKnownContexts)
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePageChange = (_, { activePage }) => {
    setPage(activePage);
    fetch(activePage);
  };

  const applyFilters = () => {
    setPage(1);
    fetch(1);
  };

  const toggleLevel = (level) =>
    setLevels((prev) => ({ ...prev, [level]: !prev[level] }));

  const toggleExpanded = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);

      if (next.has(key)) next.delete(key);
      else next.add(key);

      return next;
    });

  const clearAll = () => {
    setLevels({ ...ALL_LEVELS_ON });
    setActiveContexts([]);
    setMessageFilter('');
    setDateFrom('');
    setDateTo(today);
    setTimeout(() => {
      setPage(1);
      fetch(1);
    }, 0);
  };

  let regexError = false;

  if (regexMode && messageFilter) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(messageFilter, 'i');
    } catch {
      regexError = true;
    }
  }

  const hasFilters =
    activeContexts.length > 0 ||
    messageFilter ||
    dateFrom ||
    dateTo !== today ||
    !Object.values(levels).every(Boolean);

  return (
    <>
      <div className="logs-toolbar">
        <div className="logs-toolbar-row">
          <LevelFilter
            levels={levels}
            onToggle={toggleLevel}
          />

          <ContextPicker
            active={activeContexts}
            all={knownContexts}
            onChange={setActiveContexts}
          />

          <SearchBox
            onChange={setMessageFilter}
            onSubmit={applyFilters}
            regexError={regexError}
            regexMode={regexMode}
            toggleRegex={() => setRegexMode((prev) => !prev)}
            value={messageFilter}
          />

          <div className="logs-date-range">
            <input
              className="opt-input logs-date-input"
              onChange={(e) => setDateFrom(e.target.value)}
              title="From date"
              type="date"
              value={dateFrom}
            />
            <span className="logs-date-sep-text">→</span>
            <input
              className="opt-input logs-date-input"
              onChange={(e) => setDateTo(e.target.value)}
              title="To date"
              type="date"
              value={dateTo}
            />
          </div>

          <button
            className="logs-primary-btn"
            onClick={applyFilters}
            type="button"
          >
            Search
          </button>

          {hasFilters && (
            <button
              className="logs-ghost-btn"
              onClick={clearAll}
              title="Reset all filters"
              type="button"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <ColumnHead />

      <div className="logs-history-body">
        {loading && <LoaderSegment />}
        {!loading && results.length === 0 && (
          <div className="logs-history-empty">
            No log entries match the current filters.
          </div>
        )}
        {!loading &&
          results.map((log, i) => {
            const key = `${log.timestamp}-${log.context}-${log.level}-${i}`;
            const day = dayOf(log.timestamp);
            const newDay = i === 0 || day !== dayOf(results[i - 1].timestamp);
            return (
              <React.Fragment key={key}>
                {newDay && <DateSeparator day={day} />}
                <LogRow
                  expanded={expanded.has(key)}
                  log={log}
                  messageFilter={regexError ? '' : messageFilter}
                  onToggle={() => toggleExpanded(key)}
                  regexMode={regexMode}
                />
              </React.Fragment>
            );
          })}
      </div>

      <div className="logs-history-body logs-history-mobile">
        {loading && <LoaderSegment />}
        {!loading && results.length === 0 && (
          <div className="logs-history-empty">
            No log entries match the current filters.
          </div>
        )}
        {!loading &&
          results.map((log, i) => {
            const key = `${log.timestamp}-${log.context}-${log.level}-${i}`;
            return (
              <LogCard
                expanded={expanded.has(key)}
                key={key}
                log={log}
                messageFilter={regexError ? '' : messageFilter}
                onToggle={() => toggleExpanded(key)}
                regexMode={regexMode}
              />
            );
          })}
      </div>

      <div className="logs-pagination">
        <span className="logs-pagination-count">
          {totalCount.toLocaleString()} {totalCount === 1 ? 'entry' : 'entries'}
        </span>
        {totalPages > 1 && (
          <Pagination
            activePage={page}
            boundaryRange={1}
            ellipsisItem={null}
            firstItem={null}
            lastItem={null}
            onPageChange={handlePageChange}
            siblingRange={2}
            size="mini"
            totalPages={totalPages}
          />
        )}
      </div>
    </>
  );
};

// ─── Root component ───────────────────────────────────────────────────────────

const isPopout = () =>
  typeof window !== 'undefined' &&
  window.location.pathname.replace(/\/$/, '') === `${urlBase}/logs-popup`;

const openPopout = () =>
  window.open(
    `${urlBase}/logs-popup`,
    'resonance-logs',
    'width=1100,height=700,resizable=yes',
  );

const Logs = () => {
  const [mode, setMode] = useState('live');
  const [exporting, setExporting] = useState(false);

  const exportHar = async () => {
    setExporting(true);
    try {
      const blob = await getHttpCaptureHar();
      const stamp = new Date()
        .toISOString()
        .replaceAll(/[:T]/g, '')
        .replace(/\..*$/, '');
      downloadFile(blob, `resonance-backend-${stamp}.har`, 'application/json');
    } catch {
      // surfaced by the global API error handling; nothing actionable here
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="logs">
      <div className="logs-tabs">
        <button
          className={`logs-tab hover-fx${mode === 'live' ? ' logs-tab--active' : ''}`}
          onClick={() => setMode('live')}
          type="button"
        >
          Live
        </button>
        <button
          className={`logs-tab hover-fx${mode === 'history' ? ' logs-tab--active' : ''}`}
          onClick={() => setMode('history')}
          type="button"
        >
          History
        </button>
        <span style={{ flex: 1 }} />
        {!isPopout() && (
          <button
            className="logs-tab hover-fx"
            onClick={openPopout}
            title="Open logs in their own window"
            type="button"
          >
            ⧉ Popout
          </button>
        )}
        <button
          className="logs-tab hover-fx"
          disabled={exporting}
          onClick={exportHar}
          title="Export captured backend HTTP traffic as a HAR file for comparison with the mobile network log"
          type="button"
        >
          {exporting ? 'Exporting…' : '⬇ Export HAR'}
        </button>
      </div>

      {mode === 'live' && <LiveTab />}
      {mode === 'history' && <HistoryTab />}
    </div>
  );
};

export default Logs;
