import './HourlySummary.css';
import { getLogSummaries } from '../../../lib/logs';
import { summaryBuckets } from './summaryBuckets';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const hourLabel = (hour) =>
  new Date(hour).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    timeZone: 'UTC',
  });

const HourlySummary = () => {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState([]);
  const [state, setState] = useState('idle');
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setState('loading');
    getLogSummaries(days, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setRows(data);
        setState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [days, open]);
  const buckets = useMemo(() => summaryBuckets(rows), [rows]);
  const total = buckets.reduce(
    (sum, row) => sum + row.routine + row.warning + row.error,
    0,
  );
  return (
    <section
      aria-label="Archived log summaries"
      className="log-summary"
    >
      <button
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        type="button"
      >
        {open ? 'Hide' : 'Show'} hourly log summaries
      </button>
      {open && (
        <>
          <div className="log-summary-heading">
            <p>
              Archived counts by hour (UTC). Detailed messages have expired;
              recent raw logs are shown below.
            </p>
            <label>
              History{' '}
              <select
                onChange={(event) => setDays(Number(event.target.value))}
                value={days}
              >
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
            </label>
          </div>
          {state === 'loading' && (
            <p role="status">Loading hourly summaries…</p>
          )}
          {state === 'error' && (
            <p role="status">
              Hourly summaries are unavailable. Raw logs remain available.
            </p>
          )}
          {state === 'ready' &&
            (buckets.length ? (
              <>
                <p>
                  {total.toLocaleString()} archived entries · routine / warnings
                  / errors
                </p>
                <div
                  aria-label={`${total.toLocaleString()} archived entries across ${buckets.length} hourly buckets. Routine entries, warnings and errors are stacked.`}
                  className="log-summary-chart"
                  role="img"
                >
                  <ResponsiveContainer
                    height="100%"
                    width="100%"
                  >
                    <BarChart data={buckets}>
                      <XAxis
                        dataKey="hour"
                        minTickGap={60}
                        tickFormatter={hourLabel}
                      />
                      <YAxis width={60} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--bg-surface)',
                          borderColor: 'var(--border)',
                          color: 'var(--text-primary)',
                        }}
                        labelFormatter={hourLabel}
                      />
                      <Bar
                        dataKey="routine"
                        fill="var(--accent)"
                        isAnimationActive={false}
                        name="Routine"
                        stackId="logs"
                      />
                      <Bar
                        dataKey="warning"
                        fill="#d6a339"
                        isAnimationActive={false}
                        name="Warnings"
                        stackId="logs"
                      />
                      <Bar
                        dataKey="error"
                        fill="#e16b73"
                        isAnimationActive={false}
                        name="Errors"
                        stackId="logs"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <p>
                No archived summaries in this period. Recent messages remain in
                the raw log viewer.
              </p>
            ))}
        </>
      )}
    </section>
  );
};

export default HourlySummary;
