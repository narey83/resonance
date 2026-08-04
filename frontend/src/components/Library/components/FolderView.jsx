// <copyright file="FolderView.jsx" company="John Narey">
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

import { nameHue } from '../../../lib/accentHue';
import { alphaKey } from '../../../lib/alphaBucket';
import { artworkUrl as mixtapeArtworkUrl } from '../../../lib/mixtapes';
import * as prefs from '../../../lib/prefs';
import { usePagedTracks } from '../../../lib/usePagedList';
import { formatIndexedAt, trackCountLabel } from '../../../lib/util';
import AlbumArt from './AlbumArt';
import LibraryDetailHeader from './LibraryDetailHeader';
import LibraryViewHeader from './LibraryViewHeader';
import TrackTable from './TrackTable';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Play } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

const ROW_HEIGHT = 56;

const FolderCard = ({
  folder,
  mixtapeArtSrc,
  onContextMenu,
  onPlay,
  onSelect,
}) => (
  <button
    className="jb-folder-card"
    onClick={() => onSelect(folder)}
    onContextMenu={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu?.(e, folder);
    }}
    title={folder.path}
    type="button"
  >
    <div className="jb-folder-card-art">
      <AlbumArt
        hasArtwork={folder.hasArtwork || Boolean(mixtapeArtSrc)}
        name={folder.name}
        path={folder.coverPath}
        radius={0}
        size={160}
        src={mixtapeArtSrc}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          minWidth: 'unset',
        }}
      />
      <div
        className="jb-folder-card-play"
        onClick={(e) => {
          e.stopPropagation();
          onPlay(folder.path);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            onPlay(folder.path);
          }
        }}
        role="button"
        tabIndex={0}
        title={`Play ${folder.name}`}
      >
        <Play
          fill="currentColor"
          size={18}
        />
      </div>
    </div>
    <div className="jb-folder-card-info">
      <div className="jb-folder-card-name">{folder.name}</div>
      <div className="jb-folder-card-meta">{folder.trackCount} tracks</div>
      {folder.indexedAt ? (
        <div className="jb-folder-card-date">
          {formatIndexedAt(folder.indexedAt)}
        </div>
      ) : null}
    </div>
  </button>
);

const FolderRow = ({
  folder,
  mixtapeArtSrc,
  onContextMenu,
  onPlay,
  onSelect,
}) => (
  <div
    className="jb-folder-row"
    onClick={() => onSelect(folder)}
    onContextMenu={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu?.(e, folder);
    }}
    style={{ height: ROW_HEIGHT }}
  >
    <AlbumArt
      hasArtwork={folder.hasArtwork || Boolean(mixtapeArtSrc)}
      name={folder.name}
      path={folder.coverPath}
      radius={5}
      size={44}
      src={mixtapeArtSrc}
    />
    <div className="jb-folder-row-info">
      <span className="jb-folder-row-name">{folder.name}</span>
      <span className="jb-folder-row-meta">{folder.trackCount} tracks</span>
    </div>
    {folder.indexedAt ? (
      <span className="jb-folder-row-date">
        {formatIndexedAt(folder.indexedAt)}
      </span>
    ) : null}
    <div
      className="jb-list-play-btn"
      onClick={(e) => {
        e.stopPropagation();
        onPlay(folder.path);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation();
          onPlay(folder.path);
        }
      }}
      role="button"
      tabIndex={0}
      title={`Play ${folder.name}`}
    >
      <Play size={11} />
    </div>
  </div>
);

const FolderView = ({
  alphaHandlerRef,
  folders,
  initialFolder,
  loading,
  mixtapes = [],
  onAlphaEnabled,
  onContextMenu,
  onDeleteTracks,
  onFolderContextMenu,
  onPlayFolder,
  removedPaths,
  scrollContainerRef,
  tileSize = 160,
  viewMode = 'tile',
}) => {
  const [selected, setSelected] = useState(null);
  const [folderFilter, setFolderFilter] = useState('');
  const [listLetter, setListLetter] = useState(null);

  const {
    alphaApplies: trackAlphaApplies,
    clearLetter,
    isDefaultView: tracksAreDefault,
    letter,
    reset: resetTracks,
    total: trackTotal,
    trackTableProps,
  } = usePagedTracks(
    { folder: selected?.path },
    { defaultSort: 'title', enabled: Boolean(selected) },
  );

  const tracks = useMemo(
    () =>
      removedPaths.size === 0
        ? trackTableProps.tracks
        : trackTableProps.tracks.filter((t) => !removedPaths.has(t.path)),
    [removedPaths, trackTableProps.tracks],
  );

  const [sortBy, setSortBy] = useState(() =>
    prefs.get('resonance-folders-sort-by', 'name'),
  );
  const [sortDir, setSortDir] = useState(() =>
    prefs.get('resonance-folders-sort-dir', 'asc'),
  );

  const getMixtapeArtSource = useCallback(
    (folder) => {
      const m = mixtapes.find((mx) => mx.name === folder.name);
      return m?.hasArtwork
        ? `${mixtapeArtworkUrl(m.id)}?v=${m.updatedAt}`
        : undefined;
    },
    [mixtapes],
  );

  const setSort = (field) => {
    if (field === sortBy) {
      const next = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(next);
      prefs.set('resonance-folders-sort-dir', next);
    } else {
      setSortBy(field);
      setSortDir('asc');
      prefs.set('resonance-folders-sort-by', field);
      prefs.set('resonance-folders-sort-dir', 'asc');
    }
  };

  // Two lists share this view and the rail: the folder list itself (sorted here, in memory)
  // and the selected folder's paged tracks. Whichever is on screen decides.
  const foldersAreDefault =
    sortBy === 'name' && sortDir === 'asc' && !folderFilter && !listLetter;
  const alphaApplies = selected ? trackAlphaApplies : foldersAreDefault;
  useEffect(() => {
    onAlphaEnabled?.(alphaApplies);
  }, [alphaApplies, onAlphaEnabled]);

  const resetFolders = () => {
    setSortBy('name');
    setSortDir('asc');
    setFolderFilter('');
    setListLetter(null);
    prefs.set('resonance-folders-sort-by', 'name');
    prefs.set('resonance-folders-sort-dir', 'asc');
  };

  useEffect(() => {
    if (!initialFolder || !folders.length) return;
    const folder = folders.find((f) => f.path === initialFolder);
    if (folder) setSelected(folder);
  }, [folders, initialFolder]);

  const sorted = useMemo(() => {
    const q = folderFilter.toLowerCase();
    const copy = folders.filter(
      (f) =>
        (!q ||
          f.name.toLowerCase().includes(q) ||
          f.path.toLowerCase().includes(q)) &&
        (!listLetter || alphaKey(f.name) === listLetter),
    );
    copy.sort((a, b) => {
      const cmp =
        sortBy === 'date'
          ? (a.indexedAt ?? 0) - (b.indexedAt ?? 0)
          : a.name.localeCompare(b.name);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [folderFilter, folders, listLetter, sortBy, sortDir]);

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollContainerRef?.current ?? null,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    paddingStart: 8,
    paddingEnd: 8,
  });

  useEffect(() => {
    if (!alphaHandlerRef || selected) return undefined;
    alphaHandlerRef.current = (next) =>
      setListLetter((current) => (current === next ? null : next));
    return () => {
      alphaHandlerRef.current = null;
    };
  }, [alphaHandlerRef, selected]);

  // Both guards stand down once a folder is open: they describe the folder *list*, and the
  // open folder doesn't depend on it. A library refresh empties `folders` to force a refetch,
  // and letting that swap in a placeholder unmounted the TrackTable underneath an open folder
  // — which threw away its scroll position. Analysing a large folder writes tags to every
  // track, so the watcher fired this repeatedly and the list jumped to the top each time.
  if (loading && !selected) {
    return (
      <div className="jb-state">
        <div className="jb-spinner" />
        Loading folders…
      </div>
    );
  }

  if (!folders.length && !selected) {
    return <div className="jb-state">No folders found in library.</div>;
  }

  if (selected) {
    return (
      <div className="jb-detail-view">
        <LibraryDetailHeader
          actions={
            <button
              className="jb-btn jb-btn--primary"
              onClick={() => onPlayFolder(selected.path)}
              type="button"
            >
              <Play size={12} />
              Play
            </button>
          }
          hue={nameHue(selected.name)}
          isDefault={tracksAreDefault}
          letter={letter}
          meta={trackCountLabel(trackTotal || selected.trackCount || 0)}
          onBack={() => setSelected(null)}
          onClearLetter={clearLetter}
          onReset={resetTracks}
          title={selected.name}
        />
        <TrackTable
          {...trackTableProps}
          alphaHandlerRef={alphaHandlerRef}
          onContextMenu={onContextMenu}
          onDeleteTracks={onDeleteTracks}
          tracks={tracks}
        />
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <>
      <LibraryViewHeader
        filter={{
          onChange: setFolderFilter,
          placeholder: 'Filter folder…',
          value: folderFilter,
        }}
        isDefault={foldersAreDefault}
        letter={listLetter}
        onClearLetter={() => setListLetter(null)}
        onReset={resetFolders}
        onSort={setSort}
        sortBy={sortBy}
        sortDir={sortDir}
        sorts={[
          { field: 'name', label: 'Name' },
          { field: 'date', label: 'Date Added' },
        ]}
        title="Folders"
        total={sorted.length}
      />
      {sorted.length === 0 && <div className="jb-state">No folders match.</div>}
      {viewMode === 'list' ? (
        <div
          className="jb-folder-list"
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {virtualItems.map((vRow) => {
            const folder = sorted[vRow.index];
            return (
              <div
                key={folder.path}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: `${vRow.size}px`,
                  transform: `translateY(${vRow.start}px)`,
                }}
              >
                <FolderRow
                  folder={folder}
                  mixtapeArtSrc={getMixtapeArtSource(folder)}
                  onContextMenu={onFolderContextMenu}
                  onPlay={onPlayFolder}
                  onSelect={setSelected}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div
          className="jb-folders-grid"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`,
          }}
        >
          {sorted.map((folder) => (
            <FolderCard
              folder={folder}
              key={folder.path}
              mixtapeArtSrc={getMixtapeArtSource(folder)}
              onContextMenu={onFolderContextMenu}
              onPlay={onPlayFolder}
              onSelect={setSelected}
            />
          ))}
        </div>
      )}
    </>
  );
};

export default FolderView;
