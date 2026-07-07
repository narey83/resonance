import '../System.css';
import { createLogsHubConnection } from '../../../lib/hubFactory';
import { getLogs } from '../../../lib/logs';
import { parseUtcDate } from '../../../lib/util';
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

const LEVEL_ORDER = ['Debug', 'Information', 'Warning', 'Error'];

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

const LogRow = ({ expanded, log, messageFilter, onToggle, regexMode }) => {
  const level = (log.level ?? 'information').toLowerCase();
  return (
    <div
      className={`logs-row logs-row--${level}${log.exception ? ' logs-row--has-exception' : ''}`}
    >
      <div className="logs-row-ts">{formatTimestamp(log.timestamp)}</div>
      <div className="logs-row-lvl">{LEVEL_LABELS[log.level] ?? log.level}</div>
      <div
        className="logs-row-ctx"
        title={log.context}
      >
        {log.context}
      </div>
      <div className="logs-row-msg">
        {highlight(log.message, messageFilter, regexMode)}
        {log.exception && (
          <button
            className="logs-exception-toggle"
            onClick={onToggle}
            type="button"
          >
            {expanded ? '▾ hide' : '▸ exception'}
          </button>
        )}
        {expanded && log.exception && (
          <pre className="logs-exception-detail">{log.exception}</pre>
        )}
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
        <span className="logs-card-level">
          {LEVEL_LABELS[log.level] ?? log.level}
        </span>
        <span className="logs-card-ts">{formatTimestamp(log.timestamp)}</span>
        {log.context && <span className="logs-card-ctx">{log.context}</span>}
        <CopyButton log={log} />
      </div>
      <div className="logs-card-msg">
        {highlight(log.message, messageFilter, regexMode)}
        {log.exception && (
          <button
            className="logs-exception-toggle"
            onClick={onToggle}
            type="button"
          >
            {expanded ? '▾ hide' : '▸ exception'}
          </button>
        )}
        {expanded && log.exception && (
          <pre className="logs-exception-detail">{log.exception}</pre>
        )}
      </div>
    </div>
  );
};

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
  const [activeContexts, setActiveContexts] = useState([]);
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filtered = useMemo(() => {
    let compiledRe = null;
    let reError = false;
    if (regexMode && messageFilter) {
      try {
        compiledRe = new RegExp(messageFilter, 'i');
      } catch {
        reError = true;
      }
    }

    return logs.filter((log) => {
      if (!levels[log.level]) return false;

      if (activeContexts.length > 0 && !activeContexts.includes(log.context))
        return false;

      if (messageFilter) {
        if (regexMode) return !reError && compiledRe?.test(log.message ?? '');
        return (log.message ?? '')
          .toLowerCase()
          .includes(messageFilter.toLowerCase());
      }

      return true;
    });
  }, [activeContexts, levels, logs, messageFilter, regexMode, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const desktopVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 22,
    overscan: 12,
    measureElement:
      typeof window !== 'undefined'
        ? (el) => el?.getBoundingClientRect().height
        : undefined,
  });

  const mobileVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => mobileScrollRef.current,
    estimateSize: () => 52,
    overscan: 5,
    measureElement:
      typeof window !== 'undefined'
        ? (el) => el?.getBoundingClientRect().height
        : undefined,
  });

  const handleScroll = useCallback(() => {}, []);

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

  const toggleContext = (context) =>
    setActiveContexts((prev) =>
      prev.includes(context)
        ? prev.filter((c) => c !== context)
        : [...prev, context],
    );

  const toggleExpanded = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);

      if (next.has(key)) next.delete(key);
      else next.add(key);

      return next;
    });

  const clearAll = () => {
    setLevels({ Debug: true, Information: true, Warning: true, Error: true });
    setActiveContexts([]);
    setMessageFilter('');
  };

  const hasFilters =
    activeContexts.length > 0 ||
    messageFilter ||
    !Object.values(levels).every(Boolean);

  if (!connected) return <LoaderSegment />;

  return (
    <>
      <div className="logs-toolbar">
        <div className="logs-toolbar-row">
          <div className="logs-chip-group">
            {LEVEL_ORDER.map((level) => (
              <button
                className={`logs-chip logs-chip--mono${levels[level] ? '' : ' logs-chip--off'}`}
                key={level}
                onClick={() => toggleLevel(level)}
                type="button"
              >
                {LEVEL_LABELS[level]}
              </button>
            ))}
          </div>

          <span style={{ flex: 1 }} />

          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            {filtered.length} / {logs.length}
          </span>

          <button
            className={`logs-pause-btn${isPaused ? ' logs-pause-btn--paused' : ''}`}
            onClick={togglePause}
            title={isPaused ? 'Resume live stream' : 'Pause live stream'}
            type="button"
          >
            {isPaused
              ? `▶ Resume${pendingCount > 0 ? ` (${pendingCount})` : ''}`
              : '⏸ Pause'}
          </button>

          {hasFilters && (
            <button
              className="shares-add-btn"
              onClick={clearAll}
              style={{ fontSize: 11 }}
              type="button"
            >
              Clear
            </button>
          )}
        </div>

        {seenContexts.length > 0 && (
          <div className="logs-toolbar-row logs-context-row">
            {seenContexts.map((ctx) => (
              <button
                className={`logs-chip${activeContexts.length > 0 && !activeContexts.includes(ctx) ? ' logs-chip--off' : activeContexts.includes(ctx) ? ' logs-chip--active' : ''}`}
                key={ctx}
                onClick={() => toggleContext(ctx)}
                title={ctx}
                type="button"
              >
                {ctx}
              </button>
            ))}
          </div>
        )}

        <div className="logs-toolbar-row">
          <div className="logs-search-wrap">
            <input
              className={`opt-input logs-search-input${regexError ? ' opt-input--error' : ''}`}
              onChange={(e) => setMessageFilter(e.target.value)}
              placeholder={regexMode ? 'Regex pattern…' : 'Search message…'}
              type="text"
              value={messageFilter}
            />
            <button
              className={`logs-regex-btn${regexMode ? ' logs-regex-btn--on' : ''}`}
              onClick={() => setRegexMode((prev) => !prev)}
              title="Toggle regex mode"
              type="button"
            >
              .*
            </button>
          </div>
        </div>
      </div>

      <div className="logs-col-head logs-col-head--desktop">
        <div className="logs-row-ts">Timestamp</div>
        <div className="logs-row-lvl">Lvl</div>
        <div className="logs-row-ctx">Process</div>
        <div className="logs-row-msg">Message</div>
      </div>

      <div
        className="logs-scroll logs-scroll--desktop"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        <div
          style={{
            height: `${desktopVirtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {desktopVirtualizer.getVirtualItems().map((vRow) => {
            const log = filtered[vRow.index];
            const key = `${log.timestamp}-${log.context}-${log.level}`;
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
                <LogRow
                  expanded={expanded.has(key)}
                  log={log}
                  messageFilter={messageFilter}
                  onToggle={() => toggleExpanded(key)}
                  regexMode={regexMode}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="logs-scroll logs-scroll--mobile"
        onScroll={handleScroll}
        ref={mobileScrollRef}
      >
        <div
          style={{
            height: `${mobileVirtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {mobileVirtualizer.getVirtualItems().map((vRow) => {
            const log = filtered[vRow.index];
            const key = `${log.timestamp}-${log.context}-${log.level}`;
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
                <LogCard
                  expanded={expanded.has(key)}
                  log={log}
                  messageFilter={messageFilter}
                  onToggle={() => toggleExpanded(key)}
                  regexMode={regexMode}
                />
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

  const [levels, setLevels] = useState({
    Debug: true,
    Information: true,
    Warning: true,
    Error: true,
  });
  const [contextFilter, setContextFilter] = useState('');
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

  const filtersRef = useRef({
    contextFilter,
    dateFrom,
    dateTo,
    levels,
    messageFilter,
    regexMode,
  });
  filtersRef.current = {
    contextFilter,
    dateFrom,
    dateTo,
    levels,
    messageFilter,
    regexMode,
  };

  const fetch = async (pg = page) => {
    setLoading(true);

    const {
      contextFilter: ctx,
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
        context: ctx || undefined,
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
    setLevels({ Debug: true, Information: true, Warning: true, Error: true });
    setContextFilter('');
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
    contextFilter ||
    messageFilter ||
    dateFrom ||
    dateTo !== today ||
    !Object.values(levels).every(Boolean);

  return (
    <>
      <div className="logs-toolbar">
        <div className="logs-toolbar-row">
          <div className="logs-chip-group">
            {LEVEL_ORDER.map((level) => (
              <button
                className={`logs-chip logs-chip--mono${levels[level] ? '' : ' logs-chip--off'}`}
                key={level}
                onClick={() => toggleLevel(level)}
                type="button"
              >
                {LEVEL_LABELS[level]}
              </button>
            ))}
          </div>

          <div className="logs-date-range">
            <input
              className="opt-input logs-date-input"
              onChange={(e) => setDateFrom(e.target.value)}
              type="date"
              value={dateFrom}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>to</span>
            <input
              className="opt-input logs-date-input"
              onChange={(e) => setDateTo(e.target.value)}
              type="date"
              value={dateTo}
            />
          </div>

          <span style={{ flex: 1 }} />

          <button
            className="shares-add-btn"
            onClick={applyFilters}
            style={{ fontSize: 11 }}
            type="button"
          >
            Search
          </button>

          {hasFilters && (
            <button
              className="shares-add-btn"
              onClick={clearAll}
              style={{ fontSize: 11 }}
              type="button"
            >
              Clear
            </button>
          )}
        </div>

        <div className="logs-toolbar-row">
          <input
            className="opt-input"
            onChange={(e) => setContextFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            placeholder="Context filter…"
            style={{ fontSize: 11, width: 150 }}
            type="text"
            value={contextFilter}
          />

          <div className="logs-search-wrap">
            <input
              className={`opt-input logs-search-input${regexError ? ' opt-input--error' : ''}`}
              onChange={(e) => setMessageFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              placeholder={regexMode ? 'Regex pattern…' : 'Search message…'}
              type="text"
              value={messageFilter}
            />
            <button
              className={`logs-regex-btn${regexMode ? ' logs-regex-btn--on' : ''}`}
              onClick={() => setRegexMode((prev) => !prev)}
              title="Toggle regex mode"
              type="button"
            >
              .*
            </button>
          </div>
        </div>
      </div>

      <div className="logs-col-head logs-col-head--desktop">
        <div className="logs-row-ts">Timestamp</div>
        <div className="logs-row-lvl">Lvl</div>
        <div className="logs-row-ctx">Process</div>
        <div className="logs-row-msg">Message</div>
      </div>

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
            return (
              <LogRow
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

const Logs = () => {
  const [mode, setMode] = useState('live');

  return (
    <div className="logs">
      <div className="logs-tabs">
        <button
          className={`logs-tab${mode === 'live' ? ' logs-tab--active' : ''}`}
          onClick={() => setMode('live')}
          type="button"
        >
          Live
        </button>
        <button
          className={`logs-tab${mode === 'history' ? ' logs-tab--active' : ''}`}
          onClick={() => setMode('history')}
          type="button"
        >
          History
        </button>
      </div>

      {mode === 'live' && <LiveTab />}
      {mode === 'history' && <HistoryTab />}
    </div>
  );
};

export default Logs;
