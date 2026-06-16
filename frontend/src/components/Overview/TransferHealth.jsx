import {
  tooltipContentStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from '../../lib/chartTheme';
import React from 'react';
import { Cell, Pie, PieChart, Tooltip } from 'recharts';

const STATE_COLORS = {
  Aborted: '#888',
  Cancelled: 'var(--text-muted)',
  Errored: 'var(--danger)',
  Rejected: 'var(--queued)',
  Succeeded: 'var(--success)',
  TimedOut: 'var(--warning)',
};

const cleanException = (message) => {
  if (!message) return 'Unknown error';
  let m = message.trim();
  // Strip "to USER (IP:PORT)" suffix — connection errors with embedded peer details
  m = m.replace(/\s+to\s+\S.*\(\d{1,3}(?:\.\d{1,3}){3}:\d+\)\s*$/u, '').trim();
  // Strip "N bytes from/to IP:PORT: " still present in older stored messages
  m = m.replace(/^\d+\s+bytes\s+(?:from|to)\s+[\d.]+:\d+:\s*/iu, '').trim();
  return m || 'Unknown error';
};

const extractPieData = (summary) => {
  if (!summary) return [];
  const combined = {};
  for (const directionKey of ['Download', 'Upload', 'download', 'upload']) {
    const directionData = summary[directionKey];
    if (!directionData) continue;
    for (const [state, stats] of Object.entries(directionData)) {
      const key = state.charAt(0).toUpperCase() + state.slice(1);
      combined[key] = (combined[key] ?? 0) + (stats.count ?? 0);
    }
  }

  return Object.entries(combined)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
};

const mergeExceptions = (dlExceptions, ulExceptions) =>
  [
    ...(Array.isArray(dlExceptions) ? dlExceptions : []),
    ...(Array.isArray(ulExceptions) ? ulExceptions : []),
  ]
    .reduce((accumulator, item) => {
      const existingItem = accumulator.find(
        (entry) => entry.exception === item.exception,
      );
      if (existingItem) {
        existingItem.count += item.count ?? 0;
      } else {
        accumulator.push({ ...item });
      }

      return accumulator;
    }, [])
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 8);

const TransferHealth = ({ dlExceptions, summary, ulExceptions }) => {
  const pieData = extractPieData(summary);
  const total = pieData.reduce((s, entry) => s + entry.value, 0);
  const allExceptions = mergeExceptions(dlExceptions, ulExceptions);

  return (
    <div className="health-wrap">
      <div className="section-card">
        <div className="section-card-header">
          <span className="section-card-title">Transfer Health</span>
        </div>
        {pieData.length === 0 ? (
          <div
            style={{
              color: 'var(--text-muted)',
              fontStyle: 'italic',
              fontSize: 12,
              padding: '20px 14px',
              textAlign: 'center',
            }}
          >
            No data for this period
          </div>
        ) : (
          <div className="health-chart-area">
            <PieChart
              height={120}
              width={120}
            >
              <Pie
                cx={55}
                cy={55}
                data={pieData}
                dataKey="value"
                innerRadius={32}
                isAnimationActive={false}
                outerRadius={55}
                paddingAngle={2}
              >
                {pieData.map((entry) => (
                  <Cell
                    fill={STATE_COLORS[entry.name] ?? 'var(--text-dim)'}
                    key={entry.name}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={tooltipContentStyle}
                formatter={(value) => [
                  `${value.toLocaleString()} (${total > 0 ? ((value / total) * 100).toFixed(1) : 0}%)`,
                ]}
                itemStyle={tooltipItemStyle}
                labelStyle={tooltipLabelStyle}
              />
            </PieChart>
            <div className="health-legend">
              {pieData.map((entry) => (
                <div
                  className="health-legend-item"
                  key={entry.name}
                >
                  <div
                    className="health-legend-dot"
                    style={{
                      background: STATE_COLORS[entry.name] ?? 'var(--text-dim)',
                    }}
                  />
                  <span className="health-legend-label">{entry.name}</span>
                  <span className="health-legend-count">
                    {entry.value.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="section-card">
        <div className="section-card-header">
          <span className="section-card-title">Top Errors</span>
        </div>
        {allExceptions.length === 0 ? (
          <div className="errors-empty">No errors — looking good!</div>
        ) : (
          <div className="errors-list">
            {allExceptions.map((item) => (
              <div
                className="error-item"
                key={item.exception ?? 'unknown'}
              >
                <span
                  className="error-msg"
                  title={item.exception}
                >
                  {cleanException(item.exception)}
                </span>
                <span className="error-count">
                  ×{(item.count ?? 0).toLocaleString()}
                </span>
                {(item.distinctUsers ?? 0) > 0 && (
                  <span className="error-users">
                    {item.distinctUsers}{' '}
                    {item.distinctUsers === 1 ? 'user' : 'users'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(TransferHealth);
