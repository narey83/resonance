// <copyright file="GenreView.jsx" company="John Narey">
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

// Ordered by specificity — more specific keywords first
const GENRE_HUES = [
  ['drum and bass', 195],
  ['drum n bass', 195],
  ['dnb', 195],
  ['hip hop', 45],
  ['hip-hop', 45],
  ['r&b', 285],
  ['rnb', 285],
  ['neo soul', 280],
  ['bossa nova', 35],
  ['new wave', 200],
  ['post punk', 10],
  ['post rock', 5],
  ['prog rock', 355],
  ['nu metal', 350],
  ['death metal', 0],
  ['black metal', 350],
  ['heavy metal', 355],
  ['metal', 0],
  ['punk', 10],
  ['grunge', 25],
  ['shoegaze', 220],
  ['indie', 195],
  ['alternative', 170],
  ['rock', 0],
  ['techno', 195],
  ['trance', 280],
  ['house', 265],
  ['ambient', 210],
  ['industrial', 215],
  ['experimental', 225],
  ['electronic', 185],
  ['synth', 200],
  ['edm', 190],
  ['bass', 205],
  ['rap', 40],
  ['trap', 30],
  ['grime', 35],
  ['hip', 45],
  ['jazz', 38],
  ['blues', 230],
  ['soul', 280],
  ['funk', 42],
  ['gospel', 50],
  ['classical', 220],
  ['orchestral', 225],
  ['opera', 230],
  ['baroque', 215],
  ['chamber', 200],
  ['disco', 330],
  ['dance', 300],
  ['pop', 320],
  ['country', 30],
  ['folk', 100],
  ['bluegrass', 110],
  ['reggae', 120],
  ['ska', 115],
  ['latin', 25],
  ['samba', 20],
  ['world', 130],
  ['afro', 40],
];

const getGenreHue = (genre) => {
  const lower = (genre || '').toLowerCase();
  for (const [keyword, hue] of GENRE_HUES) {
    if (lower.includes(keyword)) return hue;
  }

  let hash = 0;
  for (let index = 0; index < genre.length; index++) {
    hash = ((genre.codePointAt(index) || 0) + hash * 31) % 2_147_483_647;
  }

  return hash % 360;
};

const genreColor = (hue) => `hsl(${hue} 65% 55%)`;

const GenreView = ({
  genres,
  initialSelected = null,
  loading,
  onContextMenu,
  onPlayGenre,
  tileSize = 160,
  viewMode = 'tile',
}) => {
  const [selected, setSelected] = useState(null);

  // Navigation carries just the genre name (see goToGenre/goToYear in Library.jsx),
  // but everything below wants the full row — resolve it against the loaded list.
  useEffect(() => {
    if (initialSelected == null) return;
    setSelected(
      (genres ?? []).find((x) => x.genre === initialSelected) ?? null,
    );
  }, [genres, initialSelected]);
  const {
    clearLetter,
    letter,
    total: trackTotal,
    trackTableProps,
  } = usePagedTracks(
    { genre: selected?.genre },
    { enabled: Boolean(selected) },
  );
  const [genreFilter, setGenreFilter] = useState('');
  const [filterActive, setFilterActive] = useState(false);
  const [sortBy, setSortBy] = useState(() =>
    prefs.get('resonance-genres-sort-by', 'name'),
  );
  const [sortDir, setSortDir] = useState(() =>
    prefs.get('resonance-genres-sort-dir', 'asc'),
  );

  const setSort = (field) => {
    if (field === sortBy) {
      const next = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(next);
      prefs.set('resonance-genres-sort-dir', next);
    } else {
      setSortBy(field);
      setSortDir('asc');
      prefs.set('resonance-genres-sort-by', field);
      prefs.set('resonance-genres-sort-dir', 'asc');
    }
  };

  const filteredGenres = useMemo(() => {
    if (!genreFilter) return genres;
    const q = genreFilter.toLowerCase();
    return genres.filter((g) => g.genre.toLowerCase().includes(q));
  }, [genreFilter, genres]);

  const sortedGenres = useMemo(() => {
    const copy = [...filteredGenres];
    copy.sort((a, b) => {
      const cmp =
        sortBy === 'tracks'
          ? (a.trackCount ?? 0) - (b.trackCount ?? 0)
          : (a.genre || '').localeCompare(b.genre || '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredGenres, sortBy, sortDir]);

  if (loading) {
    return (
      <div className="jb-state">
        <div className="jb-spinner" />
        Loading genres…
      </div>
    );
  }

  if (!genres.length) {
    return (
      <div className="jb-state">
        No genres found. Add genre tags to your tracks.
      </div>
    );
  }

  if (selected) {
    const hue = getGenreHue(selected.genre);
    const color = genreColor(hue);
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
              {selected.genre}
            </div>
            <div className="jb-year-detail-meta">
              {(trackTotal || selected.trackCount || 0).toLocaleString()} tracks
            </div>
          </div>
          <AlphaFilterChip
            letter={letter}
            onClear={clearLetter}
          />
          <button
            className="jb-btn jb-btn--primary"
            onClick={() => onPlayGenre?.(selected)}
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
        field="name"
        label="A–Z"
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
        <div className="jb-genre-list-view">
          <div className="jb-genre-list-head">
            <span>
              {filterActive ? (
                <span className="jb-col-filter-wrap">
                  <input
                    autoFocus
                    className="jb-col-filter-input"
                    onBlur={() => setFilterActive(false)}
                    onChange={(e) => setGenreFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setGenreFilter('');
                        setFilterActive(false);
                      }

                      if (e.key === 'Enter') setFilterActive(false);
                    }}
                    placeholder="Filter genre…"
                    value={genreFilter}
                  />
                  {genreFilter && (
                    <button
                      className="jb-col-filter-x"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setGenreFilter('');
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
                  className={`jb-col-hdr-btn${genreFilter ? ' jb-col-hdr-btn--active' : ''}`}
                  onClick={() => setFilterActive(true)}
                  type="button"
                >
                  <span className="jb-col-hdr-value">
                    {genreFilter || 'Genre'}
                  </span>
                  {genreFilter && (
                    <span
                      className="jb-col-filter-x"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setGenreFilter('');
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
            <span>Tracks</span>
            <span />
          </div>
          {sortedGenres.map((genre) => {
            const hue = getGenreHue(genre.genre);
            const color = genreColor(hue);
            return (
              <div
                className="jb-genre-list-row"
                key={genre.genre}
                style={{
                  background: `color-mix(in srgb, ${color} 8%, transparent)`,
                  borderLeft: `3px solid color-mix(in srgb, ${color} 55%, transparent)`,
                }}
              >
                <button
                  className="jb-genre-list-row-main"
                  onClick={() => setSelected(genre)}
                  type="button"
                >
                  <span
                    className="jb-genre-list-name"
                    style={{ color }}
                  >
                    {genre.genre}
                  </span>
                  <span className="jb-genre-list-tracks">
                    {genre.trackCount}
                  </span>
                </button>
                <button
                  className="jb-list-play-btn"
                  onClick={() => onPlayGenre?.(genre)}
                  title={`Play ${genre.genre}`}
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
        className="jb-genre-grid"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`,
        }}
      >
        {sortedGenres.map((genre) => {
          const hue = getGenreHue(genre.genre);
          const color = genreColor(hue);
          return (
            <button
              className="jb-genre-card"
              key={genre.genre}
              onClick={() => setSelected(genre)}
              style={{
                background: `color-mix(in srgb, ${color} 14%, var(--bg-elevated))`,
                borderColor: `color-mix(in srgb, ${color} 35%, var(--border))`,
              }}
              type="button"
            >
              <div
                className="jb-genre-card-name"
                style={{ color }}
              >
                {genre.genre}
              </div>
              <div className="jb-genre-card-meta">
                {genre.trackCount} tracks
              </div>
              <div className="jb-album-card-actions">
                <button
                  className="jb-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayGenre?.(genre);
                  }}
                  style={{ background: 'transparent', border: 'none' }}
                  title="Play genre"
                  type="button"
                >
                  <Play size={12} />
                </button>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
};

export default GenreView;
