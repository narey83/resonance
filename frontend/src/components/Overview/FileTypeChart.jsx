import {
  axisTickStyle,
  tooltipContentStyle,
  tooltipCursorStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from '../../lib/chartTheme';
import React, { useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const AUDIO_EXTENSIONS = new Set([
  'flac',
  'mp3',
  'aac',
  'ogg',
  'opus',
  'wav',
  'aiff',
  'ape',
  'wv',
  'wma',
  'm4a',
  'alac',
  'dsd',
  'dsf',
  'dff',
]);

const FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Audio', value: 'audio' },
  { label: 'Other', value: 'other' },
];

const buildChartData = (counts, filter) => {
  if (!counts || typeof counts !== 'object') return [];
  return Object.entries(counts)
    .map(([extension, count]) => ({ count, ext: extension || '(none)' }))
    .filter(({ ext }) => {
      if (filter === 'audio') return AUDIO_EXTENSIONS.has(ext);
      if (filter === 'other') return !AUDIO_EXTENSIONS.has(ext);
      return true;
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
};

const FileTypeChart = ({ counts }) => {
  const [filter, setFilter] = useState('all');
  const data = buildChartData(counts, filter);

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Shared File Types</span>
        <div className="section-card-tabs">
          {FILTERS.map(({ label, value }) => (
            <button
              className={`section-tab${filter === value ? ' active' : ''}`}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {data.length === 0 ? (
        <div
          style={{
            color: 'var(--text-muted)',
            fontSize: 12,
            fontStyle: 'italic',
            padding: '20px 14px',
            textAlign: 'center',
          }}
        >
          No data available
        </div>
      ) : (
        <ResponsiveContainer
          height={Math.max(120, data.length * 28)}
          width="100%"
        >
          <BarChart
            data={data}
            layout="vertical"
            margin={{ bottom: 0, left: 8, right: 56, top: 4 }}
          >
            <XAxis
              allowDecimals={false}
              tick={axisTickStyle}
              tickLine={false}
              type="number"
            />
            <YAxis
              dataKey="ext"
              tick={axisTickStyle}
              tickLine={false}
              type="category"
              width={44}
            />
            <Tooltip
              contentStyle={tooltipContentStyle}
              cursor={tooltipCursorStyle}
              formatter={(value) => [value.toLocaleString(), 'files']}
              itemStyle={tooltipItemStyle}
              labelStyle={tooltipLabelStyle}
            />
            <Bar
              dataKey="count"
              isAnimationActive={false}
              maxBarSize={16}
              radius={[0, 2, 2, 0]}
            >
              {data.map((entry) => (
                <Cell
                  fill={
                    AUDIO_EXTENSIONS.has(entry.ext)
                      ? 'var(--accent)'
                      : 'var(--text-muted)'
                  }
                  key={entry.ext}
                />
              ))}
              <LabelList
                dataKey="count"
                formatter={(v) => v.toLocaleString()}
                position="right"
                style={{ fill: 'var(--text-muted)', fontSize: 11 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

export default React.memo(FileTypeChart);
