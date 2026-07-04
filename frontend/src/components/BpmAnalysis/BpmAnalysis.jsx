// <copyright file="BpmAnalysis.jsx" company="John Narey">
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

import { usePlayer } from '../../context/PlayerContext';
import * as bpmApi from '../../lib/bpmAnalysis';
import PageInfo from '../Shared/PageInfo';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
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

// ── Scan settings panel ───────────────────────────────────────────────────────

const ScanSettings = ({ onClose, onStart, scanning, selectedCount = 0 }) => {
  const [skipTagged, setSkipTagged] = useState(true);
  const [resetAll, setResetAll] = useState(false);
  const [algorithm, setAlgorithm] = useState('audioAnalysis');
  const [workers, setWorkers] = useState(2);

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
        <label className="ka-field">
          <span className="ka-field-label">Algorithm</span>
          <select
            className="ka-select"
            onChange={({ target }) => setAlgorithm(target.value)}
            value={algorithm}
          >
            <option value="audioAnalysis">Audio Analysis (recommended)</option>
            <option value="tagOnly">Tag Only (fast, no audio analysis)</option>
          </select>
          <span className="ka-field-hint">
            {algorithm === 'audioAnalysis'
              ? 'Reads TBPM tag first; falls back to spectral flux analysis of the first 60 seconds via ffmpeg.'
              : 'Only reads the TBPM tag. Fast but only works if tracks are already tagged.'}
          </span>
        </label>

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
          <span className="ka-field-label">Skip already-tagged tracks</span>
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
            <AlertCircle size={13} /> This will clear all existing BPM values
            and re-detect them.
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
          onClick={() => onStart({ skipTagged, resetAll, algorithm, workers })}
          type="button"
        >
          <ScanLine size={13} />
          {selectedCount > 0 ? `Scan ${selectedCount} selected` : 'Start Scan'}
        </button>
      </div>
    </div>
  );
};

// ── BPM badge ─────────────────────────────────────────────────────────────────

const BpmBadge = ({ bpm, wasUpdated }) => {
  if (!bpm) return <span className="ka-badge ka-badge--empty">—</span>;
  return (
    <span className={`ka-badge${wasUpdated ? ' ka-badge--updated' : ''}`}>
      {bpm}
    </span>
  );
};

// ── Track row ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line complexity
const TrackRow = ({
  globalScanning,
  onClear,
  onScan,
  onSetBpm,
  onToggleSelect,
  recentlyUpdated,
  scanningFiles,
  selected,
  track,
}) => {
  const [editing, setEditing] = useState(false);
  const [bpmInput, setBpmInput] = useState(track.bpm?.toString() ?? '');
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
    const v = Number.parseInt(bpmInput, 10);
    if (v > 0) onSetBpm(track.maskedFilename, v);
    else if (track.bpm) onClear(track.maskedFilename);
    setEditing(false);
  };

  return (
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
            <input
              autoFocus
              className="ka-key-input"
              max={300}
              min={1}
              onChange={({ target }) => setBpmInput(target.value)}
              onKeyDown={({ key }) => {
                if (key === 'Enter') submit();
                if (key === 'Escape') setEditing(false);
              }}
              style={{ width: '4.5rem' }}
              type="number"
              value={bpmInput}
            />
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
              setBpmInput(track.bpm?.toString() ?? '');
              setEditing(true);
            }}
            title="Click to edit BPM"
            type="button"
          >
            <BpmBadge
              bpm={track.bpm}
              wasUpdated={wasUpdated}
            />
          </button>
        )}
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
                : 'Detect BPM'
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
        {track.bpm && !scanning && (
          <button
            className="ka-icon-btn ka-icon-btn--danger"
            onClick={() => onClear(track.maskedFilename)}
            title="Clear BPM"
            type="button"
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>
    </div>
  );
};

// ── Folder group ──────────────────────────────────────────────────────────────

const FolderGroup = ({
  collapsed,
  dir,
  globalScanning,
  name,
  onClear,
  onScan,
  onScanFolder,
  onSelectFolder,
  onSetBpm,
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
              : 'Detect BPM for untagged tracks in this folder'
          }
          type="button"
        >
          <ScanLine size={13} />
        </button>
      </div>
      {!collapsed &&
        tracks.map((t) => (
          <TrackRow
            globalScanning={globalScanning}
            key={t.maskedFilename}
            onClear={onClear}
            onScan={onScan}
            onSetBpm={onSetBpm}
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

// ── Sort icon ─────────────────────────────────────────────────────────────────

const SortIcon = ({ col, sortDirection, sortKey }) => {
  if (sortKey !== col) return null;
  return sortDirection === 'asc' ? (
    <ChevronUp size={11} />
  ) : (
    <ChevronDown size={11} />
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const FOLDERS_PER_PAGE = 20;

// eslint-disable-next-line complexity
const BpmAnalysis = () => {
  const [tracks, setTracks] = useState([]);
  const [scanState, setScanState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortKey, setSortKey] = useState('title');
  const [sortDirection, setSortDirection] = useState('asc');
  const [showSettings, setShowSettings] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [scanningFiles, setScanningFiles] = useState(new Set());
  const [recentlyUpdated, setRecentlyUpdated] = useState(new Map());
  const pollRef = useRef(null);
  const bpmSnapshotRef = useRef(new Map());
  const lastCompletedScanRef = useRef(null);
  const finalizingRef = useRef(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [data, state] = await Promise.all([
        bpmApi.getAll(),
        bpmApi.getScanState().catch(() => null),
      ]);
      setTracks(data ?? []);
      setScanState(state);
      if (state?.scanning) {
        bpmSnapshotRef.current = new Map(
          (data ?? []).map((t) => [t.maskedFilename, t.bpm]),
        );
        finalizingRef.current = false;
      }
    } catch {
      setError('Failed to load BPM analysis data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const finalizeScan = useCallback(async () => {
    try {
      const data = await bpmApi.getAll();
      const snapshot = bpmSnapshotRef.current;
      const updated = new Map();
      for (const t of data ?? []) {
        if (t.bpm !== snapshot.get(t.maskedFilename)) {
          updated.set(t.maskedFilename, {
            oldBpm: snapshot.get(t.maskedFilename) ?? null,
            newBpm: t.bpm,
            title: t.title ?? t.filename,
          });
        }
      }

      setRecentlyUpdated(updated);
      setTracks(data ?? []);
      setScanningFiles(new Set());
      setSelected(new Set());
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

  useEffect(() => {
    if (scanState?.scanning) {
      pollRef.current = setInterval(async () => {
        try {
          const state = await bpmApi.getScanState();
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
    bpmSnapshotRef.current = new Map(
      tracks.map((t) => [t.maskedFilename, t.bpm]),
    );
    finalizingRef.current = false;
    setRecentlyUpdated(new Map());
    setScanningFiles(filenames ? new Set(filenames) : new Set());
    setScanState(null);
    try {
      await bpmApi.startScan({ ...request, onlyFilenames: filenames ?? null });
      const state = await bpmApi.getScanState();
      setScanState(state);
    } catch {
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
        skipTagged: false,
        resetAll: false,
        algorithm: 'audioAnalysis',
        workers: 2,
      },
      filenames,
    );
  };

  const handleCancelScan = async () => {
    try {
      await bpmApi.cancelScan();
    } catch (caughtError) {
      if (caughtError?.response?.status !== 404)
        toast.error('Failed to cancel scan.');
    }

    try {
      const state = await bpmApi.getScanState();
      setScanState(state);
    } catch {
      /* ignore */
    }
  };

  const handleSetBpm = async (maskedFilename, bpm) => {
    try {
      await bpmApi.setBpm(maskedFilename, bpm);
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
      await bpmApi.clearBpm(maskedFilename);
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

  const toggleSort = (col) => {
    if (sortKey === col)
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(col);
      setSortDirection('asc');
    }
  };

  const filtered = useMemo(() => {
    let list = tracks;
    if (filter === 'tagged') list = list.filter((t) => t.hasBpm);
    else if (filter === 'untagged') list = list.filter((t) => !t.hasBpm);
    else if (filter === 'updated')
      list = list.filter((t) => recentlyUpdated.has(t.maskedFilename));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          (t.title ?? t.filename).toLowerCase().includes(q) ||
          (t.artist ?? '').toLowerCase().includes(q) ||
          (t.album ?? '').toLowerCase().includes(q) ||
          (t.bpm?.toString() ?? '').includes(q),
      );
    }

    return [...list].sort((a, b) => {
      let cmp;
      if (sortKey === 'bpm') cmp = (a.bpm ?? 0) - (b.bpm ?? 0);
      else if (sortKey === 'artist')
        cmp = (a.artist ?? '').localeCompare(b.artist ?? '');
      else cmp = (a.title ?? a.filename).localeCompare(b.title ?? b.filename);
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [filter, recentlyUpdated, search, sortDirection, sortKey, tracks]);

  const stats = useMemo(() => {
    const total = tracks.length;
    const tagged = tracks.filter((t) => t.hasBpm).length;
    const pct = total > 0 ? Math.round((tagged / total) * 100) : 0;
    return { total, tagged, untagged: total - tagged, pct };
  }, [tracks]);

  useEffect(() => {
    setPage(1);
  }, [filter, search, sortDirection, sortKey]);
  useEffect(() => {
    setSelected(new Set());
  }, [filter]);

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
      const updated = new Set(previous);
      if (updated.has(maskedFilename)) updated.delete(maskedFilename);
      else updated.add(maskedFilename);
      return updated;
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
        skipTagged: true,
        resetAll: false,
        algorithm: 'audioAnalysis',
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
      if (pagedGroups.every((g) => toggled.has(g.dir)))
        for (const g of pagedGroups) toggled.delete(g.dir);
      else for (const g of pagedGroups) toggled.add(g.dir);
      return toggled;
    });
  }, [pagedGroups]);

  if (loading) {
    return (
      <div className="ka-state-center">
        <div className="ka-spinner" />
        <span>Loading BPM analysis...</span>
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
      <PageInfo storageKey="bpmanalysis">
        <p>
          Detects and stores the BPM for every track in your library. Two modes
          are available:
        </p>
        <ul>
          <li>
            <strong>Tag Only</strong> — reads the <code>TBPM</code> tag
            instantly. Fast, but skips files with no existing BPM tag.
          </li>
          <li>
            <strong>Audio Analysis</strong> — analyses the first 60 seconds of
            audio using spectral flux onset detection and autocorrelation to
            detect tempo, even on completely untagged files.
          </li>
        </ul>
        <p>
          The first 60 seconds covers approximately 32 bars at typical DJ tempos
          (120–140 BPM) and provides the cleanest beat signal before additional
          layers are introduced.
        </p>
      </PageInfo>

      {/* ── Stats bar ── */}
      <div className="ka-stats-bar">
        <div className="ka-stat">
          <span className="ka-stat-value">{stats.total}</span>
          <span className="ka-stat-label">Tracks</span>
        </div>
        <div className="ka-stat ka-stat--keyed">
          <span className="ka-stat-value">{stats.tagged}</span>
          <span className="ka-stat-label">With BPM</span>
        </div>
        <div className="ka-stat ka-stat--unkeyed">
          <span className="ka-stat-value">{stats.untagged}</span>
          <span className="ka-stat-label">No BPM</span>
        </div>
        <div className="ka-stat-bar-wrap">
          <div className="ka-stat-bar">
            <div
              className="ka-stat-bar-fill"
              style={{ width: `${stats.pct}%` }}
            />
          </div>
        </div>

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
            placeholder="Search tracks, artists, BPM..."
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
          {['all', 'tagged', 'untagged'].map((f) => (
            <button
              className={`ka-filter-btn hover-fx${filter === f ? ' active' : ''}`}
              key={f}
              onClick={() => setFilter(f)}
              type="button"
            >
              {f === 'all' ? 'All' : f === 'tagged' ? 'Has BPM' : 'No BPM'}
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
            onClick={() => toggleSort('bpm')}
            type="button"
          >
            BPM{' '}
            <SortIcon
              col="bpm"
              sortDirection={sortDirection}
              sortKey={sortKey}
            />
          </button>
        </div>
        <div className="ka-col-info">
          <button
            className="ka-sort-btn hover-fx"
            onClick={() => toggleSort('title')}
            type="button"
          >
            Title{' '}
            <SortIcon
              col="title"
              sortDirection={sortDirection}
              sortKey={sortKey}
            />
          </button>
          <span className="ka-col-sep"> / </span>
          <button
            className="ka-sort-btn hover-fx"
            onClick={() => toggleSort('artist')}
            type="button"
          >
            Artist{' '}
            <SortIcon
              col="artist"
              sortDirection={sortDirection}
              sortKey={sortKey}
            />
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
              globalScanning={scanning}
              key={g.dir}
              name={g.name}
              onClear={handleClearBpm}
              onScan={handleScanTrack}
              onScanFolder={handleScanFolder}
              onSelectFolder={handleSelectFolder}
              onSetBpm={handleSetBpm}
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

export default BpmAnalysis;
