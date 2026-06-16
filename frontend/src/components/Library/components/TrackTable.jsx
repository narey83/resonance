import { useLibraryActivity } from '../../../context/LibraryActivityContext';
import { usePlayer } from '../../../context/PlayerContext';
import { formatIndexedAt, formatSeconds } from '../../../lib/util';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ChevronDown,
  ChevronUp,
  Heart,
  ListFilter,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'react-toastify';

const toQueue = (track) => ({
  album: track.album,
  artist: track.artist,
  filename: track.path,
  hasArtwork: track.hasArtwork,
  length: track.duration,
  localRelativePath: track.path,
  path: track.path,
  title: track.title || track.filename,
});

const alphaKey = (s) => {
  const c = s?.trim()?.[0]?.toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
};

const ROW_HEIGHT = 36;

const TrackTable = ({
  alphaHandlerRef,
  loading,
  onContextMenu,
  onDeleteTracks,
  scrollContainerRef,
  showAdded = true,
  tracks = [],
}) => {
  const {
    isPlaying: playerIsPlaying,
    playQueue,
    track: currentTrack,
  } = usePlayer();
  const activity = useLibraryActivity();
  const lovedPaths = activity?.lovedPaths ?? new Set();
  const playStats = useMemo(
    () => activity?.playStats ?? new Map(),
    [activity?.playStats],
  );

  const [filters, setFilters] = useState({ title: '', artist: '', album: '' });
  const [activeCol, setActiveCol] = useState(null);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [selectedPaths, setSelectedPaths] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const containerRef = useRef(null);
  const lastClickIndex = useRef(null);

  const filteredTracks = useMemo(() => {
    const { album, artist, title } = filters;
    if (!title && !artist && !album) return tracks;
    const tl = title.toLowerCase();
    const al = artist.toLowerCase();
    const abl = album.toLowerCase();
    return tracks.filter(
      (t) =>
        (!tl || (t.title || t.filename || '').toLowerCase().includes(tl)) &&
        (!al || (t.artist || '').toLowerCase().includes(al)) &&
        (!abl || (t.album || '').toLowerCase().includes(abl)),
    );
  }, [filters, tracks]);

  const sortedTracks = useMemo(() => {
    if (!sortCol) return filteredTracks;
    const copy = [...filteredTracks];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'title')
        cmp = (a.title || a.filename || '').localeCompare(
          b.title || b.filename || '',
        );
      else if (sortCol === 'artist')
        cmp = (a.artist || '').localeCompare(b.artist || '');
      else if (sortCol === 'album')
        cmp = (a.album || '').localeCompare(b.album || '');
      else if (sortCol === 'key')
        cmp = (a.key || '').localeCompare(b.key || '');
      else if (sortCol === 'bpm') cmp = (a.bpm ?? 0) - (b.bpm ?? 0);
      else if (sortCol === 'duration')
        cmp = (a.duration ?? 0) - (b.duration ?? 0);
      else if (sortCol === 'plays')
        cmp =
          (playStats.get(a.path)?.playCount ?? 0) -
          (playStats.get(b.path)?.playCount ?? 0);
      else if (sortCol === 'added')
        cmp = (a.indexedAt ?? 0) - (b.indexedAt ?? 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredTracks, playStats, sortCol, sortDir]);

  const filteredQueue = useMemo(
    () => sortedTracks.map(toQueue),
    [sortedTracks],
  );

  // Drop selections for tracks that are no longer in the list
  useEffect(() => {
    setSelectedPaths((previous) => {
      if (previous.size === 0) return previous;
      const pathSet = new Set(tracks.map((t) => t.path));
      const next = new Set([...previous].filter((p) => pathSet.has(p)));
      return next.size === previous.size ? previous : next;
    });
  }, [tracks]);

  const virtualizer = useVirtualizer({
    count: sortedTracks.length,
    getScrollElement: () => (scrollContainerRef ?? containerRef).current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    paddingEnd: 100,
  });

  useEffect(() => {
    if (!alphaHandlerRef) return undefined;
    alphaHandlerRef.current = (letter) => {
      const index = sortedTracks.findIndex(
        (t) => alphaKey(t.title || t.filename) === letter,
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
  }, [alphaHandlerRef, sortedTracks, virtualizer]);

  const setFilter = (col, value) => setFilters((f) => ({ ...f, [col]: value }));
  const clearFilter = (col) => {
    setFilter(col, '');
    setActiveCol(null);
  };

  const selectMode = Boolean(onDeleteTracks && isEditMode);
  const someSelected = selectedPaths.size > 0;
  const allSelected =
    sortedTracks.length > 0 &&
    sortedTracks.every((t) => selectedPaths.has(t.path));

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(sortedTracks.map((t) => t.path)));
    }

    lastClickIndex.current = null;
  }, [allSelected, sortedTracks]);

  const handleRowClick = useCallback(
    (e, track, index) => {
      if (e.shiftKey && lastClickIndex.current !== null) {
        const start = Math.min(lastClickIndex.current, index);
        const end = Math.max(lastClickIndex.current, index);
        setSelectedPaths((previous) => {
          const next = new Set(previous);
          for (let index_ = start; index_ <= end; index_++)
            next.add(sortedTracks[index_].path);
          return next;
        });
      } else {
        setSelectedPaths((previous) => {
          const next = new Set(previous);
          if (next.has(track.path)) next.delete(track.path);
          else next.add(track.path);
          return next;
        });
        lastClickIndex.current = index;
      }
    },
    [sortedTracks],
  );

  const handleDeleteSelected = useCallback(async () => {
    if (!onDeleteTracks || deleting) return;
    setDeleting(true);
    try {
      await onDeleteTracks([...selectedPaths]);
      setSelectedPaths(new Set());
      setIsEditMode(false);
    } catch (error) {
      const raw = error?.response?.data;
      const message =
        typeof raw === 'string' ? raw : error?.message || 'Delete failed';
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }, [deleting, onDeleteTracks, selectedPaths]);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
    setIsEditMode(false);
    lastClickIndex.current = null;
  }, []);

  const handleSort = useCallback(
    (col) => {
      if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      else {
        setSortCol(col);
        setSortDir('asc');
      }
    },
    [sortCol],
  );

  // Plain render functions — not components — so React doesn't remount on every render
  const colHeader = (col, label, className) => {
    const isActive = activeCol === col;
    const value = filters[col];
    const isSortActive = sortCol === col;

    if (isActive) {
      return (
        <div className={`${className} jb-col-filter-wrap`}>
          <input
            autoFocus
            className="jb-col-filter-input"
            onBlur={() => setActiveCol(null)}
            onChange={(e) => setFilter(col, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') clearFilter(col);
              if (e.key === 'Enter') setActiveCol(null);
            }}
            placeholder={`Filter ${label}…`}
            value={value}
          />
          {value && (
            <button
              className="jb-col-filter-x"
              onMouseDown={(e) => {
                e.preventDefault();
                clearFilter(col);
              }}
              type="button"
            >
              <X size={9} />
            </button>
          )}
        </div>
      );
    }

    return (
      <div className={`${className} jb-col-hdr-wrap`}>
        <button
          className={`jb-col-hdr-btn${isSortActive ? ' jb-col-hdr-btn--sort-active' : ''}${value ? ' jb-col-hdr-btn--active' : ''}`}
          onClick={() => handleSort(col)}
          type="button"
        >
          <span className="jb-col-hdr-value">{value || label}</span>
          {isSortActive &&
            (sortDir === 'asc' ? (
              <ChevronUp size={10} />
            ) : (
              <ChevronDown size={10} />
            ))}
        </button>
        {value ? (
          <span
            className="jb-col-filter-x"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              clearFilter(col);
            }}
            role="button"
            tabIndex={-1}
          >
            <X size={9} />
          </span>
        ) : (
          <button
            className="jb-col-filter-icon"
            onClick={() => setActiveCol(col)}
            title={`Filter by ${label}`}
            type="button"
          >
            <ListFilter size={9} />
          </button>
        )}
      </div>
    );
  };

  const plainSortHeader = (col, label, className) => {
    const active = sortCol === col;
    return (
      <div className={className}>
        <button
          className={`jb-col-hdr-btn${active ? ' jb-col-hdr-btn--sort-active' : ''}`}
          onClick={() => handleSort(col)}
          type="button"
        >
          <span className="jb-col-hdr-value">{label}</span>
          {active &&
            (sortDir === 'asc' ? (
              <ChevronUp size={10} />
            ) : (
              <ChevronDown size={10} />
            ))}
        </button>
      </div>
    );
  };

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <>
      {onDeleteTracks && (
        <div className="jb-tt-mode-bar">
          <button
            className={`jb-icon-btn${isEditMode ? ' jb-icon-btn--active' : ''}`}
            onClick={() => {
              if (isEditMode) clearSelection();
              else setIsEditMode(true);
            }}
            title={isEditMode ? 'Cancel' : 'Select tracks to delete'}
            type="button"
          >
            {isEditMode ? <X size={15} /> : <Trash2 size={15} />}
          </button>
        </div>
      )}
      <div
        className={`jb-track-table${showAdded ? ' jb-track-table--with-added' : ''}`}
        ref={scrollContainerRef ? undefined : containerRef}
      >
        <div className="jb-track-table-head">
          <div className="jb-tt-num">
            {selectMode ? (
              <input
                checked={allSelected}
                className="jb-tt-select-all"
                onChange={toggleSelectAll}
                ref={(element) => {
                  if (element)
                    element.indeterminate = someSelected && !allSelected;
                }}
                title={allSelected ? 'Deselect all' : 'Select all'}
                type="checkbox"
              />
            ) : (
              '#'
            )}
          </div>
          {colHeader('title', 'Title', 'jb-tt-title')}
          {colHeader('artist', 'Artist', 'jb-tt-artist')}
          {colHeader('album', 'Album', 'jb-tt-album')}
          {plainSortHeader('key', 'Key', 'jb-tt-key')}
          {plainSortHeader('bpm', 'BPM', 'jb-tt-bpm')}
          {plainSortHeader('duration', 'Time', 'jb-tt-dur')}
          {plainSortHeader('plays', 'Plays', 'jb-tt-plays')}
          {showAdded && plainSortHeader('added', 'Added', 'jb-tt-added')}
          <div className="jb-tt-love">
            <Heart
              size={13}
              strokeWidth={1.75}
            />
          </div>
        </div>

        {loading && (
          <div className="jb-state">
            <div className="jb-spinner" />
            Loading tracks…
          </div>
        )}

        {!loading && !tracks.length && (
          <div className="jb-state">No tracks found</div>
        )}

        {!loading && tracks.length > 0 && sortedTracks.length === 0 && (
          <div
            className="jb-state"
            style={{ minHeight: 120 }}
          >
            No tracks match the filter
          </div>
        )}

        {!loading && sortedTracks.length > 0 && (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: 'relative',
            }}
          >
            {virtualItems.map((vRow) => {
              const track = sortedTracks[vRow.index];
              const index = vRow.index;
              const isPlaying =
                currentTrack?.filename === track.path ||
                currentTrack?.localRelativePath === track.path;
              const isLoved = lovedPaths.has(track.path);
              const stat = playStats.get(track.path);
              const isSelected = selectedPaths.has(track.path);

              return (
                <div
                  key={track.path}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: `${vRow.size}px`,
                    transform: `translateY(${vRow.start}px)`,
                  }}
                >
                  <div
                    className={`jb-track-row${isPlaying ? ' jb-track-row--playing' : ''}${isSelected ? ' jb-track-row--selected' : ''}`}
                    draggable={!selectMode}
                    onClick={
                      selectMode
                        ? (e) => handleRowClick(e, track, vRow.index)
                        : undefined
                    }
                    onContextMenu={(mouseEvent) => {
                      mouseEvent.preventDefault();
                      onContextMenu(mouseEvent, toQueue(track));
                    }}
                    onDoubleClick={
                      selectMode
                        ? undefined
                        : () => playQueue(filteredQueue, vRow.index)
                    }
                    onDragStart={
                      selectMode
                        ? undefined
                        : (e) => {
                            e.dataTransfer.setData(
                              'application/resonance-track',
                              JSON.stringify(toQueue(track)),
                            );
                            e.dataTransfer.effectAllowed = 'copy';
                          }
                    }
                  >
                    <div className="jb-track-num">
                      {selectMode ? (
                        <input
                          checked={isSelected}
                          className="jb-tt-checkbox"
                          onChange={(e) => handleRowClick(e, track, vRow.index)}
                          onClick={(e) => e.stopPropagation()}
                          type="checkbox"
                        />
                      ) : isPlaying ? (
                        <span
                          className={`jb-equalizer${playerIsPlaying ? '' : ' jb-equalizer--paused'}`}
                        >
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : (
                        <>
                          <span className="jb-track-num-text">{index + 1}</span>
                          <button
                            className="jb-track-play-btn"
                            onClick={() => playQueue(filteredQueue, vRow.index)}
                            type="button"
                          >
                            <Play size={12} />
                          </button>
                        </>
                      )}
                    </div>
                    <div className="jb-tt-title">
                      {track.title || track.filename}
                    </div>
                    <div className="jb-tt-artist">{track.artist || '–'}</div>
                    <div className="jb-tt-album">{track.album || '–'}</div>
                    <div className="jb-tt-key">{track.key || '–'}</div>
                    <div className="jb-tt-bpm">{track.bpm ?? '–'}</div>
                    <div className="jb-track-duration">
                      {track.duration ? formatSeconds(track.duration) : '–'}
                    </div>
                    <div className="jb-tt-plays">{stat?.playCount ?? '–'}</div>
                    {showAdded && (
                      <div className="jb-tt-added">
                        {formatIndexedAt(track.indexedAt) || '–'}
                      </div>
                    )}
                    <div className="jb-tt-love">
                      <button
                        className={`jb-love-btn${isLoved ? ' jb-love-btn--loved' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          activity?.toggleLove(track.path);
                        }}
                        title={
                          isLoved ? 'Remove from loved' : 'Love this track'
                        }
                        type="button"
                      >
                        <Heart
                          fill={isLoved ? 'currentColor' : 'none'}
                          size={13}
                          strokeWidth={1.75}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {someSelected && (
        <div className="jb-track-selection-bar">
          <span className="jb-selection-bar-msg">
            {selectedPaths.size} {selectedPaths.size === 1 ? 'track' : 'tracks'}{' '}
            selected
          </span>
          <button
            className="jb-btn"
            disabled={deleting}
            onClick={clearSelection}
            type="button"
          >
            Clear
          </button>
          <button
            className="jb-btn jb-btn--danger"
            disabled={deleting}
            onClick={handleDeleteSelected}
            type="button"
          >
            <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
    </>
  );
};

export default TrackTable;
