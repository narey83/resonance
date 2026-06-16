import React from 'react';

const truncateDirectory = (path) => {
  if (!path) return '—';
  const separator = path.includes('\\') ? '\\' : '/';
  const parts = path.split(separator).filter(Boolean).slice(1);
  if (parts.length === 0) return path;
  if (parts.length <= 2) return parts.join(separator);
  return `…${separator}${parts.slice(-2).join(separator)}`;
};

const PopularDirectories = ({ directories }) => {
  const list = Array.isArray(directories) ? directories : [];
  const max = list[0]?.distinctUsers ?? 1;

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Popular Directories</span>
      </div>
      {list.length === 0 ? (
        <div className="dir-empty">No upload data for this period</div>
      ) : (
        <div className="dir-list">
          {list.map((item, index) => {
            const pct = Math.max(
              4,
              ((item.distinctUsers ?? 0) / Math.max(max, 1)) * 100,
            );
            return (
              <div
                className="dir-item"
                key={item.directory ?? index}
              >
                <div className="dir-item-header">
                  <span
                    className="dir-name"
                    title={item.directory}
                  >
                    {truncateDirectory(item.directory)}
                  </span>
                  <span className="dir-stats">
                    {(item.distinctUsers ?? 0).toLocaleString()} users
                    {' · '}
                    {(item.count ?? 0).toLocaleString()} files
                  </span>
                </div>
                <div className="dir-bar-track">
                  <div
                    className="dir-bar-fill"
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

export default PopularDirectories;
