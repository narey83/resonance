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
import * as musicLibraryApi from '../../lib/musicLibrary';
import { useKeyFormat } from '../../lib/useKeyFormat';
import { usePagedList } from '../../lib/usePagedList';
import KeyFormatToggle from '../Shared/KeyFormatToggle';
import PageInfo from '../Shared/PageInfo';
import RowWaveform from './RowWaveform';
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
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'react-toastify';

// One window of the library per request, the same size every other paged list here uses.
const PAGE_SIZE = 200;

// A library row carries everything this page shows, but names it the way the library does.
// Rows are identified by path from here on: the paged query has no masked filenames, and one
// is only resolved (per row, on demand) when an action actually needs it.
const toRow = (t) => ({
  album: t.album,
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

const ScanSettings = ({ onClose, onStart, scanning, selectedCount = 0 }) => {
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
            Every track is analysed for key, BPM, loudness and waveform in a
            single decode. When enhanced analysis is configured, the same scan
            also generates vocals, phrases, downbeats and genre; this stage can
            take longer.
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
            })
          }
          type="button"
        >
          <ScanLine size={13} />
          {selectedCount > 0 ? `Scan ${selectedCount} selected` : 'Start Scan'}
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
          {track.album && track.album !== track.artist && (
            <span className="ka-track-album">{track.album}</span>
          )}
        </div>
        <div className="ka-track-actions">
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
  fmtKey,
  focusKey,
  globalScanning,
  inFlight,
  name,
  onClearBpm,
  onClearKey,
  onScan,
  onScanFolder,
  onSelectFolder,
  onSetBpm,
  onSetKey,
  onToggle,
  onToggleSelect,
  recentlyUpdated,
  selected,
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
            disabled={globalScanning}
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
          <span className="ka-folder-badge">{tracks.length}</span>
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
      {!collapsed &&
        tracks.map((t) => (
          <TrackRow
            fmtKey={fmtKey}
            focusKey={focusKey}
            globalScanning={globalScanning}
            key={t.path}
            onClearBpm={onClearBpm}
            onClearKey={onClearKey}
            onScan={onScan}
            onSetBpm={onSetBpm}
            onSetKey={onSetKey}
            onToggleSelect={onToggleSelect}
            recentlyUpdated={recentlyUpdated}
            scanning={inFlight.has(t.path)}
            selected={selected.has(t.path)}
            track={t}
          />
        ))}
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

// eslint-disable-next-line complexity
const Analysis = () => {
  const [scanState, setScanState] = useState(null);
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
      analysis: filter === 'all' ? undefined : filter,
      descending: sortDirection === 'desc',
      key: keyFilter || undefined,
      search: debouncedSearch.trim() || undefined,
      sort: sortKey,
    }),
    [debouncedSearch, filter, keyFilter, sortDirection, sortKey],
  );

  const {
    items,
    loadMore,
    loading,
    loadingMore,
    total: matching,
  } = usePagedList(musicLibraryApi.getTrackPage, query, {
    pageSize: PAGE_SIZE,
    refreshToken: libraryRevision + refreshNonce,
  });

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
      const [nextStats, keys] = await Promise.all([
        musicLibraryApi.getAnalysisStats(),
        musicLibraryApi.getKeys().catch(() => []),
      ]);
      if (!mountedRef.current) return;
      setStats(nextStats);
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
    } catch {
      if (!mountedRef.current) return;
      toast.error('Failed to start scan.');
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

    let paths = [];
    try {
      const { tracks: folderTracks } = await musicLibraryApi.getTracks({
        folder: folderPath,
        limit: 10_000,
      });
      paths = (folderTracks ?? []).map((t) => t.path);
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
    <div className="ka-root">
      <PageInfo storageKey="analysis">
        <p>
          Detects and stores every per-track audio metric in one place. A track
          is decoded <strong>once</strong> and all four measurements are taken
          from that single pass, so scanning for everything costs barely more
          than scanning for one thing:
        </p>
        <ul>
          <li>
            <strong>Key</strong> and <strong>BPM</strong> — detected with
            Essentia and written back to the file's tags, so they travel with
            the file.
          </li>
          <li>
            <strong>Waveform</strong> — per-band peak data backing the player's
            seek bar and the waveform inspector.
          </li>
          <li>
            <strong>Loudness</strong> — EBU R128 integrated loudness, true peak
            and loudness range.
          </li>
        </ul>
        <p>
          Keys are displayed as <strong>Camelot codes</strong> (e.g.{' '}
          <code>8A</code> = A minor, <code>8B</code> = C major). Tracks with the
          same number, or one step apart on the wheel, mix harmonically without
          clashing. Click a key badge to highlight all compatible tracks in the
          list.
        </p>
      </PageInfo>
      {scanState?.enhancedTotal > 0 && (
        <p
          role="status"
          style={{ padding: '0.5rem 1rem' }}
        >
          Enhanced analysis: {scanState.enhancedCompleted} /{' '}
          {scanState.enhancedTotal} ready · {scanState.enhancedFailed || 0}{' '}
          failed{scanState.enhancedPath ? ` · ${scanState.enhancedPath}` : ''}.
          Vocal and phrase predictions appear on the player waveform.
        </p>
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

      {showSettings && (
        <ScanSettings
          onClose={() => setShowSettings(false)}
          onStart={handleStartScan}
          scanning={scanning}
          selectedCount={selected.size}
        />
      )}

      {/* ── Toolbar ── */}
      <div className="ka-toolbar">
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
                  ? 'Fully analysed'
                  : 'Incomplete'}
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
            disabled={scanning}
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

      {/* ── Track list ── */}
      <div className="ka-track-list">
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
          groups.map((g) => (
            <FolderGroup
              collapsed={!expandedFolders.has(g.dir)}
              dir={g.dir}
              fmtKey={fmtKey}
              focusKey={focusKey}
              globalScanning={scanning}
              inFlight={inFlight}
              key={g.dir}
              name={g.name}
              onClearBpm={handleClearBpm}
              onClearKey={handleClearKey}
              onScan={handleScanTrack}
              onScanFolder={handleScanFolder}
              onSelectFolder={handleSelectFolder}
              onSetBpm={handleSetBpm}
              onSetKey={handleSetKey}
              onToggle={toggleFolder}
              onToggleSelect={toggleSelect}
              recentlyUpdated={recentlyUpdated}
              selected={selected}
              tracks={g.tracks}
            />
          ))
        )}
      </div>

      {/* ── Paging ── one 200-row window at a time, appended on demand ── */}
      {tracks.length > 0 && (
        <div className="ka-pagination">
          <span className="ka-page-info">
            Showing {tracks.length} of {matching}
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
