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

import * as prefs from '../../../lib/prefs';
import SortButton from './SortButton';
import TrackTable from './TrackTable';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeft, Play, Shuffle, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

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
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    import('../../../lib/musicLibrary')
      .then(({ getTracks }) =>
        getTracks({ artist: artist.artist, limit: 5_000 }),
      )
      .then((result) => {
        if (!cancelled) {
          setTracks(result?.tracks ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artist.artist]);

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
        <span className="jb-section-count">{artist.trackCount} tracks</span>
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
        onContextMenu={onContextMenu}
        tracks={tracks}
      />
    </div>
  );
};

const ArtistsView = ({
  alphaHandlerRef,
  artists = [],
  loading,
  onContextMenu,
  onPlayArtist,
  scrollContainerRef,
}) => {
  const [selected, setSelected] = useState(null);
  const [artistFilter, setArtistFilter] = useState('');
  const [filterActive, setFilterActive] = useState(false);
  const [sortBy, setSortBy] = useState(() =>
    prefs.get('resonance-artists-sort-by', 'name'),
  );
  const [sortDir, setSortDir] = useState(() =>
    prefs.get('resonance-artists-sort-dir', 'asc'),
  );

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

  const filteredArtists = useMemo(() => {
    if (!artistFilter) return artists;
    const q = artistFilter.toLowerCase();
    return artists.filter((a) => (a.artist || '').toLowerCase().includes(q));
  }, [artistFilter, artists]);

  const sortedArtists = useMemo(() => {
    const copy = [...filteredArtists];
    copy.sort((a, b) => {
      const cmp =
        sortBy === 'tracks'
          ? (a.trackCount ?? 0) - (b.trackCount ?? 0)
          : (a.artist || '').localeCompare(b.artist || '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredArtists, sortBy, sortDir]);

  const flatItems = useMemo(() => {
    if (sortBy !== 'name')
      return sortedArtists.map((artist) => ({ type: 'artist', artist }));
    const items = [];
    let lastLetter = null;
    for (const artist of sortedArtists) {
      const letter = alphaKey(artist.artist);
      if (letter !== lastLetter) {
        items.push({ type: 'header', letter });
        lastLetter = letter;
      }

      items.push({ type: 'artist', artist });
    }

    return items;
  }, [sortBy, sortedArtists]);

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollContainerRef?.current ?? null,
    estimateSize: (index) =>
      flatItems[index]?.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT,
    overscan: 8,
    paddingStart: 8,
    paddingEnd: 8,
  });

  useEffect(() => {
    if (!alphaHandlerRef || selected) return undefined;
    alphaHandlerRef.current = (letter) => {
      const index = flatItems.findIndex(
        (item) => item.type === 'header' && item.letter === letter,
      );
      if (index >= 0)
        virtualizer.scrollToIndex(index, {
          align: 'start',
          behavior: 'smooth',
        });
    };

    return () => {
      alphaHandlerRef.current = null;
    };
  }, [alphaHandlerRef, flatItems, selected, virtualizer]);

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
        No artists found. Run a library sync to index your music.
      </div>
    );
  }

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
    </>
  );
};

export default ArtistsView;
