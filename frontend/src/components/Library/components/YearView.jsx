// <copyright file="YearView.jsx" company="John Narey">
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

import * as prefs from '../../../lib/prefs';
import { usePagedTracks } from '../../../lib/usePagedList';
import AlphaFilterChip from './AlphaFilterChip';
import SortButton from './SortButton';
import TrackTable from './TrackTable';
import { ChevronLeft, Play, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

// Hue per decade — eras have recognisable colour associations
const DECADE_HUES = {
  194: 35, // 1940s — warm amber (big band)
  195: 30, // 1950s — golden (rock 'n' roll dawn)
  196: 270, // 1960s — psychedelic purple
  197: 25, // 1970s — funky burnt orange
  198: 320, // 1980s — neon magenta
  199: 150, // 1990s — grunge green
  200: 200, // 2000s — digital blue
  201: 170, // 2010s — teal
  202: 250, // 2020s — electric violet
};

const getYearHue = (year) => {
  const key = Math.floor((year || 2_000) / 10);
  return DECADE_HUES[key] ?? (key * 37) % 360;
};

const yearColor = (hue) => `hsl(${hue} 65% 55%)`;

const YearView = ({
  initialSelected = null,
  loading,
  onContextMenu,
  onPlayYear,
  tileSize = 160,
  viewMode = 'tile',
  years,
}) => {
  const [selected, setSelected] = useState(null);

  // Navigation carries just the year name (see goToGenre/goToYear in Library.jsx),
  // but everything below wants the full row — resolve it against the loaded list.
  useEffect(() => {
    if (initialSelected == null) return;
    setSelected((years ?? []).find((x) => x.year === initialSelected) ?? null);
  }, [initialSelected, years]);
  const {
    clearLetter,
    letter,
    total: trackTotal,
    trackTableProps,
  } = usePagedTracks({ year: selected?.year }, { enabled: Boolean(selected) });
  const [yearFilter, setYearFilter] = useState('');
  const [filterActive, setFilterActive] = useState(false);
  const [sortBy, setSortBy] = useState(() =>
    prefs.get('resonance-years-sort-by', 'year'),
  );
  const [sortDir, setSortDir] = useState(() =>
    prefs.get('resonance-years-sort-dir', 'desc'),
  );

  const setSort = (field) => {
    if (field === sortBy) {
      const next = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(next);
      prefs.set('resonance-years-sort-dir', next);
    } else {
      setSortBy(field);
      const defaultDir = field === 'year' ? 'desc' : 'asc';
      setSortDir(defaultDir);
      prefs.set('resonance-years-sort-by', field);
      prefs.set('resonance-years-sort-dir', defaultDir);
    }
  };

  const filteredYears = useMemo(() => {
    if (!yearFilter) return years;
    return years.filter((y) => String(y.year).includes(yearFilter));
  }, [yearFilter, years]);

  const sortedYears = useMemo(() => {
    const copy = [...filteredYears];
    copy.sort((a, b) => {
      const cmp =
        sortBy === 'tracks'
          ? (a.trackCount ?? 0) - (b.trackCount ?? 0)
          : (a.year ?? 0) - (b.year ?? 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredYears, sortBy, sortDir]);

  if (loading) {
    return (
      <div className="jb-state">
        <div className="jb-spinner" />
        Loading years…
      </div>
    );
  }

  if (!years.length) {
    return (
      <div className="jb-state">
        No year data found. Add year tags to your tracks.
      </div>
    );
  }

  if (selected) {
    const hue = getYearHue(selected.year);
    const color = yearColor(hue);
    return (
      <div className="jb-year-detail">
        <div
          className="jb-year-detail-header"
          style={{
            background: `color-mix(in srgb, ${color} 10%, var(--bg-primary))`,
            borderBottomColor: `color-mix(in srgb, ${color} 25%, var(--border))`,
          }}
        >
          <button
            className="jb-icon-btn"
            onClick={() => setSelected(null)}
            title="Back"
            type="button"
          >
            <ChevronLeft size={16} />
          </button>
          <div style={{ flex: 1 }}>
            <div
              className="jb-year-detail-title"
              style={{ color }}
            >
              {selected.year}
            </div>
            <div className="jb-year-detail-meta">
              {selected.albumCount}{' '}
              {selected.albumCount === 1 ? 'album' : 'albums'} ·{' '}
              {(trackTotal || selected.trackCount || 0).toLocaleString()} tracks
            </div>
          </div>
          <AlphaFilterChip
            letter={letter}
            onClear={clearLetter}
          />
          <button
            className="jb-btn jb-btn--primary"
            onClick={() => onPlayYear?.(selected)}
            type="button"
          >
            <Play size={13} /> Play
          </button>
        </div>
        <TrackTable
          {...trackTableProps}
          onContextMenu={onContextMenu}
        />
      </div>
    );
  }

  const sortBar = (
    <div className="jb-folder-sort-bar">
      <span className="jb-sort-label">Sort</span>
      <SortButton
        field="year"
        label="Year"
        onSort={setSort}
        sortBy={sortBy}
        sortDir={sortDir}
      />
      <SortButton
        field="tracks"
        label="Tracks"
        onSort={setSort}
        sortBy={sortBy}
        sortDir={sortDir}
      />
    </div>
  );

  if (viewMode === 'list') {
    return (
      <>
        {sortBar}
        <div className="jb-year-list">
          <div className="jb-year-list-head">
            <span>
              {filterActive ? (
                <span className="jb-col-filter-wrap">
                  <input
                    autoFocus
                    className="jb-col-filter-input"
                    onBlur={() => setFilterActive(false)}
                    onChange={(e) => setYearFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setYearFilter('');
                        setFilterActive(false);
                      }

                      if (e.key === 'Enter') setFilterActive(false);
                    }}
                    placeholder="Filter year…"
                    value={yearFilter}
                  />
                  {yearFilter && (
                    <button
                      className="jb-col-filter-x"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setYearFilter('');
                        setFilterActive(false);
                      }}
                      type="button"
                    >
                      <X size={9} />
                    </button>
                  )}
                </span>
              ) : (
                <button
                  className={`jb-col-hdr-btn${yearFilter ? ' jb-col-hdr-btn--active' : ''}`}
                  onClick={() => setFilterActive(true)}
                  type="button"
                >
                  <span className="jb-col-hdr-value">
                    {yearFilter || 'Year'}
                  </span>
                  {yearFilter && (
                    <span
                      className="jb-col-filter-x"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setYearFilter('');
                      }}
                      role="button"
                      tabIndex={-1}
                    >
                      <X size={9} />
                    </span>
                  )}
                </button>
              )}
            </span>
            <span>Albums</span>
            <span>Tracks</span>
            <span />
          </div>
          {sortedYears.map((year) => {
            const hue = getYearHue(year.year);
            const color = yearColor(hue);
            return (
              <div
                className="jb-year-list-row"
                key={year.year}
                style={{
                  background: `color-mix(in srgb, ${color} 8%, transparent)`,
                  borderLeft: `3px solid color-mix(in srgb, ${color} 55%, transparent)`,
                }}
              >
                <button
                  className="jb-year-list-row-main"
                  onClick={() => setSelected(year)}
                  type="button"
                >
                  <span
                    className="jb-year-list-year"
                    style={{ color }}
                  >
                    {year.year}
                  </span>
                  <span className="jb-year-list-albums">{year.albumCount}</span>
                  <span className="jb-year-list-tracks">{year.trackCount}</span>
                </button>
                <button
                  className="jb-list-play-btn jb-list-play-btn--inline"
                  onClick={() => onPlayYear?.(year)}
                  title={`Play ${year.year}`}
                  type="button"
                >
                  <Play size={11} />
                </button>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <>
      {sortBar}
      <div
        className="jb-year-grid"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`,
        }}
      >
        {sortedYears.map((year) => {
          const hue = getYearHue(year.year);
          const color = yearColor(hue);
          return (
            <div
              className="jb-year-card"
              key={year.year}
              onClick={() => setSelected(year)}
              onKeyDown={(e) => e.key === 'Enter' && setSelected(year)}
              role="button"
              style={{
                background: `color-mix(in srgb, ${color} 14%, var(--bg-elevated))`,
                borderColor: `color-mix(in srgb, ${color} 35%, var(--border))`,
              }}
              tabIndex={0}
            >
              <div
                className="jb-year-number"
                style={{ color }}
              >
                {year.year}
              </div>
              <div className="jb-year-meta">
                {year.albumCount} {year.albumCount === 1 ? 'album' : 'albums'}
              </div>
              <div className="jb-year-meta">{year.trackCount} tracks</div>
              <div className="jb-album-card-actions">
                <button
                  className="jb-icon-btn"
                  onClick={(mouseEvent) => {
                    mouseEvent.stopPropagation();
                    onPlayYear?.(year);
                  }}
                  style={{ background: 'transparent', border: 'none' }}
                  title="Play year"
                  type="button"
                >
                  <Play size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

export default YearView;
