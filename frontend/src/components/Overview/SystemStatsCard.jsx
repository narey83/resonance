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

// Compact process uptime, e.g. "12d 4h", "4h 12m", "12m", "<1m".
const formatUptime = (seconds) => {
  if (seconds == null || seconds < 0) return null;
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
};

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

  const uptime = formatUptime(system.uptimeSeconds);

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
        {uptime && (
          <span
            className="section-card-meta"
            title="Resonance uptime (since last backend start)"
          >
            up {uptime}
          </span>
        )}
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

      {(system.volumes ?? []).length > 0 && (
        <div className="sysstats-storage">
          <div className="sysstats-storage-title">Storage</div>
          {system.volumes.map((volume) => {
            const usedPct =
              volume.totalBytes > 0
                ? (volume.usedBytes / volume.totalBytes) * 100
                : 0;
            const danger = usedPct >= 90;
            return (
              <div
                className="sysstats-volume"
                key={volume.name}
                title={`${formatBytes(volume.totalBytes - volume.usedBytes)} free`}
              >
                <span className="sysstats-name">{volume.name}</span>
                <div className="sysstats-volume-track">
                  <div
                    className={`sysstats-volume-fill${danger ? ' danger' : ''}`}
                    style={{ width: `${Math.min(usedPct, 100)}%` }}
                  />
                </div>
                <span className="sysstats-volume-label">
                  {formatBytes(volume.usedBytes)} /{' '}
                  {formatBytes(volume.totalBytes)}
                </span>
                <span
                  className={`sysstats-used${danger ? ' danger' : ''} sysstats-volume-pct`}
                >
                  {usedPct.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SystemStatsCard;
