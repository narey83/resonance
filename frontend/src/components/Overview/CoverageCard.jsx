import React from 'react';

// Catalog reach: how much of the shared library has ever been uploaded at least once.
const CoverageCard = ({ totalFiles, uploadedFiles }) => {
  const uploaded = Number(uploadedFiles ?? 0);
  const total = Number(totalFiles ?? 0);
  const pct = total > 0 ? Math.min(100, (uploaded / total) * 100) : 0;
  const untouched = Math.max(0, total - uploaded);

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Catalog Reach</span>
      </div>
      <div className="coverage-body">
        {total === 0 ? (
          <div className="dir-empty">No share data available</div>
        ) : (
          <>
            <div className="coverage-headline">
              <span className="coverage-pct">{pct.toFixed(1)}%</span>
              <span className="coverage-caption">
                of your library has been shared at least once
              </span>
            </div>
            <div className="coverage-track">
              <div
                className="coverage-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="coverage-stats">
              <span>
                <strong>{uploaded.toLocaleString()}</strong> shared
              </span>
              <span className="coverage-untouched">
                <strong>{untouched.toLocaleString()}</strong> never touched
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CoverageCard;
