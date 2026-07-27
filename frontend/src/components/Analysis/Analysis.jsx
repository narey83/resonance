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
import { usePlayer } from '../../context/PlayerContext';
import * as analysisApi from '../../lib/analysis';
import { METRICS } from '../../lib/analysis';
import {
  CAMELOT_KEYS,
  camelotColour,
  camelotSortWeight,
  harmonicNeighbours,
  toCamelot,
} from '../../lib/camelot';
import { useKeyFormat } from '../../lib/useKeyFormat';
import KeyFormatToggle from '../Shared/KeyFormatToggle';
import PageInfo from '../Shared/PageInfo';
import RowWaveform from './RowWaveform';
import {
  Activity,
  AlertCircle,
  AudioWaveform,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
  Gauge,
  KeyRound,
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

// A track is "complete" only when every metric is present; the four are gathered in
// one pass, so a partial track means that pass never ran or partly failed.
const isComplete = (t) =>
  t.hasKey && t.hasBpm && t.hasWaveform && t.hasLoudness;

const METRIC_META = {
  Bpm: { Icon: Activity, label: 'BPM' },
  Key: { Icon: KeyRound, label: 'Key' },
  Loudness: { Icon: Gauge, label: 'Loudness' },
  Waveform: { Icon: AudioWaveform, label: 'Waveform' },
};

// ── Scan settings panel ───────────────────────────────────────────────────────

const ScanSettings = ({ onClose, onStart, scanning, selectedCount = 0 }) => {
  const [skipTagged, setSkipTagged] = useState(true);
  const [resetAll, setResetAll] = useState(false);
  const [metrics, setMetrics] = useState(() => new Set(METRICS));
  const [workers, setWorkers] = useState(2);

  const toggleMetric = (m) =>
    setMetrics((previous) => {
      const next = new Set(previous);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });

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
          <span className="ka-field-label">Metrics</span>
          <div className="ka-metric-picker">
            {METRICS.map((m) => {
              const { Icon, label } = METRIC_META[m];
              return (
                <button
                  className={`ka-metric-chip hover-fx${metrics.has(m) ? ' on' : ''}`}
                  key={m}
                  onClick={() => toggleMetric(m)}
                  type="button"
                >
                  <Icon size={13} />
                  {label}
                </button>
              );
            })}
          </div>
          <span className="ka-field-hint">
            All selected metrics come from a single decode per track, so
            scanning for four costs barely more than scanning for one.
          </span>
        </div>

        <label className="ka-field">
          <span className="ka-field-label">Workers</span>
          <input
            className="ka-input"
            max={8}
            min={1}
            onChange={({ target }) => setWorkers(Number(target.value))}
            type="number"
            value={workers}
          />
          <span className="ka-field-hint">
            Concurrent analysis threads (1–8).
          </span>
        </label>

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
          disabled={scanning || metrics.size === 0}
          onClick={() =>
            onStart({
              metrics: METRICS.filter((m) => metrics.has(m)).join(', '),
              skipAnalysed: skipTagged,
              resetAll,
              workers,
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

const BpmBadge = ({ bpm }) => {
  if (!bpm) return <span className="ka-badge ka-badge--empty">—</span>;
  return <span className="ka-badge ka-badge--bpm">{bpm}</span>;
};

// Waveform and loudness are cached blobs rather than values worth showing inline,
// so they read as presence dots instead of badges.
const CacheDots = ({ track }) => (
  <span className="ka-dots">
    <span
      className={`ka-dot${track.hasWaveform ? ' on' : ''}`}
      title={track.hasWaveform ? 'Waveform analysed' : 'No waveform'}
    >
      <AudioWaveform size={11} />
    </span>
    <span
      className={`ka-dot${track.hasLoudness ? ' on' : ''}`}
      title={
        track.hasLoudness
          ? `${track.lufs.toFixed(1)} LUFS`
          : 'No loudness measurement'
      }
    >
      <Gauge size={11} />
    </span>
  </span>
);

const KeyBadge = ({ compatible, fmtKey, keyValue }) => {
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
  scanningFiles,
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
  const scanning = scanningFiles?.has(track.maskedFilename) ?? false;
  const anyScanRunning = (scanningFiles?.size ?? 0) > 0 || globalScanning;
  const wasUpdated = recentlyUpdated?.has(track.maskedFilename) ?? false;
  const { play, track: currentTrack } = usePlayer();
  const localRelativePath = useMemo(() => {
    const parts = track.directory.replaceAll('\\', '/').split('/');
    return [...parts.slice(1), track.filename].join('/');
  }, [track.directory, track.filename]);
  const isPlaying = currentTrack?.localRelativePath === localRelativePath;
  const handlePlay = () =>
    play({
      filename: track.filename,
      username: null,
      size: 0,
      length: 0,
      localRelativePath,
      title: track.title || track.filename,
      artist: track.artist,
      album: track.album,
    });

  const submit = () => {
    const k = keyInput.trim();
    if (k) onSetKey(track.maskedFilename, fmtKey ? fmtKey(k) : k);
    else if (track.key) onClearKey(track.maskedFilename);
    setEditing(false);
  };

  const submitBpm = () => {
    const v = Number.parseInt(bpmInput, 10);
    if (v > 0) onSetBpm(track.maskedFilename, v);
    else if (track.bpm) onClearBpm(track.maskedFilename);
    setEditingBpm(false);
  };

  return (
    <>
      <div
        className={`ka-track${selected ? ' ka-track--selected' : ''}${wasUpdated ? ' ka-track--updated' : ''}`}
      >
        <div className="ka-track-check">
          <input
            checked={selected}
            className="ka-checkbox"
            disabled={globalScanning}
            onChange={() => onToggleSelect(track.maskedFilename)}
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
              <BpmBadge bpm={track.bpm} />
            </button>
          )}
        </div>
        <div className="ka-track-cache">
          <CacheDots track={track} />
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
            disabled={anyScanRunning}
            onClick={() => onScan(track.maskedFilename)}
            title={
              scanning
                ? 'Scanning…'
                : anyScanRunning
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
              onClick={() => onClearKey(track.maskedFilename)}
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
  scanningFiles,
  selected,
  tracks,
}) => {
  const trackIds = tracks.map((t) => t.maskedFilename);
  const allSelected =
    trackIds.length > 0 && trackIds.every((id) => selected.has(id));
  const someSelected = trackIds.some((id) => selected.has(id));
  const anyScanRunning = (scanningFiles?.size ?? 0) > 0 || globalScanning;

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
          disabled={anyScanRunning}
          onClick={() => onScanFolder(dir, name)}
          title={
            anyScanRunning
              ? 'Scan in progress'
              : 'Analyse unanalysed tracks in this folder'
          }
          type="button"
        >
          <ScanLine size={13} />
        </button>
      </div>
      {!collapsed &&
        tracks.map((t) => (
          <TrackRow
            fmtKey={fmtKey}
            focusKey={focusKey}
            globalScanning={globalScanning}
            key={t.maskedFilename}
            onClearBpm={onClearBpm}
            onClearKey={onClearKey}
            onScan={onScan}
            onSetBpm={onSetBpm}
            onSetKey={onSetKey}
            onToggleSelect={onToggleSelect}
            recentlyUpdated={recentlyUpdated}
            scanningFiles={scanningFiles}
            selected={selected.has(t.maskedFilename)}
            track={t}
          />
        ))}
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const FOLDERS_PER_PAGE = 20;

// eslint-disable-next-line complexity
const Analysis = () => {
  const [tracks, setTracks] = useState([]);
  const [scanState, setScanState] = useState(null);
  const { fmtKey, format, setFormat } = useKeyFormat();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortKey, setSortKey] = useState('title');
  const [sortDirection, setSortDirection] = useState('asc');
  const [showSettings, setShowSettings] = useState(false);
  const [keyFilter, setKeyFilter] = useState('');
  const [focusKey, setFocusKey] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [scanningFiles, setScanningFiles] = useState(new Set());
  const [recentlyUpdated, setRecentlyUpdated] = useState(new Map());
  const pollRef = useRef(null);
  const keySnapshotRef = useRef(new Map());
  const lastCompletedScanRef = useRef(null);
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

  const load = useCallback(async () => {
    setError(null);
    try {
      const [data, state] = await Promise.all([
        analysisApi.getAll(),
        analysisApi.getScanState().catch(() => null),
      ]);
      if (!mountedRef.current) return;
      setTracks(data ?? []);
      setScanState(state);
      if (state?.scanning) {
        keySnapshotRef.current = new Map(
          (data ?? []).map((t) => [
            t.maskedFilename,
            `${t.key ?? ''}|${t.bpm ?? ''}`,
          ]),
        );
        finalizingRef.current = false;
      }
    } catch {
      if (mountedRef.current) setError('Failed to load analysis data.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // finalize scan: diff against snapshot, update tracks, clear spinners, toast result
  const finalizeScan = useCallback(async () => {
    try {
      const data = await analysisApi.getAll();
      if (!mountedRef.current) return;
      const snapshot = keySnapshotRef.current;
      const updated = new Map();
      for (const t of data ?? []) {
        const before = snapshot.get(t.maskedFilename);
        const after = `${t.key ?? ''}|${t.bpm ?? ''}`;
        if (before !== undefined && before !== after) {
          updated.set(t.maskedFilename, {
            before,
            after,
            title: t.title ?? t.filename,
          });
        }
      }

      setRecentlyUpdated(updated);
      setTracks(data ?? []);
      setScanningFiles(new Set());
      setSelected(new Set());
      // ensure no stale scanning state lingers regardless of backend/timing issues
      setScanState((previous) =>
        previous?.scanning ? { ...previous, scanning: false } : previous,
      );
      const lastScan = lastCompletedScanRef.current;
      const analysed = lastScan?.analysed ?? updated.size;
      const cancelled = lastScan?.cancelled ?? false;
      if (cancelled) {
        toast.warn(
          `Scan cancelled — ${analysed} track${analysed === 1 ? '' : 's'} analysed`,
        );
      } else if (analysed > 0) {
        toast.success(
          `Scan complete — ${analysed} track${analysed === 1 ? '' : 's'} analysed`,
        );
      } else {
        toast.info('Scan complete');
      }
    } catch {
      /* ignore */
    }
  }, []);

  // fire finalizeScan after React has rendered the completed state
  useEffect(() => {
    if (finalizingRef.current) return;
    if (
      scanState &&
      !scanState.scanning &&
      (scanState.completed || scanState.cancelled)
    ) {
      lastCompletedScanRef.current = scanState;
      finalizingRef.current = true;
      void finalizeScan();
    }
  }, [finalizeScan, scanState]);

  // poll while scan is running — only updates scanState; completion detected above
  useEffect(() => {
    if (scanState?.scanning) {
      pollRef.current = setInterval(async () => {
        try {
          const state = await analysisApi.getScanState();
          if (!mountedRef.current) {
            clearInterval(pollRef.current);
            return;
          }

          setScanState(state);
          if (!state.scanning) clearInterval(pollRef.current);
        } catch {
          /* ignore */
        }
      }, 1_500);
    } else {
      clearInterval(pollRef.current);
    }

    return () => clearInterval(pollRef.current);
  }, [scanState?.scanning]);

  const startScan = async (request, filenames) => {
    keySnapshotRef.current = new Map(
      tracks.map((t) => [t.maskedFilename, `${t.key ?? ''}|${t.bpm ?? ''}`]),
    );
    finalizingRef.current = false;
    setRecentlyUpdated(new Map());
    setScanningFiles(filenames ? new Set(filenames) : new Set());
    setScanState(null);
    try {
      await analysisApi.startScan({
        ...request,
        onlyFilenames: filenames ?? null,
      });
      const state = await analysisApi.getScanState();
      if (!mountedRef.current) return;
      setScanState(state);
      // completion effect fires finalizeScan after this state update renders
    } catch {
      if (!mountedRef.current) return;
      toast.error('Failed to start scan.');
      setScanningFiles(new Set());
    }
  };

  const handleStartScan = async (request) => {
    setShowSettings(false);
    const filenames = selected.size > 0 ? Array.from(selected) : undefined;
    await startScan(request, filenames);
  };

  const handleScanTrack = async (maskedFilename) => {
    if (scanState?.scanning) {
      toast.info('A scan is already running.');
      return;
    }

    const filenames =
      selected.size > 0
        ? Array.from(new Set([maskedFilename, ...selected]))
        : [maskedFilename];
    await startScan(
      {
        metrics: METRICS.join(', '),
        skipAnalysed: false,
        resetAll: false,
        workers: 2,
      },
      filenames,
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

  const handleSetBpm = async (maskedFilename, bpm) => {
    try {
      await analysisApi.setBpm(maskedFilename, bpm);
      setTracks((previous) =>
        previous.map((t) =>
          t.maskedFilename === maskedFilename ? { ...t, bpm, hasBpm: true } : t,
        ),
      );
    } catch {
      toast.error('Failed to set BPM.');
    }
  };

  const handleClearBpm = async (maskedFilename) => {
    try {
      await analysisApi.clearBpm(maskedFilename);
      setTracks((previous) =>
        previous.map((t) =>
          t.maskedFilename === maskedFilename
            ? { ...t, bpm: null, hasBpm: false }
            : t,
        ),
      );
    } catch {
      toast.error('Failed to clear BPM.');
    }
  };

  const handleSetKey = async (maskedFilename, key) => {
    try {
      await analysisApi.setKey(maskedFilename, key);
      setTracks((previous) =>
        previous.map((t) =>
          t.maskedFilename === maskedFilename ? { ...t, key, hasKey: true } : t,
        ),
      );
    } catch {
      toast.error('Failed to set key.');
    }
  };

  const handleClearKey = async (maskedFilename) => {
    try {
      await analysisApi.clearKey(maskedFilename);
      setTracks((previous) =>
        previous.map((t) =>
          t.maskedFilename === maskedFilename
            ? { ...t, key: null, hasKey: false }
            : t,
        ),
      );
    } catch {
      toast.error('Failed to clear key.');
    }
  };

  const toggleSort = (col) => {
    if (sortKey === col)
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(col);
      setSortDirection('asc');
    }
  };

  const uniqueKeys = useMemo(() => {
    const set = new Set(tracks.map((t) => t.key).filter(Boolean));
    return Array.from(set).sort(
      (a, b) => camelotSortWeight(a) - camelotSortWeight(b),
    );
  }, [tracks]);

  const filtered = useMemo(() => {
    let list = tracks;
    if (filter === 'complete') list = list.filter((t) => isComplete(t));
    else if (filter === 'incomplete') list = list.filter((t) => !isComplete(t));
    else if (filter === 'updated')
      list = list.filter((t) => recentlyUpdated.has(t.maskedFilename));
    if (keyFilter) list = list.filter((t) => t.key === keyFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => {
        const camelot = toCamelot(t.key)?.toLowerCase() ?? '';
        return (
          (t.title ?? t.filename).toLowerCase().includes(q) ||
          (t.artist ?? '').toLowerCase().includes(q) ||
          (t.album ?? '').toLowerCase().includes(q) ||
          (t.key ?? '').toLowerCase().includes(q) ||
          (t.bpm ? String(t.bpm) : '').includes(q) ||
          camelot.includes(q)
        );
      });
    }

    return [...list].sort((a, b) => {
      let cmp;
      if (sortKey === 'key') {
        cmp = camelotSortWeight(a.key) - camelotSortWeight(b.key);
      } else if (sortKey === 'bpm') {
        cmp = (a.bpm ?? 0) - (b.bpm ?? 0);
      } else if (sortKey === 'artist') {
        cmp = (a.artist ?? '').localeCompare(b.artist ?? '');
      } else {
        cmp = (a.title ?? a.filename).localeCompare(b.title ?? b.filename);
      }

      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [
    filter,
    keyFilter,
    recentlyUpdated,
    search,
    sortDirection,
    sortKey,
    tracks,
  ]);

  const stats = useMemo(() => {
    const total = tracks.length;
    const complete = tracks.filter((t) => isComplete(t)).length;
    return {
      total,
      complete,
      incomplete: total - complete,
      keyed: tracks.filter((t) => t.hasKey).length,
      bpmed: tracks.filter((t) => t.hasBpm).length,
      waved: tracks.filter((t) => t.hasWaveform).length,
      loud: tracks.filter((t) => t.hasLoudness).length,
      pct: total > 0 ? Math.round((complete / total) * 100) : 0,
    };
  }, [tracks]);

  useEffect(() => {
    setPage(1);
  }, [filter, keyFilter, search, sortDirection, sortKey]);
  useEffect(() => {
    setSelected(new Set());
  }, [filter, keyFilter]);

  const allGrouped = useMemo(() => {
    const map = new Map();
    for (const t of filtered) {
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
  }, [filtered]);

  const totalPages = Math.ceil(allGrouped.length / FOLDERS_PER_PAGE);

  const pagedGroups = useMemo(
    () =>
      allGrouped.slice((page - 1) * FOLDERS_PER_PAGE, page * FOLDERS_PER_PAGE),
    [allGrouped, page],
  );

  const pageAllTracks = useMemo(
    () => pagedGroups.flatMap((g) => g.tracks),
    [pagedGroups],
  );

  const toggleSelect = useCallback((maskedFilename) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(maskedFilename)) next.delete(maskedFilename);
      else next.add(maskedFilename);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((previous) => {
      const pageIds = pageAllTracks.map((t) => t.maskedFilename);
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
  }, [pageAllTracks]);

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

  const handleScanFolder = async (folderPath, folderName) => {
    if (scanState?.scanning) {
      toast.info('A scan is already running.');
      return;
    }

    const allDirectoryIds = tracks
      .filter((t) => t.directory === folderPath)
      .map((t) => t.maskedFilename);
    if (allDirectoryIds.length === 0) {
      toast.warn(`No tracks found in folder: ${folderName}`);
      return;
    }

    await startScan(
      {
        metrics: METRICS.join(', '),
        skipAnalysed: true,
        resetAll: false,
        workers: 2,
      },
      allDirectoryIds,
    );
  };

  const allExpanded =
    pagedGroups.length > 0 &&
    pagedGroups.every((g) => expandedFolders.has(g.dir));

  const toggleAllFolders = useCallback(() => {
    setExpandedFolders((previous) => {
      const toggled = new Set(previous);
      if (pagedGroups.every((g) => toggled.has(g.dir))) {
        for (const g of pagedGroups) toggled.delete(g.dir);
      } else {
        for (const g of pagedGroups) toggled.add(g.dir);
      }

      return toggled;
    });
  }, [pagedGroups]);

  // eslint-disable-next-line react/no-unstable-nested-components
  const SortIcon = ({ col }) => {
    if (sortKey !== col) return null;
    return sortDirection === 'asc' ? (
      <ChevronUp size={11} />
    ) : (
      <ChevronDown size={11} />
    );
  };

  if (loading) {
    return (
      <div className="ka-state-center">
        <div className="ka-spinner" />
        <span>Loading analysis...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ka-state-center">
        <AlertCircle
          size={32}
          style={{ opacity: 0.3 }}
        />
        <span>{error}</span>
        <button
          className="ka-btn hover-fx"
          onClick={load}
          type="button"
        >
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    );
  }

  const scanning = scanState?.scanning;
  const processed = scanState
    ? scanState.analysed + scanState.skipped + scanState.failed
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
      {/* ── Stats bar ── */}
      <div className="ka-stats-bar">
        <div className="ka-stat">
          <span className="ka-stat-value">{stats.total}</span>
          <span className="ka-stat-label">Tracks</span>
        </div>
        <div className="ka-stat ka-stat--keyed">
          <span className="ka-stat-value">{stats.keyed}</span>
          <span className="ka-stat-label">Key</span>
        </div>
        <div className="ka-stat ka-stat--keyed">
          <span className="ka-stat-value">{stats.bpmed}</span>
          <span className="ka-stat-label">BPM</span>
        </div>
        <div className="ka-stat ka-stat--keyed">
          <span className="ka-stat-value">{stats.waved}</span>
          <span className="ka-stat-label">Waveform</span>
        </div>
        <div className="ka-stat ka-stat--keyed">
          <span className="ka-stat-value">{stats.loud}</span>
          <span className="ka-stat-label">Loudness</span>
        </div>
        <div className="ka-stat ka-stat--unkeyed">
          <span className="ka-stat-value">{stats.incomplete}</span>
          <span className="ka-stat-label">Incomplete</span>
        </div>
        <div className="ka-stat-bar-wrap">
          <div className="ka-stat-bar">
            <div
              className="ka-stat-bar-fill"
              style={{ width: `${stats.pct}%` }}
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
          onClick={load}
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
          {recentlyUpdated.size > 0 && (
            <button
              className={`ka-filter-btn ka-filter-btn--updated hover-fx${filter === 'updated' ? ' active' : ''}`}
              onClick={() => setFilter('updated')}
              type="button"
            >
              Updated ({recentlyUpdated.size})
            </button>
          )}
        </div>

        {uniqueKeys.length > 0 && (
          <select
            className="ka-select ka-select--sm"
            onChange={({ target }) => {
              setKeyFilter(target.value);
              setFocusKey(target.value || null);
            }}
            value={keyFilter}
          >
            <option value="">All Keys</option>
            {uniqueKeys.map((k) => {
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
                  {label}
                </option>
              );
            })}
          </select>
        )}

        <span className="ka-count">
          {filtered.length} track{filtered.length === 1 ? '' : 's'} ·{' '}
          {allGrouped.length} folder{allGrouped.length === 1 ? '' : 's'}
          {totalPages > 1 && ` · page ${page}/${totalPages}`}
        </span>

        {pagedGroups.length > 0 && (
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
              pageAllTracks.length > 0 &&
              pageAllTracks.every((t) => selected.has(t.maskedFilename))
            }
            className="ka-checkbox"
            disabled={scanning}
            onChange={toggleSelectAll}
            ref={(element) => {
              if (element)
                element.indeterminate =
                  !scanning &&
                  pageAllTracks.some((t) => selected.has(t.maskedFilename)) &&
                  !pageAllTracks.every((t) => selected.has(t.maskedFilename));
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
        {filtered.length === 0 ? (
          <div className="ka-state-center">
            <Music
              size={36}
              style={{ opacity: 0.2 }}
            />
            <span>
              {tracks.length === 0
                ? 'No audio tracks found. Make sure your library is scanned.'
                : 'No tracks match your filter.'}
            </span>
          </div>
        ) : (
          pagedGroups.map((g) => (
            <FolderGroup
              collapsed={!expandedFolders.has(g.dir)}
              dir={g.dir}
              fmtKey={fmtKey}
              focusKey={focusKey}
              globalScanning={scanning}
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
              scanningFiles={scanningFiles}
              selected={selected}
              tracks={g.tracks}
            />
          ))
        )}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="ka-pagination">
          <button
            className="ka-page-btn hover-fx"
            disabled={page === 1}
            onClick={() => setPage(1)}
            title="First page"
            type="button"
          >
            «
          </button>
          <button
            className="ka-page-btn hover-fx"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            type="button"
          >
            ‹ Prev
          </button>
          <span className="ka-page-info">
            Folders {(page - 1) * FOLDERS_PER_PAGE + 1}–
            {Math.min(page * FOLDERS_PER_PAGE, allGrouped.length)} of{' '}
            {allGrouped.length}
          </span>
          <button
            className="ka-page-btn hover-fx"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
            type="button"
          >
            Next ›
          </button>
          <button
            className="ka-page-btn hover-fx"
            disabled={page === totalPages}
            onClick={() => setPage(totalPages)}
            title="Last page"
            type="button"
          >
            »
          </button>
        </div>
      )}
    </div>
  );
};

export default Analysis;
