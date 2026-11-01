// <copyright file="Analysis.jsx" company="John Narey">
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

import './Analysis.css';
import { useLibraryActivity } from '../../context/LibraryActivityContext';
import { usePlayer } from '../../context/PlayerContext';
import useDebounce from '../../hooks/useDebounce';
import * as analysisApi from '../../lib/analysis';
import { METRICS } from '../../lib/analysis';
import {
  CAMELOT_KEYS,
  camelotColour,
  harmonicNeighbours,
  toCamelot,
} from '../../lib/camelot';
import { djSummary } from '../../lib/libraryWorkbench';
import { getPreparationStatus } from '../../lib/libraryWorkspace';
import * as musicLibraryApi from '../../lib/musicLibrary';
import { useKeyFormat } from '../../lib/useKeyFormat';
import { usePagedList } from '../../lib/usePagedList';
import KeyFormatToggle from '../Shared/KeyFormatToggle';
import AnalysisDetails from './AnalysisDetails';
import RowWaveform from './RowWaveform';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AlertCircle,
  AudioWaveform,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
  Gauge,
  Loader2,
  Music,
  Play,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  Settings2,
  X,
  XCircle,
} from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'react-toastify';

// Fill the folder view in bounded batches.
const PAGE_SIZE = 10_000;

// A library row carries everything this page shows, but names it the way the library does.
// Rows are identified by path from here on: the paged query has no masked filenames, and one
// is only resolved (per row, on demand) when an action actually needs it.
const toRow = (t) => ({
  album: t.album,
  djSummary: t.djSummary,
  duration: t.duration,
  genre: t.genre,
  artist: t.artist,
  bpm: t.bpm,
  directory: t.directory,
  filename: t.filename,
  hasBpm: Boolean(t.bpm),
  hasKey: Boolean(t.key),
  hasLoudness: t.lufs != null,
  hasWaveform: Boolean(t.hasWaveform),
  key: t.key,
  lufs: t.lufs,
  path: t.path,
  title: t.title,
});

// ── Scan settings panel ───────────────────────────────────────────────────────

const ScanSettings = ({
  enhanced,
  onClose,
  onStart,
  scanning,
  selectedCount = 0,
}) => {
  const [skipTagged, setSkipTagged] = useState(true);
  const [resetAll, setResetAll] = useState(false);

  return (
    <div className="ka-panel">
      <div className="ka-panel-header">
        <span>Scan Settings</span>
        <button
          className="ka-icon-btn hover-fx"
          onClick={onClose}
          type="button"
        >
          <X size={14} />
        </button>
      </div>

      <div className="ka-panel-body">
        <div className="ka-field">
          <span className="ka-field-hint">
            Basic analysis measures key, BPM, loudness and waveform in one
            decode. Enhanced analysis adds vocal, phrase, downbeat and genre
            models after the basic pass.
          </span>
        </div>

        <div className="ka-field">
          <p className="ka-field-label">
            Selected mode: <strong>{enhanced ? 'Enhanced' : 'Basic'}</strong>
          </p>
          <span className="ka-field-hint">
            Choose Basic or Enhanced using the cards above. Existing enhanced
            results are preserved unless reset is selected.
          </span>
        </div>

        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className="ka-toggle-row">
          <span className="ka-field-label">Skip already-analysed tracks</span>
          <button
            className={`ka-toggle hover-fx${skipTagged ? ' on' : ''}`}
            onClick={() => {
              setSkipTagged((v) => !v);
              if (!skipTagged) setResetAll(false);
            }}
            type="button"
          >
            <span className="ka-toggle-thumb" />
          </button>
        </label>

        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className="ka-toggle-row">
          <span className="ka-field-label">Reset & re-scan all tracks</span>
          <button
            className={`ka-toggle hover-fx${resetAll ? ' on' : ''}`}
            onClick={() => {
              setResetAll((v) => !v);
              if (!resetAll) setSkipTagged(false);
            }}
            type="button"
          >
            <span className="ka-toggle-thumb" />
          </button>
        </label>
        {resetAll && (
          <p className="ka-warn">
            <AlertCircle size={13} /> This will clear the selected metrics on
            every matching track and re-detect them.
          </p>
        )}
      </div>

      <div className="ka-panel-footer">
        <button
          className="ka-btn hover-fx"
          onClick={onClose}
          type="button"
        >
          Cancel
        </button>
        <button
          className="ka-btn ka-btn--primary hover-fx"
          disabled={scanning}
          onClick={() =>
            onStart({
              metrics: METRICS.join(', '),
              skipAnalysed: skipTagged,
              resetAll,
              enhanced,
            })
          }
          type="button"
        >
          <ScanLine size={13} />
          {selectedCount > 0
            ? `Scan ${selectedCount} selected`
            : enhanced
              ? 'Start Enhanced Scan'
              : 'Start Basic Scan'}
        </button>
      </div>
    </div>
  );
};

// ── Badges ────────────────────────────────────────────────────────────────────

const LoadingBadge = () => (
  <span
    className="ka-badge ka-badge--loading"
    title="Analysing…"
  >
    <Loader2
      className="ka-spin-icon"
      size={11}
    />
  </span>
);

const BpmBadge = ({ bpm, scanning }) => {
  if (scanning) return <LoadingBadge />;
  if (!bpm) return <span className="ka-badge ka-badge--empty">—</span>;
  return <span className="ka-badge ka-badge--bpm">{bpm}</span>;
};

// Waveform and loudness are cached blobs rather than values worth showing inline,
// so they read as presence dots instead of badges.
const CacheDots = ({ scanning, track }) => (
  <span className="ka-dots">
    <span
      className={`ka-dot${track.hasWaveform ? ' on' : ''}`}
      title={track.hasWaveform ? 'Waveform analysed' : 'No waveform'}
    >
      <AudioWaveform size={11} />
    </span>
    <span
      className={`ka-dot${scanning || track.hasLoudness ? ' on' : ''}`}
      title={
        scanning
          ? 'Analysing…'
          : track.hasLoudness
            ? `${track.lufs.toFixed(1)} LUFS`
            : 'No loudness measurement'
      }
    >
      {scanning ? (
        <Loader2
          className="ka-spin-icon"
          size={11}
        />
      ) : (
        <Gauge size={11} />
      )}
    </span>
  </span>
);

const KeyBadge = ({ compatible, fmtKey, keyValue, scanning }) => {
  if (scanning) return <LoadingBadge />;
  if (!keyValue) return <span className="ka-badge ka-badge--empty">—</span>;
  const code = toCamelot(keyValue);
  const colour = camelotColour(code);
  const minor = code?.endsWith('A');
  const dim = compatible != null && !compatible;
  const display = fmtKey ? fmtKey(keyValue) : code ?? keyValue;
  return (
    <span
      className={`ka-badge${minor ? ' ka-badge--minor' : ''}${dim ? ' ka-badge--dim' : ''}`}
      style={{ '--key-colour': colour ?? 'var(--border)' }}
      title={fmtKey ? `${code ?? keyValue} · ${keyValue}` : keyValue}
    >
      {display}
    </span>
  );
};

// ── Track row ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line complexity
const TrackRow = ({
  fmtKey,
  focusKey,
  globalScanning,
  onClearBpm,
  onClearKey,
  onInspect,
  onScan,
  onSetBpm,
  onSetKey,
  onToggleSelect,
  recentlyUpdated,
  scanning,
  selected,
  track,
}) => {
  const [editing, setEditing] = useState(false);
  const [showWave, setShowWave] = useState(false);
  const [editingBpm, setEditingBpm] = useState(false);
  const [bpmInput, setBpmInput] = useState(track.bpm?.toString() ?? '');
  const [keyInput, setKeyInput] = useState(track.key ?? '');
  const compatible = focusKey
    ? harmonicNeighbours(focusKey).has(track.key) || track.key === focusKey
    : null;
  const summary = djSummary(track) || {};
  const basicReady =
    track.hasBpm && track.hasKey && track.hasWaveform && track.hasLoudness;
  const wasUpdated = recentlyUpdated?.has(track.path) ?? false;
  const { play, track: currentTrack } = usePlayer();
  const isPlaying = currentTrack?.localRelativePath === track.path;
  const handlePlay = () =>
    play({
      filename: track.filename,
      hasWaveform: track.hasWaveform,
      bpm: track.bpm,
      key: track.key,
      username: null,
      size: 0,
      length: 0,
      lufs: track.lufs,
      localRelativePath: track.path,
      path: track.path,
      title: track.title || track.filename,
      artist: track.artist,
      album: track.album,
    });

  const submit = () => {
    const k = keyInput.trim();
    if (k) onSetKey(track.path, fmtKey ? fmtKey(k) : k);
    else if (track.key) onClearKey(track.path);
    setEditing(false);
  };

  const submitBpm = () => {
    const v = Number.parseInt(bpmInput, 10);
    if (v > 0) onSetBpm(track.path, v);
    else if (track.bpm) onClearBpm(track.path);
    setEditingBpm(false);
  };

  return (
    <>
      <div
        className={`ka-track${selected ? ' ka-track--selected' : ''}${wasUpdated ? ' ka-track--updated' : ''}${scanning ? ' ka-track--scanning' : ''}`}
      >
        <div className="ka-track-check">
          <input
            checked={selected}
            className="ka-checkbox"
            disabled={globalScanning}
            onChange={() => onToggleSelect(track.path)}
            type="checkbox"
          />
        </div>
        <div className="ka-track-key">
          {editing ? (
            <div className="ka-key-edit">
              <select
                autoFocus
                className="ka-key-input ka-key-select"
                onChange={({ target }) => setKeyInput(target.value)}
                onKeyDown={({ key }) => {
                  if (key === 'Enter') submit();
                  if (key === 'Escape') setEditing(false);
                }}
                value={keyInput}
              >
                <option value="">— none —</option>
                {CAMELOT_KEYS.map(({ camelot, standard }) => (
                  <option
                    key={standard}
                    value={standard}
                  >
                    {camelot} — {standard}
                  </option>
                ))}
              </select>
              <div className="ka-key-edit-actions">
                <button
                  className="ka-icon-btn ka-icon-btn--ok"
                  onClick={submit}
                  title="Save"
                  type="button"
                >
                  <CheckCircle2 size={13} />
                </button>
                <button
                  className="ka-icon-btn"
                  onClick={() => setEditing(false)}
                  title="Cancel"
                  type="button"
                >
                  <XCircle size={13} />
                </button>
              </div>
            </div>
          ) : (
            <button
              className="ka-key-btn"
              onClick={() => {
                setKeyInput(track.key ?? '');
                setEditing(true);
              }}
              title="Click to edit key"
              type="button"
            >
              <KeyBadge
                compatible={compatible}
                fmtKey={fmtKey}
                keyValue={track.key}
                scanning={scanning}
              />
            </button>
          )}
        </div>
        <div className="ka-track-bpm">
          {editingBpm ? (
            <input
              autoFocus
              className="ka-key-input ka-bpm-input"
              onBlur={submitBpm}
              onChange={({ target }) => setBpmInput(target.value)}
              onKeyDown={({ key }) => {
                if (key === 'Enter') submitBpm();
                if (key === 'Escape') setEditingBpm(false);
              }}
              type="number"
              value={bpmInput}
            />
          ) : (
            <button
              className="ka-key-btn"
              onClick={() => {
                setBpmInput(track.bpm?.toString() ?? '');
                setEditingBpm(true);
              }}
              title="Click to edit BPM"
              type="button"
            >
              <BpmBadge
                bpm={track.bpm}
                scanning={scanning}
              />
            </button>
          )}
        </div>
        <div className="ka-track-cache">
          <CacheDots
            scanning={scanning}
            track={track}
          />
        </div>
        <div className="ka-track-info">
          <span
            className="ka-track-title"
            title={track.title || track.filename}
          >
            {track.title || track.filename}
          </span>
          {track.artist && (
            <span className="ka-track-artist">{track.artist}</span>
          )}
          <span className="ka-track-readiness">
            {basicReady ? 'Basic ready' : 'Basic incomplete'} ·{' '}
            {summary.complete ? 'Enhanced ready' : 'Enhanced pending'}
            {summary.genre ? ` · ${summary.genre}` : ''}
          </span>
          {track.album && track.album !== track.artist && (
            <span className="ka-track-album">{track.album}</span>
          )}
        </div>
        <div className="ka-track-actions">
          <button
            aria-label={`Analysis details for ${track.title || track.filename}`}
            className="ka-icon-btn"
            onClick={() => onInspect(track)}
            title="Analysis details"
            type="button"
          >
            <Search size={13} />
          </button>
          <button
            className={`ka-icon-btn${isPlaying ? ' ka-icon-btn--playing' : ''}`}
            onClick={handlePlay}
            title={isPlaying ? 'Now playing' : 'Play track'}
            type="button"
          >
            <Play size={13} />
          </button>
          <button
            className="ka-icon-btn"
            disabled={globalScanning}
            onClick={() => onScan(track.path)}
            title={
              scanning
                ? 'Analysing…'
                : globalScanning
                  ? 'Scan in progress'
                  : 'Analyse track'
            }
            type="button"
          >
            {scanning ? (
              <Loader2
                className="ka-spin-icon"
                size={13}
              />
            ) : (
              <ScanLine size={13} />
            )}
          </button>
          <button
            className={`ka-icon-btn${showWave ? ' ka-icon-btn--playing' : ''}`}
            onClick={() => setShowWave((v) => !v)}
            title={showWave ? 'Hide waveform' : 'Show waveform'}
            type="button"
          >
            <AudioWaveform size={13} />
          </button>
          {track.key && !scanning && (
            <button
              className="ka-icon-btn ka-icon-btn--danger"
              onClick={() => onClearKey(track.path)}
              title="Clear key"
              type="button"
            >
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      </div>
      {showWave && <RowWaveform track={track} />}
    </>
  );
};

// ── Folder group ──────────────────────────────────────────────────────────────

const FolderGroup = ({
  collapsed,
  dir,
  globalScanning,
  inFlight,
  name,
  onScanFolder,
  onSelectFolder,
  onToggle,
  selected,
  selectionReady,
  tracks,
}) => {
  const trackIds = tracks.map((t) => t.path);
  const allSelected =
    trackIds.length > 0 && trackIds.every((id) => selected.has(id));
  const someSelected = trackIds.some((id) => selected.has(id));

  // A collapsed folder still shows that something inside it is being decoded right now —
  // otherwise the only sign of a running scan on a folder-grouped list is the global counter.
  const folderScanning = trackIds.some((id) => inFlight.has(id));

  return (
    <div className="ka-folder-group">
      <div className="ka-folder-header">
        <div className="ka-folder-check">
          <input
            checked={allSelected}
            className="ka-checkbox"
            disabled={globalScanning || !selectionReady}
            onChange={() => onSelectFolder(trackIds, allSelected)}
            ref={(element) => {
              if (element)
                element.indeterminate =
                  !globalScanning && someSelected && !allSelected;
            }}
            title={allSelected ? 'Deselect folder' : 'Select folder'}
            type="checkbox"
          />
        </div>
        <button
          className="ka-folder-expand"
          onClick={() => onToggle(dir)}
          title={dir}
          type="button"
        >
          <span className="ka-folder-chevron">
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </span>
          <Folder
            className="ka-folder-icon"
            size={13}
          />
          <span className="ka-folder-name">{name}</span>
          <span className="ka-folder-badge">
            {tracks.length.toLocaleString()} tracks
          </span>
        </button>
        <button
          className="ka-icon-btn ka-folder-scan-btn"
          disabled={globalScanning}
          onClick={() => onScanFolder(dir, name)}
          title={
            folderScanning
              ? 'Analysing tracks in this folder…'
              : globalScanning
                ? 'Scan in progress'
                : 'Analyse unanalysed tracks in this folder'
          }
          type="button"
        >
          {folderScanning ? (
            <Loader2
              className="ka-spin-icon"
              size={13}
            />
          ) : (
            <ScanLine size={13} />
          )}
        </button>
      </div>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

// eslint-disable-next-line complexity
const Analysis = () => {
  const [scanState, setScanState] = useState(null);
  const [enhanced, setEnhanced] = useState(false);
  const [inspectedTrack, setInspectedTrack] = useState(null);
  const [preparation, setPreparation] = useState(null);
  useEffect(() => {
    if (scanState?.scanning && scanState.enhancedTotal > 0) setEnhanced(true);
  }, [scanState?.scanning, scanState?.enhancedTotal]);
  const { fmtKey, format, setFormat } = useKeyFormat();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortKey, setSortKey] = useState('title');
  const [sortDirection, setSortDirection] = useState('asc');
  const [showSettings, setShowSettings] = useState(false);
  const [keyFilter, setKeyFilter] = useState('');
  const [focusKey, setFocusKey] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [recentlyUpdated, setRecentlyUpdated] = useState(new Set());
  const [stats, setStats] = useState(null);
  const [keyOptions, setKeyOptions] = useState([]);

  // A manual key/BPM edit is written to the file's tags; the library index only picks it up on
  // the next (debounced) sync, so refetching straight after an edit would still hand back the
  // old value. These hold the new one over the row until something authoritative replaces them.
  const [edits, setEdits] = useState(new Map());

  // Bumped whenever something this page did should be reflected in the rows it already holds
  // (a scan finishing, the refresh button). Added to the library's own revision so a tag write
  // from anywhere else refreshes the window too.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const libraryRevision = useLibraryActivity()?.libraryRevision ?? 0;
  // Tag writes during a scan can broadcast every second. Keep the complete folder
  // listing in place, then refresh its values when the scan finishes.
  const idleRevisionRef = useRef(libraryRevision);
  if (!scanState?.scanning) idleRevisionRef.current = libraryRevision;

  const pollRef = useRef(null);
  const wasScanningRef = useRef(false);
  const inFlightRef = useRef(new Set());
  // true = "no scan pending finalization" (initial / already handled)
  // false = "a scan was started from this session and needs finalizing"
  const finalizingRef = useRef(true);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Typing shouldn't fire a query per keystroke — the search runs server-side now.
  const debouncedSearch = useDebounce(search, 250);

  // Everything the list is narrowed and ordered by is a query parameter: the page holds one
  // 200-row window at a time, so filtering or sorting what happens to be loaded would answer
  // a different question from the one the toolbar asks.
  const query = useMemo(
    () => ({
      analysis:
        filter === 'all'
          ? undefined
          : enhanced
            ? filter === 'complete'
              ? 'enhanced'
              : 'pending'
            : filter,
      descending: sortDirection === 'desc',
      key: keyFilter || undefined,
      search: debouncedSearch.trim() || undefined,
      sort: sortKey,
    }),
    [debouncedSearch, enhanced, filter, keyFilter, sortDirection, sortKey],
  );

  const {
    error,
    items,
    loadMore,
    loading,
    loadingMore,
    total: matching,
  } = usePagedList(musicLibraryApi.getTrackPage, query, {
    pageSize: PAGE_SIZE,
    refreshToken: idleRevisionRef.current + refreshNonce,
  });

  // Fill the folder view sequentially; stop on errors or an empty page.
  const autoLoadRef = useRef(null);
  useEffect(() => {
    if (loading) autoLoadRef.current = null;
    const cursor = JSON.stringify([query, items.length]);
    if (loading || loadingMore || error || items.length >= matching) return;
    if (autoLoadRef.current === cursor) return;
    autoLoadRef.current = cursor;
    loadMore();
  }, [error, items.length, loadMore, loading, loadingMore, matching, query]);

  const tracks = useMemo(
    () =>
      items.map((t) => {
        const row = toRow(t);
        const edit = edits.get(row.path);
        return edit ? { ...row, ...edit } : row;
      }),
    [edits, items],
  );

  // Which rows are being decoded at this instant, straight from the scan state the page
  // already polls. The backend reports absolute paths, the same form the library rows carry,
  // so no resolving is needed to line the two up.
  const inFlight = useMemo(
    () => new Set(scanState?.inFlightPaths ?? []),
    [scanState],
  );

  // A path that was in flight a moment ago and isn't now has just been written; that's the
  // whole "recently updated" signal, no before/after diff of the library required.
  // ponytail: grows for the length of one scan (reset when the next starts). A full-library
  // run holds ~50k strings; bound it if that ever matters.
  useEffect(() => {
    const previous = inFlightRef.current;
    const finished = [...previous].filter((p) => !inFlight.has(p));
    inFlightRef.current = inFlight;
    if (finished.length === 0) return;
    setRecentlyUpdated((current) => new Set([...current, ...finished]));
  }, [inFlight]);

  const loadSummary = useCallback(async () => {
    try {
      const [nextStats, keys, nextPreparation] = await Promise.all([
        musicLibraryApi.getAnalysisStats(),
        musicLibraryApi.getKeys().catch(() => []),
        getPreparationStatus().catch(() => null),
      ]);
      if (!mountedRef.current) return;
      setStats(nextStats);
      setPreparation(nextPreparation);
      setKeyOptions(keys ?? []);
    } catch {
      /* the counts are a headline, not the page — the list still renders without them */
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [libraryRevision, loadSummary, refreshNonce]);

  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  // Explicit "show me what the server has" — drops the optimistic overrides with it.
  const hardRefresh = useCallback(() => {
    autoLoadRef.current = null;
    setEdits(new Map());
    refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    analysisApi
      .getScanState()
      .then((state) => {
        if (cancelled || !mountedRef.current) return;
        setScanState(state);
        wasScanningRef.current = Boolean(state?.scanning);
        // A scan already running when the page opens still needs finalizing when it ends.
        if (state?.scanning) finalizingRef.current = false;
      })
      .catch(() => {
        /* the scan bar simply stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // finalize scan: pull the fresh values into the rows on screen and report the outcome
  const finalizeScan = useCallback(() => {
    setSelected(new Set());
    setScanState((previous) =>
      previous?.scanning ? { ...previous, scanning: false } : previous,
    );
    // A scan is the only other thing that rewrites key/BPM, so its results supersede any
    // optimistic override still being held over a row.
    setEdits(new Map());
    refresh();
  }, [refresh]);

  // fire finalizeScan after React has rendered the completed state
  useEffect(() => {
    if (finalizingRef.current) return;
    if (
      scanState &&
      !scanState.scanning &&
      (scanState.completed || scanState.cancelled)
    ) {
      finalizingRef.current = true;
      finalizeScan();
    }
  }, [finalizeScan, scanState]);

  // Poll continuously (not only once a scan is already under way) so a scan the
  // automatic post-download check starts while this page is just sitting open still
  // shows up — completion is detected separately, above.
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      try {
        const state = await analysisApi.getScanState();
        if (!mountedRef.current) {
          clearInterval(pollRef.current);
          return;
        }

        // A scan that started without this page's own startScan() (i.e. the automatic
        // check) still needs finalizing when it ends.
        if (state.scanning && !wasScanningRef.current) {
          finalizingRef.current = false;
        }

        wasScanningRef.current = state.scanning;

        setScanState(state);
      } catch {
        /* ignore */
      }
    }, 2_000);

    return () => clearInterval(pollRef.current);
  }, []);

  // paths, not masked filenames: the backend resolves them against the share in one query
  // rather than the page doing a lookup per row before it can ask for anything.
  const startScan = async (request, paths) => {
    finalizingRef.current = false;
    setRecentlyUpdated(new Set());
    inFlightRef.current = new Set();
    setScanState(null);
    try {
      await analysisApi.startScan({ ...request, onlyPaths: paths ?? null });
      const state = await analysisApi.getScanState();
      if (!mountedRef.current) return;
      wasScanningRef.current = Boolean(state?.scanning);
      setScanState(state);
      // completion effect fires finalizeScan after this state update renders
    } catch (caughtError) {
      if (!mountedRef.current) return;
      const detail = caughtError?.response?.data;
      toast.error(
        (typeof detail === 'string' && detail) ||
          detail?.message ||
          'Failed to start scan.',
      );
    }
  };

  const handleStartScan = async (request) => {
    setShowSettings(false);
    const paths = selected.size > 0 ? Array.from(selected) : undefined;
    await startScan(request, paths);
  };

  const handleScanTrack = async (path) => {
    if (scanState?.scanning) {
      toast.info('A scan is already running.');
      return;
    }

    const paths =
      selected.size > 0 ? Array.from(new Set([path, ...selected])) : [path];
    await startScan(
      {
        metrics: METRICS.join(', '),
        skipAnalysed: true,
        resetAll: false,
        enhanced,
      },
      paths,
    );
  };

  const handleCancelScan = async () => {
    try {
      await analysisApi.cancelScan();
    } catch (caughtError) {
      if (caughtError?.response?.status !== 404) {
        toast.error('Failed to cancel scan.');
      }
    }

    try {
      const state = await analysisApi.getScanState();
      if (mountedRef.current) setScanState(state);
    } catch {
      /* ignore */
    }
  };

  // A row action needs the masked filename the tag endpoints key on, and only the path is at
  // hand — so resolve that one path now, rather than resolving a name for all 200 rows of a
  // page nobody may touch. Failing here means the file isn't in the share, which is worth
  // saying rather than silently doing nothing.
  const editTags = async (path, action, patch, failure) => {
    try {
      const masked = await analysisApi.getMaskedFilename(path);
      await action(masked);
      // No refetch here on purpose: WriteFileTags triggers a library sync, and its (debounced)
      // LIBRARY_UPDATED is what brings the real row back. Asking now would only re-read the
      // pre-edit value, which is exactly what the override above is covering for.
      setEdits((previous) =>
        new Map(previous).set(path, { ...previous.get(path), ...patch }),
      );
    } catch {
      toast.error(failure);
    }
  };

  const handleSetBpm = (path, bpm) =>
    editTags(
      path,
      (masked) => analysisApi.setBpm(masked, bpm),
      { bpm, hasBpm: true },
      'Failed to set BPM.',
    );

  const handleClearBpm = (path) =>
    editTags(
      path,
      (masked) => analysisApi.clearBpm(masked),
      { bpm: null, hasBpm: false },
      'Failed to clear BPM.',
    );

  const handleSetKey = (path, key) =>
    editTags(
      path,
      (masked) => analysisApi.setKey(masked, key),
      { hasKey: true, key },
      'Failed to set key.',
    );

  const handleClearKey = (path) =>
    editTags(
      path,
      (masked) => analysisApi.clearKey(masked),
      { hasKey: false, key: null },
      'Failed to clear key.',
    );

  const toggleSort = (col) => {
    if (sortKey === col)
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(col);
      setSortDirection('asc');
    }
  };

  useEffect(() => {
    setSelected(new Set());
  }, [debouncedSearch, filter, keyFilter, sortDirection, sortKey]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const t of tracks) {
      if (!map.has(t.directory)) map.set(t.directory, []);
      map.get(t.directory).push(t);
    }

    return Array.from(map.entries())
      .map(([directory, directoryTracks]) => ({
        dir: directory,
        name: directory.split(/[/\\]/u).filter(Boolean).pop() ?? directory,
        tracks: directoryTracks,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tracks]);

  const scrollRef = useRef(null);
  const listRef = useRef(null);
  const [listOffset, setListOffset] = useState(0);

  // Results share the page scroll area. Keep their virtual coordinates aligned
  // when settings, details, progress or responsive wrapping move the list.
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return undefined;
    const updateOffset = () => setListOffset(listRef.current?.offsetTop ?? 0);
    updateOffset();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateOffset);
    observer.observe(root);
    for (const child of root.children) {
      if (child !== listRef.current) observer.observe(child);
    }

    return () => observer.disconnect();
  }, [error, inspectedTrack, loading, showSettings]);
  const visibleRows = useMemo(
    () =>
      groups.flatMap((group) => [
        { key: `folder:${group.dir}`, group },
        ...(expandedFolders.has(group.dir)
          ? group.tracks.map((track) => ({ key: `track:${track.path}`, track }))
          : []),
      ]),
    [expandedFolders, groups],
  );
  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => visibleRows[index].key,
    estimateSize: (index) => (visibleRows[index].group ? 59 : 44),
    overscan: 12,
    scrollMargin: listOffset,
  });

  const toggleSelect = useCallback((path) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((previous) => {
      const pageIds = tracks.map((t) => t.path);
      const allSelected = pageIds.every((id) => previous.has(id));
      if (allSelected) {
        const deselected = new Set(previous);
        for (const id of pageIds) deselected.delete(id);
        return deselected;
      }

      const allAdded = new Set(previous);
      for (const id of pageIds) allAdded.add(id);
      return allAdded;
    });
  }, [tracks]);

  const toggleFolder = useCallback((folderPath) => {
    setExpandedFolders((previous) => {
      const expanded = new Set(previous);
      if (expanded.has(folderPath)) expanded.delete(folderPath);
      else expanded.add(folderPath);
      return expanded;
    });
  }, []);

  const handleSelectFolder = useCallback((trackIds, allSelected) => {
    setSelected((previous) => {
      const folderSelected = new Set(previous);
      if (allSelected) for (const id of trackIds) folderSelected.delete(id);
      else for (const id of trackIds) folderSelected.add(id);
      return folderSelected;
    });
  }, []);

  // The folder's tracks are asked for by folder rather than taken from the loaded window: a
  // folder can easily run past the end of it, and scanning "this folder" has to mean all of it.
  const handleScanFolder = async (folderPath, folderName) => {
    if (scanState?.scanning) {
      toast.info('A scan is already running.');
      return;
    }

    const paths = [];
    try {
      let total = 1;
      while (paths.length < total) {
        const page = await musicLibraryApi.getTrackPage({
          folder: folderPath,
          limit: PAGE_SIZE,
          offset: paths.length,
        });
        if (!mountedRef.current) return;
        if (page.items.length === 0 && paths.length < page.total) {
          throw new Error('Folder listing ended before all tracks were loaded');
        }

        paths.push(...page.items.map((track) => track.path));
        total = page.total;
      }
    } catch {
      toast.error('Could not list that folder.');
      return;
    }

    if (paths.length === 0) {
      toast.warn(`No tracks found in folder: ${folderName}`);
      return;
    }

    await startScan(
      {
        metrics: METRICS.join(', '),
        skipAnalysed: true,
        resetAll: false,
        enhanced,
      },
      paths,
    );
  };

  const allExpanded =
    groups.length > 0 && groups.every((g) => expandedFolders.has(g.dir));

  const toggleAllFolders = useCallback(() => {
    setExpandedFolders((previous) => {
      const toggled = new Set(previous);
      if (groups.every((g) => toggled.has(g.dir))) {
        for (const g of groups) toggled.delete(g.dir);
      } else {
        for (const g of groups) toggled.add(g.dir);
      }

      return toggled;
    });
  }, [groups]);

  // eslint-disable-next-line react/no-unstable-nested-components
  const SortIcon = ({ col }) => {
    if (sortKey !== col) return null;
    return sortDirection === 'asc' ? (
      <ChevronUp size={11} />
    ) : (
      <ChevronDown size={11} />
    );
  };

  if (loading && tracks.length === 0) {
    return (
      <div className="ka-state-center">
        <div className="ka-spinner" />
        <span>Loading analysis...</span>
      </div>
    );
  }

  const scanning = scanState?.scanning;
  const processed = scanState
    ? scanState.analysed + scanState.skipped + scanState.failed
    : 0;
  const coverage = stats ?? {
    bpmed: 0,
    complete: 0,
    keyed: 0,
    loudness: 0,
    total: 0,
    waveformed: 0,
  };
  const pct =
    coverage.total > 0
      ? Math.round((coverage.complete / coverage.total) * 100)
      : 0;

  return (
    <div
      className={`ka-root${expandedFolders.size > 0 ? ' ka-root--expanded' : ''}`}
      ref={scrollRef}
    >
      <section className="ka-overview">
        <div className="ka-view-heading">
          <AudioWaveform size={18} />
          <div>
            <h2>Track analysis</h2>
            <p>Key, tempo, waveform and loudness, organised by folder.</p>
          </div>
        </div>
        {scanState?.error && <p role="alert">{scanState.error}</p>}
        <fieldset
          className="ka-analysis-modes"
          disabled={scanning}
        >
          <legend>Analysis mode</legend>
          <label className={enhanced ? '' : 'ka-mode-selected'}>
            <input
              checked={!enhanced}
              name="analysis-mode"
              onChange={() => setEnhanced(false)}
              type="radio"
              value="basic"
            />
            <strong>Basic</strong>
            <span>BPM, musical key, waveform and loudness (LUFS).</span>
          </label>
          <label className={enhanced ? 'ka-mode-selected' : ''}>
            <input
              checked={enhanced}
              disabled={preparation?.enhancedEnabled === false}
              name="analysis-mode"
              onChange={() => setEnhanced(true)}
              type="radio"
              value="enhanced"
            />
            <strong>Enhanced</strong>
            <span>
              Everything in Basic, plus beat and downbeat grids, vocals and
              stems, sections and phrase labels, genre and energy, cue and loop
              suggestions, and similarity.
            </span>
          </label>
        </fieldset>
        <div className="ka-analysis-context">
          <span>
            <strong>Basic ready:</strong> {coverage.complete} tracks
          </span>
          <span>
            <strong>Enhanced ready:</strong>{' '}
            {preparation ? preparation.counts?.complete || 0 : '—'} tracks
          </span>
          <span>
            <strong>Automatic preparation:</strong>{' '}
            {preparation
              ? preparation.paused
                ? 'Paused'
                : 'Enabled'
              : 'Checking…'}
          </span>
          <span>
            <strong>Enhanced worker:</strong>{' '}
            {preparation
              ? preparation.enhancedEnabled
                ? 'Available'
                : 'Not configured'
              : 'Checking…'}
          </span>
        </div>
        <p className="ka-analysis-note">
          Enhanced results are predictions stored separately from file tags.
          Review beat grids, vocal and phrase labels before using them in a mix.
          Open a track’s analysis details to compare measurements and inspect
          every feature.
        </p>
        {scanState?.enhancedTotal > 0 && (
          <section
            aria-label="Enhanced analysis progress"
            className="ka-enhanced-status"
            role="status"
          >
            <strong>
              Enhanced analysis: {scanState.enhancedCompleted} /{' '}
              {scanState.enhancedTotal} ready · {scanState.enhancedFailed || 0}{' '}
              failed
            </strong>
            <progress
              aria-label="Enhanced tracks processed"
              max={scanState.enhancedTotal}
              value={
                (scanState.enhancedCompleted || 0) +
                (scanState.enhancedFailed || 0)
              }
            />
            <span>
              {Math.max(
                0,
                scanState.enhancedTotal -
                  (scanState.enhancedCompleted || 0) -
                  (scanState.enhancedFailed || 0),
              )}{' '}
              remaining
              {scanState.enhancedPath
                ? ` · Latest track started: ${scanState.enhancedPath.split(/[/\\]/).pop()}`
                : ''}
            </span>
            {scanState.enhancedFailed > 0 && (
              <span>
                Some tracks need attention. Open their analysis details for
                missing features and check System → Logs → Music → Enhanced
                Analysis.
              </span>
            )}
          </section>
        )}
        {/* ── Stats bar ── */}
        <div className="ka-stats-bar">
          <div className="ka-stat">
            <span className="ka-stat-value">{coverage.total}</span>
            <span className="ka-stat-label">Tracks</span>
          </div>
          <div className="ka-stat ka-stat--keyed">
            <span className="ka-stat-value">{coverage.keyed}</span>
            <span className="ka-stat-label">Key</span>
          </div>
          <div className="ka-stat ka-stat--keyed">
            <span className="ka-stat-value">{coverage.bpmed}</span>
            <span className="ka-stat-label">BPM</span>
          </div>
          <div className="ka-stat ka-stat--keyed">
            <span className="ka-stat-value">{coverage.waveformed}</span>
            <span className="ka-stat-label">Waveform</span>
          </div>
          <div className="ka-stat ka-stat--keyed">
            <span className="ka-stat-value">{coverage.loudness}</span>
            <span className="ka-stat-label">Loudness</span>
          </div>
          <div className="ka-stat ka-stat--unkeyed">
            <span className="ka-stat-value">
              {coverage.total - coverage.complete}
            </span>
            <span className="ka-stat-label">Incomplete</span>
          </div>
          <div className="ka-stat-bar-wrap">
            <div className="ka-stat-bar">
              <div
                className="ka-stat-bar-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* inline scan progress */}
          {scanning && scanState.total > 0 && (
            <div className="ka-progress-bar-wrap">
              <div className="ka-progress-bar">
                <div
                  className="ka-progress-fill"
                  style={{ width: `${(scanState.progress * 100).toFixed(1)}%` }}
                />
              </div>
              <div className="ka-progress-stats">
                <span className="ka-progress-chip ka-progress-chip--queued">
                  Queued:{' '}
                  {Math.max(
                    0,
                    scanState.total - processed - (scanState.inFlight ?? 0),
                  )}
                </span>
                <span className="ka-progress-chip ka-progress-chip--active">
                  Scanning: {scanState.inFlight ?? 0}
                </span>
                <span className="ka-progress-chip ka-progress-chip--done">
                  Done: {processed}
                </span>
                {scanState.failed > 0 && (
                  <span className="ka-progress-chip ka-progress-chip--failed">
                    Failed: {scanState.failed}
                  </span>
                )}
              </div>
            </div>
          )}
          {scanning && (
            <button
              className="ka-btn ka-btn--scanning hover-fx"
              onClick={handleCancelScan}
              type="button"
            >
              <Loader2
                className="ka-spin-icon"
                size={13}
              />{' '}
              Scanning… Cancel
            </button>
          )}

          <div className="ka-spacer" />
          <KeyFormatToggle
            format={format}
            onChange={setFormat}
          />
          <button
            className="ka-btn hover-fx"
            onClick={hardRefresh}
            title="Refresh"
            type="button"
          >
            <RefreshCw size={13} />
          </button>
          <button
            className={`ka-btn hover-fx${showSettings ? ' ka-btn--active' : ''}`}
            disabled={scanning}
            onClick={() => setShowSettings((v) => !v)}
            type="button"
          >
            <Settings2 size={13} /> Scan
          </button>
        </div>
      </section>

      {showSettings && (
        <ScanSettings
          enhanced={enhanced}
          onClose={() => setShowSettings(false)}
          onStart={handleStartScan}
          scanning={scanning}
          selectedCount={selected.size}
        />
      )}

      {inspectedTrack && (
        <AnalysisDetails
          key={inspectedTrack.path}
          onClose={() => setInspectedTrack(null)}
          track={inspectedTrack}
        />
      )}
      {/* ── Toolbar ── */}
      <div className="ka-toolbar">
        <span className="ka-browser-title">
          <Folder size={16} /> Folders
        </span>
        <div className="ka-search-wrap">
          <Search
            className="ka-search-icon"
            size={13}
          />
          <input
            className="ka-search"
            onChange={({ target }) => setSearch(target.value)}
            placeholder="Search tracks, artists, keys..."
            type="text"
            value={search}
          />
          {search && (
            <button
              className="ka-search-clear hover-fx"
              onClick={() => setSearch('')}
              type="button"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="ka-filter-group">
          {['all', 'complete', 'incomplete'].map((f) => (
            <button
              className={`ka-filter-btn hover-fx${filter === f ? ' active' : ''}`}
              key={f}
              onClick={() => setFilter(f)}
              type="button"
            >
              {f === 'all'
                ? 'All'
                : f === 'complete'
                  ? enhanced
                    ? 'Enhanced ready'
                    : 'Basic ready'
                  : enhanced
                    ? 'Enhanced pending'
                    : 'Basic incomplete'}
            </button>
          ))}
        </div>

        {keyOptions.length > 0 && (
          <select
            className="ka-select ka-select--sm"
            onChange={({ target }) => {
              setKeyFilter(target.value);
              setFocusKey(target.value || null);
            }}
            value={keyFilter}
          >
            <option value="">All Keys</option>
            {keyOptions.map(({ key: k, trackCount }) => {
              const c = toCamelot(k);
              const label =
                format === 'camelot'
                  ? c
                    ? `${c} — ${k}`
                    : k
                  : c
                    ? `${k} — ${c}`
                    : k;
              return (
                <option
                  key={k}
                  value={k}
                >
                  {label} ({trackCount})
                </option>
              );
            })}
          </select>
        )}

        <span className="ka-count">
          {tracks.length} of {matching} track{matching === 1 ? '' : 's'} ·{' '}
          {groups.length} folder{groups.length === 1 ? '' : 's'}
        </span>

        {groups.length > 0 && (
          <button
            className="ka-btn ka-btn--sm hover-fx"
            onClick={toggleAllFolders}
            type="button"
          >
            {allExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>

      {/* ── Column headers ── */}
      <div className="ka-header-row">
        <div className="ka-col-check">
          <input
            checked={
              tracks.length > 0 && tracks.every((t) => selected.has(t.path))
            }
            className="ka-checkbox"
            disabled={scanning || tracks.length < matching}
            onChange={toggleSelectAll}
            ref={(element) => {
              if (element)
                element.indeterminate =
                  !scanning &&
                  tracks.some((t) => selected.has(t.path)) &&
                  !tracks.every((t) => selected.has(t.path));
            }}
            title={
              selected.size > 0
                ? `${selected.size} selected`
                : 'Select all visible'
            }
            type="checkbox"
          />
        </div>
        <div className="ka-col-key">
          <button
            className="ka-sort-btn hover-fx"
            onClick={() => toggleSort('key')}
            type="button"
          >
            Key <SortIcon col="key" />
          </button>
        </div>
        <div className="ka-col-bpm">
          <button
            className="ka-sort-btn hover-fx"
            onClick={() => toggleSort('bpm')}
            type="button"
          >
            BPM <SortIcon col="bpm" />
          </button>
        </div>
        <div className="ka-col-cache">Cached</div>
        <div className="ka-col-info">
          <button
            className="ka-sort-btn hover-fx"
            onClick={() => toggleSort('title')}
            type="button"
          >
            Title <SortIcon col="title" />
          </button>
          <span className="ka-col-sep"> / </span>
          <button
            className="ka-sort-btn hover-fx"
            onClick={() => toggleSort('artist')}
            type="button"
          >
            Artist <SortIcon col="artist" />
          </button>
        </div>
        <div className="ka-col-actions" />
      </div>

      {error && (
        <div
          className="ka-load-error"
          role="alert"
        >
          <AlertCircle size={14} /> Could not load all tracks.
          <button
            className="ka-btn"
            onClick={hardRefresh}
            type="button"
          >
            Retry
          </button>
        </div>
      )}
      {/* ── Track list ── */}
      <div
        className="ka-track-list"
        ref={listRef}
      >
        {tracks.length === 0 ? (
          <div className="ka-state-center">
            <Music
              size={36}
              style={{ opacity: 0.2 }}
            />
            <span>
              {coverage.total === 0
                ? 'No audio tracks found. Make sure your library is scanned.'
                : 'No tracks match your filter.'}
            </span>
          </div>
        ) : (
          <div
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const { group: g, track } = visibleRows[virtualRow.index];
              return (
                <div
                  data-index={virtualRow.index}
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start - listOffset}px)`,
                  }}
                >
                  {g ? (
                    <FolderGroup
                      collapsed={!expandedFolders.has(g.dir)}
                      dir={g.dir}
                      globalScanning={scanning}
                      inFlight={inFlight}
                      name={g.name}
                      onScanFolder={handleScanFolder}
                      onSelectFolder={handleSelectFolder}
                      onToggle={toggleFolder}
                      selected={selected}
                      selectionReady={tracks.length === matching}
                      tracks={g.tracks}
                    />
                  ) : (
                    <TrackRow
                      fmtKey={fmtKey}
                      focusKey={focusKey}
                      globalScanning={scanning}
                      onClearBpm={handleClearBpm}
                      onClearKey={handleClearKey}
                      onInspect={setInspectedTrack}
                      onScan={handleScanTrack}
                      onSetBpm={handleSetBpm}
                      onSetKey={handleSetKey}
                      onToggleSelect={toggleSelect}
                      recentlyUpdated={recentlyUpdated}
                      scanning={inFlight.has(track.path)}
                      selected={selected.has(track.path)}
                      track={track}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Automatic loading progress and manual batch retry. */}
      {tracks.length > 0 && (
        <div className="ka-pagination">
          <span className="ka-page-info">
            {tracks.length < matching ? 'Loading' : 'Loaded'} {tracks.length} of{' '}
            {matching} tracks
          </span>
          {tracks.length < matching && (
            <button
              className="ka-page-btn hover-fx"
              disabled={loadingMore}
              onClick={loadMore}
              type="button"
            >
              {loadingMore ? (
                <>
                  <Loader2
                    className="ka-spin-icon"
                    size={12}
                  />{' '}
                  Loading…
                </>
              ) : (
                `Load ${Math.min(PAGE_SIZE, matching - tracks.length)} more ›`
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default Analysis;
