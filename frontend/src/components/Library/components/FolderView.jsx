import { artworkUrl as mixtapeArtworkUrl } from '../../../lib/mixtapes';
import { getTracks } from '../../../lib/musicLibrary';
import * as prefs from '../../../lib/prefs';
import { formatIndexedAt } from '../../../lib/util';
import AlbumArt from './AlbumArt';
import SortButton from './SortButton';
import TrackTable from './TrackTable';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeft, Clock, Play } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

const alphaKey = (s) => {
  const c = s?.trim()?.[0]?.toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
};

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
  onContextMenu,
  onDeleteTracks,
  onFolderContextMenu,
  onPlayFolder,
  removedTrackPath,
  scrollContainerRef,
  tileSize = 160,
  viewMode = 'tile',
}) => {
  const [selected, setSelected] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [tracksLoading, setTracksLoading] = useState(false);
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

  useEffect(() => {
    if (!initialFolder || !folders.length) return;
    const folder = folders.find((f) => f.path === initialFolder);
    if (folder) setSelected(folder);
  }, [folders, initialFolder]);

  useEffect(() => {
    if (!selected) return undefined;
    let cancelled = false;
    setTracksLoading(true);
    setTracks([]);

    getTracks({ folder: selected.path, limit: 5_000 })
      .then((result) => {
        if (!cancelled) setTracks(result.tracks ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setTracksLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  useEffect(() => {
    if (removedTrackPath) {
      setTracks((previous) =>
        previous.filter((t) => t.path !== removedTrackPath),
      );
    }
  }, [removedTrackPath]);

  const sorted = useMemo(() => {
    const copy = [...folders];
    copy.sort((a, b) => {
      const cmp =
        sortBy === 'date'
          ? (a.indexedAt ?? 0) - (b.indexedAt ?? 0)
          : a.name.localeCompare(b.name);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [folders, sortBy, sortDir]);

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollContainerRef?.current ?? null,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    paddingStart: 8,
    paddingEnd: 8,
  });

  useEffect(() => {
    if (!alphaHandlerRef || viewMode !== 'list' || selected) return undefined;
    alphaHandlerRef.current = (letter) => {
      const index = sorted.findIndex((f) => alphaKey(f.name) === letter);
      if (index >= 0)
        virtualizer.scrollToIndex(index, {
          align: 'start',
          behavior: 'smooth',
        });
    };

    return () => {
      alphaHandlerRef.current = null;
    };
  }, [alphaHandlerRef, selected, sorted, viewMode, virtualizer]);

  if (loading) {
    return (
      <div className="jb-state">
        <div className="jb-spinner" />
        Loading folders…
      </div>
    );
  }

  if (!folders.length) {
    return <div className="jb-state">No folders found in library.</div>;
  }

  if (selected) {
    return (
      <div className="jb-folder-detail-view">
        <div className="jb-section-header">
          <button
            className="jb-icon-btn"
            onClick={() => setSelected(null)}
            title="Back to folders"
            type="button"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="jb-section-title">{selected.name}</span>
          <span className="jb-section-count">{selected.trackCount} tracks</span>
          <div className="jb-section-controls">
            <button
              className="jb-btn jb-btn--primary"
              onClick={() => onPlayFolder(selected.path)}
              type="button"
            >
              <Play size={12} />
              Play
            </button>
          </div>
        </div>
        <TrackTable
          alphaHandlerRef={alphaHandlerRef}
          loading={tracksLoading}
          onContextMenu={onContextMenu}
          onDeleteTracks={
            onDeleteTracks
              ? async (paths) => {
                  await onDeleteTracks(paths);
                  setTracks((previous) =>
                    previous.filter((t) => !paths.includes(t.path)),
                  );
                }
              : undefined
          }
          tracks={tracks}
        />
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <>
      <div className="jb-folder-sort-bar">
        <span className="jb-sort-label">Sort by</span>
        <SortButton
          field="name"
          label="Name"
          onSort={setSort}
          sortBy={sortBy}
          sortDir={sortDir}
        />
        <SortButton
          field="date"
          label={
            <>
              <Clock size={11} /> Date Added
            </>
          }
          onSort={setSort}
          sortBy={sortBy}
          sortDir={sortDir}
        />
      </div>
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
