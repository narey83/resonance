import '../System.css';
import { createLogsHubConnection } from '../../../lib/hubFactory';
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

const MAX_LOGS = 500;

const TIME_RANGES = [
  { label: 'All time', value: 0 },
  { label: 'Last 1 min', value: 1 },
  { label: 'Last 5 min', value: 5 },
  { label: 'Last 15 min', value: 15 },
  { label: 'Last 30 min', value: 30 },
  { label: 'Last 1 hr', value: 60 },
];

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

const Logs = () => {
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
  const [timeRange, setTimeRange] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [tick, setTick] = useState(0);

  const scrollRef = useRef(null);
  const mobileScrollRef = useRef(null);
  const timeRangeRef = useRef(timeRange);

  useEffect(() => {
    timeRangeRef.current = timeRange;
  }, [timeRange]);

  useEffect(() => {
    // onclose fires when cleanup stops the hub; don't setState after unmount.
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

    const tickInterval = setInterval(() => {
      if (timeRangeRef.current > 0) setTick((t) => t + 1);
    }, 10_000);

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

  // regexError is computed inline for the input className; also recomputed inside useMemo
  let regexError = false;
  if (regexMode && messageFilter) {
    try {
      // eslint-disable-next-line no-new -- validity probe only
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

    const nowMs = Date.now();
    return logs.filter((log) => {
      if (!levels[log.level]) return false;
      if (activeContexts.length > 0 && !activeContexts.includes(log.context))
        return false;
      if (
        timeRange > 0 &&
        nowMs - parseUtcDate(log.timestamp).getTime() > timeRange * 60_000
      )
        return false;
      if (messageFilter) {
        if (regexMode) return !reError && compiledRe?.test(log.message ?? '');
        return (log.message ?? '')
          .toLowerCase()
          .includes(messageFilter.toLowerCase());
      }

      return true;
    });
  }, [activeContexts, levels, logs, messageFilter, regexMode, tick, timeRange]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleScroll = useCallback((e) => {
    if (e.target.scrollTop > 20) setIsPaused(true);
  }, []);

  const jumpToLatest = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (mobileScrollRef.current) mobileScrollRef.current.scrollTop = 0;
    setIsPaused(false);
  }, []);

  const toggleLevel = (level) =>
    setLevels((prev) => ({ ...prev, [level]: !prev[level] }));

  const toggleContext = (context) =>
    setActiveContexts((prev) =>
      prev.includes(context)
        ? prev.filter((c) => c !== context)
        : [...prev, context],
    );

  const clearAll = () => {
    setLevels({ Debug: true, Information: true, Warning: true, Error: true });
    setActiveContexts([]);
    setMessageFilter('');
    setTimeRange(0);
  };

  const hasFilters =
    activeContexts.length > 0 ||
    messageFilter ||
    timeRange > 0 ||
    !Object.values(levels).every(Boolean);

  return (
    <div className="logs">
      {!connected && <LoaderSegment />}
      {connected && (
        <>
          <div className="logs-toolbar">
            {/* Row 1: level toggles · time range · count · jump · clear */}
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

              <select
                className="opt-select"
                onChange={(e) => setTimeRange(Number(e.target.value))}
                style={{ fontSize: 11, padding: '2px 6px' }}
                value={timeRange}
              >
                {TIME_RANGES.map((r) => (
                  <option
                    key={r.value}
                    value={r.value}
                  >
                    {r.label}
                  </option>
                ))}
              </select>

              <span style={{ flex: 1 }} />

              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                {filtered.length} / {logs.length}
              </span>

              {isPaused && (
                <button
                  className="logs-jump-btn"
                  onClick={jumpToLatest}
                  type="button"
                >
                  ↑ Latest
                </button>
              )}

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

            {/* Row 2: context chips */}
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

            {/* Row 3: message search + regex toggle */}
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

          {/* Column header — desktop only */}
          <div className="logs-col-head logs-col-head--desktop">
            <div className="logs-row-ts">Timestamp</div>
            <div className="logs-row-lvl">Lvl</div>
            <div className="logs-row-ctx">Process</div>
            <div className="logs-row-msg">Message</div>
          </div>

          {/* Virtualized desktop table */}
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
                const level = (log.level ?? 'information').toLowerCase();
                return (
                  <div
                    className={`logs-row logs-row--${level}`}
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
                    <div className="logs-row-ts">
                      {formatTimestamp(log.timestamp)}
                    </div>
                    <div className="logs-row-lvl">
                      {LEVEL_LABELS[log.level] ?? log.level}
                    </div>
                    <div
                      className="logs-row-ctx"
                      title={log.context}
                    >
                      {log.context}
                    </div>
                    <div className="logs-row-msg">
                      {highlight(log.message, messageFilter, regexMode)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Virtualized mobile cards */}
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
                const level = (log.level ?? 'information').toLowerCase();
                return (
                  <div
                    className={`logs-card logs-card--${level}`}
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
                    <div className="logs-card-meta">
                      <span className="logs-card-level">
                        {LEVEL_LABELS[log.level] ?? log.level}
                      </span>
                      <span className="logs-card-ts">
                        {formatTimestamp(log.timestamp)}
                      </span>
                      {log.context && (
                        <span className="logs-card-ctx">{log.context}</span>
                      )}
                    </div>
                    <div className="logs-card-msg">
                      {highlight(log.message, messageFilter, regexMode)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Logs;
