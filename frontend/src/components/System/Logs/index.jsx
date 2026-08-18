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
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const PER_PAGE = 50;
const TAIL_POLL_INTERVAL_MS = 7_000;
const TAIL_POLL_LIMIT = 200;

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

const dayOf = (ts) => parseUtcDate(ts).toISOString().slice(0, 10);

// The backend has no unique/monotonic id on a log record, so this composite stands in for one —
// used both as the React/virtualizer row key and as the cross-request dedupe key where the live
// tail poll and the scroll-back page fetches overlap at their inclusive from/to boundaries.
const logKey = (log) =>
  `${log.timestamp}|${log.context}|${log.level}|${log.message}`;

const rowKey = (row) =>
  row.type === 'date' ? `date-${row.day}` : logKey(row.log);

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
// subContext carries finer-grained identity (which device, which peer, ...) that would otherwise
// fragment the context registry into one entry per instance if baked into context itself.
const ContextLabel = ({ context, subContext }) => {
  if (!context) return null;

  const split = context.lastIndexOf(' / ');

  const label =
    split === -1 ? (
      <span className="logs-ctx-leaf">{context}</span>
    ) : (
      <>
        <span className="logs-ctx-group">{context.slice(0, split + 3)}</span>
        <span className="logs-ctx-leaf">{context.slice(split + 3)}</span>
      </>
    );

  return (
    <>
      {label}
      {subContext && <span className="logs-ctx-sub"> · {subContext}</span>}
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
  const context = log.subContext
    ? `${log.context ?? ''} · ${log.subContext}`
    : log.context ?? '';
  const parts = [
    `${formatTimestamp(log.timestamp)} [${LEVEL_LABELS[log.level] ?? log.level}] ${context}`,
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
        {formatTimestamp(log.timestamp)}
      </div>
      <div className="logs-row-lvl">
        <span className={`logs-level-tag logs-level-tag--${level}`}>
          {LEVEL_LABELS[log.level] ?? log.level}
        </span>
      </div>
      <div
        className="logs-row-ctx"
        title={
          log.subContext ? `${log.context} · ${log.subContext}` : log.context
        }
      >
        <ContextLabel
          context={log.context}
          subContext={log.subContext}
        />
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
            <ContextLabel
              context={log.context}
              subContext={log.subContext}
            />
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

// Persistent home for the server-side level controls. The in-toolbar notice only appears when a
// filter is being suppressed, so these need somewhere permanent to live.
const ServerLevelMenu = ({ framework, level, onChange }) => {
  const [open, setOpen] = useState(false);
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

  if (!level) return null;

  return (
    <div
      className="logs-ctx-picker"
      ref={rootRef}
    >
      <button
        className="logs-tab hover-fx"
        onClick={() => setOpen((prev) => !prev)}
        title="Minimum level the server records at"
        type="button"
      >
        ⚙ Server: {LEVEL_LABELS[level] ?? level}
      </button>

      {open && (
        <div className="logs-ctx-menu logs-ctx-menu--right">
          <div className="logs-level-menu-section">
            <div className="logs-ctx-group-head">Application level</div>
            <div className="logs-server-level-picker">
              {LEVEL_ORDER.map((option) => (
                <button
                  className={`logs-server-level-btn${level === option ? ' logs-server-level-btn--on' : ''}`}
                  key={option}
                  onClick={() => onChange({ level: option })}
                  type="button"
                >
                  {LEVEL_LABELS[option]}
                </button>
              ))}
            </div>
            <p className="logs-level-menu-hint">
              Anything below this is discarded before it reaches the log, so no
              filter can bring it back.
            </p>
          </div>

          <div className="logs-level-menu-section">
            <div className="logs-ctx-group-head">Framework level</div>
            <div className="logs-server-level-picker">
              {LEVEL_ORDER.map((option) => (
                <button
                  className={`logs-server-level-btn${framework === option ? ' logs-server-level-btn--on' : ''}`}
                  key={option}
                  onClick={() => onChange({ framework: option })}
                  type="button"
                >
                  {LEVEL_LABELS[option]}
                </button>
              ))}
            </div>
            <p className="logs-level-menu-hint">
              ASP.NET, EF Core and SignalR internals. Held at ERR by default —
              they are extremely chatty and will bury the application&apos;s own
              output.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

const ColumnHead = () => (
  <div className="logs-col-head logs-col-head--desktop">
    <div className="logs-row-ts">Timestamp</div>
    <div className="logs-row-lvl">Lvl</div>
    <div className="logs-row-ctx">Context</div>
    <div className="logs-row-msg">Message</div>
  </div>
);

// ─── Logs feed ────────────────────────────────────────────────────────────────

// Shared by every fetch (initial load, scroll-back page, tail poll) — level/context/search
// params are identical across all three; only offset/limit/from/to differ per call site.
const buildLogQueryParams = ({
  activeContexts,
  levels,
  messageFilter,
  regexMode,
}) => {
  const activeLevels = Object.entries(levels)
    .filter(([, on]) => on)
    .map(([name]) => name);

  const allLevels = activeLevels.length === LEVEL_ORDER.length;

  let searchOk = true;

  if (regexMode && messageFilter) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(messageFilter, 'i');
    } catch {
      searchOk = false;
    }
  }

  return {
    context: activeContexts.length > 0 ? activeContexts : undefined,
    level: allLevels ? undefined : activeLevels,
    search: messageFilter && searchOk ? messageFilter : undefined,
  };
};

const LogsFeed = ({ onChangeServerLevel, serverLevel }) => {
  const [levels, setLevels] = useState({ ...ALL_LEVELS_ON });
  const [knownContexts, setKnownContexts] = useState([]);
  const [activeContexts, setActiveContexts] = useState([]);
  const [messageFilter, setMessageFilter] = useState('');
  const [regexMode, setRegexMode] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [entries, setEntries] = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  const scrollRef = useRef(null);
  const mobileScrollRef = useRef(null);
  const entriesRef = useRef([]);
  entriesRef.current = entries;

  const filtersRef = useRef();
  filtersRef.current = {
    activeContexts,
    dateFrom,
    dateTo,
    levels,
    messageFilter,
    regexMode,
  };

  // Everything currently represented in entries + pendingRef, so the tail poll and the
  // scroll-back page fetches never double-insert the record they inclusively overlap on.
  const seenKeysRef = useRef(new Set());
  // Tailed entries that arrived while scrolled away from the top — held back so a live update
  // never yanks the list out from under someone reading older rows.
  const pendingRef = useRef([]);
  const atTopRef = useRef(true);
  const fetchingOlderRef = useRef(false);
  const pollInFlightRef = useRef(false);
  // Bumped on every filter reset; async fetches discard their result if a newer reset has
  // already happened by the time they resolve.
  const generationRef = useRef(0);
  // Consumed by the layout effect below to snap scroll to top only right after a top-prepend —
  // bottom (scroll-back) appends never touch scroll position.
  const pendingTopResetRef = useRef(false);

  const resetScroll = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (mobileScrollRef.current) mobileScrollRef.current.scrollTop = 0;
  };

  const dedupeAndMark = (items) => {
    const fresh = [];

    for (const item of items) {
      const key = logKey(item);
      if (seenKeysRef.current.has(key)) continue;
      seenKeysRef.current.add(key);
      fresh.push(item);
    }

    return fresh;
  };

  const resetAndFetch = async () => {
    const gen = ++generationRef.current;

    seenKeysRef.current = new Set();
    pendingRef.current = [];
    atTopRef.current = true;
    setPendingCount(0);
    setEntries([]);
    setExpanded(new Set());
    setHasMoreOlder(true);
    resetScroll();
    setLoadingInitial(true);

    const { dateFrom: from, dateTo: to } = filtersRef.current;

    try {
      const { logs: items } = await getLogs({
        offset: 0,
        limit: PER_PAGE,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to + 'T23:59:59').toISOString() : undefined,
        ...buildLogQueryParams(filtersRef.current),
      });

      if (gen !== generationRef.current) return;

      setEntries(dedupeAndMark(items));
      setHasMoreOlder(items.length === PER_PAGE);
    } catch {
      if (gen !== generationRef.current) return;
      setEntries([]);
      setHasMoreOlder(false);
    } finally {
      if (gen === generationRef.current) setLoadingInitial(false);
    }
  };

  // Scroll-back: cursor-paginated on the oldest loaded record's timestamp rather than a raw
  // offset, so it stays correct regardless of how many new entries the tail poll has prepended
  // in the meantime. +1 on the limit absorbs the guaranteed one-record overlap at the inclusive
  // `to` boundary; a short page (< limit) means there's nothing further back to load.
  const fetchOlderPage = async () => {
    if (fetchingOlderRef.current) return;
    fetchingOlderRef.current = true;
    const gen = generationRef.current;
    setLoadingOlder(true);

    const { dateFrom: from } = filtersRef.current;
    const oldest = entriesRef.current.at(-1)?.timestamp;

    try {
      const { logs: items } = await getLogs({
        offset: 0,
        limit: PER_PAGE + 1,
        from: from ? new Date(from).toISOString() : undefined,
        to: oldest,
        ...buildLogQueryParams(filtersRef.current),
      });

      if (gen !== generationRef.current) return;

      const fresh = dedupeAndMark(items);
      if (fresh.length > 0) setEntries((prev) => [...prev, ...fresh]);
      setHasMoreOlder(items.length === PER_PAGE + 1);
    } catch {
      if (gen === generationRef.current) setHasMoreOlder(false);
    } finally {
      if (gen === generationRef.current) setLoadingOlder(false);
      // eslint-disable-next-line require-atomic-updates
      fetchingOlderRef.current = false;
    }
  };

  // Tail: polls for anything at-or-newer than the current newest-loaded record (inclusive, so
  // dedupeAndMark drops the re-sent boundary record). Merges straight in while pinned to the
  // top; otherwise queues in pendingRef so a mid-read scroll position never gets disturbed.
  const poll = async () => {
    if (pollInFlightRef.current || entriesRef.current.length === 0) return;
    pollInFlightRef.current = true;
    const gen = generationRef.current;

    const { dateTo: to } = filtersRef.current;
    const newest = entriesRef.current[0]?.timestamp;

    try {
      const { logs: items } = await getLogs({
        offset: 0,
        limit: TAIL_POLL_LIMIT,
        from: newest,
        to: to ? new Date(to + 'T23:59:59').toISOString() : undefined,
        ...buildLogQueryParams(filtersRef.current),
      });

      if (gen !== generationRef.current) return;

      const fresh = dedupeAndMark(items);
      if (fresh.length === 0) return;

      if (atTopRef.current) {
        pendingTopResetRef.current = true;
        setEntries((prev) => [...fresh, ...prev]);
      } else {
        pendingRef.current = [...fresh, ...pendingRef.current];
        setPendingCount((n) => n + fresh.length);
      }
    } catch {
      // transient — the next interval tick retries
    } finally {
      // eslint-disable-next-line require-atomic-updates
      pollInFlightRef.current = false;
    }
  };

  const flushPending = () => {
    const pending = pendingRef.current;
    pendingRef.current = [];
    setPendingCount(0);
    if (pending.length > 0) {
      pendingTopResetRef.current = true;
      setEntries((prev) => [...pending, ...prev]);
    }
  };

  const handleScroll = (e) => {
    const wasAtTop = atTopRef.current;
    atTopRef.current = e.target.scrollTop <= 4;
    if (!wasAtTop && atTopRef.current && pendingRef.current.length > 0) {
      flushPending();
    }
  };

  useLayoutEffect(() => {
    if (!pendingTopResetRef.current) return;
    pendingTopResetRef.current = false;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (mobileScrollRef.current) mobileScrollRef.current.scrollTop = 0;
  }, [entries]);

  useEffect(() => {
    resetAndFetch();
    getLogContexts()
      .then(setKnownContexts)
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = () => {
    resetAndFetch();
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
    setDateTo('');
    setTimeout(() => {
      resetAndFetch();
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
    dateTo ||
    !Object.values(levels).every(Boolean);

  // No client-side re-filtering needed here (unlike the old Live tab) — entries only ever
  // contains records the server already matched against the active filters.
  const levelCounts = useMemo(() => {
    const counts = {};

    for (const log of entries) {
      counts[log.level] = (counts[log.level] ?? 0) + 1;
    }

    return counts;
  }, [entries]);

  // Every context the backend can emit, plus anything loaded that predates the registry.
  const allContexts = useMemo(
    () =>
      [
        ...new Set([
          ...knownContexts,
          ...entries.map((log) => log.context).filter(Boolean),
        ]),
      ].sort((a, b) => a.localeCompare(b)),
    [entries, knownContexts],
  );

  // Flattened list of date separators + log rows, so the virtualizer can measure both.
  const rows = useMemo(() => {
    const out = [];
    let lastDay = null;

    for (const log of entries) {
      const day = dayOf(log.timestamp);

      if (day !== lastDay) {
        out.push({ day, type: 'date' });
        lastDay = day;
      }

      out.push({ log, type: 'log' });
    }

    return out;
  }, [entries]);

  const todayStr = new Date().toISOString().slice(0, 10);
  // A dateTo strictly in the past can never gain a newer match, so tailing simply doesn't poll
  // — an explicit dateTo also has no special-case handling for "stop showing new rows": once
  // wall-clock passes it, poll responses naturally stop matching, same as any other filter.
  const tailingEnabled = !(dateTo && dateTo < todayStr);

  const desktopVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rowKey(rows[index]),
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
    getItemKey: (index) => rowKey(rows[index]),
    estimateSize: (index) => (rows[index]?.type === 'date' ? 26 : 52),
    overscan: 5,
    measureElement:
      typeof window !== 'undefined'
        ? (el) => el?.getBoundingClientRect().height
        : undefined,
  });

  const desktopLastIndex =
    desktopVirtualizer.getVirtualItems().at(-1)?.index ?? -1;
  const mobileLastIndex =
    mobileVirtualizer.getVirtualItems().at(-1)?.index ?? -1;

  // Infinite scroll-back: once the last rendered row is within reach of what's loaded, pull the
  // next page. Fires again automatically once the appended rows push the "end" further out.
  useEffect(() => {
    // rows.length === 0 before the first page has loaded would otherwise satisfy
    // "last index >= rows.length - 1" trivially (-1 >= -1) and fire an unbounded fetch.
    if (!hasMoreOlder || loadingInitial || loadingOlder || rows.length === 0) {
      return;
    }

    if (desktopLastIndex >= rows.length - 1) fetchOlderPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    desktopLastIndex,
    rows.length,
    hasMoreOlder,
    loadingInitial,
    loadingOlder,
  ]);

  useEffect(() => {
    if (!hasMoreOlder || loadingInitial || loadingOlder || rows.length === 0) {
      return;
    }

    if (mobileLastIndex >= rows.length - 1) fetchOlderPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mobileLastIndex,
    rows.length,
    hasMoreOlder,
    loadingInitial,
    loadingOlder,
  ]);

  // Tail poll: skips while the tab is backgrounded (no point paying for a full-file-scan the
  // user can't see), and fires one catch-up poll immediately on becoming visible again rather
  // than waiting out a stale interval.
  useEffect(() => {
    if (!tailingEnabled) return undefined;

    const tick = () => {
      if (!document.hidden) poll();
    };

    const id = setInterval(tick, TAIL_POLL_INTERVAL_MS);

    const onVisible = () => {
      if (!document.hidden) poll();
    };

    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tailingEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only nag when it is actionable: a level is switched on that the server never emits. Either
  // lowering the server level or switching that filter off clears it, so it can't become wallpaper.
  const serverFloor = serverLevel ? LEVEL_ORDER.indexOf(serverLevel) : 0;
  const suppressedLevels = LEVEL_ORDER.filter(
    (level, index) => levels[level] && index < serverFloor,
  );

  const renderScroll = (mobile) => {
    const virtualizer = mobile ? mobileVirtualizer : desktopVirtualizer;
    const Row = mobile ? LogCard : LogRow;

    return (
      <div
        className={`logs-scroll logs-scroll--${mobile ? 'mobile' : 'desktop'}`}
        onScroll={handleScroll}
        ref={mobile ? mobileScrollRef : scrollRef}
      >
        {pendingCount > 0 && (
          <button
            className="logs-jump-latest"
            onClick={flushPending}
            type="button"
          >
            ↑ {pendingCount} new — jump to latest
          </button>
        )}
        {loadingInitial && <LoaderSegment />}
        {!loadingInitial && rows.length === 0 && (
          <div className="logs-history-empty">
            No log entries match the current filters.
          </div>
        )}
        {!loadingInitial && rows.length > 0 && (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((vRow) => {
              const row = rows[vRow.index];
              const key = rowKey(row);
              return (
                <div
                  data-index={vRow.index}
                  key={vRow.key}
                  ref={virtualizer.measureElement}
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
                    <Row
                      expanded={expanded.has(key)}
                      log={row.log}
                      messageFilter={regexError ? '' : messageFilter}
                      onToggle={() => toggleExpanded(key)}
                      regexMode={regexMode}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
        {loadingOlder && (
          <div className="logs-load-more-hint">Loading more…</div>
        )}
      </div>
    );
  };

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
              title="To date (blank = live-tail with no upper bound)"
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

          <span className="logs-toolbar-divider" />

          <span
            className="logs-count"
            title="Entries currently loaded in this session"
          >
            <strong>{entries.length.toLocaleString()}</strong>
          </span>

          <span
            className={`logs-live-dot${tailingEnabled ? '' : ' logs-live-dot--paused'}`}
            title={
              tailingEnabled
                ? 'Tailing live'
                : 'Tailing paused — end date is in the past'
            }
          />
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
                  onClick={() => onChangeServerLevel({ level })}
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

      {renderScroll(false)}
      {renderScroll(true)}
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
  const [exporting, setExporting] = useState(false);
  const [levels, setLevels] = useState({ framework: null, level: null });

  useEffect(() => {
    getLogLevel()
      .then(setLevels)
      .catch(() => {});
  }, []);

  // Optimistic, then reconciled with whatever the server actually applied.
  const changeServerLevel = (patch) => {
    setLevels((prev) => ({ ...prev, ...patch }));
    setLogLevel(patch)
      .then(setLevels)
      .catch(() =>
        getLogLevel()
          .then(setLevels)
          .catch(() => {}),
      );
  };

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
        <span style={{ flex: 1 }} />
        <ServerLevelMenu
          framework={levels.framework}
          level={levels.level}
          onChange={changeServerLevel}
        />
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

      <LogsFeed
        onChangeServerLevel={changeServerLevel}
        serverLevel={levels.level}
      />
    </div>
  );
};

export default Logs;
