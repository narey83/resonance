// <copyright file="Duplicates.jsx" company="John Narey">
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

import './Duplicates.css';
import { toast } from '../../lib/activityNotices';
import { deleteTrackBatch } from '../../lib/musicLibrary';
import { browseAll, getTags } from '../../lib/shares';
import { Copy, RefreshCw, Search, Trash2, X } from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const AUDIO_EXTS = new Set([
  'mp3',
  'flac',
  'ogg',
  'wav',
  'm4a',
  'aac',
  'opus',
  'wma',
  'aiff',
  'aif',
]);

// ── Formatting helpers ────────────────────────────────────────────────────────

const formatBytes = (b) => {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} KB`;
  return `${b} B`;
};

const formatQuality = (f) => {
  const extension = (f.extension ?? '?').toUpperCase();
  if (f.bitRate)
    return `${extension} · ${f.bitRate}${f.isVariableBitRate ? ' VBR' : ''} kbps`;
  if (f.sampleRate) {
    const khz = `${(f.sampleRate / 1_000).toFixed(1)} kHz`;
    return f.bitDepth
      ? `${extension} · ${khz} / ${f.bitDepth}-bit`
      : `${extension} · ${khz}`;
  }

  return extension;
};

// ── Quality scoring ───────────────────────────────────────────────────────────
// Tiers: lossless with full metadata > lossless (size tiebreak) > lossy > size only
// Using ?? 0 (not ?? 16 / ?? 44100) so files without metadata don't get falsely
// inflated scores and end up sharing the same value as files that do have metadata.

const LOSSLESS_EXTS = new Set(['flac', 'wav', 'aiff', 'aif', 'alac']);

const qualityScore = (f) => {
  const extension = (f.extension ?? '').toLowerCase();
  if (LOSSLESS_EXTS.has(extension)) {
    const meta = (f.bitDepth ?? 0) * (f.sampleRate ?? 0);
    // Lossless with metadata beats lossless without; size breaks ties within each tier
    return meta > 0
      ? 2_000_000 + meta + (f.size ?? 0) / 1e9
      : 1_000_000 + (f.size ?? 0);
  }

  if (f.bitRate) return f.bitRate * 1_000 + (f.size ?? 0) / 1e9;
  return f.size ?? 0;
};

// Annotate groups: mark the best copy and sort best-first within each group
const annotateGroups = (groups) =>
  groups.map((group) => {
    const scores = group.files.map(qualityScore);
    const maxScore = Math.max(...scores);
    return {
      ...group,
      files: group.files
        .map((f, index) => ({ ...f, isBest: scores[index] === maxScore }))
        .sort((a, b) => qualityScore(b) - qualityScore(a)),
    };
  });

// ── Fuzzy search ──────────────────────────────────────────────────────────────

const fuzzyScore = (query, target) => {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 1;
  // Exact substring: highest priority
  if (t.includes(q)) return 1_000 + (q.length / (t.length || 1)) * 500;
  // Subsequence match with consecutive-run bonus
  let qi = 0;
  let run = 0;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      run++;
      score += run * 2;
    } else {
      run = 0;
    }
  }

  return qi === q.length ? score : 0;
};

// ── String similarity (Levenshtein) ───────────────────────────────────────────

const levenshtein = (a, b) => {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  let previous = Array.from({ length: n + 1 }, (_, index) => index);
  let current = Array.from({ length: n + 1 });
  for (let index = 1; index <= m; index++) {
    current[0] = index;
    for (let column = 1; column <= n; column++) {
      current[column] =
        a[index - 1] === b[column - 1]
          ? previous[column - 1]
          : 1 +
            Math.min(
              previous[column],
              current[column - 1],
              previous[column - 1],
            );
    }

    [previous, current] = [current, previous];
  }

  return previous[n];
};

const stringSimilarity = (a, b) => {
  const distribution = levenshtein(a, b);
  return 1 - distribution / Math.max(a.length, b.length, 1);
};

// ── Normalisation helpers ─────────────────────────────────────────────────────

const norm = (s) =>
  (s ?? '')
    .toLowerCase()
    .replaceAll(/[^\w ]/gu, '')
    .replaceAll(/\s+/gu, ' ')
    .trim();

const normFolder = (name) =>
  name
    .toLowerCase()
    .replaceAll(/\s*[([{][^)\]}]*[)\]}]/gu, ' ')
    .replaceAll(/[_-]/gu, ' ')
    .replaceAll(/[^\s\w]/gu, '')
    .replaceAll(/\s+/gu, ' ')
    .trim();

const lastName = (path) =>
  path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? path;

// ── File parsing ──────────────────────────────────────────────────────────────

const parseFile = (directoryName, file, tags) => {
  const extension = (
    file.extension ||
    file.filename.split('.').pop() ||
    ''
  ).toLowerCase();
  const bare = file.filename.replace(/\.[^./]+$/u, '');

  let title = tags?.title ?? null;
  let artist = tags?.artist ?? tags?.albumArtist ?? null;

  if (!title) {
    const withoutNumber = bare.replace(/^\d{1,3}[\s._-]+/u, '').trim();
    const dashIndex = withoutNumber.indexOf(' - ');
    if (dashIndex > 0) {
      artist = artist || withoutNumber.slice(0, dashIndex).trim();
      title = withoutNumber.slice(dashIndex + 3).trim();
    } else {
      title = withoutNumber || bare;
    }
  }

  if (!artist) {
    const parts = directoryName.replaceAll('\\', '/').split('/');
    artist = parts.at(-2) ?? parts.at(-1) ?? '';
  }

  return {
    artist: artist || '',
    bare,
    bitDepth: file.bitDepth,
    bitRate: file.bitRate,
    dirName: directoryName,
    extension,
    filename: file.filename,
    fullPath: `${directoryName}\\${file.filename}`,
    isVariableBitRate: file.isVariableBitRate,
    sampleRate: file.sampleRate,
    size: file.size,
    title: title || bare,
  };
};

// ── Grouping: track identity ──────────────────────────────────────────────────

const groupByTrack = (files) => {
  const map = new Map();
  for (const f of files) {
    const key = norm(`${f.artist} ${f.title}`);
    if (!key) continue;
    if (!map.has(key)) {
      const label = f.artist ? `${f.artist} — ${f.title}` : f.title;
      map.set(key, { files: [], key, label });
    }

    map.get(key).files.push(f);
  }

  return [...map.values()].filter((g) => g.files.length > 1);
};

// ── Grouping: filename ────────────────────────────────────────────────────────

const groupByFilename = (files) => {
  const map = new Map();
  for (const f of files) {
    const key = f.bare.toLowerCase();
    if (!key) continue;
    if (!map.has(key)) map.set(key, { files: [], key, label: f.bare });
    map.get(key).files.push(f);
  }

  return [...map.values()].filter((g) => g.files.length > 1);
};

// ── Grouping: similar folders ─────────────────────────────────────────────────

const FOLDER_SIM_THRESHOLD = 0.7;
const FILE_OVERLAP_THRESHOLD = 0.3;

const groupBySimilarFolders = (files) => {
  const directoryFiles = new Map();
  for (const f of files) {
    if (!directoryFiles.has(f.dirName))
      directoryFiles.set(f.dirName, new Set());
    directoryFiles.get(f.dirName).add(f.filename.toLowerCase());
  }

  const directories = [...directoryFiles.keys()];
  const pairs = [];

  for (let index = 0; index < directories.length; index++) {
    for (
      let innerIndex = index + 1;
      innerIndex < directories.length;
      innerIndex++
    ) {
      const a = directories[index];
      const b = directories[innerIndex];
      const normA = normFolder(lastName(a));
      const normB = normFolder(lastName(b));
      if (!normA || !normB) continue;

      const nameSim = stringSimilarity(normA, normB);
      if (nameSim < FOLDER_SIM_THRESHOLD) continue;

      const setA = directoryFiles.get(a);
      const setB = directoryFiles.get(b);
      const sharedFiles = [...setA].filter((f) => setB.has(f));
      const unionSize = new Set([...setA, ...setB]).size;
      const jaccard = sharedFiles.length / unionSize;

      if (jaccard >= FILE_OVERLAP_THRESHOLD || nameSim >= 0.95) {
        pairs.push({
          dirs: [
            { fileCount: setA.size, path: a },
            { fileCount: setB.size, path: b },
          ],
          key: `${a}|||${b}`,
          label: lastName(a),
          nameSimilarity: nameSim,
          sharedFileCount: sharedFiles.length,
        });
      }
    }
  }

  return pairs.sort(
    (a, b) =>
      b.nameSimilarity - a.nameSimilarity ||
      b.sharedFileCount - a.sharedFileCount,
  );
};

// ── Grouping: by folder (folders with 2+ tracks duplicated elsewhere) ─────────

const groupByFolder = (files) => {
  const trackGroups = groupByTrack(files);
  const folderMap = new Map();

  for (const group of trackGroups) {
    const scores = group.files.map(qualityScore);
    const maxScore = Math.max(...scores);

    for (let index = 0; index < group.files.length; index++) {
      const f = group.files[index];
      const isBest = scores[index] === maxScore;
      const peers = group.files
        .filter((_, index_) => index_ !== index)
        .map((p) => ({ ...p, isBest: qualityScore(p) === maxScore }));

      if (!folderMap.has(f.dirName)) folderMap.set(f.dirName, []);
      folderMap.get(f.dirName).push({ file: { ...f, isBest }, peers });
    }
  }

  const result = [];
  for (const [directoryName, items] of folderMap) {
    if (items.length < 2) continue;
    result.push({
      dirName: directoryName,
      items: items.sort((a, b) =>
        a.file.filename.localeCompare(b.file.filename),
      ),
      key: directoryName,
      label: lastName(directoryName),
    });
  }

  return result.sort(
    (a, b) =>
      b.items.length - a.items.length || a.dirName.localeCompare(b.dirName),
  );
};

// ── Clipboard helper ──────────────────────────────────────────────────────────

const copyPath = (path) => {
  // eslint-disable-next-line promise/prefer-await-to-then
  navigator.clipboard.writeText(path).catch(() => {});
  toast.success('Path copied', { autoClose: 1_500 });
};

// ── Component ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const Pager = ({ onPage, page, totalPages }) =>
  totalPages > 1 ? (
    <div className="dupes-pager">
      <button
        className="dupes-pager-btn hover-fx"
        disabled={page === 0}
        onClick={() => onPage(0)}
        type="button"
      >
        «
      </button>
      <button
        className="dupes-pager-btn hover-fx"
        disabled={page === 0}
        onClick={() => onPage((p) => p - 1)}
        type="button"
      >
        ‹
      </button>
      <span className="dupes-pager-info">
        {page + 1} / {totalPages}
      </span>
      <button
        className="dupes-pager-btn hover-fx"
        disabled={page === totalPages - 1}
        onClick={() => onPage((p) => p + 1)}
        type="button"
      >
        ›
      </button>
      <button
        className="dupes-pager-btn hover-fx"
        disabled={page === totalPages - 1}
        onClick={() => onPage(totalPages - 1)}
        type="button"
      >
        »
      </button>
    </div>
  ) : null;

// eslint-disable-next-line complexity
const Duplicates = () => {
  const [allFiles, setAllFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('track');
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeFilter, setActiveFilter] = useState(null);
  const [activeFilterLabel, setActiveFilterLabel] = useState('');
  const [deletionQueue, setDeletionQueue] = useState(new Set());
  const [showDeletionList, setShowDeletionList] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const loadingRef = useRef(false);
  const searchWrapRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const [contents, tagsMap] = await Promise.all([
        browseAll(),
        // eslint-disable-next-line promise/prefer-await-to-then
        getTags().catch(() => ({})),
      ]);
      const files = [];
      for (const directory of contents ?? []) {
        for (const file of directory.files ?? []) {
          const extension = (
            file.extension ||
            file.filename.split('.').pop() ||
            ''
          ).toLowerCase();
          if (!AUDIO_EXTS.has(extension)) continue;
          const tagKey = `${directory.name}\\${file.filename}`;
          files.push(parseFile(directory.name, file, tagsMap[tagKey] ?? null));
        }
      }

      if (mountedRef.current) {
        setAllFiles(files);
        setPage(0);
      }
    } catch (caughtError) {
      console.error(caughtError);
      if (mountedRef.current) setError('Failed to load files.');
    } finally {
      if (mountedRef.current) setLoading(false);
      // eslint-disable-next-line require-atomic-updates
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (mouseEvent) => {
      if (
        searchWrapRef.current &&
        !searchWrapRef.current.contains(mouseEvent.target)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const groups = useMemo(() => {
    if (mode === 'filename') return annotateGroups(groupByFilename(allFiles));
    if (mode === 'folders') return groupBySimilarFolders(allFiles);
    if (mode === 'folder') return groupByFolder(allFiles);
    return annotateGroups(groupByTrack(allFiles));
  }, [allFiles, mode]);

  // Fuzzy suggestions from current groups
  const suggestions = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return [];
    return groups
      .map((g) => ({
        group: g,
        score: fuzzyScore(q, g.label + ' ' + (g.dirName ?? '')),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.group);
  }, [groups, searchQuery]);

  // Visible groups: filter by active selection or show all
  const displayGroups = useMemo(() => {
    if (activeFilter) return groups.filter((g) => g.key === activeFilter);
    return groups;
  }, [activeFilter, groups]);

  const isSimilarFolderMode = mode === 'folders';
  const isFolderMode = mode === 'folder';

  const totalFiles = isSimilarFolderMode
    ? groups.reduce((sum, g) => sum + g.dirs.length, 0)
    : isFolderMode
      ? groups.reduce((sum, g) => sum + g.items.length, 0)
      : groups.reduce((sum, g) => sum + g.files.length, 0);

  const totalPages = Math.ceil(displayGroups.length / PAGE_SIZE);
  const pageGroups = displayGroups.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );

  const handleModeChange = ({ target }) => {
    setMode(target.value);
    setPage(0);
    setActiveFilter(null);
    setActiveFilterLabel('');
    setSearchQuery('');
  };

  const selectSuggestion = (group) => {
    setActiveFilter(group.key);
    setActiveFilterLabel(group.label);
    setSearchQuery('');
    setShowSuggestions(false);
    setPage(0);
  };

  const clearFilter = () => {
    setActiveFilter(null);
    setActiveFilterLabel('');
    setSearchQuery('');
    setPage(0);
  };

  // ── Deletion queue helpers ──────────────────────────────────────────────────

  const toggleQueued = (path) =>
    setDeletionQueue((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const queuePaths = (paths) =>
    setDeletionQueue((previous) => new Set([...previous, ...paths]));

  const keepBest = (group) =>
    queuePaths(group.files.filter((f) => !f.isBest).map((f) => f.fullPath));

  const queueFolder = (directoryName) =>
    queuePaths(
      allFiles
        .filter((f) => f.dirName === directoryName)
        .map((f) => f.fullPath),
    );

  const handleDeleteQueued = async () => {
    if (deleting || deletionQueue.size === 0) return;
    setDeleting(true);
    try {
      const result = await deleteTrackBatch([...deletionQueue]);
      const { deleted, forbidden, notFound } = result;
      if (deleted > 0) {
        toast.success(`Deleted ${deleted} file${deleted !== 1 ? 's' : ''}`);
        setAllFiles((previous) =>
          previous.filter((f) => !deletionQueue.has(f.fullPath)),
        );
        setDeletionQueue(new Set());
        setShowDeletionList(false);
      }

      if (notFound > 0)
        toast.warn(`${notFound} file${notFound !== 1 ? 's' : ''} not found`);
      if (forbidden > 0)
        toast.error(
          `${forbidden} file${forbidden !== 1 ? 's' : ''} outside share directory`,
        );
    } catch {
      toast.error('Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="dupes-shell">
      <div className="dupes-window">
        {/* ── Toolbar ── */}
        <div className="dupes-toolbar">
          <div className="dupes-toolbar-row">
            <div className="dupes-toolbar-left">
              <span className="dupes-toolbar-title">Duplicate Files</span>
              {!loading && allFiles.length > 0 && (
                <span className="dupes-count">
                  {groups.length} {groups.length === 1 ? 'group' : 'groups'}
                  {isSimilarFolderMode
                    ? ` · ${totalFiles} folders`
                    : isFolderMode
                      ? ` · ${totalFiles} duplicated tracks`
                      : ` · ${totalFiles} files`}
                </span>
              )}
            </div>
            <div className="dupes-toolbar-right">
              <select
                className="opt-select"
                onChange={handleModeChange}
                value={mode}
              >
                <option value="track">Match by track identity</option>
                <option value="filename">Match by filename</option>
                <option value="folders">Similar folder names</option>
                <option value="folder">By folder</option>
              </select>
              <button
                className="dupes-refresh-btn hover-fx"
                disabled={loading}
                onClick={() => {
                  loadingRef.current = false;
                  void load();
                }}
                title="Refresh"
                type="button"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {/* ── Search row ── */}
          <div
            className="dupes-search-row"
            ref={searchWrapRef}
          >
            {activeFilter ? (
              <div className="dupes-filter-chip">
                <Search size={12} />
                <span>{activeFilterLabel}</span>
                <button
                  className="dupes-filter-clear hover-fx"
                  onClick={clearFilter}
                  type="button"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="dupes-search-input-wrap">
                <Search
                  className="dupes-search-icon"
                  size={13}
                />
                <input
                  className="dupes-search-input"
                  onChange={({ target }) => {
                    setSearchQuery(target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => searchQuery && setShowSuggestions(true)}
                  placeholder="Filter duplicates…"
                  type="text"
                  value={searchQuery}
                />
                {searchQuery && (
                  <button
                    className="dupes-search-clear hover-fx"
                    onClick={() => {
                      setSearchQuery('');
                      setShowSuggestions(false);
                    }}
                    type="button"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )}

            {/* Suggestions dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="dupes-suggestions">
                {suggestions.map((g) => (
                  <button
                    className="dupes-suggestion-item"
                    key={g.key}
                    onClick={() => selectSuggestion(g)}
                    type="button"
                  >
                    <span className="dupes-suggestion-label">{g.label}</span>
                    <span className="dupes-suggestion-meta">
                      {isFolderMode
                        ? `${g.items?.length ?? 0} tracks`
                        : isSimilarFolderMode
                          ? `${Math.round((g.nameSimilarity ?? 0) * 100)}% similar`
                          : `${g.files?.length ?? 0} copies`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Content ── */}
        <div className="dupes-content">
          {loading && <div className="dupes-empty">Scanning…</div>}
          {!loading && error && <div className="dupes-empty">{error}</div>}
          {!loading && !error && allFiles.length === 0 && (
            <div className="dupes-empty">
              No audio files found. Make sure shares are configured and scanned.
            </div>
          )}
          {!loading &&
            !error &&
            displayGroups.length === 0 &&
            allFiles.length > 0 && (
              <div className="dupes-empty">
                {activeFilter
                  ? 'No results for this filter.'
                  : isSimilarFolderMode
                    ? `No similar folders found across ${allFiles.length.toLocaleString()} files`
                    : isFolderMode
                      ? `No folders with multiple duplicate tracks found in ${allFiles.length.toLocaleString()} files`
                      : mode === 'track'
                        ? `No duplicates found in ${allFiles.length.toLocaleString()} files — try "Match by filename" to catch format variations`
                        : `No duplicates found in ${allFiles.length.toLocaleString()} files`}
              </div>
            )}

          {!loading && !error && displayGroups.length > 0 && (
            <Pager
              onPage={setPage}
              page={page}
              totalPages={totalPages}
            />
          )}

          {/* ── Track / filename mode ── */}
          {!loading &&
            !error &&
            !isSimilarFolderMode &&
            !isFolderMode &&
            pageGroups.map((group) => (
              <div
                className="dupes-group"
                key={group.key}
              >
                <div className="dupes-group-header">
                  <div className="dupes-section-header">
                    <span>{group.label}</span>
                    <div className="dupes-group-header-right">
                      <span className="dupes-group-count">
                        {group.files.length} copies
                      </span>
                      <button
                        className="dupes-action-btn"
                        onClick={() => keepBest(group)}
                        title="Queue all lower-quality copies for deletion"
                        type="button"
                      >
                        Keep best
                      </button>
                    </div>
                  </div>
                </div>
                <div className="dupes-group-body">
                  {group.files.map((f) => (
                    <div
                      className={`dupes-file-row${deletionQueue.has(f.fullPath) ? ' dupes-file-row--queued' : ''}`}
                      key={f.fullPath}
                    >
                      <span
                        className="dupes-file-path"
                        title={f.fullPath}
                      >
                        {f.fullPath}
                      </span>
                      <div className="dupes-file-meta">
                        {f.isBest && (
                          <span className="dupes-best-badge">BEST</span>
                        )}
                        <span className="dupes-file-quality">
                          {formatQuality(f)}
                        </span>
                        <span className="dupes-file-size">
                          {formatBytes(f.size)}
                        </span>
                        <button
                          className={`dupes-queue-btn${deletionQueue.has(f.fullPath) ? ' dupes-queue-btn--active' : ''}`}
                          onClick={() => toggleQueued(f.fullPath)}
                          title={
                            deletionQueue.has(f.fullPath)
                              ? 'Remove from deletion queue'
                              : 'Queue for deletion'
                          }
                          type="button"
                        >
                          <Trash2 size={13} />
                        </button>
                        <button
                          className="dupes-copy-btn"
                          onClick={() => copyPath(f.fullPath)}
                          title="Copy path"
                          type="button"
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

          {/* ── Similar folders mode ── */}
          {!loading &&
            !error &&
            isSimilarFolderMode &&
            pageGroups.map((group) => (
              <div
                className="dupes-group"
                key={group.key}
              >
                <div className="dupes-group-header">
                  <div className="dupes-section-header">
                    <span>{group.label}</span>
                    <span className="dupes-group-count">
                      {Math.round(group.nameSimilarity * 100)}% similar
                      {group.sharedFileCount > 0 &&
                        ` · ${group.sharedFileCount} shared files`}
                    </span>
                  </div>
                </div>
                <div className="dupes-group-body">
                  {group.dirs.map((d) => (
                    <div
                      className="dupes-folder-row"
                      key={d.path}
                    >
                      <span
                        className="dupes-folder-path"
                        title={d.path}
                      >
                        {d.path}
                      </span>
                      <div className="dupes-file-meta">
                        <span className="dupes-file-quality">
                          {d.fileCount} {d.fileCount === 1 ? 'file' : 'files'}
                        </span>
                        <button
                          className="dupes-action-btn dupes-action-btn--danger"
                          onClick={() => queueFolder(d.path)}
                          title="Queue entire folder for deletion"
                          type="button"
                        >
                          Queue folder
                        </button>
                        <button
                          className="dupes-copy-btn"
                          onClick={() => copyPath(d.path)}
                          title="Copy path"
                          type="button"
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

          {/* ── By folder mode ── */}
          {!loading &&
            !error &&
            isFolderMode &&
            pageGroups.map((group) => (
              <div
                className="dupes-group"
                key={group.key}
              >
                <div className="dupes-group-header">
                  <div className="dupes-section-header">
                    <div className="dupes-folder-header-left">
                      <span className="dupes-folder-name">{group.label}</span>
                      <span
                        className="dupes-folder-dir"
                        title={group.dirName}
                      >
                        {group.dirName}
                      </span>
                    </div>
                    <div className="dupes-group-header-right">
                      <span className="dupes-group-count">
                        {group.items.length} duplicated{' '}
                        {group.items.length === 1 ? 'track' : 'tracks'}
                      </span>
                      <button
                        className="dupes-action-btn dupes-action-btn--danger"
                        onClick={() => queueFolder(group.dirName)}
                        title="Queue this entire folder for deletion"
                        type="button"
                      >
                        Queue folder
                      </button>
                    </div>
                  </div>
                </div>
                <div className="dupes-group-body">
                  {group.items.map(({ file, peers }) => (
                    <div
                      className="dupes-folder-item"
                      key={file.fullPath}
                    >
                      <div
                        className={`dupes-file-row dupes-file-row--primary${deletionQueue.has(file.fullPath) ? ' dupes-file-row--queued' : ''}`}
                      >
                        <span
                          className="dupes-file-path"
                          title={file.fullPath}
                        >
                          {file.filename}
                        </span>
                        <div className="dupes-file-meta">
                          {file.isBest && (
                            <span className="dupes-best-badge">BEST</span>
                          )}
                          <span className="dupes-file-quality">
                            {formatQuality(file)}
                          </span>
                          <span className="dupes-file-size">
                            {formatBytes(file.size)}
                          </span>
                          <button
                            className={`dupes-queue-btn${deletionQueue.has(file.fullPath) ? ' dupes-queue-btn--active' : ''}`}
                            onClick={() => toggleQueued(file.fullPath)}
                            title={
                              deletionQueue.has(file.fullPath)
                                ? 'Remove from deletion queue'
                                : 'Queue for deletion'
                            }
                            type="button"
                          >
                            <Trash2 size={13} />
                          </button>
                          <button
                            className="dupes-copy-btn"
                            onClick={() => copyPath(file.fullPath)}
                            title="Copy path"
                            type="button"
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      </div>
                      {peers.map((peer) => (
                        <div
                          className={`dupes-file-row dupes-file-row--peer${deletionQueue.has(peer.fullPath) ? ' dupes-file-row--queued' : ''}`}
                          key={peer.fullPath}
                        >
                          <span className="dupes-peer-arrow">↳</span>
                          <span
                            className="dupes-file-path"
                            title={peer.fullPath}
                          >
                            {peer.fullPath}
                          </span>
                          <div className="dupes-file-meta">
                            {peer.isBest && (
                              <span className="dupes-best-badge">BEST</span>
                            )}
                            <span className="dupes-file-quality">
                              {formatQuality(peer)}
                            </span>
                            <span className="dupes-file-size">
                              {formatBytes(peer.size)}
                            </span>
                            <button
                              className="dupes-action-btn dupes-action-btn--sm dupes-action-btn--danger"
                              onClick={() => queueFolder(peer.dirName)}
                              title="Queue this peer folder for deletion"
                              type="button"
                            >
                              Queue folder
                            </button>
                            <button
                              className={`dupes-queue-btn${deletionQueue.has(peer.fullPath) ? ' dupes-queue-btn--active' : ''}`}
                              onClick={() => toggleQueued(peer.fullPath)}
                              title={
                                deletionQueue.has(peer.fullPath)
                                  ? 'Remove from deletion queue'
                                  : 'Queue for deletion'
                              }
                              type="button"
                            >
                              <Trash2 size={13} />
                            </button>
                            <button
                              className="dupes-copy-btn"
                              onClick={() => copyPath(peer.fullPath)}
                              title="Copy path"
                              type="button"
                            >
                              <Copy size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}

          {!loading && !error && displayGroups.length > 0 && (
            <Pager
              onPage={setPage}
              page={page}
              totalPages={totalPages}
            />
          )}
        </div>
      </div>

      {/* ── Deletion queue panel ── */}
      {deletionQueue.size > 0 && (
        <div className="dupes-deletion-panel">
          <div
            className="dupes-deletion-header"
            onClick={() => setShowDeletionList((s) => !s)}
            onKeyDown={({ key }) => {
              if (key === 'Enter' || key === ' ')
                setShowDeletionList((s) => !s);
            }}
            role="button"
            tabIndex={0}
          >
            <div className="dupes-deletion-header-left">
              <Trash2 size={13} />
              <span>
                {deletionQueue.size}{' '}
                {deletionQueue.size === 1 ? 'file' : 'files'} queued for
                deletion
              </span>
              <span className="dupes-deletion-toggle">
                {showDeletionList ? '▲' : '▼'}
              </span>
            </div>
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
            <div
              className="dupes-deletion-header-right"
              onClick={(clickEvent) => clickEvent.stopPropagation()}
            >
              <button
                className="dupes-deletion-action-btn dupes-deletion-action-btn--delete hover-fx"
                disabled={deleting}
                onClick={handleDeleteQueued}
                type="button"
              >
                <Trash2 size={12} />
                {deleting
                  ? 'Deleting…'
                  : `Delete ${deletionQueue.size} file${deletionQueue.size !== 1 ? 's' : ''}`}
              </button>
              <button
                className="dupes-deletion-action-btn dupes-deletion-action-btn--clear hover-fx"
                onClick={() => {
                  setDeletionQueue(new Set());
                  setShowDeletionList(false);
                }}
                type="button"
              >
                Clear all
              </button>
            </div>
          </div>
          {showDeletionList && (
            <div className="dupes-deletion-list">
              {[...deletionQueue].sort().map((path) => (
                <div
                  className="dupes-deletion-item"
                  key={path}
                >
                  <span className="dupes-deletion-path">{path}</span>
                  <button
                    className="dupes-deletion-remove"
                    onClick={() => toggleQueued(path)}
                    type="button"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Duplicates;
