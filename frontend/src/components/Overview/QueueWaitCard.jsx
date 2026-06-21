import React from 'react';

const formatDuration = (seconds) => {
  if (seconds == null || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3_600);
  const m = Math.round((seconds % 3_600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

// How long peers waited in our upload queue before their transfer started.
// The median is the honest "typical" figure; the upper percentiles are dominated
// by remote peers who queue then download later, so they're shown as muted context.
const QueueWaitCard = ({ stats }) => {
  const count = Number(stats?.count ?? 0);
  const tail = [
    { key: 'p90', label: '90th' },
    { key: 'p99', label: '99th' },
    { key: 'max', label: 'Worst' },
  ];

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Upload Queue Wait</span>
        {count > 0 && (
          <span className="queue-count">{count.toLocaleString()} uploads</span>
        )}
      </div>
      {count === 0 ? (
        <div className="dir-empty">No queued uploads for this period</div>
      ) : (
        <div className="queue-body">
          <div className="queue-headline">
            <span className="queue-value">{formatDuration(stats?.p50)}</span>
            <span className="queue-caption">
              typical wait — half of peers start sooner
            </span>
          </div>

          <div className="queue-tail">
            {tail.map((t) => (
              <div
                className="queue-tail-stat"
                key={t.key}
              >
                <span className="queue-tail-value">
                  {formatDuration(stats?.[t.key])}
                </span>
                <span className="queue-tail-label">{t.label} pct</span>
              </div>
            ))}
          </div>

          <p className="queue-note">
            Long waits are mostly remote peers who queue a file then download it
            later — not a local slot limit.
          </p>
        </div>
      )}
    </div>
  );
};

export default QueueWaitCard;
