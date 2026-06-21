import React from 'react';

// New vs returning peers active in the window (by each peer's first-ever transfer).
const PeerRetentionCard = ({ data }) => {
  const newPeers = Number(data?.newPeers ?? 0);
  const returning = Number(data?.returningPeers ?? 0);
  const total = newPeers + returning;
  const newPct = total > 0 ? (newPeers / total) * 100 : 0;

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Audience</span>
        {total > 0 && (
          <span className="peer-total">{total.toLocaleString()} peers</span>
        )}
      </div>
      <div className="coverage-body">
        {total === 0 ? (
          <div className="dir-empty">No peer activity for this period</div>
        ) : (
          <>
            <div className="peer-split-track">
              <div
                className="peer-split-new"
                style={{ width: `${newPct}%` }}
              />
              <div
                className="peer-split-returning"
                style={{ width: `${100 - newPct}%` }}
              />
            </div>
            <div className="peer-legend">
              <span className="peer-legend-item">
                <span className="peer-dot peer-dot-new" />
                <strong>{newPeers.toLocaleString()}</strong> new
              </span>
              <span className="peer-legend-item">
                <span className="peer-dot peer-dot-returning" />
                <strong>{returning.toLocaleString()}</strong> returning
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PeerRetentionCard;
