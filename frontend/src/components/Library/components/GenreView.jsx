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

import { genreHue, hueColour } from '../../../lib/accentHue';
import { alphaKey } from '../../../lib/alphaBucket';
import * as prefs from '../../../lib/prefs';
import { usePagedTracks } from '../../../lib/usePagedList';
import { trackCountLabel } from '../../../lib/util';
import ResonanceMark from '../../Shared/ResonanceMark';
import LibraryDetailHeader from './LibraryDetailHeader';
import LibraryViewHeader from './LibraryViewHeader';
import TrackTable from './TrackTable';
import { Play } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

const GenreView = ({
  alphaHandlerRef,
  genres,
  initialSelected = null,
  loading,
  onAlphaEnabled,
  onAnalyzeTracks,
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
    alphaApplies: trackAlphaApplies,
    clearLetter,
    isDefaultView: tracksAreDefault,
    letter,
    reset: resetTracks,
    total: trackTotal,
    trackTableProps,
  } = usePagedTracks(
    { genre: selected?.genre },
    { defaultSort: 'title', enabled: Boolean(selected) },
  );
  const [genreFilter, setGenreFilter] = useState('');
  const [listLetter, setListLetter] = useState(null);
  const [sortBy, setSortBy] = useState(() =>
    prefs.get('resonance-genres-sort-by', 'name'),
  );
  const [sortDir, setSortDir] = useState(() =>
    prefs.get('resonance-genres-sort-dir', 'asc'),
  );

  const isDefaultView =
    sortBy === 'name' && sortDir === 'asc' && !genreFilter && !listLetter;

  const resetView = () => {
    setSortBy('name');
    setSortDir('asc');
    setGenreFilter('');
    setListLetter(null);
    prefs.set('resonance-genres-sort-by', 'name');
    prefs.set('resonance-genres-sort-dir', 'asc');
  };

  // Genre names are alphabetical, so the rail applies whenever the list is in name order.
  // Whichever list is on screen owns the rail: the genre list, or the selected genre's tracks.
  const alphaApplies = selected
    ? trackAlphaApplies
    : sortBy === 'name' && sortDir === 'asc';
  useEffect(() => {
    onAlphaEnabled?.(alphaApplies);
  }, [alphaApplies, onAlphaEnabled]);

  useEffect(() => {
    if (!alphaHandlerRef || selected) return undefined;
    alphaHandlerRef.current = (next) =>
      setListLetter((current) => (current === next ? null : next));
    return () => {
      alphaHandlerRef.current = null;
    };
  }, [alphaHandlerRef, selected]);

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

  // The rail narrows the list to a letter, the same as it does on the paged views — the
  // chip says "Starting with S", so it has to mean that everywhere. This list is small and
  // held whole, so it filters here instead of re-querying.
  const filteredGenres = useMemo(() => {
    const q = genreFilter.toLowerCase();
    return genres.filter(
      (g) =>
        (!q || g.genre.toLowerCase().includes(q)) &&
        (!listLetter || alphaKey(g.genre) === listLetter),
    );
  }, [genreFilter, genres, listLetter]);

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

  // Not while a genre is open — see the note in FolderView. A library refresh empties the
  // collection to force a refetch, and swapping in a placeholder would unmount the open
  // genre's TrackTable and lose its scroll position.
  if (loading && !selected) {
    return (
      <div className="jb-state">
        <ResonanceMark size={48} />
        Loading genres…
      </div>
    );
  }

  if (!genres.length && !selected) {
    return (
      <div className="jb-state">
        No genres found. Add genre tags to your tracks.
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
              onClick={() => onPlayGenre?.(selected)}
              type="button"
            >
              <Play size={13} /> Play
            </button>
          }
          hue={genreHue(selected.genre)}
          isDefault={tracksAreDefault}
          letter={letter}
          meta={trackCountLabel(trackTotal || selected.trackCount || 0)}
          onBack={() => setSelected(null)}
          onClearLetter={clearLetter}
          onReset={resetTracks}
          title={selected.genre}
        />
        <TrackTable
          {...trackTableProps}
          alphaHandlerRef={alphaHandlerRef}
          onAnalyzeTracks={onAnalyzeTracks}
          onContextMenu={onContextMenu}
        />
      </div>
    );
  }

  const header = (
    <LibraryViewHeader
      filter={{
        onChange: setGenreFilter,
        placeholder: 'Filter genre…',
        value: genreFilter,
      }}
      isDefault={isDefaultView}
      letter={listLetter}
      onClearLetter={() => setListLetter(null)}
      onReset={resetView}
      onSort={setSort}
      sortBy={sortBy}
      sortDir={sortDir}
      sorts={[
        { field: 'name', label: 'A–Z' },
        { field: 'tracks', label: 'Tracks' },
      ]}
      title="Genres"
      total={sortedGenres.length}
    />
  );

  if (viewMode === 'list') {
    return (
      <>
        {header}
        {sortedGenres.length === 0 && (
          <div className="jb-state">No genres match.</div>
        )}
        <div className="jb-genre-list-view">
          <div className="jb-genre-list-head">
            <span>Genre</span>
            <span>Tracks</span>
            <span />
          </div>
          {sortedGenres.map((genre) => {
            const color = hueColour(genreHue(genre.genre));
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
      {header}
      {sortedGenres.length === 0 && (
        <div className="jb-state">No genres match.</div>
      )}
      <div
        className="jb-genre-grid"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`,
        }}
      >
        {sortedGenres.map((genre) => {
          const color = hueColour(genreHue(genre.genre));
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
                {/* div, not button: this sits inside the card's own <button>, and nesting
                    buttons is invalid HTML. Mirrors FolderCard's play control. */}
                <div
                  className="jb-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayGenre?.(genre);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      onPlayGenre?.(genre);
                    }
                  }}
                  role="button"
                  style={{ background: 'transparent', border: 'none' }}
                  tabIndex={0}
                  title="Play genre"
                >
                  <Play size={12} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
};

export default GenreView;
