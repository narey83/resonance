// <copyright file="ArtistsView.jsx" company="John Narey">
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

import useDebounce from '../../../hooks/useDebounce';
import { getArtistPage, getTrackPage } from '../../../lib/musicLibrary';
import * as prefs from '../../../lib/prefs';
import { usePagedList } from '../../../lib/usePagedList';
import AlphaFilterChip from './AlphaFilterChip';
import ResetViewButton from './ResetViewButton';
import SortButton from './SortButton';
import TrackTable from './TrackTable';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeft, Play, Shuffle, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

const alphaKey = (s) => {
  const c = s?.trim()?.[0]?.toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
};

const HEADER_HEIGHT = 28;
const ROW_HEIGHT = 46;

const nameToHue = (name) => {
  if (!name) return 0;
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    // eslint-disable-next-line no-bitwise
    hash = name.codePointAt(index) + ((hash << 5) - hash);
  }

  return Math.abs(hash) % 360;
};

const AvatarCircle = ({ name }) => {
  const initials = name ? name.trim()[0].toUpperCase() : '?';
  const hue = nameToHue(name);
  return (
    <div
      className="jb-artist-avatar"
      style={{ background: `hsl(${hue}, 45%, 35%)` }}
    >
      {initials}
    </div>
  );
};

const ArtistRow = ({ artist, onPlay, onSelect }) => (
  <div
    className="jb-artist-row"
    onClick={() => onSelect(artist)}
    style={{ height: ROW_HEIGHT }}
  >
    <button
      className="jb-list-play-btn"
      onClick={(e) => {
        e.stopPropagation();
        onPlay(artist);
      }}
      title={`Play ${artist.artist}`}
      type="button"
    >
      <Play size={11} />
    </button>
    <AvatarCircle name={artist.artist} />
    <div className="jb-artist-row-info">
      <span className="jb-artist-row-name">{artist.artist || '(Unknown)'}</span>
      <span className="jb-artist-row-meta">
        {artist.trackCount} {artist.trackCount === 1 ? 'track' : 'tracks'}
      </span>
    </div>
  </div>
);

const ArtistDetail = ({ artist, onBack, onContextMenu, onPlayArtist }) => {
  const {
    items: tracks,
    loadMore,
    loading,
    loadingMore,
    total,
  } = usePagedList(getTrackPage, { artist: artist.artist });

  return (
    <div className="jb-artist-detail-view">
      <div className="jb-section-header">
        <button
          className="jb-icon-btn"
          onClick={onBack}
          title="Back to artists"
          type="button"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="jb-section-title">{artist.artist}</span>
        <span className="jb-section-count">
          {(total || artist.trackCount) ?? 0} tracks
        </span>
        <div className="jb-section-controls">
          <button
            className="jb-btn"
            disabled={!tracks.length}
            onClick={() => onPlayArtist(artist)}
            type="button"
          >
            <Shuffle size={12} /> Shuffle
          </button>
          <button
            className="jb-btn jb-btn--primary"
            disabled={!tracks.length}
            onClick={() => onPlayArtist(artist)}
            type="button"
          >
            <Play size={12} /> Play
          </button>
        </div>
      </div>
      <TrackTable
        loading={loading}
        loadingMore={loadingMore}
        onContextMenu={onContextMenu}
        onEndReached={loadMore}
        tracks={tracks}
      />
    </div>
  );
};

const ArtistsView = ({
  alphaHandlerRef,
  onAlphaEnabled,
  onContextMenu,
  onPlayArtist,
  scrollContainerRef,
}) => {
  const [selected, setSelected] = useState(null);
  const [artistFilter, setArtistFilter] = useState('');
  const [filterActive, setFilterActive] = useState(false);
  const [letter, setLetter] = useState(null);
  const [sortBy, setSortBy] = useState(() =>
    prefs.get('resonance-artists-sort-by', 'name'),
  );
  const [sortDir, setSortDir] = useState(() =>
    prefs.get('resonance-artists-sort-dir', 'asc'),
  );

  // Typing shouldn't fire a request per keystroke.
  const search = useDebounce(artistFilter, 250);

  // Filtering, ordering and the A-Z rail are all query parameters now: there are ~13k artists
  // and we only ever hold the window that's been scrolled to, so none of them can be answered
  // from what's in memory.
  const {
    items: artists,
    loadMore,
    loading,
    loadingMore,
    total,
  } = usePagedList(getArtistPage, {
    descending: sortDir === 'desc',
    search: search || undefined,
    sort: sortBy,
    startsWith: letter || undefined,
  });

  const setSort = (field) => {
    if (field === sortBy) {
      const next = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(next);
      prefs.set('resonance-artists-sort-dir', next);
    } else {
      setSortBy(field);
      setSortDir('asc');
      prefs.set('resonance-artists-sort-by', field);
      prefs.set('resonance-artists-sort-dir', 'asc');
    }
  };

  const flatItems = useMemo(() => {
    if (sortBy !== 'name')
      return artists.map((artist) => ({ type: 'artist', artist }));
    const items = [];
    let lastLetter = null;
    for (const artist of artists) {
      const artistLetter = alphaKey(artist.artist);
      if (artistLetter !== lastLetter) {
        items.push({ type: 'header', letter: artistLetter });
        lastLetter = artistLetter;
      }

      items.push({ type: 'artist', artist });
    }

    return items;
  }, [artists, sortBy]);

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollContainerRef?.current ?? null,
    estimateSize: (index) =>
      flatItems[index]?.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT,
    overscan: 8,
    paddingStart: 8,
    paddingEnd: 8,
  });

  // The rail narrows the query instead of scrolling, because the letter is almost never inside
  // the window we hold. Re-picking the active letter clears it.
  const jumpToLetter = useCallback((next) => {
    setLetter((current) => (current === next ? null : next));
    scrollContainerRef?.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!alphaHandlerRef || selected) return undefined;
    alphaHandlerRef.current = jumpToLetter;
    return () => {
      alphaHandlerRef.current = null;
    };
  }, [alphaHandlerRef, jumpToLetter, selected]);

  // The rail buckets by name, so it only means anything while the list is in name order.
  const alphaApplies = sortBy === 'name' && sortDir === 'asc' && !selected;
  useEffect(() => {
    onAlphaEnabled?.(alphaApplies);
  }, [alphaApplies, onAlphaEnabled]);

  const isDefaultView =
    sortBy === 'name' && sortDir === 'asc' && !letter && !artistFilter;

  const resetView = () => {
    setSortBy('name');
    setSortDir('asc');
    setLetter(null);
    setArtistFilter('');
    setFilterActive(false);
    prefs.set('resonance-artists-sort-by', 'name');
    prefs.set('resonance-artists-sort-dir', 'asc');
  };

  const lastIndex = virtualizer.getVirtualItems().at(-1)?.index ?? -1;
  useEffect(() => {
    if (lastIndex >= flatItems.length - 20) loadMore();
  }, [flatItems.length, lastIndex, loadMore]);

  if (selected) {
    return (
      <ArtistDetail
        artist={selected}
        onBack={() => setSelected(null)}
        onContextMenu={onContextMenu}
        onPlayArtist={onPlayArtist}
      />
    );
  }

  if (loading) {
    return (
      <div className="jb-state">
        <div className="jb-spinner" />
        Loading artists…
      </div>
    );
  }

  if (!loading && artists.length === 0) {
    return (
      <div className="jb-state">
        {search || letter
          ? 'No artists match.'
          : 'No artists found. Run a library sync to index your music.'}
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <>
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
        <AlphaFilterChip
          letter={letter}
          onClear={() => setLetter(null)}
        />
        <ResetViewButton
          hidden={isDefaultView}
          onReset={resetView}
        />
        <span className="jb-sort-bar-count">
          {total.toLocaleString()} {total === 1 ? 'artist' : 'artists'}
        </span>
      </div>
      <div className="jb-artist-list-head">
        <span />
        <span />
        <span>
          {filterActive ? (
            <span className="jb-col-filter-wrap">
              <input
                autoFocus
                className="jb-col-filter-input"
                onBlur={() => setFilterActive(false)}
                onChange={(e) => setArtistFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setArtistFilter('');
                    setFilterActive(false);
                  }

                  if (e.key === 'Enter') setFilterActive(false);
                }}
                placeholder="Filter artist…"
                value={artistFilter}
              />
              {artistFilter && (
                <button
                  className="jb-col-filter-x"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setArtistFilter('');
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
              className={`jb-col-hdr-btn${artistFilter ? ' jb-col-hdr-btn--active' : ''}`}
              onClick={() => setFilterActive(true)}
              type="button"
            >
              <span className="jb-col-hdr-value">
                {artistFilter || 'Artist'}
              </span>
              {artistFilter && (
                <span
                  className="jb-col-filter-x"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setArtistFilter('');
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
        <span />
      </div>
      <div
        className="jb-artist-list-view"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualItems.map((vRow) => {
          const item = flatItems[vRow.index];
          return (
            <div
              key={
                item.type === 'header'
                  ? `hdr-${item.letter}`
                  : item.artist.artist
              }
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: `${vRow.size}px`,
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              {item.type === 'header' ? (
                <div className="jb-alpha-divider">{item.letter}</div>
              ) : (
                <ArtistRow
                  artist={item.artist}
                  onPlay={onPlayArtist}
                  onSelect={setSelected}
                />
              )}
            </div>
          );
        })}
      </div>
      {loadingMore && (
        <div className="jb-tt-more">
          <div className="jb-spinner" />
          Loading more…
        </div>
      )}
    </>
  );
};

export default ArtistsView;
