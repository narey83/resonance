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

import { hueColour, yearHue } from '../../../lib/accentHue';
import * as prefs from '../../../lib/prefs';
import { usePagedTracks } from '../../../lib/usePagedList';
import { trackCountLabel } from '../../../lib/util';
import LibraryDetailHeader from './LibraryDetailHeader';
import LibraryViewHeader from './LibraryViewHeader';
import TrackTable from './TrackTable';
import { Play } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

const YearView = ({
  initialSelected = null,
  loading,
  onAnalyzeTracks,
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
    isDefaultView: tracksAreDefault,
    letter,
    reset: resetTracks,
    total: trackTotal,
    trackTableProps,
  } = usePagedTracks({ year: selected?.year }, { enabled: Boolean(selected) });
  const [yearFilter, setYearFilter] = useState('');
  const [sortBy, setSortBy] = useState(() =>
    prefs.get('resonance-years-sort-by', 'year'),
  );
  const [sortDir, setSortDir] = useState(() =>
    prefs.get('resonance-years-sort-dir', 'desc'),
  );

  const isDefaultView = sortBy === 'year' && sortDir === 'desc' && !yearFilter;

  const resetView = () => {
    setSortBy('year');
    setSortDir('desc');
    setYearFilter('');
    prefs.set('resonance-years-sort-by', 'year');
    prefs.set('resonance-years-sort-dir', 'desc');
  };

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

  // Not while a year is open — see the note in FolderView. A library refresh empties the
  // collection to force a refetch, and swapping in a placeholder would unmount the open
  // year's TrackTable and lose its scroll position.
  if (loading && !selected) {
    return (
      <div className="jb-state">
        <div className="jb-spinner" />
        Loading years…
      </div>
    );
  }

  if (!years.length && !selected) {
    return (
      <div className="jb-state">
        No year data found. Add year tags to your tracks.
      </div>
    );
  }

  if (selected) {
    return (
      <div className="jb-detail-view">
        <LibraryDetailHeader
          actions={
            <button
              className="jb-btn jb-btn--primary"
              onClick={() => onPlayYear?.(selected)}
              type="button"
            >
              <Play size={13} /> Play
            </button>
          }
          hue={yearHue(selected.year)}
          isDefault={tracksAreDefault}
          letter={letter}
          meta={`${selected.albumCount} ${
            selected.albumCount === 1 ? 'album' : 'albums'
          } · ${trackCountLabel(trackTotal || selected.trackCount || 0)}`}
          onBack={() => setSelected(null)}
          onClearLetter={clearLetter}
          onReset={resetTracks}
          title={selected.year}
        />
        <TrackTable
          {...trackTableProps}
          onAnalyzeTracks={onAnalyzeTracks}
          onContextMenu={onContextMenu}
        />
      </div>
    );
  }

  // Years carry no alphabet — every entry buckets to '#' — so this view deliberately has no
  // A-Z rail (Library omits VIEWS.YEARS from showAlphaStrip). Everything else is standard.
  const header = (
    <LibraryViewHeader
      filter={{
        onChange: setYearFilter,
        placeholder: 'Filter year…',
        value: yearFilter,
      }}
      isDefault={isDefaultView}
      onReset={resetView}
      onSort={setSort}
      sortBy={sortBy}
      sortDir={sortDir}
      sorts={[
        { field: 'year', label: 'Year' },
        { field: 'tracks', label: 'Tracks' },
      ]}
      title="Years"
      total={filteredYears.length}
    />
  );

  if (viewMode === 'list') {
    return (
      <>
        {header}
        {sortedYears.length === 0 && (
          <div className="jb-state">No years match.</div>
        )}
        <div className="jb-year-list">
          <div className="jb-year-list-head">
            <span>Year</span>
            <span>Albums</span>
            <span>Tracks</span>
            <span />
          </div>
          {sortedYears.map((year) => {
            const color = hueColour(yearHue(year.year));
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
      {header}
      {sortedYears.length === 0 && (
        <div className="jb-state">No years match.</div>
      )}
      <div
        className="jb-year-grid"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`,
        }}
      >
        {sortedYears.map((year) => {
          const color = hueColour(yearHue(year.year));
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
