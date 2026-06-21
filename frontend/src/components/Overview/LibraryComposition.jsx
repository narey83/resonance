import React, { useMemo, useState } from 'react';

const basename = (path) => {
  if (!path) return '—';
  const parts = path.split(/[/\\]/).filter(Boolean);
  const name = parts[parts.length - 1] ?? path;
  return name.replace(/\.[^./]+$/, '');
};

const TABS = [
  { key: 'genres', label: 'Genres' },
  { key: 'decades', label: 'Decades' },
  { key: 'played', label: 'Most Played' },
];

// Local library composition (what you collect) and listening habits (what you play).
const LibraryComposition = ({ genres, playStats, years }) => {
  const [tab, setTab] = useState('genres');

  const rows = useMemo(() => {
    if (tab === 'genres') {
      return (Array.isArray(genres) ? genres : [])
        .filter((g) => g.genre)
        .map((g) => ({ label: g.genre, value: g.trackCount ?? 0 }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
    }

    if (tab === 'decades') {
      const byDecade = {};
      for (const y of Array.isArray(years) ? years : []) {
        if (!y.year) continue;
        const decade = `${Math.floor(y.year / 10) * 10}s`;
        byDecade[decade] = (byDecade[decade] ?? 0) + (y.trackCount ?? 0);
      }

      return Object.entries(byDecade)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
    }

    return (Array.isArray(playStats) ? playStats : [])
      .map((p) => ({ label: basename(p.path), value: p.playCount ?? 0 }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [genres, playStats, tab, years]);

  const max = rows[0]?.value ?? 1;
  const unit = tab === 'played' ? 'plays' : 'tracks';

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Library</span>
        <div className="section-card-tabs">
          {TABS.map((t) => (
            <button
              className={`section-tab${tab === t.key ? ' active' : ''}`}
              key={t.key}
              onClick={() => setTab(t.key)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="dir-empty">No library data available</div>
      ) : (
        <div className="dir-list">
          {rows.map((r) => {
            const pct = Math.max(4, (r.value / Math.max(max, 1)) * 100);
            return (
              <div
                className="dir-item"
                key={r.label}
              >
                <div className="dir-item-header">
                  <span
                    className="dir-name"
                    title={r.label}
                  >
                    {r.label}
                  </span>
                  <span className="dir-stats">
                    {r.value.toLocaleString()} {unit}
                  </span>
                </div>
                <div className="dir-bar-track">
                  <div
                    className="dir-bar-fill library-bar"
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

export default LibraryComposition;
