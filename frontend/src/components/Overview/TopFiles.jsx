import React from 'react';

const stripExtension = (name) => name.replace(/\.[^./]+$/, '');

const TopFiles = ({ files }) => {
  const list = Array.isArray(files) ? files.slice(0, 2) : [];
  const max = list[0]?.count ?? 1;

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Top Downloaded Tracks</span>
      </div>
      {list.length === 0 ? (
        <div className="dir-empty">No upload data for this period</div>
      ) : (
        <div className="dir-list">
          {list.map((item, index) => {
            const pct = Math.max(
              4,
              ((item.count ?? 0) / Math.max(max, 1)) * 100,
            );
            const name = stripExtension(item.filename ?? '—');
            return (
              <div
                className="dir-item"
                key={item.filename ?? index}
              >
                <div className="dir-item-header">
                  <span
                    className="dir-name"
                    title={item.filename}
                  >
                    {name}
                  </span>
                  <span className="dir-stats">
                    {(item.count ?? 0).toLocaleString()} downloads
                    {' · '}
                    {(item.distinctUsers ?? 0).toLocaleString()} user
                    {item.distinctUsers !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="dir-bar-track">
                  <div
                    className="dir-bar-fill top-files-bar"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TopFiles;
