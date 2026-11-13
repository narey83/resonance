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
import { Check, Copy, RefreshCw, Search, Trash2, X } from 'lucide-react';
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
  if (b == null) return 'Size unknown';
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
// Size only breaks ties inside a quality tier. A large file with missing audio
// metadata must not outrank a file with known format or bitrate.

const LOSSLESS_EXTS = new Set(['flac', 'wav', 'aiff', 'aif', 'alac']);

const qualityScore = (f) => {
  const extension = (f.extension ?? '').toLowerCase();
  const sizeTieBreaker = Math.min((f.size ?? 0) / 1e12, 0.999);
  if (LOSSLESS_EXTS.has(extension)) {
    const meta = (f.bitDepth ?? 0) * (f.sampleRate ?? 0);
    return meta > 0
      ? 2_000_000 + meta + sizeTieBreaker
      : 1_000_000 + sizeTieBreaker;
  }

  if (f.bitRate) return f.bitRate * 1_000 + sizeTieBreaker;
  return sizeTieBreaker;
};

const qualityRank = (file) => {
  if (LOSSLESS_EXTS.has((file.extension ?? '').toLowerCase()))
    return 1_000_000 + (file.bitDepth ?? 0) * (file.sampleRate ?? 0);
  return file.bitRate ?? 0;
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

// ── Component ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const copyPath = (path) => {
  navigator.clipboard.writeText(path).then(
    () => toast.success('Path copied'),
    () => toast.error('Could not copy path'),
  );
};

const Pager = ({ onPage, page, totalPages }) =>
  totalPages > 1 ? (
    <nav
      aria-label="Duplicate results pages"
      className="dupes-pager"
    >
      <button
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        type="button"
      >
        Previous
      </button>
      <span>
        Page {page + 1} of {totalPages}
      </span>
      <button
        disabled={page >= totalPages - 1}
        onClick={() => onPage(page + 1)}
        type="button"
      >
        Next
      </button>
    </nav>
  ) : null;

const modeDescriptions = {
  track:
    'Tracks with matching artist and title. Confirm the mix before removing a copy.',
  filename: 'Files with the same name, regardless of their tags or folders.',
  folder: 'Folders containing two or more tracks that also appear elsewhere.',
  folders:
    'Folders with similar names or overlapping file lists. Compare them before changing files.',
};

// eslint-disable-next-line complexity
const Duplicates = () => {
  const [allFiles, setAllFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('track');
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [deletionQueue, setDeletionQueue] = useState(new Set());
  const [reviewOpen, setReviewOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const loadingRef = useRef(false);
  const mountedRef = useRef(true);
  const dialogRef = useRef(null);

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
          const path = `${directory.name}\\${file.filename}`;
          files.push(parseFile(directory.name, file, tagsMap[path] ?? null));
        }
      }

      if (mountedRef.current) {
        const livePaths = new Set(files.map((file) => file.fullPath));
        setAllFiles(files);
        setDeletionQueue(
          (previous) =>
            new Set([...previous].filter((path) => livePaths.has(path))),
        );
        setPage(0);
      }
    } catch (caughtError) {
      console.error(caughtError);
      if (mountedRef.current)
        setError('Could not load shared files. Try refreshing.');
    } finally {
      if (mountedRef.current) setLoading(false);
      // A newer request is prevented by the loading guard above.
      // eslint-disable-next-line require-atomic-updates
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!reviewOpen) return undefined;
    const previousFocus = document.activeElement;
    dialogRef.current?.querySelector('button')?.focus();
    return () => previousFocus?.focus();
  }, [reviewOpen]);

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape' && !deleting) {
      setReviewOpen(false);
      return;
    }

    if (event.key !== 'Tab') return;
    const buttons = [
      ...dialogRef.current.querySelectorAll('button:not(:disabled)'),
    ];
    const first = buttons[0];
    const last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const groups = useMemo(() => {
    if (mode === 'filename') return annotateGroups(groupByFilename(allFiles));
    if (mode === 'folder') return groupByFolder(allFiles);
    if (mode === 'folders') return groupBySimilarFolders(allFiles);
    return annotateGroups(groupByTrack(allFiles));
  }, [allFiles, mode]);

  const visibleGroups = useMemo(() => {
    const search = query.trim();
    if (!search) return groups;
    return groups.filter((group) => {
      const paths =
        group.files?.map((file) => file.fullPath) ??
        group.items?.map(({ file }) => file.fullPath) ??
        group.dirs?.map(({ path }) => path) ??
        [];
      return fuzzyScore(search, `${group.label} ${paths.join(' ')}`) > 0;
    });
  }, [groups, query]);

  const totalPages = Math.ceil(visibleGroups.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(totalPages - 1, 0));
  const pageGroups = visibleGroups.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const comparisonMode = mode === 'track' || mode === 'filename';
  const extraCopies = comparisonMode
    ? groups.reduce((sum, group) => sum + group.files.length - 1, 0)
    : 0;
  const potentialSpace = comparisonMode
    ? groups.reduce(
        (sum, group) =>
          sum +
          group.files
            .slice(1)
            .reduce((total, file) => total + (file.size ?? 0), 0),
        0,
      )
    : 0;
  const queuedFiles = allFiles.filter((file) =>
    deletionQueue.has(file.fullPath),
  );
  const queuedBytes = queuedFiles.reduce(
    (sum, file) => sum + (file.size ?? 0),
    0,
  );

  // The display's quality suggestion is only a heuristic. Never allow a staged
  // selection to remove every member of either kind of duplicate group.
  const wouldRemoveLastCopy = (paths) => {
    const next = new Set([...deletionQueue, ...paths]);
    return [...groupByTrack(allFiles), ...groupByFilename(allFiles)].some(
      (group) => group.files.every((file) => next.has(file.fullPath)),
    );
  };

  const stageFiles = (paths) => {
    if (wouldRemoveLastCopy(paths)) {
      toast.warn('Keep at least one copy of each matched track.');
      return;
    }

    setDeletionQueue((previous) => new Set([...previous, ...paths]));
  };

  const toggleQueued = (path) => {
    if (deletionQueue.has(path)) {
      setDeletionQueue((previous) => {
        const next = new Set(previous);
        next.delete(path);
        return next;
      });
    } else stageFiles([path]);
  };

  const keepFile = (group, path) => {
    const others = group.files
      .filter((file) => file.fullPath !== path)
      .map((file) => file.fullPath);
    const next = new Set(
      [...deletionQueue].filter((queued) => queued !== path),
    );
    for (const other of others) next.add(other);
    if (
      [...groupByTrack(allFiles), ...groupByFilename(allFiles)].some(
        (candidate) => candidate.files.every((file) => next.has(file.fullPath)),
      )
    ) {
      toast.warn(
        'This choice conflicts with another staged group. Review your selections.',
      );
      return;
    }

    setDeletionQueue(next);
  };

  const handleDelete = async () => {
    if (deleting || deletionQueue.size === 0) return;
    setDeleting(true);
    try {
      const result = await deleteTrackBatch([...deletionQueue]);
      setReviewOpen(false);
      if (result.deleted > 0)
        toast.success(
          `Deleted ${result.deleted} ${result.deleted === 1 ? 'file' : 'files'}.`,
        );
      if (result.notFound > 0 || result.forbidden > 0) {
        toast.warn(
          `${result.notFound + result.forbidden} files could not be deleted. Review the remaining selection.`,
        );
      }

      await load();
    } catch (caughtError) {
      console.error(caughtError);
      toast.error('Deletion failed. No selection was cleared.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="dupes-shell">
      <div className="dupes-intro">
        <div>
          <span className="dupes-eyebrow">LIBRARY TOOLS / DUPLICATES</span>
          <h1>Find the copy worth keeping</h1>
          <p>
            Compare matches, choose what to keep, then review every removal.
          </p>
        </div>
        <button
          className="dupes-secondary"
          disabled={loading}
          onClick={load}
          type="button"
        >
          <RefreshCw size={15} /> Refresh library
        </button>
      </div>

      <div
        aria-label="Duplicate overview"
        className="dupes-overview"
      >
        <div>
          <strong>{groups.length.toLocaleString()}</strong>
          <span>
            {mode === 'folders'
              ? 'similar folder pairs'
              : mode === 'folder'
                ? 'folders to inspect'
                : 'matched groups'}
          </span>
        </div>
        {comparisonMode && (
          <div>
            <strong>{extraCopies.toLocaleString()}</strong>
            <span>possible extra copies</span>
          </div>
        )}
        {comparisonMode && (
          <div>
            <strong>{formatBytes(potentialSpace)}</strong>
            <span>if one file per match is kept</span>
          </div>
        )}
      </div>

      <div className="dupes-workspace">
        <div className="dupes-controls">
          <div className="dupes-mode">
            <label htmlFor="dupes-mode">Compare by</label>
            <select
              className="opt-select"
              id="dupes-mode"
              onChange={({ target }) => {
                setMode(target.value);
                setPage(0);
              }}
              value={mode}
            >
              <option value="track">Artist and title</option>
              <option value="filename">File name</option>
              <option value="folder">Tracks by folder</option>
              <option value="folders">Similar folders</option>
            </select>
          </div>
          <div className="dupes-search">
            <Search
              aria-hidden="true"
              size={17}
            />
            <input
              aria-label="Search duplicate groups and paths"
              onChange={({ target }) => {
                setQuery(target.value);
                setPage(0);
              }}
              placeholder="Search artist, title or path"
              type="search"
              value={query}
            />
          </div>
        </div>
        <div className="dupes-results-heading">
          <div>
            <h2>
              {mode === 'folder'
                ? 'Folders with matches'
                : mode === 'folders'
                  ? 'Similar folders'
                  : 'Matches to review'}
            </h2>
            <p>{modeDescriptions[mode]}</p>
          </div>
          <span>{visibleGroups.length.toLocaleString()} shown</span>
        </div>
        <div className="dupes-content">
          {loading && <div className="dupes-empty">Loading shared files…</div>}
          {!loading && error && <div className="dupes-empty">{error}</div>}
          {!loading && !error && visibleGroups.length === 0 && (
            <div className="dupes-empty">
              {query
                ? 'No matches for that search.'
                : 'No matches found in this view.'}
            </div>
          )}
          {!loading && !error && visibleGroups.length > 0 && (
            <Pager
              onPage={setPage}
              page={currentPage}
              totalPages={totalPages}
            />
          )}
          {!loading &&
            !error &&
            comparisonMode &&
            pageGroups.map((group) => (
              <section
                className="dupes-group"
                key={group.key}
              >
                <div className="dupes-group-header">
                  <div>
                    <h3>{group.label}</h3>
                    <span>
                      {group.files.length} copies · compare the file details
                    </span>
                  </div>
                </div>
                <div className="dupes-group-body">
                  {group.files.map((file, index) => (
                    <div
                      className={`dupes-file-row${deletionQueue.has(file.fullPath) ? ' dupes-file-row--queued' : ''}`}
                      key={file.fullPath}
                    >
                      <div className="dupes-file-main">
                        <span className="dupes-file-name">{file.filename}</span>
                        <span
                          className="dupes-file-path"
                          title={file.fullPath}
                        >
                          {file.dirName}
                        </span>
                      </div>
                      <div className="dupes-file-details">
                        <span className="dupes-file-quality">
                          {formatQuality(file)}
                        </span>
                        <span className="dupes-file-size">
                          {formatBytes(file.size)}
                        </span>
                        {index === 0 &&
                          qualityRank(file) > qualityRank(group.files[1]) && (
                            <span className="dupes-suggestion">Suggested</span>
                          )}
                      </div>
                      <div className="dupes-file-actions">
                        <button
                          className="dupes-keep"
                          onClick={() => keepFile(group, file.fullPath)}
                          type="button"
                        >
                          <Check size={14} /> Keep this
                        </button>
                        <label className="dupes-remove">
                          <input
                            checked={deletionQueue.has(file.fullPath)}
                            onChange={() => toggleQueued(file.fullPath)}
                            type="checkbox"
                          />{' '}
                          Remove
                        </label>
                        <button
                          aria-label={`Copy path for ${file.filename}`}
                          className="dupes-icon"
                          onClick={() => copyPath(file.fullPath)}
                          title="Copy full path"
                          type="button"
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          {!loading &&
            !error &&
            mode === 'folder' &&
            pageGroups.map((group) => (
              <section
                className="dupes-group"
                key={group.key}
              >
                <div className="dupes-group-header">
                  <div>
                    <h3>{group.label}</h3>
                    <span title={group.dirName}>
                      {group.dirName} · {group.items.length} matching tracks
                    </span>
                  </div>
                </div>
                {group.items.map(({ file, peers }) => (
                  <div
                    className="dupes-folder-match"
                    key={file.fullPath}
                  >
                    <strong>{file.filename}</strong>
                    <span>
                      {formatQuality(file)} · {formatBytes(file.size)}
                    </span>
                    <small>
                      Also in {peers.map((peer) => peer.dirName).join(', ')}
                    </small>
                  </div>
                ))}
              </section>
            ))}
          {!loading &&
            !error &&
            mode === 'folders' &&
            pageGroups.map((group) => (
              <section
                className="dupes-group"
                key={group.key}
              >
                <div className="dupes-group-header">
                  <div>
                    <h3>{group.label}</h3>
                    <span>
                      {Math.round(group.nameSimilarity * 100)}% similar names ·{' '}
                      {group.sharedFileCount} shared file names
                    </span>
                  </div>
                </div>
                {group.dirs.map((directory) => (
                  <div
                    className="dupes-folder-match"
                    key={directory.path}
                  >
                    <strong>{lastName(directory.path)}</strong>
                    <small>{directory.path}</small>
                    <span>{directory.fileCount} files</span>
                  </div>
                ))}
              </section>
            ))}
          {!loading && !error && visibleGroups.length > 0 && (
            <Pager
              onPage={setPage}
              page={currentPage}
              totalPages={totalPages}
            />
          )}
        </div>
      </div>

      {deletionQueue.size > 0 && (
        <div className="dupes-selection-bar">
          <div>
            <strong>{deletionQueue.size} selected for removal</strong>
            <span>
              {formatBytes(queuedBytes)} · nothing has been deleted yet
            </span>
          </div>
          <div>
            <button
              className="dupes-secondary"
              onClick={() => setDeletionQueue(new Set())}
              type="button"
            >
              Clear selection
            </button>
            <button
              className="dupes-primary"
              onClick={() => setReviewOpen(true)}
              type="button"
            >
              Review removal
            </button>
          </div>
        </div>
      )}

      {reviewOpen && (
        <div
          className="dupes-dialog-backdrop"
          onMouseDown={({ currentTarget, target }) => {
            if (target === currentTarget && !deleting) setReviewOpen(false);
          }}
        >
          <div
            aria-labelledby="dupes-dialog-title"
            aria-modal="true"
            className="dupes-dialog"
            onKeyDown={handleDialogKeyDown}
            ref={dialogRef}
            role="alertdialog"
          >
            <div className="dupes-dialog-head">
              <div>
                <span className="dupes-eyebrow">FINAL REVIEW</span>
                <h2 id="dupes-dialog-title">
                  Remove {deletionQueue.size} files?
                </h2>
              </div>
              <button
                aria-label="Close review"
                className="dupes-icon"
                disabled={deleting}
                onClick={() => setReviewOpen(false)}
                type="button"
              >
                <X size={20} />
              </button>
            </div>
            <p>
              These files will be deleted from the shared library. Check each
              path and mix before continuing. This cannot be undone here.
            </p>
            <div className="dupes-dialog-list">
              {queuedFiles.map((file) => (
                <div key={file.fullPath}>
                  <strong>{file.filename}</strong>
                  <span>{file.fullPath}</span>
                  <small>
                    {formatQuality(file)} · {formatBytes(file.size)}
                  </small>
                  <button
                    aria-label={`Keep ${file.filename}`}
                    disabled={deleting}
                    onClick={() => toggleQueued(file.fullPath)}
                    type="button"
                  >
                    Keep
                  </button>
                </div>
              ))}
            </div>
            <div className="dupes-dialog-footer">
              <span>{formatBytes(queuedBytes)} selected</span>
              <button
                className="dupes-secondary"
                disabled={deleting}
                onClick={() => setReviewOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="dupes-danger"
                disabled={deleting || deletionQueue.size === 0}
                onClick={handleDelete}
                type="button"
              >
                <Trash2 size={15} />{' '}
                {deleting ? 'Deleting…' : 'Delete selected files'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Duplicates;
