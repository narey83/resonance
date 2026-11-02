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
import { toast } from '../../lib/activityNotices';
import * as analysisApi from '../../lib/analysis';
import { METRICS } from '../../lib/analysis';
import { CAMELOT_KEYS, camelotColour, toCamelot } from '../../lib/camelot';
import { djSummary } from '../../lib/libraryWorkbench';
import {
  getPreparationStatus,
  pausePreparation,
} from '../../lib/libraryWorkspace';
import * as musicLibraryApi from '../../lib/musicLibrary';
import {
  ANALYSIS_TRACK_PAGE_SIZE,
  useAnalysisPages,
} from '../../lib/useAnalysisPages';
import { useKeyFormat } from '../../lib/useKeyFormat';
import { usePagedList } from '../../lib/usePagedList';
import BackgroundAnalysisQueue from '../Library/components/BackgroundAnalysisQueue';
import AnalysisDetails from './AnalysisDetails';
import AnalysisFailures from './AnalysisFailures';
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

// Fill the folder view in bounded batches.
const PAGE_SIZE = 10_000;
const fetchFolderPage = async ({ analysis, search }) => {
  const items = await musicLibraryApi.getFolders({ search, analysis });
  return { items, total: items.length };
};

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

const ENHANCED_FEATURES = [
  ['beats', 'Beat grids'],
  ['downbeats', 'Downbeats'],
  ['vocals', 'Vocals'],
  ['stems', 'Stem analysis'],
  ['sections', 'Sections'],
  ['phrases', 'Phrases'],
  ['genre', 'Genre'],
  ['energy', 'Energy'],
  ['cues', 'Cue analysis'],
  ['loops', 'Loop analysis'],
  ['similarity', 'Similarity'],
];

const formatCount = (value) =>
  typeof value === 'number' ? value.toLocaleString('en-GB') : value;

// Each source refreshes independently; retained values must never look current after a failure.
const Freshness = ({ label, maxAge, now, status }) => {
  const stale = status.failed || (status.at && now - status.at > maxAge);
  return (
    <span className={stale ? 'ka-data-stale' : ''}>
      {label}:{' '}
      {stale ? 'Stale · retrying' : status.at ? 'Updated' : 'Checking…'}
      {status.at ? ` ${new Date(status.at).toLocaleTimeString()}` : ''}
    </span>
  );
};

const enhancedFeatureValue = (coverage, feature) => {
  const count = coverage?.features?.[feature];
  if (count == null) return '—';
  if (coverage.unindexed > 0) return count > 0 ? `${formatCount(count)}+` : '—';
  return count;
};

const MetricCard = ({ label, title, value }) => (
  <div
    className="ka-stat"
    title={title}
  >
    <span className="ka-stat-value">{formatCount(value) ?? '—'}</span>
    <span className="ka-stat-label">{label}</span>
  </div>
);

// ── Analysis settings panel ───────────────────────────────────────────────────────

const ScanSettings = ({
  enhanced,
  modeSelector,
  onStart,
  scanning,
  selectedCount = 0,
  viewState,
}) => {
  const [skipTagged, setSkipTagged] = useState(
    viewState?.current?.skipTagged ?? true,
  );
  const [resetAll, setResetAll] = useState(
    viewState?.current?.resetAll ?? false,
  );
  useEffect(() => {
    if (viewState)
      viewState.current = { ...viewState.current, skipTagged, resetAll };
  }, [resetAll, skipTagged, viewState]);

  return (
    <section
      aria-label="Analysis settings"
      className="ka-panel"
    >
      <div className="ka-panel-header">
        <span>Choose music to analyse</span>
      </div>

      <div className="ka-panel-body">
        {modeSelector}

        <label
          className="ka-toggle-row"
          htmlFor="analysis-skip-analysed"
        >
          <span className="ka-field-label">Skip already-analysed tracks</span>
          <button
            aria-checked={skipTagged}
            aria-label="Skip already-analysed tracks"
            className={`ka-toggle hover-fx${skipTagged ? ' on' : ''}`}
            id="analysis-skip-analysed"
            onClick={() => {
              setSkipTagged((v) => !v);
              if (!skipTagged) setResetAll(false);
            }}
            role="switch"
            type="button"
          >
            <span className="ka-toggle-thumb" />
          </button>
        </label>

        <label
          className="ka-toggle-row"
          htmlFor="analysis-reset-all"
        >
          <span className="ka-field-label">
            Reset & reanalyse selected tracks
          </span>
          <button
            aria-checked={resetAll}
            aria-label="Reset & reanalyse selected tracks"
            className={`ka-toggle hover-fx${resetAll ? ' on' : ''}`}
            id="analysis-reset-all"
            onClick={() => {
              setResetAll((v) => !v);
              if (!resetAll) setSkipTagged(false);
            }}
            role="switch"
            type="button"
          >
            <span className="ka-toggle-thumb" />
          </button>
        </label>
        {resetAll && (
          <p className="ka-warn">
            <AlertCircle size={13} /> This will clear the selected metrics on
            every selected track and re-detect them.
          </p>
        )}
      </div>

      <div className="ka-panel-footer">
        {selectedCount === 0 && (
          <span>Select tracks or folders below to start analysis.</span>
        )}
        <button
          className="ka-btn ka-btn--primary hover-fx"
          disabled={scanning || selectedCount === 0}
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
            ? `Analyse ${selectedCount} selected`
            : enhanced
              ? 'Start Enhanced analysis'
              : 'Start Basic analysis'}
        </button>
      </div>
    </section>
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

const KeyBadge = ({ fmtKey, keyValue, scanning }) => {
  if (scanning) return <LoadingBadge />;
  if (!keyValue) return <span className="ka-badge ka-badge--empty">—</span>;
  const code = toCamelot(keyValue);
  const colour = camelotColour(code);
  const minor = code?.endsWith('A');
  const display = fmtKey ? fmtKey(keyValue) : code ?? keyValue;
  return (
    <span
      className={`ka-badge${minor ? ' ka-badge--minor' : ''}`}
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
            onChange={() => onToggleSelect(track)}
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
  selectedCount,
  selectionReady,
  trackCount,
}) => {
  const allSelected = trackCount > 0 && selectedCount === trackCount;
  const someSelected = selectedCount > 0;

  // A collapsed folder still shows that something inside it is being decoded right now —
  // otherwise the only sign of a running scan on a folder-grouped list is the global counter.
  const folderScanning = [...inFlight].some(
    (path) =>
      path
        .replaceAll('\\', '/')
        .slice(0, path.replaceAll('\\', '/').lastIndexOf('/')) ===
      dir.replaceAll('\\', '/'),
  );

  return (
    <div className="ka-folder-group">
      <div className="ka-folder-header">
        <div className="ka-folder-check">
          <input
            checked={allSelected}
            className="ka-checkbox"
            disabled={globalScanning || !selectionReady}
            onChange={() => onSelectFolder(dir, allSelected)}
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
          aria-expanded={!collapsed}
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
            {trackCount.toLocaleString()}{' '}
            {trackCount === 1 ? 'track' : 'tracks'}
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
const Analysis = ({ viewState }) => {
  const [scanState, setScanState] = useState(null);
  const [backgroundQueueOpen, setBackgroundQueueOpen] = useState(false);
  const [enhanced, setEnhanced] = useState(
    viewState?.current?.enhanced ?? false,
  );
  const [inspectedTrack, setInspectedTrack] = useState(null);
  const [preparation, setPreparation] = useState(null);
  const [preparationBusy, setPreparationBusy] = useState('');
  const [scanControlBusy, setScanControlBusy] = useState('');
  const [stopRequested, setStopRequested] = useState(false);
  useEffect(() => {
    if (
      stopRequested &&
      !preparationBusy &&
      !scanState?.scanning &&
      !(preparation?.counts?.running > 0)
    ) {
      setStopRequested(false);
    }
  }, [
    stopRequested,
    preparationBusy,
    scanState?.scanning,
    preparation?.counts?.running,
  ]);
  useEffect(() => {
    if (scanState?.scanning && scanState.enhancedTotal > 0) setEnhanced(true);
  }, [scanState?.scanning, scanState?.enhancedTotal]);
  const { fmtKey } = useKeyFormat();
  const [search, setSearch] = useState(viewState?.current?.search ?? '');
  const [filter, setFilter] = useState(viewState?.current?.filter ?? 'all');
  const [sortKey, setSortKey] = useState(
    viewState?.current?.sortKey ?? 'title',
  );
  const [sortDirection, setSortDirection] = useState(
    viewState?.current?.sortDirection ?? 'asc',
  );
  const [selected, setSelected] = useState(
    viewState?.current?.selected ?? new Map(),
  );
  const [selecting, setSelecting] = useState(false);
  const [selectionProgress, setSelectionProgress] = useState(null);
  const selectionRequestRef = useRef(null);
  const [expandedFolders, setExpandedFolders] = useState(
    viewState?.current?.expandedFolders ?? new Set(),
  );
  useEffect(() => {
    if (viewState)
      viewState.current = {
        ...viewState.current,
        enhanced,
        search,
        filter,
        sortKey,
        sortDirection,
        selected,
        expandedFolders,
      };
  }, [
    enhanced,
    expandedFolders,
    filter,
    search,
    selected,
    sortDirection,
    sortKey,
    viewState,
  ]);
  const [recentlyUpdated, setRecentlyUpdated] = useState(new Set());
  const [stats, setStats] = useState(null);
  const [dataRevision, setDataRevision] = useState(0);
  const [folderRevision, setFolderRevision] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [coverageStatus, setCoverageStatus] = useState({
    at: null,
    failed: false,
  });
  const [scanStatus, setScanStatus] = useState({ at: null, failed: false });
  const [queueStatus, setQueueStatus] = useState({ at: null, failed: false });

  // A manual key/BPM edit is written to the file's tags; the library index only picks it up on
  // the next (debounced) sync, so refetching straight after an edit would still hand back the
  // old value. These hold the new one over the row until something authoritative replaces them.
  const [edits, setEdits] = useState(new Map());

  // Bumped whenever something this page did should be reflected in the rows it already holds
  // (a scan finishing, the refresh button). Added to the library's own revision so a tag write
  // from anywhere else refreshes the window too.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const libraryRevision = useLibraryActivity()?.libraryRevision ?? 0;
  const summaryRef = useRef({
    request: null,
    lastStarted: Number.NEGATIVE_INFINITY,
    dirty: false,
    revision: libraryRevision,
  });
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      selectionRequestRef.current?.abort();
    };
  }, []);

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
      search: debouncedSearch.trim() || undefined,
      sort: sortKey,
    }),
    [debouncedSearch, enhanced, filter, sortDirection, sortKey],
  );

  const folderQuery = useMemo(
    () => ({ analysis: query.analysis, search: query.search }),
    [query.analysis, query.search],
  );
  const {
    error,
    items: folders,
    loading,
  } = usePagedList(fetchFolderPage, folderQuery, {
    refreshToken:
      idleRevisionRef.current +
      refreshNonce +
      folderRevision +
      (query.analysis ? dataRevision : 0),
  });
  const matching = folders.reduce(
    (total, folder) => total + folder.trackCount,
    0,
  );
  const { cache: trackPages, version: pageVersion } = useAnalysisPages(query);
  const queryRef = useRef(query);
  queryRef.current = query;

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

  const loadSummary = useCallback(
    (includePreparation = true, force = false) => {
      const summary = summaryRef.current;
      summary.dirty = true;
      if (
        summary.request ||
        (!force && Date.now() - summary.lastStarted < 4_000)
      )
        return summary.request;
      summary.dirty = false;
      summary.lastStarted = Date.now();
      summary.request = (async () => {
        try {
          void (includePreparation
            ? getPreparationStatus()
                .then((nextPreparation) => {
                  if (!mountedRef.current) return;
                  setPreparation(nextPreparation);
                  setQueueStatus({ at: Date.now(), failed: false });
                })
                .catch(() => {
                  if (mountedRef.current)
                    setQueueStatus((previous) => ({
                      ...previous,
                      failed: true,
                    }));
                })
            : Promise.resolve());
          const nextStats = await musicLibraryApi.getAnalysisStats();
          if (!mountedRef.current) return;
          if (
            summary.total != null &&
            (summary.total !== nextStats.total ||
              Date.now() - summary.foldersAt >= 30_000)
          ) {
            setFolderRevision((revision) => revision + 1);
            summary.foldersAt = Date.now();
          }

          summary.total = nextStats.total;
          summary.foldersAt ??= Date.now();
          setStats(nextStats);
          setCoverageStatus({ at: Date.now(), failed: false });
          setDataRevision((revision) => revision + 1);
        } catch {
          // Retain the last counts and retry on a later poll instead of displaying zeroes.
          summary.dirty = true;
          if (mountedRef.current)
            setCoverageStatus((previous) => ({ ...previous, failed: true }));
        }
      })().finally(() => {
        summary.request = null;
      });
      return summary.request;
    },
    [],
  );

  useEffect(() => {
    void loadSummary(true, true);
  }, [loadSummary, refreshNonce]);

  useEffect(() => {
    if (summaryRef.current.revision === libraryRevision) return;
    summaryRef.current.revision = libraryRevision;
    void loadSummary(false);
  }, [libraryRevision, loadSummary]);

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
        setScanStatus({ at: Date.now(), failed: false });
        wasScanningRef.current = Boolean(state?.scanning);
        // A scan already running when the page opens still needs finalizing when it ends.
        if (state?.scanning) finalizingRef.current = false;
      })
      .catch(() => {
        if (!cancelled && mountedRef.current)
          setScanStatus((previous) => ({ ...previous, failed: true }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // finalize scan: pull the fresh values into the rows on screen and report the outcome
  const finalizeScan = useCallback(() => {
    setSelected(new Map());
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
    let pending = null;
    const poll = () => {
      if (!mountedRef.current || document.hidden) return;
      setNow(Date.now());
      if (pending) return;
      pending = (async () => {
        const [scanResult, queueResult] = await Promise.allSettled([
          analysisApi.getScanState(),
          getPreparationStatus(),
        ]);
        if (!mountedRef.current) return;
        const state =
          scanResult.status === 'fulfilled' ? scanResult.value : null;
        const nextPreparation =
          queueResult.status === 'fulfilled' ? queueResult.value : null;
        setScanStatus((previous) =>
          state
            ? { at: Date.now(), failed: false }
            : { ...previous, failed: true },
        );
        setQueueStatus((previous) =>
          nextPreparation
            ? { at: Date.now(), failed: false }
            : { ...previous, failed: true },
        );
        if (nextPreparation) setPreparation(nextPreparation);
        const ended = state && !state.scanning && wasScanningRef.current;
        if (state) {
          if (state.scanning && !wasScanningRef.current)
            finalizingRef.current = false;
          wasScanningRef.current = state.scanning;
          setScanState(state);
        }

        // Refresh on every exit, including errors without a completed/cancelled flag.
        // Idle reconciliation catches missed notifications without a full library dump.
        if (ended) {
          finalizingRef.current = true;
          finalizeScan();
        }

        if (
          ended ||
          state?.scanning ||
          nextPreparation?.counts?.running > 0 ||
          summaryRef.current.dirty ||
          Date.now() - summaryRef.current.lastStarted >= 30_000
        ) {
          void loadSummary(false, Boolean(ended));
        }
      })().finally(() => {
        pending = null;
      });
    };

    pollRef.current = setInterval(poll, 2_000);
    const reconnect = () => {
      if (document.hidden) return;
      void loadSummary(true, true);
      poll();
    };

    window.addEventListener('online', reconnect);
    window.addEventListener('focus', reconnect);
    document.addEventListener('visibilitychange', reconnect);
    return () => {
      clearInterval(pollRef.current);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('focus', reconnect);
      document.removeEventListener('visibilitychange', reconnect);
    };
  }, [finalizeScan, loadSummary]);

  // paths, not masked filenames: the backend resolves them against the share in one query
  // rather than the page doing a lookup per row before it can ask for anything.
  const startScan = async (request, paths) => {
    if (preparationBusy || stopRequested) return;
    if (!paths?.length) {
      toast.info('Select tracks or folders before starting analysis.');
      return;
    }

    finalizingRef.current = false;
    setRecentlyUpdated(new Set());
    inFlightRef.current = new Set();
    setScanState(null);
    try {
      await analysisApi.startScan({ ...request, onlyPaths: paths });
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
    const paths = Array.from(selected.keys());
    await startScan(request, paths);
  };

  const handleScanTrack = async (path) => {
    if (scanState?.scanning) {
      toast.info('A scan is already running.');
      return;
    }

    const paths =
      selected.size > 0
        ? Array.from(new Set([path, ...selected.keys()]))
        : [path];
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

  const handlePreparationAction = async (action) => {
    if (preparationBusy || stopRequested) return;
    setPreparationBusy(action);
    if (action === 'stop') setStopRequested(true);
    let schedulingPaused = false;
    try {
      // Let the entire current scan finish; prevent automatic scheduling of another scan.
      const paused = action !== 'resume';
      await pausePreparation(paused);
      schedulingPaused = paused;
      if (mountedRef.current)
        setPreparation((previous) => ({ ...previous, paused }));

      const [nextPreparation, state] = await Promise.all([
        getPreparationStatus(),
        analysisApi.getScanState(),
      ]);
      if (mountedRef.current) {
        setPreparation(nextPreparation);
        setScanState(state);
      }
    } catch {
      if (action === 'stop' && !schedulingPaused && mountedRef.current)
        setStopRequested(false);
      toast.error(
        action === 'stop' && schedulingPaused
          ? 'Automatic scheduling is stopped. Could not refresh scan status; updates will retry.'
          : 'Could not update analysis. Please retry.',
      );
    } finally {
      if (mountedRef.current) setPreparationBusy('');
    }
  };

  const handleScanControl = async (action) => {
    if (scanControlBusy || scanState?.ending) return;
    setScanControlBusy(action);
    let schedulingPaused = false;
    try {
      if (action === 'end') {
        await pausePreparation(true);
        schedulingPaused = true;
        if (mountedRef.current)
          setPreparation((previous) => ({ ...previous, paused: true }));
      }

      const request = {
        pause: analysisApi.pauseScan,
        resume: analysisApi.resumeScan,
        end: analysisApi.endScan,
      }[action];
      try {
        await request();
      } catch (controlError) {
        if (controlError?.response?.status !== 404) throw controlError;
      }

      const state = await analysisApi.getScanState();
      if (mountedRef.current) setScanState(state);
    } catch {
      toast.error(
        schedulingPaused
          ? 'Automatic analysis is paused, but the scan end was not confirmed. Please retry.'
          : 'Could not update this scan. Please retry.',
      );
    } finally {
      if (mountedRef.current) setScanControlBusy('');
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

  const cancelSelection = useCallback(() => {
    selectionRequestRef.current?.abort();
    selectionRequestRef.current = null;
    setSelecting(false);
    setSelectionProgress(null);
  }, []);

  const selectionQuery = JSON.stringify([
    debouncedSearch,
    filter,
    query.analysis,
    sortDirection,
    sortKey,
  ]);
  const previousSelectionQuery = useRef(selectionQuery);
  useEffect(() => {
    if (previousSelectionQuery.current === selectionQuery) return;
    previousSelectionQuery.current = selectionQuery;
    cancelSelection();
    setSelected(new Map());
  }, [
    cancelSelection,
    debouncedSearch,
    filter,
    query.analysis,
    sortDirection,
    sortKey,
    selectionQuery,
  ]);

  const groups = useMemo(
    () =>
      folders
        .map((folder) => ({
          dir: folder.path,
          name: folder.name,
          trackCount: folder.trackCount,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders],
  );
  const selectedCounts = useMemo(() => {
    const counts = new Map();
    for (const directory of selected.values())
      counts.set(directory, (counts.get(directory) ?? 0) + 1);
    return counts;
  }, [selected]);

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
  }, [error, inspectedTrack, loading, selectionProgress]);
  const visibleRows = useMemo(
    () =>
      groups.flatMap((group) => [
        { key: `folder:${group.dir}`, group },
        ...(expandedFolders.has(group.dir)
          ? Array.from({ length: group.trackCount }, (_, index) => ({
              key: `track:${group.dir}:${index}`,
              directory: group.dir,
              index,
            }))
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

  const virtualRows = virtualizer.getVirtualItems();
  useEffect(() => {
    trackPages.setVisible(
      virtualRows
        .map((virtualRow) => visibleRows[virtualRow.index])
        .filter((row) => row && !row.group),
      dataRevision,
    );
  }, [
    dataRevision,
    libraryRevision,
    pageVersion,
    refreshNonce,
    trackPages,
    virtualRows,
    visibleRows,
  ]);

  const toggleSelect = useCallback((track) => {
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(track.path)) next.delete(track.path);
      else next.set(track.path, track.directory);
      return next;
    });
  }, []);

  // Bulk actions explicitly resolve their full matching set; browsing never does.
  const selectMatching = async (directory, clear) => {
    const currentQuery = queryRef.current;
    if (clear) {
      setSelected(
        (previous) =>
          new Map(
            [...previous].filter(([, dir]) => directory && dir !== directory),
          ),
      );
      return;
    }

    if (selectionRequestRef.current) return;
    const controller = new AbortController();
    selectionRequestRef.current = controller;
    setSelecting(true);
    setSelectionProgress({
      done: 0,
      total: directory
        ? groups.find((group) => group.dir === directory)?.trackCount ?? 0
        : matching,
    });
    try {
      const chosen = new Map();
      let offset = 0;
      let total = 1;
      while (offset < total) {
        const page = await musicLibraryApi.getTrackPage(
          {
            ...currentQuery,
            folder: directory,
            recursive: false,
            limit: PAGE_SIZE,
            offset,
          },
          { signal: controller.signal },
        );
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          queryRef.current !== currentQuery
        )
          return;
        if (!page.items.length && offset < page.total)
          throw new Error('Incomplete folder listing');
        for (const track of page.items) chosen.set(track.path, track.directory);
        offset += page.items.length;
        total = page.total;
        setSelectionProgress({ done: offset, total });
      }

      setSelected((previous) => new Map([...previous, ...chosen]));
    } catch {
      if (!controller.signal.aborted)
        toast.error('Could not select all matching tracks. Please retry.');
    } finally {
      if (mountedRef.current && selectionRequestRef.current === controller) {
        selectionRequestRef.current = null;
        setSelecting(false);
        setSelectionProgress(null);
      }
    }
  };

  const toggleSelectAll = () =>
    selectMatching(undefined, selected.size === matching);
  const handleSelectFolder = (directory, clear) =>
    selectMatching(directory, clear);

  const toggleFolder = useCallback((folderPath) => {
    setExpandedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
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
          recursive: false,
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

  if (loading && folders.length === 0) {
    return (
      <div className="ka-state-center">
        <div className="ka-spinner" />
        <span>Loading analysis...</span>
      </div>
    );
  }

  const scanning = scanState?.scanning;
  const scanRunning = scanning ? scanState.inFlight ?? inFlight.size : 0;
  const processed = scanState
    ? (scanState.analysed ?? 0) +
      (scanState.skipped ?? 0) +
      (scanState.failed ?? 0)
    : 0;
  const coverage = stats ?? {};

  return (
    <div
      className={`ka-root${expandedFolders.size > 0 ? ' ka-root--expanded' : ''}`}
      ref={scrollRef}
    >
      <section className="ka-overview">
        <h2 className="ka-section-title">Library readiness</h2>
        <div className="ka-readiness">
          <MetricCard
            label="Total tracks"
            value={coverage.total}
          />
          <MetricCard
            label="Basic ready"
            value={coverage.complete}
          />
          <MetricCard
            label="Enhanced ready"
            value={stats?.enhanced?.complete}
          />
        </div>
        <details
          aria-label="Data freshness"
          className="ka-freshness-details"
        >
          <summary>
            {coverageStatus.failed || scanStatus.failed || queueStatus.failed
              ? 'Updates delayed — view status'
              : 'Live updates · view status'}
          </summary>
          <Freshness
            label="Coverage"
            maxAge={scanning ? 10_000 : 45_000}
            now={now}
            status={coverageStatus}
          />
          <Freshness
            label="Scan"
            maxAge={10_000}
            now={now}
            status={scanStatus}
          />
          <Freshness
            label="Automatic queue"
            maxAge={10_000}
            now={now}
            status={queueStatus}
          />
        </details>
        {coverageStatus.failed && !stats && (
          <p role="status">
            Library coverage is unavailable. Retrying automatically…
          </p>
        )}
        <details className="ka-coverage-details">
          <summary>View coverage details</summary>
          <div className="ka-analysis-summary">
            <section
              aria-label="Basic analysis coverage"
              className="ka-summary-basic"
            >
              <h3>Basic analysis</h3>
              <div className="ka-metric-grid">
                {[
                  ['Tracks', coverage.total],
                  ['Key', coverage.keyed],
                  ['BPM', coverage.bpmed],
                  ['Waveform', coverage.waveformed],
                  ['Loudness', coverage.loudness],
                  ['Ready', coverage.complete],
                  [
                    'Incomplete',
                    stats
                      ? Math.max(0, coverage.total - coverage.complete)
                      : null,
                  ],
                ].map(([label, value]) => (
                  <MetricCard
                    key={label}
                    label={label}
                    value={value}
                  />
                ))}
              </div>
            </section>
            <section
              aria-label="Enhanced feature coverage"
              className="ka-summary-enhanced"
            >
              <h3>
                Enhanced analysis{' '}
                <span>
                  {stats?.enhanced
                    ? `${formatCount(stats.enhanced.complete)} ready · ${formatCount(Math.max(0, coverage.total - stats.enhanced.complete))} incomplete`
                    : 'Checking coverage…'}
                </span>
              </h3>
              <div className="ka-metric-grid">
                {ENHANCED_FEATURES.map(([key, label]) => {
                  const pending = stats?.enhanced?.unindexed > 0;
                  return (
                    <MetricCard
                      key={key}
                      label={label}
                      title={
                        pending
                          ? 'Older saved results are still being indexed; shown counts are confirmed minimums.'
                          : 'Tracks with usable saved enhanced results for this feature.'
                      }
                      value={enhancedFeatureValue(stats?.enhanced, key)}
                    />
                  );
                })}
              </div>
              {stats?.enhanced?.unindexed > 0 && (
                <p className="ka-coverage-pending">
                  Coverage is being indexed for {stats.enhanced.unindexed} older
                  saved results.
                </p>
              )}
            </section>
          </div>
          <details className="ka-analysis-help">
            <summary>Analysis details</summary>
            <p>
              Basic measures BPM, musical key, waveform and loudness (LUFS).
              Enhanced adds beat and downbeat grids, vocals and stems, sections
              and phrase labels, genre and energy, cue and loop suggestions, and
              similarity.
            </p>
            <p>
              Enhanced results are independent predictions; review them before
              mixing. Coverage counts saved, available results. Vocals, cue and
              loop analysis can be complete with no detections or suggestions.
              Stem analysis counts processing, not retained audio files.
            </p>
            <p>
              Enhanced analysis uses more CPU and memory. Existing enhanced
              results are preserved unless reset is selected.
            </p>
          </details>
        </details>
        <div className="ka-current-analysis">
          <header className="ka-current-header">
            <h2 className="ka-section-title">Current analysis</h2>
            {scanState?.supportsPause && scanning ? (
              <div
                aria-label="Current scan controls"
                className="ka-scan-actions"
              >
                <button
                  className="ka-btn ka-btn--primary hover-fx"
                  disabled={Boolean(scanControlBusy) || scanState.ending}
                  onClick={() =>
                    handleScanControl(
                      scanState.pauseRequested ? 'resume' : 'pause',
                    )
                  }
                  title={
                    scanState.pauseRequested
                      ? 'Continue the same scan queue.'
                      : 'Finish only the tracks already being analysed, then hold the remaining queue for Resume.'
                  }
                  type="button"
                >
                  {scanState.ending
                    ? 'Finishing current tracks…'
                    : scanControlBusy === 'pause'
                      ? 'Pausing…'
                      : scanControlBusy === 'resume'
                        ? 'Resuming…'
                        : scanState.pauseRequested
                          ? 'Resume scan'
                          : 'Pause after current tracks'}
                </button>
                <button
                  className="ka-btn ka-btn--end hover-fx"
                  disabled={Boolean(scanControlBusy) || scanState.ending}
                  onClick={() => handleScanControl('end')}
                  title="Finish the tracks already running, then end this scan and discard its remaining queue. Completed results are kept. Background auto-analysis will stay off."
                  type="button"
                >
                  End scan
                </button>
              </div>
            ) : (
              (scanning ||
                stopRequested ||
                preparation?.counts?.running > 0) && (
                <button
                  aria-label="Stop analysis"
                  className="ka-btn ka-btn--stop hover-fx"
                  disabled={
                    Boolean(preparationBusy) ||
                    stopRequested ||
                    (!scanning && !(preparation?.counts?.running > 0))
                  }
                  onClick={() => handlePreparationAction('stop')}
                  title="Finish every remaining track in the current scan, then stop. No further automatic scans will start."
                  type="button"
                >
                  {stopRequested ? 'Finishing scan…' : 'Stop after this scan'}
                </button>
              )
            )}
          </header>
          {scanState?.enhancedTotal > 0 && (
            <section
              aria-label="Enhanced analysis progress"
              className="ka-enhanced-status"
              role="status"
            >
              <strong>
                Enhanced analysis: {scanState.enhancedCompleted} /{' '}
                {scanState.enhancedTotal} ready ·{' '}
                {scanState.enhancedFailed || 0} failed
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
          {scanState?.error && (
            <details className="ka-scan-errors">
              <summary>
                View scan issue
                {scanState.failed ? ` · ${scanState.failed} failed` : ''}
              </summary>
              <p role="alert">{scanState.error}</p>
            </details>
          )}
          <AnalysisFailures />
          <div className="ka-scan-progress">
            {/* inline scan progress */}
            {scanState?.total > 0 && (
              <div
                aria-label="Current scan progress"
                className="ka-progress-bar-wrap"
              >
                <strong>
                  {scanState.enhancedTotal > 0 ? 'Basic + Enhanced' : 'Basic'}{' '}
                  scan ·{' '}
                  {stopRequested
                    ? 'Finishing current scan…'
                    : scanState.ending
                      ? 'Ending after current tracks…'
                      : scanState.paused
                        ? 'Paused'
                        : scanState.pauseRequested
                          ? 'Pausing after current tracks…'
                          : scanning
                            ? 'Running'
                            : scanState.cancelled
                              ? 'Stopped'
                              : scanState.completed
                                ? 'Finished'
                                : 'Stopped with an error'}
                </strong>
                <div className="ka-progress-bar">
                  <div
                    className="ka-progress-fill"
                    style={{
                      width: `${(scanState.progress * 100).toFixed(1)}%`,
                    }}
                  />
                </div>
                <div className="ka-progress-stats">
                  <span className="ka-progress-chip ka-progress-chip--queued">
                    Remaining:{' '}
                    {Math.max(0, scanState.total - processed - scanRunning)}
                  </span>
                  <span className="ka-progress-chip ka-progress-chip--active">
                    Analysing: {scanRunning}
                  </span>
                  <span className="ka-progress-chip ka-progress-chip--done">
                    Succeeded: {scanState.analysed ?? 0}
                  </span>
                  <span className="ka-progress-chip">
                    Skipped: {scanState.skipped ?? 0}
                  </span>
                  <span className="ka-progress-chip">
                    Processed: {processed} / {scanState.total}
                  </span>
                  {scanState.failed > 0 && (
                    <span className="ka-progress-chip ka-progress-chip--failed">
                      Failed: {scanState.failed}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
          {!scanState?.total && (
            <p className="ka-idle-status">
              {scanning
                ? 'Preparing analysis…'
                : 'No scan running. Choose music below to begin.'}
            </p>
          )}
          {scanState?.supportsPause &&
            scanning &&
            (scanState.pauseRequested || scanState.ending) && (
              <p
                className="ka-stop-status"
                role="status"
              >
                {scanState.ending
                  ? 'Finishing current tracks; the remaining scan queue will be discarded. Background auto-analysis will stay off.'
                  : scanState.paused
                    ? 'Queue paused. Resume to continue the remaining tracks.'
                    : 'Finishing the tracks already being analysed, then pausing the queue.'}
              </p>
            )}
          {stopRequested && (
            <p
              className="ka-stop-status"
              role="status"
            >
              Finishing this scan; automatic analysis will remain off.
            </p>
          )}
        </div>
      </section>

      <ScanSettings
        enhanced={enhanced}
        modeSelector={
          <div className="ka-analysis-toolbar">
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
                <span>BPM · key · waveform · LUFS</span>
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
                <span>Basic + grids, vocals, structure and genre</span>
              </label>
            </fieldset>
          </div>
        }
        onStart={handleStartScan}
        scanning={
          scanning || selecting || Boolean(preparationBusy) || stopRequested
        }
        selectedCount={selected.size}
        viewState={viewState}
      />

      <details className="ka-automatic-details">
        <summary>
          <strong>Background auto-analysis:</strong>{' '}
          {preparation ? (preparation.paused ? 'Off' : 'On') : 'Checking…'}
        </summary>
        <p className="ka-background-help">
          Automatically analyses tracks in the background. This setting does not
          pause or resume a scan you start manually.
        </p>
        <div className="ka-analysis-context">
          <div className="ka-preparation-actions">
            <button
              aria-label={
                preparation?.paused
                  ? 'Turn on background auto-analysis'
                  : 'Turn off background auto-analysis'
              }
              className="ka-btn ka-btn--sm hover-fx"
              disabled={
                !preparation || Boolean(preparationBusy) || stopRequested
              }
              onClick={() =>
                handlePreparationAction(preparation.paused ? 'resume' : 'pause')
              }
              title={
                preparation?.paused
                  ? 'Turn on background jobs, regardless of the selected scan mode.'
                  : 'Turn off background jobs after active tracks finish. Queued tracks are kept.'
              }
              type="button"
            >
              {preparationBusy === 'resume'
                ? 'Turning on…'
                : preparationBusy === 'pause'
                  ? 'Turning off…'
                  : preparation?.paused
                    ? 'Turn on'
                    : 'Turn off'}
            </button>
          </div>
          <span>
            <strong>Enhanced worker:</strong>{' '}
            {preparation
              ? preparation.enhancedEnabled
                ? 'Available'
                : 'Not configured'
              : 'Checking…'}
          </span>
        </div>
      </details>

      <details
        className="ka-background-queue"
        onToggle={(event) => setBackgroundQueueOpen(event.currentTarget.open)}
      >
        <summary>Background queue and metadata enrichment</summary>
        {backgroundQueueOpen && (
          <BackgroundAnalysisQueue
            onRefresh={() => loadSummary(true, true)}
            status={preparation}
            statusError={
              queueStatus.failed
                ? 'Background queue updates are delayed. Retrying automatically…'
                : ''
            }
          />
        )}
      </details>

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
            aria-label="Search analysis tracks, artists or keys"
            className="ka-search"
            onChange={({ target }) => setSearch(target.value)}
            placeholder="Search tracks, artists, keys..."
            type="text"
            value={search}
          />
          {search && (
            <button
              aria-label="Clear analysis search"
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

        <span className="ka-count">
          {matching.toLocaleString()} track{matching === 1 ? '' : 's'} ·{' '}
          {groups.length} folder{groups.length === 1 ? '' : 's'}
        </span>

        <button
          className="ka-btn ka-btn--sm hover-fx"
          onClick={hardRefresh}
          title="Refresh tracks"
          type="button"
        >
          <RefreshCw size={13} /> Refresh tracks
        </button>

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

      {selectionProgress && (
        <div className="ka-selection-status">
          <span role="status">
            <Loader2
              className="ka-spin-icon"
              size={13}
            />{' '}
            Selecting tracks… {selectionProgress.done.toLocaleString()} /{' '}
            {selectionProgress.total.toLocaleString()}
          </span>
          <button
            className="ka-btn ka-btn--sm hover-fx"
            onClick={cancelSelection}
            type="button"
          >
            Cancel selection
          </button>
        </div>
      )}
      {/* ── Column headers ── */}
      <div className="ka-header-row">
        <div className="ka-col-check">
          <input
            checked={matching > 0 && selected.size === matching}
            className="ka-checkbox"
            disabled={scanning || selecting || matching === 0}
            onChange={toggleSelectAll}
            ref={(element) => {
              if (element)
                element.indeterminate =
                  !scanning && selected.size > 0 && selected.size < matching;
            }}
            title={
              selected.size > 0
                ? `${selected.size} selected`
                : 'Select all matching tracks'
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
          <AlertCircle size={14} /> Could not load folders.
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
        {groups.length === 0 ? (
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
            {virtualRows.map((virtualRow) => {
              const row = visibleRows[virtualRow.index];
              const g = row.group;
              const page = g ? null : trackPages.get(row.directory, row.index);
              const rawTrack =
                page?.items?.[row.index % ANALYSIS_TRACK_PAGE_SIZE];
              const track = rawTrack
                ? { ...toRow(rawTrack), ...edits.get(rawTrack.path) }
                : null;
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
                      globalScanning={
                        scanning ||
                        selecting ||
                        Boolean(preparationBusy) ||
                        stopRequested
                      }
                      inFlight={inFlight}
                      name={g.name}
                      onScanFolder={handleScanFolder}
                      onSelectFolder={handleSelectFolder}
                      onToggle={toggleFolder}
                      selectedCount={selectedCounts.get(g.dir) ?? 0}
                      selectionReady={!selecting}
                      trackCount={g.trackCount}
                    />
                  ) : track ? (
                    <TrackRow
                      fmtKey={fmtKey}
                      globalScanning={
                        scanning ||
                        selecting ||
                        Boolean(preparationBusy) ||
                        stopRequested
                      }
                      key={track.path}
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
                  ) : (
                    <div
                      className="ka-track-placeholder"
                      role={page?.error ? 'alert' : undefined}
                    >
                      {page?.error
                        ? 'Could not load these tracks.'
                        : page?.items && !page.loading
                          ? 'This folder changed. Refresh to update its tracks.'
                          : 'Loading tracks…'}
                      {page?.error && (
                        <button
                          className="ka-btn"
                          onClick={() =>
                            trackPages.retry(
                              row.directory,
                              row.index,
                              dataRevision,
                            )
                          }
                          type="button"
                        >
                          Retry
                        </button>
                      )}
                      {page?.items && !page.loading && !page.error && (
                        <button
                          className="ka-btn"
                          onClick={hardRefresh}
                          type="button"
                        >
                          Refresh
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Analysis;
