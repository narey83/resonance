import {
  axisTickStyle,
  tooltipContentStyle,
  tooltipCursorStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from '../../lib/chartTheme';
import { parseUtcDate } from '../../lib/util';
import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const getCount = (directionData, state) =>
  (directionData[state] ?? directionData[state?.toLowerCase()])?.count ?? 0;

const formatBucketLabel = (timestamp, intervalMinutes) => {
  const date = parseUtcDate(timestamp);
  if (intervalMinutes <= 60) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  if (intervalMinutes < 1_440) {
    return (
      date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' +
      date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const transformHistogram = (data, intervalMinutes) => {
  if (!data || typeof data !== 'object') return [];

  return Object.entries(data)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, directions]) => {
      const dl = (directions.Download ?? directions.download) || {};
      const ul = (directions.Upload ?? directions.upload) || {};

      const downloads = getCount(dl, 'Succeeded');
      const uploads = getCount(ul, 'Succeeded');
      return {
        downloads,
        name: formatBucketLabel(timestamp, intervalMinutes),
        uploads,
      };
    });
};

const ActivityChart = ({ data, intervalMinutes = 60 }) => {
  const [hidden, setHidden] = useState(new Set());

  const toggleSeries = ({ dataKey }) =>
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });

  const chartData = useMemo(
    () => transformHistogram(data, intervalMinutes),
    [data, intervalMinutes],
  );

  if (!chartData || chartData.length === 0) {
    return (
      <div className="activity-chart-wrap">
        <div className="chart-title">Activity</div>
        <div
          style={{
            alignItems: 'center',
            color: 'var(--text-muted)',
            display: 'flex',
            fontSize: 12,
            fontStyle: 'italic',
            height: 160,
            justifyContent: 'center',
          }}
        >
          No data for this period
        </div>
      </div>
    );
  }

  return (
    <div className="activity-chart-wrap">
      <div className="chart-title">Activity</div>
      <ResponsiveContainer
        height={180}
        width="100%"
      >
        <BarChart
          barGap={2}
          data={chartData}
          margin={{ bottom: 0, left: -20, right: 4, top: 4 }}
        >
          <CartesianGrid
            stroke="var(--border)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="name"
            interval="preserveStartEnd"
            tick={axisTickStyle}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={axisTickStyle}
            tickLine={false}
          />
          <Tooltip
            contentStyle={tooltipContentStyle}
            cursor={tooltipCursorStyle}
            itemStyle={tooltipItemStyle}
            labelStyle={tooltipLabelStyle}
          />
          <Legend
            formatter={(value, entry) => (
              <span style={{ opacity: hidden.has(entry.dataKey) ? 0.35 : 1 }}>
                {value}
              </span>
            )}
            iconSize={8}
            iconType="circle"
            onClick={toggleSeries}
            wrapperStyle={{
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 11,
              paddingTop: 8,
            }}
          />
          <Bar
            dataKey="downloads"
            fill="var(--accent)"
            hide={hidden.has('downloads')}
            isAnimationActive={false}
            maxBarSize={20}
            name="Downloads"
            radius={[2, 2, 0, 0]}
          />
          <Bar
            dataKey="uploads"
            fill="var(--success)"
            hide={hidden.has('uploads')}
            isAnimationActive={false}
            maxBarSize={20}
            name="Uploads"
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default React.memo(ActivityChart);
