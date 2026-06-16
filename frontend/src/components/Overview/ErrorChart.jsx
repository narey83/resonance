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

const isNotSucceeded = (stateKey) =>
  !stateKey.toLowerCase().includes('succeeded');

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

const transformErrors = (data, intervalMinutes) => {
  if (!data || typeof data !== 'object') return [];

  return Object.entries(data)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, directions]) => {
      const dl = (directions.Download ?? directions.download) || {};
      const ul = (directions.Upload ?? directions.upload) || {};

      const dlFailed = Object.entries(dl)
        .filter(([stateKey]) => isNotSucceeded(stateKey))
        .reduce((sum, [, v]) => sum + (v.count ?? 0), 0);
      const ulFailed = Object.entries(ul)
        .filter(([stateKey]) => isNotSucceeded(stateKey))
        .reduce((sum, [, v]) => sum + (v.count ?? 0), 0);

      return {
        dlFailed,
        name: formatBucketLabel(timestamp, intervalMinutes),
        ulFailed,
      };
    });
};

const ErrorChart = ({ data, intervalMinutes = 60 }) => {
  const [hidden, setHidden] = useState(new Set());

  const toggleSeries = ({ dataKey }) =>
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });

  const chartData = useMemo(
    () => transformErrors(data, intervalMinutes),
    [data, intervalMinutes],
  );

  const hasErrors = chartData.some((d) => d.dlFailed > 0 || d.ulFailed > 0);

  if (!chartData || chartData.length === 0) {
    return (
      <div className="activity-chart-wrap">
        <div className="chart-title">Errors</div>
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
      <div className="chart-title">
        Errors
        {!hasErrors && (
          <span
            style={{
              color: 'var(--success)',
              fontSize: 11,
              fontWeight: 400,
              marginLeft: 8,
            }}
          >
            None in this period
          </span>
        )}
      </div>
      <ResponsiveContainer
        height={160}
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
            dataKey="dlFailed"
            fill="var(--danger)"
            hide={hidden.has('dlFailed')}
            isAnimationActive={false}
            maxBarSize={20}
            name="Download errors"
            radius={[2, 2, 0, 0]}
          />
          <Bar
            dataKey="ulFailed"
            fill="var(--warning)"
            hide={hidden.has('ulFailed')}
            isAnimationActive={false}
            maxBarSize={20}
            name="Upload errors"
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default React.memo(ErrorChart);
