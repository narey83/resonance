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
import { nameHue } from '../../../lib/accentHue';
import { alphaKey } from '../../../lib/alphaBucket';
import { getArtistPage } from '../../../lib/musicLibrary';
import * as prefs from '../../../lib/prefs';
import { usePagedList, usePagedTracks } from '../../../lib/usePagedList';
import { trackCountLabel } from '../../../lib/util';
import AlbumArt from './AlbumArt';
import LibraryDetailHeader from './LibraryDetailHeader';
import LibraryViewHeader from './LibraryViewHeader';
import TrackTable from './TrackTable';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Play, Shuffle } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

const HEADER_HEIGHT = 28;
const ROW_HEIGHT = 46;

const AvatarCircle = ({ name }) => {
  const initials = name ? name.trim()[0].toUpperCase() : '?';
  const hue = nameHue(name);
  return (
    <div
      className="jb-artist-avatar"
      style={{ background: `hsl(${hue}, 45%, 35%)` }}
    >
      {initials}
    </div>
  );
};

// Tile equivalent of ArtistRow, mirroring FolderCard so the grids match. Artists rarely have
// their own artwork, so the avatar circle stays as the fallback — just at tile scale.
const ArtistCard = ({ artist, onPlay, onSelect, tileSize }) => (
  <button
    className="jb-folder-card"
    onClick={() => onSelect(artist)}
    title={artist.artist}
    type="button"
  >
    <div className="jb-folder-card-art">
      {artist.hasArtwork && artist.coverPath ? (
        <AlbumArt
          hasArtwork
          name={artist.artist}
          path={artist.coverPath}
          radius={0}
          size={tileSize}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            minWidth: 'unset',
          }}
        />
      ) : (
        <div
          className="jb-artist-tile-avatar"
          style={{ background: `hsl(${nameHue(artist.artist)}, 45%, 35%)` }}
        >
          {artist.artist ? artist.artist.trim()[0].toUpperCase() : '?'}
        </div>
      )}
      <div
        className="jb-folder-card-play"
        onClick={(e) => {
          e.stopPropagation();
          onPlay(artist);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            onPlay(artist);
          }
        }}
        role="button"
        tabIndex={0}
        title={`Play ${artist.artist}`}
      >
        <Play
          fill="currentColor"
          size={18}
        />
      </div>
    </div>
    <div className="jb-folder-card-info">
      <div className="jb-folder-card-name">{artist.artist || '(Unknown)'}</div>
      <div className="jb-folder-card-meta">
        {artist.trackCount} {artist.trackCount === 1 ? 'track' : 'tracks'}
      </div>
    </div>
  </button>
);

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

const ArtistDetail = ({
  alphaHandlerRef,
  artist,
  onAlphaEnabled,
  onAnalyzeTracks,
  onBack,
  onContextMenu,
  onPlayArtist,
}) => {
  const {
    alphaApplies,
    clearLetter,
    isDefaultView,
    letter,
    reset,
    total,
    trackTableProps,
  } = usePagedTracks({ artist: artist.artist }, { defaultSort: 'title' });

  // While a detail is open the rail belongs to its track list, not the artist list behind it.
  useEffect(() => {
    onAlphaEnabled?.(alphaApplies);
  }, [alphaApplies, onAlphaEnabled]);

  return (
    <div className="jb-detail-view">
      <LibraryDetailHeader
        actions={
          <>
            <button
              className="jb-btn"
              onClick={() => onPlayArtist(artist)}
              type="button"
            >
              <Shuffle size={12} /> Shuffle
            </button>
            <button
              className="jb-btn jb-btn--primary"
              onClick={() => onPlayArtist(artist)}
              type="button"
            >
              <Play size={12} /> Play
            </button>
          </>
        }
        hue={nameHue(artist.artist)}
        isDefault={isDefaultView}
        letter={letter}
        meta={trackCountLabel(total || artist.trackCount || 0)}
        onBack={onBack}
        onClearLetter={clearLetter}
        onReset={reset}
        title={artist.artist}
      />
      <TrackTable
        {...trackTableProps}
        alphaHandlerRef={alphaHandlerRef}
        onAnalyzeTracks={onAnalyzeTracks}
        onContextMenu={onContextMenu}
      />
    </div>
  );
};

const ArtistsView = ({
  alphaHandlerRef,
  onAlphaEnabled,
  onAnalyzeTracks,
  onContextMenu,
  onPlayArtist,
  scrollContainerRef,
  tileSize = 160,
  viewMode = 'list',
}) => {
  const [selected, setSelected] = useState(null);
  const [artistFilter, setArtistFilter] = useState('');
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
  const alphaApplies = sortBy === 'name' && sortDir === 'asc';
  useEffect(() => {
    if (selected) return;
    onAlphaEnabled?.(alphaApplies);
  }, [alphaApplies, onAlphaEnabled, selected]);

  const isDefaultView =
    sortBy === 'name' && sortDir === 'asc' && !letter && !artistFilter;

  const resetView = () => {
    setSortBy('name');
    setSortDir('asc');
    setLetter(null);
    setArtistFilter('');
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
        alphaHandlerRef={alphaHandlerRef}
        artist={selected}
        onAlphaEnabled={onAlphaEnabled}
        onAnalyzeTracks={onAnalyzeTracks}
        onBack={() => setSelected(null)}
        onContextMenu={onContextMenu}
        onPlayArtist={onPlayArtist}
      />
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <>
      <LibraryViewHeader
        filter={{
          onChange: setArtistFilter,
          placeholder: 'Filter artist…',
          value: artistFilter,
        }}
        isDefault={isDefaultView}
        letter={letter}
        onClearLetter={() => setLetter(null)}
        onReset={resetView}
        onSort={setSort}
        sortBy={sortBy}
        sortDir={sortDir}
        sorts={[
          { field: 'name', label: 'A–Z' },
          { field: 'tracks', label: 'Tracks' },
        ]}
        title="Artists"
        total={total}
      />
      {loading && (
        <div className="jb-state">
          <div className="jb-spinner" />
          Loading artists…
        </div>
      )}

      {!loading && artists.length === 0 && (
        <div className="jb-state">
          {search || letter
            ? 'No artists match.'
            : 'No artists found. Run a library sync to index your music.'}
        </div>
      )}

      {!loading &&
        artists.length > 0 &&
        (viewMode === 'tile' ? (
          <div
            className="jb-folders-grid"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`,
            }}
          >
            {artists.map((artist) => (
              <ArtistCard
                artist={artist}
                key={artist.artist}
                onPlay={onPlayArtist}
                onSelect={setSelected}
                tileSize={tileSize}
              />
            ))}
          </div>
        ) : (
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
        ))}
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
