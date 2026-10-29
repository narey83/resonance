// <copyright file="AlbumsView.jsx" company="John Narey">
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
import { albumKey, getAlbumPage } from '../../../lib/musicLibrary';
import { usePagedList } from '../../../lib/usePagedList';
import { formatIndexedAt, isRecentlyIndexed } from '../../../lib/util';
import AlbumArt from './AlbumArt';
import LibraryViewHeader from './LibraryViewHeader';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Play, Shuffle, Sparkles } from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const LIST_ROW_HEIGHT = 52;
const TILE_GAP = 10;
const TILE_INFO_HEIGHT = 88;

const AlbumsView = ({
  alphaHandlerRef,
  onAlbum,
  onAlbumContextMenu,
  onAlphaEnabled,
  onPlayAlbum,
  onShuffleAlbum,
  scrollContainerRef,
  tileSize = 160,
  viewMode = 'tile',
}) => {
  const DEFAULT_DIR = {
    name: 'asc',
    artist: 'asc',
    year: 'desc',
    date: 'desc',
  };
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [letter, setLetter] = useState(null);
  const [albumFilter, setAlbumFilter] = useState('');
  const [containerWidth, setContainerWidth] = useState(0);

  // Typing shouldn't fire a request per keystroke.
  const albumSearch = useDebounce(albumFilter, 250);
  const resizeObserverRef = useRef(null);

  // ~19k album groups: ordering and the A-Z rail are query parameters, not things we can work
  // out from the window currently in memory.
  const {
    items: sorted,
    loadMore,
    loading,
    loadingMore,
    total,
  } = usePagedList(getAlbumPage, {
    descending: sortDir === 'desc',
    search: albumSearch || undefined,
    sort: sortBy,
    startsWith: letter || undefined,
  });

  const setSort = (field) => {
    if (field === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortBy(field);
    setSortDir(DEFAULT_DIR[field] ?? 'asc');
  };

  // Tracks the container width, which decides how many tiles fit per row.
  //
  // A callback ref rather than an effect: the grid is behind the loading early-return, so it
  // isn't in the DOM on first render. An effect keyed on viewMode would run once against a null
  // ref, bail, and never re-run once the albums arrived — leaving containerWidth at 0, cols at
  // 0, and the tile grid rendering nothing at all. This fires whenever the node actually
  // mounts or unmounts.
  const gridRef = useCallback((element) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (!element) return;

    const ro = new ResizeObserver(([entry]) =>
      setContainerWidth(entry.contentRect.width),
    );
    ro.observe(element);
    resizeObserverRef.current = ro;
    setContainerWidth(Math.max(0, element.clientWidth - 32));
  }, []);

  useEffect(() => () => resizeObserverRef.current?.disconnect(), []);

  const cols =
    containerWidth > 0
      ? Math.max(
          1,
          Math.floor((containerWidth + TILE_GAP) / (tileSize + TILE_GAP)),
        )
      : 0;

  const tileRows = useMemo(() => {
    if (cols === 0) return [];
    const result = [];
    for (let index = 0; index < sorted.length; index += cols)
      result.push(sorted.slice(index, index + cols));
    return result;
  }, [cols, sorted]);

  const tileRowHeight = tileSize + TILE_INFO_HEIGHT + TILE_GAP;

  const listVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollContainerRef?.current ?? null,
    estimateSize: () => LIST_ROW_HEIGHT,
    overscan: 10,
    paddingEnd: 40,
  });

  const gridVirtualizer = useVirtualizer({
    count: tileRows.length,
    getScrollElement: () => scrollContainerRef?.current ?? null,
    estimateSize: () => tileRowHeight,
    overscan: 3,
    paddingEnd: 40,
  });

  // The rail narrows the query instead of scrolling, because the letter is almost never inside
  // the window we hold. Re-picking the active letter clears it.
  const jumpToLetter = useCallback((next) => {
    setLetter((current) => (current === next ? null : next));
    scrollContainerRef?.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!alphaHandlerRef) return undefined;
    alphaHandlerRef.current = jumpToLetter;
    return () => {
      alphaHandlerRef.current = null;
    };
  }, [alphaHandlerRef, jumpToLetter]);

  // The rail buckets by album name, so it only means anything in name order.
  const alphaApplies = sortBy === 'name' && sortDir === 'asc';
  useEffect(() => {
    onAlphaEnabled?.(alphaApplies);
  }, [alphaApplies, onAlphaEnabled]);

  const isDefaultView = alphaApplies && !letter && !albumFilter;

  const resetView = () => {
    setSortBy('name');
    setSortDir('asc');
    setLetter(null);
    setAlbumFilter('');
  };

  const lastListIndex = listVirtualizer.getVirtualItems().at(-1)?.index ?? -1;
  const lastGridIndex = gridVirtualizer.getVirtualItems().at(-1)?.index ?? -1;
  useEffect(() => {
    const nearEnd =
      viewMode === 'list'
        ? lastListIndex >= sorted.length - 20
        : lastGridIndex >= tileRows.length - 3;
    if (nearEnd) loadMore();
  }, [
    lastGridIndex,
    lastListIndex,
    loadMore,
    sorted.length,
    tileRows.length,
    viewMode,
  ]);

  const listVirtualItems = listVirtualizer.getVirtualItems();
  const gridVirtualItems = gridVirtualizer.getVirtualItems();

  return (
    <>
      <LibraryViewHeader
        filter={{
          onChange: setAlbumFilter,
          placeholder: 'Filter album…',
          value: albumFilter,
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
          { field: 'artist', label: 'Artist' },
          { field: 'year', label: 'Year' },
          { field: 'date', label: 'Added' },
        ]}
        title="Albums"
        total={total}
      />

      {loading && (
        <div className="jb-state">
          <div className="jb-spinner" />
          Loading albums…
        </div>
      )}

      {!loading && sorted.length === 0 && (
        <div className="jb-state">
          {letter || albumFilter
            ? 'No albums match.'
            : 'No albums found. Run a library sync to index your music.'}
        </div>
      )}

      {!loading &&
        sorted.length > 0 &&
        (viewMode === 'list' ? (
          <div className="jb-album-list">
            <div className="jb-album-list-head">
              <span />
              <span>Album</span>
              <span>Year</span>
              <span>Tracks</span>
              <span>Date Added</span>
              <span />
            </div>
            <div
              style={{
                height: `${listVirtualizer.getTotalSize()}px`,
                position: 'relative',
              }}
            >
              {listVirtualItems.map((vRow) => {
                const album = sorted[vRow.index];
                return (
                  <div
                    key={albumKey(album)}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: `${vRow.size}px`,
                      transform: `translateY(${vRow.start}px)`,
                    }}
                  >
                    <AlbumRow
                      album={album}
                      onAlbum={onAlbum}
                      onContextMenu={onAlbumContextMenu}
                      onPlay={onPlayAlbum}
                      onShuffle={onShuffleAlbum}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div
            className="jb-album-tiles"
            ref={gridRef}
            style={{ minHeight: 4 }}
          >
            {cols > 0 && (
              <div
                style={{
                  height: `${gridVirtualizer.getTotalSize()}px`,
                  position: 'relative',
                }}
              >
                {gridVirtualItems.map((vRow) => (
                  <div
                    key={vRow.index}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: `${vRow.size}px`,
                      transform: `translateY(${vRow.start}px)`,
                      display: 'flex',
                      gap: TILE_GAP,
                      padding: `0 0 ${TILE_GAP}px`,
                    }}
                  >
                    {tileRows[vRow.index].map((album) => (
                      <AlbumCard
                        album={album}
                        key={albumKey(album)}
                        onAlbum={onAlbum}
                        onContextMenu={onAlbumContextMenu}
                        onPlay={onPlayAlbum}
                        onShuffle={onShuffleAlbum}
                        tileSize={tileSize}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
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

const AlbumRow = ({ album, onAlbum, onContextMenu, onPlay, onShuffle }) => {
  const handlePlay = (mouseEvent) => {
    mouseEvent.stopPropagation();
    onPlay?.(album);
  };

  const handleShuffle = (mouseEvent) => {
    mouseEvent.stopPropagation();
    onShuffle?.(album);
  };

  return (
    <div
      className="jb-album-row"
      onClick={() => onAlbum(album)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, album) : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAlbum(album);
        }
      }}
      role="button"
      style={{ height: LIST_ROW_HEIGHT }}
      tabIndex={0}
    >
      <AlbumArt
        hasArtwork={album.hasArtwork}
        name={album.album}
        path={album.coverPath}
        radius={4}
        size={36}
      />
      <span
        className="jb-album-row-name"
        title={album.album}
      >
        {album.album || '(Untitled)'}
        {isRecentlyIndexed(album.indexedAt) && (
          <Sparkles
            aria-label="Added in the last 7 days"
            className="jb-new-item-icon"
            size={13}
          />
        )}
      </span>
      <span className="jb-album-row-year">{album.year ?? '–'}</span>
      <span className="jb-album-row-tracks">{album.trackCount ?? '–'}</span>
      <span className="jb-album-row-date">
        {formatIndexedAt(album.indexedAt) || '–'}
      </span>
      <div className="jb-album-row-actions">
        <button
          className="jb-icon-btn"
          onClick={handleShuffle}
          style={{ background: 'transparent', border: 'none' }}
          title="Shuffle album"
          type="button"
        >
          <Shuffle size={13} />
        </button>
        <button
          className="jb-icon-btn"
          onClick={handlePlay}
          style={{ background: 'transparent', border: 'none' }}
          title="Play album"
          type="button"
        >
          <Play size={13} />
        </button>
      </div>
    </div>
  );
};

const AlbumCard = ({
  album,
  onAlbum,
  onContextMenu,
  onPlay,
  onShuffle,
  tileSize = 160,
}) => {
  const meta = [
    album.year,
    album.trackCount ? `${album.trackCount} tracks` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const handlePlay = (mouseEvent) => {
    mouseEvent.stopPropagation();
    onPlay?.(album);
  };

  const handleShuffle = (mouseEvent) => {
    mouseEvent.stopPropagation();
    onShuffle?.(album);
  };

  return (
    <button
      className="jb-album-card"
      onClick={() => onAlbum(album)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, album) : undefined}
      style={{ width: tileSize, flexShrink: 0 }}
      type="button"
    >
      <div
        className="jb-album-card-art"
        style={{ width: '100%', aspectRatio: '1' }}
      >
        <AlbumArt
          hasArtwork={album.hasArtwork}
          name={album.album}
          path={album.coverPath}
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
        {isRecentlyIndexed(album.indexedAt) && (
          <span
            className="jb-new-item-badge"
            title="Added in the last 7 days"
          >
            <Sparkles
              aria-hidden="true"
              size={12}
            />
            <span>New</span>
          </span>
        )}
        {/* div, not button: this sits inside the card's own <button>, and nesting buttons
            is invalid HTML. Mirrors FolderCard's play control. */}
        <div
          className="jb-folder-card-play"
          onClick={handlePlay}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handlePlay(e);
          }}
          role="button"
          tabIndex={0}
          title="Play album"
        >
          <Play
            fill="currentColor"
            size={18}
          />
        </div>
      </div>
      <div className="jb-album-card-body">
        <div
          className="jb-album-card-name"
          title={album.album}
        >
          {album.album || '(Untitled)'}
        </div>
        <div
          className="jb-album-card-artist"
          title={album.artist}
        >
          {album.artist}
        </div>
        {meta ? <div className="jb-album-card-meta">{meta}</div> : null}
        {album.indexedAt ? (
          <div className="jb-album-card-date">
            {formatIndexedAt(album.indexedAt)}
          </div>
        ) : null}
        <div className="jb-album-card-actions">
          {/* div, not button — see the play control above. */}
          <div
            className="jb-icon-btn"
            onClick={handleShuffle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') handleShuffle(e);
            }}
            role="button"
            style={{ background: 'transparent', border: 'none' }}
            tabIndex={0}
            title="Shuffle album"
          >
            <Shuffle size={12} />
          </div>
        </div>
      </div>
    </button>
  );
};

export default AlbumsView;
