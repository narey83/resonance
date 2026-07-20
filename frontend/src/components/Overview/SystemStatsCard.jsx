import {
  tooltipContentStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from '../../lib/chartTheme';
import { formatBytes } from '../../lib/util';
import AppContext from '../AppContext';
import { Cpu } from 'lucide-react';
import React, { useContext, useEffect, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';

// Sparkline history is client-side only: last 40 of the 30-second STATE
// samples, so roughly a 20-minute window. Kept at module scope so switching
// Overview tabs (which unmounts this card) doesn't blank the charts; only a
// full page reload resets it. Samples still only accumulate while mounted.
const MAX_SAMPLES = 40;
const buffers = {};
let lastSample = null;

const Sparkline = ({ color, data, formatter }) => (
  <ResponsiveContainer
    height={36}
    width="100%"
  >
    <AreaChart
      data={data}
      margin={{ bottom: 0, left: 0, right: 0, top: 4 }}
    >
      <defs>
        <linearGradient
          id={`sysFill-${color}`}
          x1="0"
          x2="0"
          y1="0"
          y2="1"
        >
          <stop
            offset="0%"
            stopColor={`var(--${color})`}
            stopOpacity={0.4}
          />
          <stop
            offset="100%"
            stopColor={`var(--${color})`}
            stopOpacity={0}
          />
        </linearGradient>
      </defs>
      <Tooltip
        contentStyle={tooltipContentStyle}
        formatter={formatter}
        itemStyle={tooltipItemStyle}
        labelFormatter={() => ''}
        labelStyle={tooltipLabelStyle}
      />
      <Area
        dataKey="v"
        fill={`url(#sysFill-${color})`}
        isAnimationActive={false}
        stroke={`var(--${color})`}
        strokeWidth={1.5}
        type="monotone"
      />
    </AreaChart>
  </ResponsiveContainer>
);

const SystemStatsCard = () => {
  const { state } = useContext(AppContext);
  const system = state?.system;

  // eslint-disable-next-line react/hook-use-state -- value unused; state only forces a re-render after buffering
  const [, setTick] = useState(0);

  useEffect(() => {
    // STATE broadcasts fire on unrelated changes too; only buffer new samples.
    if (!system?.sampledAt || system.sampledAt === lastSample) {
      return;
    }

    lastSample = system.sampledAt;

    const append = (key, cpu, mem) => {
      const buffer = buffers[key] ?? (buffers[key] = []);
      buffer.push({ cpu: { v: cpu ?? 0 }, mem: { v: mem } });
      if (buffer.length > MAX_SAMPLES) buffer.shift();
    };

    if (system.hostMemoryTotalBytes > 0) {
      append('host', system.hostCpuPercent, system.hostMemoryUsedBytes);
    }

    for (const c of system.containers ?? []) {
      append(c.name, c.cpuPercent, c.memoryUsageBytes);
    }

    setTick((t) => t + 1);
  }, [system]);

  if (!system?.containers?.length && !(system?.hostMemoryTotalBytes > 0)) {
    return null;
  }

  const rows = [
    ...(system.hostMemoryTotalBytes > 0
      ? [
          {
            cpu: system.hostCpuPercent,
            key: 'host',
            mem: system.hostMemoryUsedBytes,
            memLimit: system.hostMemoryTotalBytes,
            name: 'host',
          },
        ]
      : []),
    ...(system.containers ?? []).map((c) => ({
      cpu: c.cpuPercent,
      key: c.name,
      mem: c.memoryUsageBytes,
      memLimit: c.memoryLimitBytes,
      name: c.name,
    })),
  ];

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">
          <Cpu
            size={13}
            strokeWidth={1.75}
          />{' '}
          System Resources
        </span>
      </div>
      <table className="leaderboard-table sysstats-table">
        <thead>
          <tr>
            <th>Service</th>
            <th className="leaderboard-num">CPU</th>
            <th className="sysstats-spark-col">CPU trend</th>
            <th className="leaderboard-num">Memory</th>
            <th className="leaderboard-num">Limit</th>
            <th className="leaderboard-num">Used</th>
            <th className="sysstats-spark-col">Memory trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const buffer = buffers[row.key] ?? [];
            const usedPct =
              row.memLimit > 0 ? (row.mem / row.memLimit) * 100 : null;
            return (
              <tr key={row.key}>
                <td className="sysstats-name">{row.name}</td>
                <td className="leaderboard-num">
                  {row.cpu == null ? '—' : `${row.cpu.toFixed(0)}%`}
                </td>
                <td className="sysstats-spark-col">
                  <Sparkline
                    color="accent"
                    data={buffer.map((s) => s.cpu)}
                    formatter={(v) => [`${v.toFixed(1)}%`, 'cpu']}
                  />
                </td>
                <td className="leaderboard-num">{formatBytes(row.mem)}</td>
                <td className="leaderboard-num">
                  {row.memLimit > 0 ? formatBytes(row.memLimit) : '—'}
                </td>
                <td className="leaderboard-num">
                  {usedPct == null ? (
                    '—'
                  ) : (
                    <span
                      className={
                        usedPct >= 90 ? 'sysstats-used danger' : 'sysstats-used'
                      }
                    >
                      {usedPct.toFixed(0)}%
                    </span>
                  )}
                </td>
                <td className="sysstats-spark-col">
                  <Sparkline
                    color="success"
                    data={buffer.map((s) => s.mem)}
                    formatter={(v) => [formatBytes(v), 'memory']}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default SystemStatsCard;
