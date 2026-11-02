// <copyright file="TrackTable.jsx" company="John Narey">
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

import { urlBase } from '../../../config';
import { useLibraryActivity } from '../../../context/LibraryActivityContext';
import { usePlayer } from '../../../context/PlayerContext';
import { useSetPlanner } from '../../../context/SetPlannerContext';
import useAnalysisQueue from '../../../hooks/useAnalysisQueue';
import { toast } from '../../../lib/activityNotices';
import { getMaskedFilename } from '../../../lib/analysis';
import { analysisStatus, djSummary } from '../../../lib/libraryWorkbench';
import { mixPath } from '../../../lib/mixCompatibility';
import * as prefs from '../../../lib/prefs';
import {
  formatAttributes,
  formatIndexedAt,
  formatSeconds,
  isRecentlyIndexed,
} from '../../../lib/util';
import WaveformPreview from '../../Shared/WaveformPreview';
import LibraryMenu from './LibraryMenu';
import { useMixPreview } from './MixCompatibilityPreview';
import PlaylistTools from './PlaylistTools';
import TrackInspector from './TrackInspector';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AudioWaveform,
  ChevronDown,
  ChevronUp,
  Headphones,
  Heart,
  ListChecks,
  ListFilter,
  Loader2,
  Play,
  Save,
  Sparkles,
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
import { createPortal } from 'react-dom';
import { useHistory } from 'react-router-dom';

const toQueue = (track) => ({
  album: track.album,
  artist: track.artist,
  filename: track.path,
  hasArtwork: track.hasArtwork,
  hasWaveform: track.hasWaveform,
  bpm: track.bpm,
  key: track.key,
  length: track.duration,
  lufs: track.lufs,
  localRelativePath: track.path,
  path: track.path,
  title: track.title || track.filename,
});

const alphaKey = (s) => {
  const c = s?.trim()?.[0]?.toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
};

const ROW_HEIGHT = 36;

const WIDTHS_PREF = 'library-column-widths';

// Column order and default track sizes. Flexible defaults stay flexible until the
// user drags one, at which point that column is pinned to the pixel width it had.
// num and love are icon slots and are not resizable.
// Title, artist and wave carry a floor rather than minmax(0, …): a 0 minimum lets the flexible
// columns be squeezed to nothing once the fixed ones fill the row, and since the table only
// scrolls vertically there was then no way to reach them — a narrow window hid the track names
// (and the waveform) entirely.
export const COLUMNS = [
  { def: '28px', fixed: true, id: 'num', min: 24 },
  { def: 'minmax(60px, 1fr)', id: 'wave', min: 60 },
  { def: 'minmax(80px, 2.2fr)', id: 'title', min: 80 },
  { def: 'minmax(60px, 1.4fr)', id: 'artist', min: 60 },
  { def: 'minmax(60px, 1.4fr)', id: 'album', min: 60 },
  { def: '44px', id: 'key', min: 32 },
  { def: '44px', id: 'bpm', min: 32 },
  { def: '100px', id: 'status', min: 80 },
  { def: '52px', id: 'lufs', min: 36 },
  { def: '42px', id: 'ext', min: 32 },
  { def: '72px', id: 'quality', min: 40 },
  { def: '52px', id: 'duration', min: 40 },
  { def: '36px', id: 'plays', min: 30 },
  { def: '160px', id: 'added', min: 60, onlyWhenAdded: true },
  { def: '28px', fixed: true, id: 'love', min: 24 },
];

// What a narrowing table gives up, in the order it gives it up. Floors alone only stop the names
// collapsing; without dropping something they'd still be squeezed to 80px of ellipsis. num, wave,
// title, artist, duration and love are deliberately absent — a row you can't read (or see the
// waveform of) isn't a track listing.
const DROP_ORDER = [
  'plays',
  'quality',
  'ext',
  'album',
  'lufs',
  'key',
  'bpm',
  'status',
];

const COLUMN_GAP = 10;
const ROW_PADDING = 48;

// The width a column will not go below: whatever it has been dragged to, else its own size if
// fixed, else its declared minimum.
const columnFloor = (column, widths) =>
  widths[column.id] ??
  (column.def.endsWith('px') ? Number.parseInt(column.def, 10) : column.min);

const requiredWidth = (columns, widths) =>
  columns.reduce((sum, c) => sum + columnFloor(c, widths), 0) +
  COLUMN_GAP * Math.max(0, columns.length - 1) +
  ROW_PADDING;

// Drops columns in DROP_ORDER until what's left actually fits. Returns everything when the width
// is unknown (first render, before the observer reports) so the table never starts out mutilated.
// Exported for testing — rendering the whole virtualised table to assert on arithmetic is a far
// heavier way to ask the same question.
export const fitColumns = (columns, width, widths) => {
  if (!width) return columns;

  const kept = [...columns];
  for (const id of DROP_ORDER) {
    if (requiredWidth(kept, widths) <= width) break;
    const index = kept.findIndex((c) => c.id === id);
    if (index !== -1) kept.splice(index, 1);
  }

  return kept;
};

// `serverSort`, `serverFilter` and `onEndReached` turn the table into a window onto a list the
// server is paging. All three are optional: without them the table sorts and filters the array
// it was handed, exactly as before — which is what the album, mixtape, loved and history views
// still want, since those lists are small enough to hold whole.
const TrackTable = ({
  alphaHandlerRef,
  loading,
  loadingMore = false,
  onAlphaJump,
  onAnalyzeTracks,
  onContextMenu,
  onDeleteTracks,
  onEndReached,
  onExportTracks,
  resolvePlaybackQueue,
  scrollContainerRef,
  serverFilter,
  serverSort,
  showAdded = true,
  toolbarTarget,
  tracks = [],
}) => {
  const {
    enqueueTrack,
    isPlaying: playerIsPlaying,
    playQueue,
    seekTrack,
    track: currentTrack,
  } = usePlayer();
  const mixPreview = useMixPreview();
  const setPlanner = useSetPlanner();
  const activity = useLibraryActivity();
  const lovedPaths = activity?.lovedPaths ?? new Set();
  const playStats = useMemo(
    () => activity?.playStats ?? new Map(),
    [activity?.playStats],
  );

  const history = useHistory();
  const scan = useAnalysisQueue();
  const [queuedPaths, setQueuedPaths] = useState(new Set());
  const scanActive = Boolean(scan.scanning || scan.enhancedPath);
  useEffect(() => {
    if (!scanActive) setQueuedPaths(new Set());
  }, [scanActive]);
  const activePath = (path) =>
    [...(scan.inFlightPaths || []), scan.enhancedPath]
      .filter(Boolean)
      .some((p) => p === path || p.endsWith(`/${path}`));
  const [layout, setLayout] = useState(() =>
    prefs.get('library.layout', 'browse'),
  );
  const [columnPanel, setColumnPanel] = useState(false);
  const defaultHidden = {
    browse: ['lufs', 'ext', 'quality', 'added', 'plays'],
    prepare: ['album', 'ext', 'quality', 'plays', 'added'],
    export: ['lufs', 'plays'],
  };
  const [hidden, setHidden] = useState(() =>
    prefs.get(`library.layout.${layout}.hidden`, defaultHidden[layout] || []),
  );
  const [order, setOrder] = useState(() =>
    prefs.get(
      `library.layout.${layout}.order`,
      COLUMNS.map((c) => c.id),
    ),
  );
  const [inspected, setInspected] = useState(null);
  const [reviewed, setReviewed] = useState(() =>
    prefs.get('library.reviewedTracks', {}),
  );
  const hasReviewed = (track) =>
    Boolean(
      djSummary(track).analysisId &&
        reviewed[track.path] === djSummary(track).analysisId,
    );
  const closeInspector = useCallback(() => setInspected(null), []);

  const [localFilters, setLocalFilters] = useState({
    title: '',
    artist: '',
    album: '',
  });
  const [activeCol, setActiveCol] = useState(null);
  const [localSortCol, setLocalSortCol] = useState(null);
  const [localSortDir, setLocalSortDir] = useState('asc');

  // In server mode the three column boxes drive the one thing the server can filter on: a
  // search across title/artist/album/key. We remember which box was typed into purely so the
  // text stays where the user put it — the query is the same whichever one they used.
  const [serverFilterCol, setServerFilterCol] = useState('title');

  const sortCol = serverSort ? serverSort.col : localSortCol;
  const sortDir = serverSort ? serverSort.dir : localSortDir;
  const filters = useMemo(
    () =>
      serverFilter
        ? {
            title: '',
            artist: '',
            album: '',
            [serverFilterCol]: serverFilter.value,
          }
        : localFilters,
    [localFilters, serverFilter, serverFilterCol],
  );
  const [selectedPaths, setSelectedPaths] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  // Right-click on a row that's part of the current multi-selection opens this instead of
  // the caller's single-track menu — see the row's onContextMenu below.
  const [bulkMenu, setBulkMenu] = useState(null);
  const containerRef = useRef(null);
  const lastClickIndex = useRef(null);

  // Which rows' WaveformPreview is currently running an analysis — surfaced here so the
  // key/BPM/LUFS cells can show the same spinner the waveform cell already does, instead of
  // looking done while the row's own metrics are still mid-decode.
  const [analysingPaths, setAnalysingPaths] = useState(() => new Set());
  const handleAnalysingChange = useCallback((path, isAnalysing) => {
    setAnalysingPaths((previous) => {
      if (previous.has(path) === isAnalysing) return previous;
      const next = new Set(previous);
      if (isAnalysing) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  // Server mode: the rows arrived already filtered and ordered by the query, so re-doing either
  // here would only re-apply it to the window we happen to hold — and get it wrong.
  const filteredTracks = useMemo(() => {
    if (serverFilter) return tracks;
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
  }, [filters, serverFilter, tracks]);

  const sortedTracks = useMemo(() => {
    if (serverSort || !sortCol) return filteredTracks;
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
      else if (sortCol === 'lufs')
        cmp =
          (a.lufs ?? Number.NEGATIVE_INFINITY) -
          (b.lufs ?? Number.NEGATIVE_INFINITY);
      else if (sortCol === 'ext')
        cmp = (a.extension || '').localeCompare(b.extension || '');
      else if (sortCol === 'quality')
        cmp =
          (a.bitRate ?? a.sampleRate ?? 0) - (b.bitRate ?? b.sampleRate ?? 0);
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
  }, [filteredTracks, playStats, serverSort, sortCol, sortDir]);

  const filteredQueue = useMemo(
    () => sortedTracks.map(toQueue),
    [sortedTracks],
  );

  // Paged collections can resolve a queue beyond the rows currently visible.
  const requestPlayback = async (track, index, time) => {
    let queued = filteredQueue;
    let queueIndex = index;
    if (resolvePlaybackQueue) {
      const resolved = await resolvePlaybackQueue(track, index);
      if (!resolved) return;
      queued = resolved.tracks.map(toQueue);
      queueIndex = resolved.index;
    }

    if (time === undefined) playQueue(queued, queueIndex);
    else
      seekTrack(queued, queueIndex, time, {
        replaceQueue: Boolean(resolvePlaybackQueue),
      });
  };

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
      // Server mode: the letter almost certainly isn't in the window we hold, so ask for that
      // bucket instead of scrolling to a row that was never loaded.
      if (onAlphaJump) {
        onAlphaJump(letter);
        return;
      }

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
  }, [alphaHandlerRef, onAlphaJump, sortedTracks, virtualizer]);

  // Ask for the next page while there's still a screenful or so left below, so the list keeps
  // moving instead of stalling at the bottom every 200 rows.
  const lastVisibleIndex = virtualizer.getVirtualItems().at(-1)?.index ?? -1;
  useEffect(() => {
    if (onEndReached && lastVisibleIndex >= sortedTracks.length - 30) {
      onEndReached();
    }
  }, [lastVisibleIndex, onEndReached, sortedTracks.length]);

  const setFilter = (col, value) => {
    if (serverFilter) {
      setServerFilterCol(col);
      serverFilter.onChange(value);
      return;
    }

    setLocalFilters((f) => ({ ...f, [col]: value }));
  };

  const clearFilter = (col) => {
    setFilter(col, '');
    setActiveCol(null);
  };

  const selectMode = Boolean(
    (onDeleteTracks || onExportTracks || onAnalyzeTracks) && isEditMode,
  );
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

  const handleExportSelected = useCallback(async () => {
    if (!onExportTracks || exporting) return;
    setExporting(true);
    try {
      const selected = sortedTracks.filter((t) => selectedPaths.has(t.path));
      await onExportTracks(selected);
      setSelectedPaths(new Set());
      setIsEditMode(false);
    } finally {
      setExporting(false);
    }
  }, [exporting, onExportTracks, selectedPaths, sortedTracks]);

  const handleAnalyzeSelected = useCallback(async () => {
    if (!onAnalyzeTracks || analysing) return;
    setAnalysing(true);
    try {
      setQueuedPaths(new Set(selectedPaths));
      await onAnalyzeTracks([...selectedPaths]);
      setSelectedPaths(new Set());
      setIsEditMode(false);
    } finally {
      setAnalysing(false);
    }
  }, [analysing, onAnalyzeTracks, selectedPaths]);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
    setIsEditMode(false);
    lastClickIndex.current = null;
  }, []);

  const handleSort = useCallback(
    (col) => {
      const nextDir = col === sortCol && sortDir === 'asc' ? 'desc' : 'asc';
      if (serverSort) {
        serverSort.onChange(col, nextDir);
        return;
      }

      setLocalSortCol(col);
      setLocalSortDir(nextDir);
    },
    [serverSort, sortCol, sortDir],
  );

  // Plain render functions — not components — so React doesn't remount on every render
  const [colWidths, setColWidths] = useState(
    () =>
      prefs.get(
        `library.layout.${layout}.widths`,
        prefs.get(WIDTHS_PREF, {}),
      ) ?? {},
  );
  const changeLayout = (next) => {
    setLayout(next);
    prefs.set('library.layout', next);
    setHidden(
      prefs.get(`library.layout.${next}.hidden`, defaultHidden[next] || []),
    );
    setOrder(
      prefs.get(
        `library.layout.${next}.order`,
        COLUMNS.map((c) => c.id),
      ),
    );
    setColWidths(prefs.get(`library.layout.${next}.widths`, {}));
  };

  const reorder = (id, direction) => {
    const next = [...order];
    const index = next.indexOf(id);
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    prefs.set(`library.layout.${layout}.order`, next);
  };

  const editTags = async () => {
    try {
      const paths = [...selectedPaths];
      const maskedFilenames = [];
      for (const path of paths)
        maskedFilenames.push(await getMaskedFilename(path));
      history.push(`${urlBase}/tags`, { maskedFilenames });
    } catch {
      toast.error('Could not open the selected tracks in Tag Manager');
    }
  };

  const headRef = useRef(null);
  const dragRef = useRef(null);
  const waveHeadRef = useRef(null);

  // The table's own width, not the window's — the nav rail and queue panel come out of it, so a
  // window-width breakpoint would drop columns at the wrong moment.
  const [tableWidth, setTableWidth] = useState(0);
  useEffect(() => {
    const element = headRef.current;
    if (!element) return undefined;

    const observer = new ResizeObserver(([entry]) =>
      setTableWidth(entry.contentRect.width + ROW_PADDING),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The wave column is now flexible (minmax, not a fixed px), so its rendered width can only be
  // read off the DOM, not computed from colWidths — every row shares this one measurement rather
  // than each running its own observer.
  const [waveColPx, setWaveColPx] = useState(0);
  useEffect(() => {
    const element = waveHeadRef.current;
    if (!element) return undefined;

    const observer = new ResizeObserver(([entry]) =>
      setWaveColPx(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const activeColumns = useMemo(
    () =>
      fitColumns(
        COLUMNS.filter(
          (c) => (!c.onlyWhenAdded || showAdded) && !hidden.includes(c.id),
        ).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
        tableWidth,
        colWidths,
      ),
    [colWidths, hidden, order, showAdded, tableWidth],
  );

  // Cells are written out in column order rather than generated, so a dropped column has to skip
  // its cell too or every row shifts one place left of its heading.
  const shows = useMemo(
    () => new Set(activeColumns.map((c) => c.id)),
    [activeColumns],
  );

  const gridTemplate = useMemo(
    () =>
      activeColumns
        .map((c) => (colWidths[c.id] ? `${colWidths[c.id]}px` : c.def))
        .join(' '),
    [activeColumns, colWidths],
  );

  // Dragging a flexible column needs a pixel value to start from, so its rendered
  // width is measured at grab time; from then on it is a fixed column.
  const startResize = (event, col) => {
    event.preventDefault();
    event.stopPropagation();
    const cell = event.currentTarget.parentElement;
    const meta = COLUMNS.find((c) => c.id === col);
    dragRef.current = {
      col,
      min: meta?.min ?? 40,
      startWidth: cell?.getBoundingClientRect().width ?? 100,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveResize = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = Math.max(
      drag.min,
      Math.round(drag.startWidth + (event.clientX - drag.startX)),
    );
    setColWidths((previous) => ({ ...previous, [drag.col]: next }));
  };

  const endResize = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    // Persisted once per gesture rather than per mouse-move; prefs debounces the
    // PATCH anyway, but there is no reason to queue a write for every pixel.
    setColWidths((previous) => {
      prefs.set(`library.layout.${layout}.widths`, previous);
      return previous;
    });
  };

  // Double-click a handle to give that column its default width back.
  const resetColumn = (col) =>
    setColWidths((previous) => {
      const next = { ...previous };
      delete next[col];
      prefs.set(`library.layout.${layout}.widths`, next);
      return next;
    });

  // Plain markup, not a nested component: a component declared in here gets a new
  // identity on every render, so the re-render each drag step causes would remount
  // the handle, drop its pointer capture and strand the drag after one move.
  const resizeHandle = (col) => (
    <span
      className="jb-col-resize"
      onDoubleClick={() => resetColumn(col)}
      onPointerDown={(e) => startResize(e, col)}
      onPointerMove={moveResize}
      onPointerUp={endResize}
      role="presentation"
      title="Drag to resize, double-click to reset"
    />
  );

  const colHeader = (col, label, className) => {
    const isActive = activeCol === col;
    const value = filters[col];
    const isSortActive = sortCol === col;

    if (isActive) {
      return (
        <div className={`${className} jb-col-filter-wrap`}>
          {resizeHandle(col)}
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
        {resizeHandle(col)}
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

    // Play counts live in a different schema from the library, so the server can't order by
    // them. Rather than offer a sort that would silently only reorder the loaded window,
    // the column is just a label while the list is server-paged.
    if (serverSort && col === 'plays') {
      return (
        <div className={className}>
          {resizeHandle(col)}
          <span className="jb-col-hdr-value">{label}</span>
        </div>
      );
    }

    return (
      <div className={className}>
        {resizeHandle(col)}
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

  // The preview is drawn at the column's actual rendered width (measured, since the column is
  // flexible), so resizing or narrowing the window reveals more or less of the waveform rather
  // than stretching the same picture.
  const waveWidth = Math.max(40, waveColPx - 10);

  const virtualItems = virtualizer.getVirtualItems();

  const toolbar = (
    <div className="library-table-controls">
      <LibraryMenu
        label="Library view"
        summary={
          <>
            <span className="library-toolbar-muted">View</span>
            <strong>{layout[0].toUpperCase() + layout.slice(1)}</strong>
          </>
        }
      >
        <div
          aria-label="Saved library layouts"
          className="library-layout-choices"
          role="group"
        >
          {['browse', 'prepare', 'export'].map((name) => (
            <button
              aria-pressed={layout === name}
              className="library-layout-choice"
              data-close-menu="true"
              key={name}
              onClick={() => changeLayout(name)}
              type="button"
            >
              <strong>{name[0].toUpperCase() + name.slice(1)}</strong>
              <span>
                {name === 'browse'
                  ? 'Essential track information'
                  : name === 'prepare'
                    ? 'Analysis, tempo and key'
                    : 'File formats and USB preparation'}
              </span>
            </button>
          ))}
        </div>
        <button
          aria-expanded={columnPanel}
          className="library-menu-action"
          onClick={() => setColumnPanel(!columnPanel)}
          type="button"
        >
          Customise columns <ChevronDown size={13} />
        </button>
        {columnPanel && (
          <div
            aria-label="Column settings"
            className="library-column-panel"
          >
            {order.map((id, index) => (
              <div key={id}>
                <label>
                  <input
                    checked={!hidden.includes(id)}
                    disabled={[
                      'num',
                      'wave',
                      'title',
                      'artist',
                      'duration',
                      'love',
                    ].includes(id)}
                    onChange={() => {
                      const next = hidden.includes(id)
                        ? hidden.filter((v) => v !== id)
                        : [...hidden, id];
                      setHidden(next);
                      prefs.set(`library.layout.${layout}.hidden`, next);
                    }}
                    type="checkbox"
                  />
                  {id === 'status' ? 'Analysis' : id}
                </label>
                <button
                  aria-label={`Move ${id} column left`}
                  className="jb-btn"
                  disabled={index === 0}
                  onClick={() => reorder(id, -1)}
                  type="button"
                >
                  ←
                </button>
                <button
                  aria-label={`Move ${id} column right`}
                  className="jb-btn"
                  disabled={index === order.length - 1}
                  onClick={() => reorder(id, 1)}
                  type="button"
                >
                  →
                </button>
              </div>
            ))}
            <button
              className="jb-btn"
              onClick={() => {
                const next = COLUMNS.map((c) => c.id);
                setOrder(next);
                setHidden(defaultHidden[layout]);
                setColWidths({});
                prefs.set(`library.layout.${layout}.order`, next);
                prefs.set(
                  `library.layout.${layout}.hidden`,
                  defaultHidden[layout],
                );
                prefs.set(`library.layout.${layout}.widths`, {});
              }}
              type="button"
            >
              Reset {layout} layout
            </button>
          </div>
        )}
      </LibraryMenu>
      {(onDeleteTracks || onExportTracks || onAnalyzeTracks) && (
        <button
          aria-label={isEditMode ? 'Done selecting' : 'Select tracks'}
          aria-pressed={isEditMode}
          className="library-toolbar-icon"
          onClick={() => {
            if (isEditMode) clearSelection();
            else setIsEditMode(true);
          }}
          title={isEditMode ? 'Done selecting' : 'Select tracks'}
          type="button"
        >
          {isEditMode ? <X size={15} /> : <ListChecks size={15} />}
        </button>
      )}
    </div>
  );

  return (
    <>
      {toolbarTarget ? (
        createPortal(toolbar, toolbarTarget)
      ) : (
        <div className="library-workbench-toolbar">{toolbar}</div>
      )}
      <div
        className={`jb-track-table${showAdded ? ' jb-track-table--with-added' : ''}`}
        ref={scrollContainerRef ? undefined : containerRef}
        style={Object.fromEntries(
          activeColumns.map((c, index) => [`--col-${c.id}`, index]),
        )}
      >
        <div
          className="jb-track-table-head"
          ref={headRef}
          style={{ gridTemplateColumns: gridTemplate }}
        >
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
          <div
            className="jb-tt-wave"
            ref={waveHeadRef}
          >
            {resizeHandle('wave')}
            Wave
          </div>
          {colHeader('title', 'Title', 'jb-tt-title')}
          {colHeader('artist', 'Artist', 'jb-tt-artist')}
          {shows.has('album') && colHeader('album', 'Album', 'jb-tt-album')}
          {shows.has('key') && plainSortHeader('key', 'Key', 'jb-tt-key')}
          {shows.has('bpm') && plainSortHeader('bpm', 'BPM', 'jb-tt-bpm')}
          {shows.has('status') && (
            <div className="jb-tt-status">{resizeHandle('status')}Analysis</div>
          )}
          {shows.has('lufs') && plainSortHeader('lufs', 'LUFS', 'jb-tt-lufs')}
          {shows.has('ext') && plainSortHeader('ext', 'Ext', 'jb-tt-ext')}
          {shows.has('quality') &&
            plainSortHeader('quality', 'Quality', 'jb-tt-quality')}
          {plainSortHeader('duration', 'Time', 'jb-tt-dur')}
          {shows.has('plays') &&
            plainSortHeader('plays', 'Plays', 'jb-tt-plays')}
          {shows.has('added') &&
            plainSortHeader('added', 'Added', 'jb-tt-added')}
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
          <div className="jb-state">
            {serverFilter?.value
              ? 'No tracks match the filter'
              : 'No tracks found'}
          </div>
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
                        : () => setInspected(track)
                    }
                    onContextMenu={(mouseEvent) => {
                      mouseEvent.preventDefault();
                      if (
                        selectMode &&
                        selectedPaths.size > 1 &&
                        selectedPaths.has(track.path)
                      ) {
                        setBulkMenu({
                          x: mouseEvent.clientX,
                          y: mouseEvent.clientY,
                        });
                        return;
                      }

                      onContextMenu?.(mouseEvent, toQueue(track));
                    }}
                    onDoubleClick={
                      selectMode
                        ? undefined
                        : () => requestPlayback(track, vRow.index)
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
                    style={{ gridTemplateColumns: gridTemplate }}
                  >
                    <div className="jb-track-num">
                      {selectMode ? (
                        <input
                          aria-label={`Select ${track.title || track.filename}`}
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
                            aria-label={`Play ${track.title || track.filename}`}
                            className="jb-track-play-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              void requestPlayback(track, vRow.index);
                            }}
                            type="button"
                          >
                            <Play size={12} />
                          </button>
                        </>
                      )}
                    </div>
                    <div className="jb-tt-wave">
                      <WaveformPreview
                        hasWaveform={track.hasWaveform}
                        height={24}
                        onAnalysingChange={(isAnalysing) =>
                          handleAnalysingChange(track.path, isAnalysing)
                        }
                        onSeek={
                          track.duration
                            ? (fraction) =>
                                requestPlayback(
                                  track,
                                  vRow.index,
                                  fraction * track.duration,
                                )
                            : undefined
                        }
                        path={track.path}
                        width={waveWidth}
                      />
                    </div>
                    <div
                      className="jb-tt-title"
                      title={track.title || track.filename}
                    >
                      <button
                        className="library-inspect-title"
                        onClick={(e) => {
                          if (!selectMode) {
                            e.stopPropagation();
                            setInspected(track);
                          }
                        }}
                        type="button"
                      >
                        {track.title || track.filename}
                        {isRecentlyIndexed(track.indexedAt) && (
                          <Sparkles
                            aria-label="Added in the last 7 days"
                            className="jb-new-item-icon"
                            size={13}
                          />
                        )}
                      </button>
                    </div>
                    <div
                      className="jb-tt-artist"
                      title={track.artist || ''}
                    >
                      {track.artist || '–'}
                    </div>
                    {shows.has('album') && (
                      <div
                        className="jb-tt-album"
                        title={track.album || ''}
                      >
                        {track.album || '–'}
                      </div>
                    )}
                    {shows.has('key') &&
                      (analysingPaths.has(track.path) ? (
                        <div className="jb-tt-key">
                          <Loader2
                            className="jb-spin"
                            size={12}
                          />
                        </div>
                      ) : (
                        <div className="jb-tt-key">{track.key || '–'}</div>
                      ))}
                    {shows.has('bpm') &&
                      (analysingPaths.has(track.path) ? (
                        <div className="jb-tt-bpm">
                          <Loader2
                            className="jb-spin"
                            size={12}
                          />
                        </div>
                      ) : (
                        <div className="jb-tt-bpm">{track.bpm || '–'}</div>
                      ))}
                    {shows.has('status') &&
                      (() => {
                        const status = analysisStatus(
                          track,
                          analysingPaths.has(track.path) ||
                            activePath(track.path)
                            ? true
                            : queuedPaths.has(track.path) && scanActive
                              ? 'queued'
                              : false,
                          hasReviewed(track),
                        );
                        return (
                          <div className="jb-tt-status">
                            <span
                              className={`library-analysis-badge is-${status.kind}`}
                              title={status.detail}
                            >
                              {status.label}
                            </span>
                          </div>
                        );
                      })()}
                    {shows.has('lufs') &&
                      (analysingPaths.has(track.path) ? (
                        <div className="jb-tt-lufs">
                          <Loader2
                            className="jb-spin"
                            size={12}
                          />
                        </div>
                      ) : (
                        <div className="jb-tt-lufs">
                          {track.lufs != null ? track.lufs.toFixed(1) : '–'}
                        </div>
                      ))}
                    {shows.has('ext') && (
                      <div className="jb-tt-ext">
                        {track.extension?.toUpperCase() || '–'}
                      </div>
                    )}
                    {shows.has('quality') && (
                      <div className="jb-tt-quality">
                        {formatAttributes(track) || '–'}
                      </div>
                    )}
                    <div className="jb-tt-dur">
                      {track.duration ? formatSeconds(track.duration) : '–'}
                    </div>
                    {shows.has('plays') && (
                      <div className="jb-tt-plays">
                        {stat?.playCount ?? '–'}
                      </div>
                    )}
                    {shows.has('added') && (
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

        {loadingMore && (
          <div className="jb-tt-more">
            <div className="jb-spinner" />
            Loading more…
          </div>
        )}
      </div>

      {someSelected && (
        <div className="jb-track-selection-bar">
          <span className="jb-selection-bar-msg">
            {selectedPaths.size} {selectedPaths.size === 1 ? 'track' : 'tracks'}{' '}
            selected ·{' '}
            {formatSeconds(
              tracks
                .filter((t) => selectedPaths.has(t.path))
                .reduce((total, t) => total + (t.duration || 0), 0),
            )}
          </span>
          <button
            className="jb-btn"
            onClick={() => {
              for (const track of tracks.filter((t) =>
                selectedPaths.has(t.path),
              ))
                enqueueTrack(toQueue(track));
              toast.success(`Added ${selectedPaths.size} tracks to queue`);
            }}
            type="button"
          >
            Add to queue
          </button>
          <button
            className="jb-btn"
            onClick={editTags}
            type="button"
          >
            Edit tags
          </button>
          <PlaylistTools paths={[...selectedPaths]} />
          {setPlanner && (
            <button
              className="jb-btn"
              disabled={setPlanner.switching}
              onClick={() =>
                setPlanner.open(
                  sortedTracks.filter((track) => selectedPaths.has(track.path)),
                )
              }
              type="button"
            >
              <ListChecks size={13} /> Add to set
            </button>
          )}
          {mixPreview && (
            <button
              className="jb-btn"
              disabled={
                selectedPaths.size !== 2 &&
                !(
                  selectedPaths.size === 1 &&
                  mixPath(currentTrack) &&
                  !selectedPaths.has(mixPath(currentTrack))
                )
              }
              onClick={() => {
                const selected = sortedTracks.filter((track) =>
                  selectedPaths.has(track.path),
                );
                if (selected.length === 2)
                  mixPreview.open(selected[0], selected[1]);
                else if (selected.length === 1)
                  mixPreview.open(currentTrack, selected[0]);
              }}
              title="Compare two selected tracks, or one track with the loaded track"
              type="button"
            >
              <Headphones size={13} /> Compare mix
            </button>
          )}
          <button
            className="jb-btn"
            disabled={deleting || exporting || analysing}
            onClick={clearSelection}
            type="button"
          >
            Clear
          </button>
          {onAnalyzeTracks && (
            <button
              className="jb-btn"
              disabled={deleting || exporting || analysing}
              onClick={handleAnalyzeSelected}
              type="button"
            >
              <AudioWaveform size={13} /> {analysing ? 'Analysing…' : 'Analyse'}
            </button>
          )}
          {onExportTracks && (
            <button
              className="jb-btn"
              disabled={deleting || exporting || analysing}
              onClick={handleExportSelected}
              type="button"
            >
              <Save size={13} /> {exporting ? 'Exporting…' : 'Export'}
            </button>
          )}
          {onDeleteTracks && (
            <button
              className="jb-btn jb-btn--danger"
              disabled={deleting || exporting || analysing}
              onClick={handleDeleteSelected}
              type="button"
            >
              <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
      )}

      {inspected && (
        <TrackInspector
          key={inspected.path}
          onClose={closeInspector}
          onMix={
            mixPreview
              ? () => {
                  const fromLoaded =
                    mixPath(currentTrack) &&
                    mixPath(currentTrack) !== inspected.path;
                  closeInspector();
                  mixPreview.open(
                    fromLoaded ? currentTrack : inspected,
                    fromLoaded ? inspected : null,
                  );
                }
              : undefined
          }
          onReview={(path, value) => {
            const record = tracks.find((t) => t.path === path) || inspected;
            const next = {
              ...reviewed,
              [path]: value ? djSummary(record).analysisId : false,
            };
            setReviewed(next);
            prefs.set('library.reviewedTracks', next);
          }}
          onSeek={(time) => {
            const index = sortedTracks.findIndex(
              (t) => t.path === inspected.path,
            );
            if (index >= 0) void requestPlayback(inspected, index, time);
            else seekTrack([toQueue(inspected)], 0, time);
          }}
          reviewed={hasReviewed(
            tracks.find((t) => t.path === inspected.path) || inspected,
          )}
          track={tracks.find((t) => t.path === inspected.path) || inspected}
        />
      )}
      {bulkMenu && (
        <BulkContextMenu
          analysing={analysing}
          deleting={deleting}
          exporting={exporting}
          onAnalyze={
            onAnalyzeTracks
              ? () => {
                  handleAnalyzeSelected();
                  setBulkMenu(null);
                }
              : undefined
          }
          onClear={() => {
            clearSelection();
            setBulkMenu(null);
          }}
          onClose={() => setBulkMenu(null)}
          onDelete={
            onDeleteTracks
              ? () => {
                  handleDeleteSelected();
                  setBulkMenu(null);
                }
              : undefined
          }
          onExport={
            onExportTracks
              ? () => {
                  handleExportSelected();
                  setBulkMenu(null);
                }
              : undefined
          }
          selectedCount={selectedPaths.size}
          x={bulkMenu.x}
          y={bulkMenu.y}
        />
      )}
    </>
  );
};

// A lightweight sibling to Library.jsx's ContextMenu, scoped to the tracks currently
// selected via the checkbox/select-mode above (right-click a selected row to open it).
// Kept local rather than routed through the caller's onContextMenu: that one is built
// around a single track (playlists, rename, similar search…) and none of that applies
// to a multi-track selection.
const BulkContextMenu = ({
  analysing,
  deleting,
  exporting,
  onAnalyze,
  onClear,
  onClose,
  onDelete,
  onExport,
  selectedCount,
  x,
  y,
}) => {
  const ref = useRef(null);

  useEffect(() => {
    const onDown = ({ target }) => {
      if (!ref.current?.contains(target)) onClose();
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('contextmenu', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('contextmenu', onDown);
    };
  }, [onClose]);

  const style = {
    left: Math.min(x, window.innerWidth - 240),
    top: Math.min(y, window.innerHeight - 200),
  };
  const label = `${selectedCount} track${selectedCount === 1 ? '' : 's'}`;

  return (
    <div
      className="jb-context-menu"
      ref={ref}
      style={style}
    >
      <div className="jb-context-title">{label} selected</div>
      <div className="jb-context-sep" />
      {onAnalyze && (
        <button
          className="jb-context-item"
          disabled={analysing}
          onClick={onAnalyze}
          type="button"
        >
          <AudioWaveform size={13} />
          {analysing ? 'Analysing…' : `Analyse ${label}`}
        </button>
      )}
      {onExport && (
        <button
          className="jb-context-item"
          disabled={exporting}
          onClick={onExport}
          type="button"
        >
          <Save size={13} />
          {exporting ? 'Exporting…' : `Export ${label} to USB`}
        </button>
      )}
      {onDelete && (
        <button
          className="jb-context-item jb-context-item--danger"
          disabled={deleting}
          onClick={onDelete}
          type="button"
        >
          <Trash2 size={13} />
          {deleting ? 'Deleting…' : `Delete ${label}…`}
        </button>
      )}
      <div className="jb-context-sep" />
      <button
        className="jb-context-item"
        onClick={onClear}
        type="button"
      >
        <X size={13} />
        Clear selection
      </button>
    </div>
  );
};

export default TrackTable;
