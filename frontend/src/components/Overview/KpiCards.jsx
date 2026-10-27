// <copyright file="KpiCards.jsx" company="John Narey">
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

import { formatBitrate, formatBytes } from '../../lib/util';
import React from 'react';

const sumBytes = (directionData) =>
  (directionData.Succeeded ?? directionData.succeeded)?.totalBytes ?? 0;

const sumCount = (directionData) =>
  Object.values(directionData).reduce((s, v) => s + (v.count ?? 0), 0);

const succeededOf = (directionData) => {
  const succeeded = directionData.Succeeded ?? directionData.succeeded;
  return succeeded?.count ?? 0;
};

const failedOf = (directionData, succeeded) =>
  sumCount(directionData) - succeeded;

const successRateOf = (count, succeeded) =>
  count > 0 ? ((succeeded / count) * 100).toFixed(1) : null;

const extractKpis = (summary, direction) => {
  if (!summary) return null;

  const dl = summary.Download ?? summary.download ?? {};
  const ul = summary.Upload ?? summary.upload ?? {};

  const dlBytes = sumBytes(dl);
  const ulBytes = sumBytes(ul);
  const dlCount = succeededOf(dl);
  const ulCount = succeededOf(ul);

  const dlSucceeded = succeededOf(dl);
  const ulSucceeded = succeededOf(ul);
  const dlFailed = failedOf(dl, dlSucceeded);
  const ulFailed = failedOf(ul, ulSucceeded);
  const dlSuccessRate = successRateOf(sumCount(dl), dlSucceeded);
  const ulSuccessRate = successRateOf(sumCount(ul), ulSucceeded);

  const dlSucc = dl.Succeeded ?? dl.succeeded;
  const ulSucc = ul.Succeeded ?? ul.succeeded;
  const selected = direction === 'download' ? dlSucc : ulSucc;
  const avgSpeed = direction
    ? selected?.averageSpeed ?? 0
    : ((dlSucc?.averageSpeed ?? 0) + (ulSucc?.averageSpeed ?? 0)) / 2;

  const distinctUsers = direction
    ? selected?.distinctUsers ?? 0
    : Math.max(dlSucc?.distinctUsers ?? 0, ulSucc?.distinctUsers ?? 0);

  const avgWait = direction
    ? selected?.averageWait ?? null
    : dlSucc?.averageWait ?? ulSucc?.averageWait ?? null;

  return {
    avgSpeed,
    avgWait,
    distinctUsers,
    dlBytes,
    dlCount,
    dlFailed,
    dlSuccessRate,
    ulBytes,
    ulCount,
    ulFailed,
    ulSuccessRate,
  };
};

const formatWait = (seconds) => {
  if (seconds == null || seconds === 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)}m`;
};

// Percent change of current vs previous, or null when there's no usable baseline.
const pctChange = (current, previous) => {
  if (previous == null || previous === 0 || current == null) return null;
  return ((current - previous) / previous) * 100;
};

const DeltaBadge = ({ delta }) => {
  if (delta == null || !Number.isFinite(delta) || Math.round(delta) === 0) {
    return null;
  }

  const up = delta > 0;
  return (
    <span className={`kpi-delta${up ? ' kpi-delta-up' : ' kpi-delta-down'}`}>
      {up ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%
    </span>
  );
};

const KpiCard = ({ delta, label, loading, sub, value }) => (
  <div className="kpi-card">
    <div className="kpi-card-label">{label}</div>
    {loading ? (
      <div className="kpi-card-loading" />
    ) : (
      <>
        <div className="kpi-card-value">
          {value}
          <DeltaBadge delta={delta} />
        </div>
        <div
          className="kpi-card-sub"
          style={{ visibility: sub ? 'visible' : 'hidden' }}
        >
          {sub || ' '}
        </div>
      </>
    )}
  </div>
);

const KpiGroupStat = ({ delta, label, loading, sub, value }) => (
  <div className="kpi-group-stat">
    <div className="kpi-card-label">{label}</div>
    {loading ? (
      <div className="kpi-card-loading" />
    ) : (
      <>
        <div className="kpi-card-value">
          {value}
          <DeltaBadge delta={delta} />
        </div>
        <div
          className="kpi-card-sub"
          style={{ visibility: sub ? 'visible' : 'hidden' }}
        >
          {sub || ' '}
        </div>
      </>
    )}
  </div>
);

const KpiGroupCard = ({ primary, secondary }) => (
  <div className="kpi-card kpi-card-group">
    <KpiGroupStat {...primary} />
    <div className="kpi-group-divider" />
    <KpiGroupStat {...secondary} />
  </div>
);

const KpiCards = ({
  direction,
  downloads,
  loading,
  prevSummary,
  summary,
  uploads,
}) => {
  const kpis = extractKpis(summary, direction);
  const prev = extractKpis(prevSummary, direction);

  const activeDownloads = Array.isArray(downloads)
    ? downloads.filter((t) => t.state === 'InProgress')
    : [];
  const activeUploads = Array.isArray(uploads)
    ? uploads.filter((t) => t.state === 'InProgress')
    : [];
  const liveDownSpeed = activeDownloads.reduce(
    (s, t) => s + (t.averageSpeed ?? 0),
    0,
  );
  const liveUpSpeed = activeUploads.reduce(
    (s, t) => s + (t.averageSpeed ?? 0),
    0,
  );

  return (
    <div className="kpi-cards">
      {direction !== 'upload' && (
        <KpiGroupCard
          primary={{
            delta: kpis && prev ? pctChange(kpis.dlBytes, prev.dlBytes) : null,
            label: 'Downloaded',
            loading,
            sub:
              liveDownSpeed > 0
                ? `${formatBitrate(liveDownSpeed)} now`
                : undefined,
            value: kpis ? formatBytes(kpis.dlBytes) : '—',
          }}
          secondary={{
            delta: kpis && prev ? pctChange(kpis.dlCount, prev.dlCount) : null,
            label: 'Successful downloads',
            loading,
            sub:
              kpis?.dlSuccessRate == null
                ? undefined
                : `${kpis.dlSuccessRate}% success · ${kpis.dlFailed.toLocaleString()} failed`,
            value: kpis ? kpis.dlCount.toLocaleString() : '—',
          }}
        />
      )}
      {direction !== 'download' && (
        <KpiGroupCard
          primary={{
            delta: kpis && prev ? pctChange(kpis.ulBytes, prev.ulBytes) : null,
            label: 'Uploaded',
            loading,
            sub:
              liveUpSpeed > 0 ? `${formatBitrate(liveUpSpeed)} now` : undefined,
            value: kpis ? formatBytes(kpis.ulBytes) : '—',
          }}
          secondary={{
            delta: kpis && prev ? pctChange(kpis.ulCount, prev.ulCount) : null,
            label: 'Successful uploads',
            loading,
            sub:
              kpis?.ulSuccessRate == null
                ? undefined
                : `${kpis.ulSuccessRate}% success · ${kpis.ulFailed.toLocaleString()} failed`,
            value: kpis ? kpis.ulCount.toLocaleString() : '—',
          }}
        />
      )}
      {direction && (
        <KpiCard
          label="Failed attempts"
          loading={loading}
          value={
            kpis
              ? (direction === 'download'
                  ? kpis.dlFailed
                  : kpis.ulFailed
                ).toLocaleString()
              : '—'
          }
        />
      )}
      <KpiCard
        label="Peers"
        loading={loading}
        value={kpis ? kpis.distinctUsers.toLocaleString() : '—'}
      />
      <KpiCard
        label="Avg Speed"
        loading={loading}
        value={kpis ? formatBitrate(kpis.avgSpeed) : '—'}
      />
      {!direction && (
        <KpiCard
          label="Avg Queue Wait"
          loading={loading}
          value={kpis ? formatWait(kpis.avgWait) : '—'}
        />
      )}
    </div>
  );
};

export default KpiCards;
