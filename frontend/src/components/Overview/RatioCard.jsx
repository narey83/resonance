// <copyright file="RatioCard.jsx" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import {
  tooltipContentStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from '../../lib/chartTheme';
import { formatBytes, parseUtcDate } from '../../lib/util';
import React, { useMemo } from 'react';
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

const sumBytes = (directionData) =>
  (directionData?.Succeeded ?? directionData?.succeeded)?.totalBytes ?? 0;

// Build a per-interval upload/download ratio sparkline from the histogram.
const buildTrend = (histogram) => {
  if (!histogram || typeof histogram !== 'object') return [];
  return Object.entries(histogram)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, directions]) => {
      const dl = sumBytes(directions.Download ?? directions.download);
      const ul = sumBytes(directions.Upload ?? directions.upload);
      // log2 ratio: 0 = balanced, positive = net giver, negative = net taker
      const ratio = dl > 0 && ul > 0 ? Math.log2(ul / dl) : 0;
      return { date: parseUtcDate(timestamp).getTime(), ratio };
    });
};

const RatioCard = ({ histogram, summary }) => {
  const dlBytes = summary ? sumBytes(summary.Download ?? summary.download) : 0;
  const ulBytes = summary ? sumBytes(summary.Upload ?? summary.upload) : 0;
  const ratio = dlBytes > 0 ? ulBytes / dlBytes : null;

  const trend = useMemo(() => buildTrend(histogram), [histogram]);

  const ulPct =
    dlBytes + ulBytes > 0 ? (ulBytes / (dlBytes + ulBytes)) * 100 : 50;

  const verdict =
    ratio == null
      ? '—'
      : ratio >= 1.05
        ? 'Net giver'
        : ratio <= 0.95
          ? 'Net taker'
          : 'Balanced';

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Share Ratio</span>
        <span className="ratio-verdict">{verdict}</span>
      </div>
      <div className="ratio-body">
        <div className="ratio-headline">
          <span className="ratio-value">
            {ratio == null ? '—' : ratio.toFixed(2)}
          </span>
          <span className="ratio-caption">uploaded ÷ downloaded</span>
        </div>

        <div className="ratio-balance-track">
          <div
            className="ratio-balance-ul"
            style={{ width: `${ulPct}%` }}
          />
        </div>
        <div className="ratio-balance-labels">
          <span className="ratio-up">↑ {formatBytes(ulBytes)}</span>
          <span className="ratio-down">↓ {formatBytes(dlBytes)}</span>
        </div>

        {trend.length > 1 && (
          <ResponsiveContainer
            height={48}
            width="100%"
          >
            <AreaChart
              data={trend}
              margin={{ bottom: 0, left: 0, right: 0, top: 4 }}
            >
              <defs>
                <linearGradient
                  id="ratioFill"
                  x1="0"
                  x2="0"
                  y1="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor="var(--success)"
                    stopOpacity={0.4}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--success)"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <ReferenceLine
                stroke="var(--border)"
                strokeDasharray="2 2"
                y={0}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                formatter={(v) => [`${(2 ** v).toFixed(2)}×`, 'ratio']}
                itemStyle={tooltipItemStyle}
                labelFormatter={() => ''}
                labelStyle={tooltipLabelStyle}
              />
              <Area
                dataKey="ratio"
                fill="url(#ratioFill)"
                isAnimationActive={false}
                stroke="var(--success)"
                strokeWidth={1.5}
                type="monotone"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default RatioCard;
