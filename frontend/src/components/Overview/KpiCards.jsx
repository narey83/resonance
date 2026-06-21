import { formatBytes } from '../../lib/util';
import React from 'react';

const sumBytes = (directionData) =>
  Object.values(directionData).reduce((s, v) => s + (v.totalBytes ?? 0), 0);

const sumCount = (directionData) =>
  Object.values(directionData).reduce((s, v) => s + (v.count ?? 0), 0);

const succeededOf = (directionData) => {
  const succeeded = directionData.Succeeded ?? directionData.succeeded;
  return succeeded?.count ?? 0;
};

const extractKpis = (summary) => {
  if (!summary) return null;

  const dl = summary.Download ?? summary.download ?? {};
  const ul = summary.Upload ?? summary.upload ?? {};

  const dlBytes = sumBytes(dl);
  const ulBytes = sumBytes(ul);
  const dlCount = sumCount(dl);
  const ulCount = sumCount(ul);
  const totalCount = dlCount + ulCount;
  const totalSucceeded = succeededOf(dl) + succeededOf(ul);
  const successRate =
    totalCount > 0 ? ((totalSucceeded / totalCount) * 100).toFixed(1) : null;

  const dlSucc = dl.Succeeded ?? dl.succeeded;
  const ulSucc = ul.Succeeded ?? ul.succeeded;
  const avgSpeed =
    ((dlSucc?.averageSpeed ?? 0) + (ulSucc?.averageSpeed ?? 0)) / 2;

  const distinctUsers = Math.max(
    dlSucc?.distinctUsers ?? 0,
    ulSucc?.distinctUsers ?? 0,
  );

  const avgWait = dlSucc?.averageWait ?? ulSucc?.averageWait ?? null;

  return {
    avgSpeed,
    avgWait,
    distinctUsers,
    dlBytes,
    successRate,
    totalCount,
    ulBytes,
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

const KpiCards = ({ downloads, loading, prevSummary, summary, uploads }) => {
  const kpis = extractKpis(summary);
  const prev = extractKpis(prevSummary);

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
      <KpiCard
        delta={kpis && prev ? pctChange(kpis.dlBytes, prev.dlBytes) : null}
        label="Downloaded"
        loading={loading}
        sub={
          liveDownSpeed > 0 ? `${formatBytes(liveDownSpeed)}/s now` : undefined
        }
        value={kpis ? formatBytes(kpis.dlBytes) : '—'}
      />
      <KpiCard
        delta={kpis && prev ? pctChange(kpis.ulBytes, prev.ulBytes) : null}
        label="Uploaded"
        loading={loading}
        sub={liveUpSpeed > 0 ? `${formatBytes(liveUpSpeed)}/s now` : undefined}
        value={kpis ? formatBytes(kpis.ulBytes) : '—'}
      />
      <KpiCard
        delta={
          kpis && prev ? pctChange(kpis.totalCount, prev.totalCount) : null
        }
        label="Transfers"
        loading={loading}
        sub={
          kpis?.successRate == null ? undefined : `${kpis.successRate}% success`
        }
        value={kpis ? kpis.totalCount.toLocaleString() : '—'}
      />
      <KpiCard
        label="Peers"
        loading={loading}
        value={kpis ? kpis.distinctUsers.toLocaleString() : '—'}
      />
      <KpiCard
        label="Avg Speed"
        loading={loading}
        value={kpis ? `${formatBytes(kpis.avgSpeed)}/s` : '—'}
      />
      <KpiCard
        label="Avg Queue Wait"
        loading={loading}
        value={kpis ? formatWait(kpis.avgWait) : '—'}
      />
    </div>
  );
};

export default KpiCards;
