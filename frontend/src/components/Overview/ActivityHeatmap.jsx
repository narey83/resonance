import { formatBytes } from '../../lib/util';
import React, { useState } from 'react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const METRICS = [
  { key: 'count', label: 'Transfers' },
  { key: 'bytes', label: 'Volume' },
];

const ActivityHeatmap = ({ data }) => {
  const [metric, setMetric] = useState('count');
  const cells = Array.isArray(data) ? data : [];

  // index by `${dow}-${hour}`
  const grid = {};
  let max = 0;
  for (const c of cells) {
    const value = metric === 'bytes' ? c.bytes ?? 0 : c.count ?? 0;
    grid[`${c.dow}-${c.hour}`] = value;
    if (value > max) max = value;
  }

  const intensity = (value) => {
    if (!value || max === 0) return 0;
    // perceptual-ish ramp so low values are still visible
    return 0.12 + 0.88 * Math.sqrt(value / max);
  };

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">
          Activity Heatmap
          <span className="heatmap-window">last 90 days</span>
        </span>
        <div className="section-card-tabs">
          {METRICS.map((m) => (
            <button
              className={`section-tab${metric === m.key ? ' active' : ''}`}
              key={m.key}
              onClick={() => setMetric(m.key)}
              type="button"
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {cells.length === 0 ? (
        <div className="dir-empty">No activity for this period</div>
      ) : (
        <div className="heatmap">
          <div className="heatmap-hours">
            <span className="heatmap-corner" />
            {HOURS.map((h) => (
              <span
                className="heatmap-hour-label"
                key={h}
              >
                {h % 6 === 0 ? `${h}` : ''}
              </span>
            ))}
          </div>
          {DAYS.map((day, dow) => (
            <div
              className="heatmap-row"
              key={day}
            >
              <span className="heatmap-day-label">{day}</span>
              {HOURS.map((h) => {
                const value = grid[`${dow}-${h}`] ?? 0;
                const label =
                  metric === 'bytes'
                    ? formatBytes(value)
                    : `${value.toLocaleString()} transfers`;
                return (
                  <span
                    className="heatmap-cell"
                    key={h}
                    style={{
                      backgroundColor:
                        value > 0
                          ? `color-mix(in srgb, var(--accent) ${intensity(value) * 100}%, transparent)`
                          : 'var(--bg-elevated)',
                    }}
                    title={`${day} ${h}:00 UTC · ${label}`}
                  />
                );
              })}
            </div>
          ))}
          <div className="heatmap-legend">
            <span>UTC</span>
            <span className="heatmap-legend-scale">
              Less
              <span className="heatmap-legend-swatch heatmap-swatch-0" />
              <span className="heatmap-legend-swatch heatmap-swatch-1" />
              <span className="heatmap-legend-swatch heatmap-swatch-2" />
              <span className="heatmap-legend-swatch heatmap-swatch-3" />
              More
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(ActivityHeatmap);
