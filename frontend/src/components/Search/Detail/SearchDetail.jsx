// <copyright file="SearchDetail.jsx" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import { usePlayer } from '../../../context/PlayerContext';
import useDebounce from '../../../hooks/useDebounce';
import {
  saveRecentFolder,
  suggestDestinationFolder,
} from '../../../lib/downloadDestination';
import { groupFoldersByName } from '../../../lib/folderDedup';
import { getResponses } from '../../../lib/searches';
import {
  extractMetadata,
  matchesMetaFilters,
} from '../../../lib/searchMetadata';
import {
  basenameHasAllTerms,
  parseQueryTerms,
  scoreFilename,
} from '../../../lib/searchRelevance';
import * as transfers from '../../../lib/transfers';
import { getDirectoryContents, getStatus } from '../../../lib/users';
import {
  formatAttributes,
  formatBitrate,
  formatBytes,
  formatSeconds,
  getDirectoryName,
  getFileName,
  sleep,
} from '../../../lib/util';
import UsernameLink from '../../Shared/UsernameLink';
import FolderPickerModal from './FolderPickerModal';
import SearchDetailHeader from './SearchDetailHeader';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ChevronDown,
  ChevronRight,
  CloudOff,
  Download,
  Folder,
  FolderSearch,
  Layers,
  Lock,
  Play,
  SlidersHorizontal,
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
import { Dropdown } from 'semantic-ui-react';

const AUDIO_EXTENSIONS = new Set([
  'aac',
  'aif',
  'aiff',
  'alac',
  'ape',
  'flac',
  'm4a',
  'mp3',
  'ogg',
  'opus',
  'wav',
  'wma',
]);

const LOSSLESS_EXTS = new Set(['flac', 'alac', 'ape', 'aif', 'aiff', 'wav']);

const STATIC_FILTERS = [
  {
    key: 'free-slots',
    label: 'Free Slots',
    match: (f) => f._hasFreeUploadSlot,
  },
  { key: 'unlocked', label: 'Unlocked', match: (f) => !f.locked },
  {
    key: 'lossless',
    label: 'Lossless',
    match: (f) => LOSSLESS_EXTS.has(f.filename.split('.').pop().toLowerCase()),
  },
  { key: 'hq', label: '≥ 320kbps', match: (f) => (f.bitRate ?? 0) >= 320 },
  { key: 'vbr', label: 'VBR', match: (f) => f.isVariableBitRate },
];

const isAudio = (filename) =>
  AUDIO_EXTENSIONS.has(filename.split('.').pop().toLowerCase());

const fileKey = (file) => `${file._username}::${file.filename}`;

// ── File row ──────────────────────────────────────────────────────────────────

const FileRow = React.memo(({ checked, disabled, file, onToggleFile }) => {
  const { play } = usePlayer();
  const audio = isAudio(file.filename);
  const handleToggle = useCallback(
    () => onToggleFile(file),
    [file, onToggleFile],
  );

  return (
    <div className="sr-file-row">
      <div className="sr-file-check">
        <input
          aria-label={`Select ${getFileName(file.filename)}`}
          checked={checked}
          className="sr-checkbox"
          disabled={disabled || file.locked}
          onChange={handleToggle}
          type="checkbox"
        />
      </div>

      <div className="sr-file-play">
        {audio && !file.locked && (
          <button
            className="sr-file-play-btn"
            disabled={!file._hasFreeUploadSlot}
            onClick={() =>
              play({ filename: file.filename, username: file._username })
            }
            title={file._hasFreeUploadSlot ? 'Preview' : 'No free slot'}
            type="button"
          >
            <Play size={12} />
          </button>
        )}
      </div>

      <div className="sr-file-name">
        <span
          className="sr-file-name-text"
          title={file.filename}
        >
          {file.locked && (
            <Lock
              className="sr-file-lock-icon"
              size={10}
            />
          )}
          {getFileName(file.filename)}
        </span>
      </div>

      <div className="sr-file-quality">{formatAttributes(file)}</div>
      <div className="sr-file-size">{formatBytes(file.size)}</div>
      <div className="sr-file-length">
        {file.length > 0 ? formatSeconds(file.length) : '—'}
      </div>

      <div className="sr-file-source">
        <span
          className={`sr-slot-dot${file._hasFreeUploadSlot ? ' sr-slot-dot--free' : ''}`}
        />
        {formatBitrate(file._uploadSpeed)}
      </div>
    </div>
  );
});

const presenceCache = {};

const presenceColor = (p) =>
  p === 'Online' ? '#48bb78' : p === 'Away' ? '#ecc94b' : null;

// ── Folder group ──────────────────────────────────────────────────────────────

const FolderGroup = ({
  disabled,
  downloadedFolders,
  group,
  initiallyOpen = false,
  onDownload,
  onToggleFile,
  onToggleFolder,
  selected,
}) => {
  const [open, setOpen] = useState(initiallyOpen);
  const [browseState, setBrowseState] = useState('idle'); // idle | loading | done | error
  const [extraFiles, setExtraFiles] = useState([]);
  const username = group.files[0]?._username;
  const folderKey = group.directory
    .split(/[/\\]/u)
    .filter(Boolean)
    .at(-1)
    ?.toLowerCase();
  const dlStatus = downloadedFolders?.get(folderKey);
  const [presence, setPresence] = useState(presenceCache[username] ?? null);

  useEffect(() => {
    if (!username || presenceCache[username]) return undefined;
    let cancelled = false;
    getStatus({ username })
      .then(({ data }) => {
        const p = data?.presence ?? 'Offline';
        presenceCache[username] = p;
        if (!cancelled) setPresence(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [username]);
  const checkboxRef = useRef(null);

  const allGroupFiles = useMemo(
    () => [...group.files, ...extraFiles],
    [group.files, extraFiles],
  );

  const selectableFiles = allGroupFiles.filter((file) => !file.locked);
  const allSelected =
    selectableFiles.length > 0 &&
    selectableFiles.every((f) => selected.has(fileKey(f)));
  const someSelected =
    !allSelected && allGroupFiles.some((f) => selected.has(fileKey(f)));

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const browseFolder = async (event) => {
    event.stopPropagation();
    if (browseState !== 'idle') return;
    setOpen(true);
    setBrowseState('loading');
    try {
      const directories = await getDirectoryContents({
        username,
        directory: group.directory,
      });
      const rootDir = directories?.[0];
      const existing = new Set(group.files.map((f) => f.filename));
      const separator = group.directory.includes('/') ? '/' : '\\';
      const fetched = (rootDir?.files ?? [])
        .map((f) => ({
          ...f,
          filename: `${group.directory}${separator}${f.filename}`,
          _hasFreeUploadSlot: group.hasFreeSlot,
          _uploadSpeed: group.bestSpeed,
          _username: username,
        }))
        .filter((f) => !existing.has(f.filename));
      setExtraFiles(fetched);
      setBrowseState('done');
    } catch {
      setBrowseState('error');
      toast.error('Failed to browse folder');
    }
  };

  return (
    <div className="sr-folder-group">
      <div className="sr-folder-header">
        <input
          aria-label={`Select matched files from ${username}`}
          checked={allSelected}
          className="sr-checkbox sr-folder-checkbox"
          disabled={disabled || selectableFiles.length === 0}
          onChange={() => onToggleFolder(selectableFiles)}
          ref={checkboxRef}
          type="checkbox"
        />
        <button
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} files from ${username}`}
          className="sr-folder-chevron"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>

        <button
          className="sr-folder-name"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          <Folder
            size={13}
            strokeWidth={1.75}
          />
          <span className="sr-folder-label">{group.label}</span>
        </button>

        {dlStatus === 'done' && (
          <span className="sr-folder-dl-badge sr-folder-dl-badge--done">
            ✓ Downloaded
          </span>
        )}
        {dlStatus === 'active' && (
          <span className="sr-folder-dl-badge sr-folder-dl-badge--active">
            ↓ In queue
          </span>
        )}

        <span className="sr-folder-meta">
          {group.files.length} {group.files.length === 1 ? 'file' : 'files'} ·{' '}
          {formatBytes(
            group.files.reduce((sum, file) => sum + (file.size ?? 0), 0),
          )}{' '}
          ·{' '}
          {[
            ...new Set(
              group.files
                .filter((file) => isAudio(file.filename))
                .map((file) => file.filename.split('.').pop().toUpperCase()),
            ),
          ].join(' / ') || 'Other files'}
          {' · '}
          <span
            className={`sr-slot-dot${group.hasFreeSlot ? ' sr-slot-dot--free' : ''}`}
          />
          {group.hasFreeSlot
            ? 'Free slot'
            : Number.isFinite(group.bestQueue)
              ? `Queue ${group.bestQueue}`
              : 'Queue unknown'}{' '}
          · {formatBitrate(group.bestSpeed)}
        </span>

        {presence === 'Offline' ? (
          <CloudOff
            size={13}
            strokeWidth={1.75}
            style={{ color: '#6b7280', flexShrink: 0 }}
            title="Offline"
          />
        ) : presenceColor(presence) ? (
          <span
            className="sr-folder-presence"
            style={{ background: presenceColor(presence) }}
            title={presence}
          />
        ) : null}
        {username && <UsernameLink username={username} />}
        <button
          className="sr-source-download"
          disabled={disabled || !allGroupFiles.some((file) => !file.locked)}
          onClick={() => onDownload(allGroupFiles)}
          title="Choose a destination for the matched files from this source. Browse the full folder to find additional files."
          type="button"
        >
          <Download size={14} /> Download files
        </button>

        <button
          className={`sr-folder-browse-btn${browseState === 'done' && extraFiles.length > 0 ? ' sr-folder-browse-btn--has-extra' : ''}`}
          disabled={browseState === 'loading' || browseState === 'done'}
          onClick={browseFolder}
          title={
            browseState === 'idle' ? 'Browse full folder contents' : undefined
          }
          type="button"
        >
          {browseState === 'idle' && <FolderSearch size={12} />}
          {browseState === 'loading' && (
            <span className="sr-folder-browse-spinner" />
          )}
          {browseState === 'done' &&
            extraFiles.length > 0 &&
            `+${extraFiles.length}`}
          {browseState === 'done' && extraFiles.length === 0 && (
            <FolderSearch size={12} />
          )}
          {browseState === 'error' && <FolderSearch size={12} />}
        </button>
      </div>

      {open && (
        <div className="sr-folder-files">
          {group.files.map((file) => (
            <FileRow
              checked={selected.has(fileKey(file))}
              disabled={disabled}
              file={file}
              key={fileKey(file)}
              onToggleFile={onToggleFile}
            />
          ))}
          {browseState === 'done' && extraFiles.length > 0 && (
            <>
              <div className="sr-folder-extra-divider">
                {extraFiles.length} more{' '}
                {extraFiles.length === 1 ? 'file' : 'files'} in folder
              </div>
              {extraFiles.map((file) => (
                <FileRow
                  checked={selected.has(fileKey(file))}
                  disabled={disabled}
                  file={file}
                  key={fileKey(file)}
                  onToggleFile={onToggleFile}
                />
              ))}
            </>
          )}
          {browseState === 'done' && extraFiles.length === 0 && (
            <div className="sr-folder-extra-divider">
              No additional files in this folder
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Album group (wraps multiple FolderGroups with the same normalised album name) ─

const AlbumGroup = React.memo(
  ({
    albumGroup,
    disabled,
    downloadedFolders,
    onDownload,
    onToggleFile,
    onToggleFolder,
    selected,
  }) => {
    const [open, setOpen] = useState(true);
    const representativeFiles = albumGroup.folders[0]?.files ?? [];
    const formats = [
      ...new Set(
        albumGroup.folders
          .flatMap((folder) => folder.files)
          .filter((file) => isAudio(file.filename))
          .map((file) => file.filename.split('.').pop().toUpperCase()),
      ),
    ];
    return (
      <div className="sr-album-group">
        <div className="sr-album-header">
          <button
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Compare'} sources for ${albumGroup.displayName}`}
            className="sr-album-chevron"
            onClick={() => setOpen((v) => !v)}
            type="button"
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <Layers
            size={13}
            strokeWidth={1.75}
            style={{ color: 'var(--text-muted)', flexShrink: 0 }}
          />
          <button
            aria-expanded={open}
            className="sr-album-name"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            {albumGroup.displayName}
            <small>
              {formats.join(' / ') || 'Other files'} ·{' '}
              {representativeFiles.length} matched{' '}
              {representativeFiles.length === 1 ? 'file' : 'files'} ·{' '}
              {formatBytes(
                representativeFiles.reduce(
                  (sum, file) => sum + (file.size ?? 0),
                  0,
                ),
              )}{' '}
              in leading source
            </small>
          </button>
          <span className="sr-album-meta">
            {albumGroup.folders.length}{' '}
            {albumGroup.folders.length === 1 ? 'source' : 'sources'}
            {' · '}
            <span
              className={`sr-slot-dot${albumGroup.hasFreeSlot ? ' sr-slot-dot--free' : ''}`}
            />
            {albumGroup.hasFreeSlot ? 'Free slot available' : 'Queued sources'}{' '}
            · {formatBitrate(albumGroup.bestSpeed)}
          </span>
        </div>

        {open && (
          <div className="sr-album-sources">
            {albumGroup.folders.map((fg) => (
              <FolderGroup
                disabled={disabled}
                downloadedFolders={downloadedFolders}
                group={fg}
                initiallyOpen
                key={fg.sourceKey}
                onDownload={onDownload}
                onToggleFile={onToggleFile}
                onToggleFolder={onToggleFolder}
                selected={selected}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
);

// ── SearchDetail ──────────────────────────────────────────────────────────────

const SearchDetail = ({
  creating,
  disabled,
  initialFilters = {},
  onCreate,
  onRemove,
  onRestart,
  onStop,
  removing,
  restarting,
  search,
  stopping,
}) => {
  const { fileCount, id, isComplete, lockedFileCount, responseCount, state } =
    search;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(undefined);
  const [results, setResults] = useState([]);
  const [downloadedFolders, setDownloadedFolders] = useState(new Map());

  useEffect(() => {
    let cancelled = false;
    transfers
      .getAll({ direction: 'download' })
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return;
        const map = new Map();
        for (const user of data) {
          for (const dir of user.directories ?? []) {
            const name = dir.directory
              .split(/[/\\]/u)
              .filter(Boolean)
              .at(-1)
              ?.toLowerCase();
            if (!name) continue;
            const files = dir.files ?? [];
            const allSucceeded =
              files.length > 0 &&
              files.every((f) => f.state === 'Completed, Succeeded');
            const status = allSucceeded ? 'done' : 'active';
            if (!map.has(name) || status === 'active') map.set(name, status);
          }
        }

        setDownloadedFolders(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const [resultSort, setResultSort] = useState('uploadSpeed');
  const [activeFilters, setActiveFilters] = useState(
    new Set(initialFilters.flags ?? []),
  );
  const [selectedExtensions, setSelectedExtensions] = useState(
    initialFilters.extensions ?? [],
  );
  const [groupSimilar, setGroupSimilar] = useState(true);
  const [refineOpen, setRefineOpen] = useState(false);
  const [filenameOnly, setFilenameOnly] = useState(false);

  const terms = useMemo(
    () => parseQueryTerms(search.searchText ?? ''),
    [search.searchText],
  );
  const [metaFilters, setMetaFilters] = useState({
    artist: '',
    folder: '',
    title: '',
    year: '',
  });
  const debouncedMetaFilters = useDebounce(metaFilters, 200);
  const [selected, setSelected] = useState(new Map());
  const [destinationFolder, setDestinationFolder] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const lastSuggestionRef = useRef('');

  const suggestion = useMemo(
    () =>
      suggestDestinationFolder([...selected.values()].map((f) => f.filename)),
    [selected],
  );

  useEffect(() => {
    if (
      destinationFolder === '' ||
      destinationFolder === lastSuggestionRef.current
    ) {
      setDestinationFolder(suggestion);
      lastSuggestionRef.current = suggestion;
    }
  }, [suggestion]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchedRef = useRef(false);
  const previousIsCompleteRef = useRef(isComplete);

  useEffect(() => {
    if (previousIsCompleteRef.current && !isComplete) {
      fetchedRef.current = false;
      setResults([]);
      setLoading(false);
      setError(undefined);
      setSelected(new Map());
    }

    previousIsCompleteRef.current = isComplete;
  }, [isComplete]);

  useEffect(() => {
    const get = async () => {
      try {
        setLoading(true);
        await sleep(500);
        const responses = await getResponses({ id });
        setResults(responses);
        setLoading(false);
      } catch (getError) {
        fetchedRef.current = false;
        setError(getError);
        setLoading(false);
      }
    };

    if (fetchedRef.current) return;

    if (isComplete) {
      fetchedRef.current = true;
      get();
    }
  }, [id, isComplete]);

  const allFiles = useMemo(() => {
    const sortOptions = {
      queueLength: { field: 'queueLength', order: 'asc' },
      uploadSpeed: { field: 'uploadSpeed', order: 'desc' },
    };
    const { field, order } = sortOptions[resultSort];

    return results
      .filter((r) => r.fileCount + r.lockedFileCount > 0)
      .sort((a, b) =>
        order === 'asc' ? a[field] - b[field] : b[field] - a[field],
      )
      .flatMap((r) =>
        r.files.map((f) => ({
          ...f,
          ...extractMetadata(f.filename),
          _directory: getDirectoryName(f.filename),
          _hasFreeUploadSlot: r.hasFreeUploadSlot,
          _relevance: scoreFilename(terms, f.filename),
          _uploadSpeed: r.uploadSpeed,
          _queueLength: r.queueLength,
          _username: r.username,
        })),
      );
  }, [resultSort, results, terms]);

  const availableFormats = useMemo(() => {
    const extensions = new Set();
    for (const f of allFiles) {
      if (f._extension) extensions.add(f._extension.toUpperCase());
    }

    return [...extensions].sort();
  }, [allFiles]);

  const filteredByPills = useMemo(() => {
    if (activeFilters.size === 0 && selectedExtensions.length === 0)
      return allFiles;

    const activeStatic = STATIC_FILTERS.filter((sf) =>
      activeFilters.has(sf.key),
    );

    return allFiles.filter((file) => {
      const passesFormat =
        selectedExtensions.length === 0 ||
        selectedExtensions.includes(file._extension.toUpperCase());
      const passesStatic = activeStatic.every((sf) => sf.match(file));
      return passesFormat && passesStatic;
    });
  }, [activeFilters, allFiles, selectedExtensions]);

  const filteredByMeta = useMemo(() => {
    const { artist, folder, title, year } = debouncedMetaFilters;
    if (!artist && !folder && !title && !year) return filteredByPills;

    return filteredByPills.filter((file) =>
      matchesMetaFilters(file, debouncedMetaFilters),
    );
  }, [debouncedMetaFilters, filteredByPills]);

  // Optional hard filter: keep only files whose *filename* contains every query
  // term (drops loose matches where a term only appears in a parent folder).
  const filteredByFilename = useMemo(() => {
    if (!filenameOnly || terms.length === 0) return filteredByMeta;
    return filteredByMeta.filter((file) =>
      basenameHasAllTerms(terms, file.filename),
    );
  }, [filenameOnly, filteredByMeta, terms]);

  const folderGroups = useMemo(() => {
    const byDirectory = new Map();

    for (const file of filteredByFilename) {
      const directory = file._directory;
      const sourceKey = `${file._username}::${directory}`;

      if (!byDirectory.has(sourceKey)) {
        byDirectory.set(sourceKey, {
          sourceKey,
          bestSpeed: 0,
          bestQueue: Number.POSITIVE_INFINITY,
          directory,
          files: [],
          hasFreeSlot: false,
          label: getDirectoryName(file.displayFilename ?? file.filename),
          relevance: 0,
        });
      }

      const group = byDirectory.get(sourceKey);
      group.files.push(file);
      group.bestQueue = Math.min(
        group.bestQueue,
        file._queueLength ?? Number.POSITIVE_INFINITY,
      );

      if (file._uploadSpeed > group.bestSpeed)
        group.bestSpeed = file._uploadSpeed;
      if (file._hasFreeUploadSlot) group.hasFreeSlot = true;
      if ((file._relevance ?? 0) > group.relevance)
        group.relevance = file._relevance;
    }

    // Rank by query relevance first (when there is a query), then upload speed,
    // so true phrase / filename matches lead over loose whole-path matches.
    return [...byDirectory.values()].sort((a, b) => {
      if (terms.length && b.relevance !== a.relevance)
        return b.relevance - a.relevance;
      return resultSort === 'queueLength'
        ? a.bestQueue - b.bestQueue || b.bestSpeed - a.bestSpeed
        : b.bestSpeed - a.bestSpeed;
    });
  }, [filteredByFilename, resultSort, terms]);

  const albumGroups = useMemo(() => {
    if (!groupSimilar) return null;
    const grouped = groupFoldersByName(folderGroups);
    // Keep relevance first, then honor the selected source ordering.
    return [...grouped]
      .map((album) => ({
        ...album,
        bestQueue: Math.min(...album.folders.map((folder) => folder.bestQueue)),
        relevance: album.folders.reduce(
          (max, f) => Math.max(max, f.relevance ?? 0),
          0,
        ),
      }))
      .sort((a, b) =>
        b.relevance !== a.relevance
          ? b.relevance - a.relevance
          : resultSort === 'queueLength'
            ? a.bestQueue - b.bestQueue || b.bestSpeed - a.bestSpeed
            : b.bestSpeed - a.bestSpeed,
      );
  }, [folderGroups, groupSimilar, resultSort]);

  const visibleGroups =
    groupSimilar && albumGroups ? albumGroups : folderGroups;
  const resultsScrollRef = useRef(null);
  const rowVirtualizer = useVirtualizer({
    count: visibleGroups.length,
    estimateSize: () => 90,
    getItemKey: (index) =>
      groupSimilar && albumGroups
        ? visibleGroups[index].normalizedName
        : visibleGroups[index].sourceKey,
    getScrollElement: () => resultsScrollRef.current,
    overscan: 6,
  });

  const toggleFile = useCallback((file) => {
    const key = fileKey(file);
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(key)) next.delete(key);
      else next.set(key, file);
      return next;
    });
  }, []);

  const toggleFolder = useCallback((files) => {
    setSelected((previous) => {
      const next = new Map(previous);
      const allSelected = files.every((f) => previous.has(fileKey(f)));
      if (allSelected) {
        for (const f of files) next.delete(fileKey(f));
      } else {
        for (const f of files) next.set(fileKey(f), f);
      }

      return next;
    });
  }, []);

  const toggleFilter = useCallback((key) => {
    setActiveFilters((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const prepareDownload = useCallback((files) => {
    const available = files.filter((file) => !file.locked);
    setSelected(new Map(available.map((file) => [fileKey(file), file])));
    setPickerOpen(true);
  }, []);

  const downloadSelected = async (folderOverride) => {
    const filesToDownload = [...selected.values()];
    const destination = (
      typeof folderOverride === 'string' ? folderOverride : destinationFolder
    ).trim();
    setSelected(new Map());

    if (destination) saveRecentFolder(destination);

    const byUsername = new Map();

    for (const file of filesToDownload) {
      if (!byUsername.has(file._username)) byUsername.set(file._username, []);
      byUsername
        .get(file._username)
        .push({ filename: file.filename, size: file.size });
    }

    const settled = await Promise.allSettled(
      [...byUsername.entries()].map(async ([username, files]) => {
        const request = { files, username, destinationFolder: destination };

        try {
          return await transfers.download(request);
        } catch (downloadError) {
          const conflict = downloadError?.response?.data;
          if (
            downloadError?.response?.status !== 409 ||
            conflict?.code !== 'DuplicateAlbumOrFolder'
          ) {
            throw downloadError;
          }

          const proceed = window.confirm(
            `${conflict.message}\n\nDownload it again anyway?`,
          );
          if (!proceed) return { cancelled: true };

          return transfers.download({ ...request, allowDuplicate: true });
        }
      }),
    );

    let failed = 0;
    let cancelled = 0;

    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value?.cancelled) {
        cancelled += 1;
      }

      if (result.status === 'rejected') {
        failed += 1;
        const downloadError = result.reason;
        toast.error(
          downloadError?.response?.data ??
            downloadError?.message ??
            'Failed to queue some files',
        );
      }
    }

    if (cancelled > 0) {
      toast.info('Duplicate download cancelled');
    } else if (failed === 0) {
      const count = filesToDownload.length;
      toast.success(
        `Queued ${count} ${count === 1 ? 'file' : 'files'}${destination ? ` → ${destination}` : ''}`,
      );
    }
  };

  const reset = () => {
    setLoading(false);
    setError(undefined);
    setResults([]);
    setSelected(new Map());
    setDestinationFolder('');
    setPickerOpen(false);
    setActiveFilters(new Set());
    setSelectedExtensions([]);
    setGroupSimilar(true);
    setFilenameOnly(false);
    setMetaFilters({ artist: '', folder: '', title: '', year: '' });
    lastSuggestionRef.current = '';
  };

  const create = ({ navigate, search: searchForCreate }) => {
    reset();
    onCreate({ navigate, search: searchForCreate });
  };

  const remove = () => {
    reset();
    onRemove(search);
  };

  const loaded = !removing && !creating && !loading && results;

  if (error) {
    return (
      <div className="sr-detail-error">
        Error loading results: {error?.message ?? String(error)}
      </div>
    );
  }

  return (
    <div
      className={`sr-detail ${groupSimilar ? 'sr-release-view' : 'sr-compact-view'}`}
    >
      <SearchDetailHeader
        creating={creating}
        disabled={disabled}
        loaded={loaded}
        loading={loading}
        onCreate={create}
        onRemove={remove}
        onRestart={() => onRestart?.(search)}
        onStop={onStop}
        removing={removing}
        restarting={restarting}
        search={search}
        stopping={stopping}
      />

      {!isComplete && (
        <div className="sr-searching">
          <span className="sr-searching-spinner" />
          {state === 'InProgress'
            ? `Found ${fileCount} files${lockedFileCount > 0 ? ` (plus ${lockedFileCount} locked)` : ''} from ${responseCount} users`
            : 'Loading results...'}
        </div>
      )}

      {loading && (
        <div className="sr-searching">
          <span className="sr-searching-spinner" />
          Loading results...
        </div>
      )}

      {loaded && (
        <>
          <div className="sr-results-toolbar">
            <div
              aria-label="Result view"
              className="sr-view-switch"
            >
              <button
                aria-pressed={groupSimilar}
                onClick={() => setGroupSimilar(true)}
                type="button"
              >
                <Layers size={15} /> Releases
              </button>
              <button
                aria-pressed={!groupSimilar}
                onClick={() => setGroupSimilar(false)}
                type="button"
              >
                Compact files
              </button>
            </div>
            <select
              aria-label="Sort received files"
              className="sr-filter-select"
              onChange={(e) => setResultSort(e.target.value)}
              value={resultSort}
            >
              <option value="uploadSpeed">Best match · fastest sources</option>
              <option value="queueLength">Best match · shortest queue</option>
            </select>

            <button
              aria-expanded={refineOpen}
              className="sr-refine-toggle"
              onClick={() => setRefineOpen((value) => !value)}
              type="button"
            >
              <SlidersHorizontal size={14} /> Refine
              {activeFilters.size +
                selectedExtensions.length +
                Object.values(metaFilters).filter(Boolean).length +
                Number(filenameOnly) >
              0
                ? ` (${activeFilters.size + selectedExtensions.length + Object.values(metaFilters).filter(Boolean).length + Number(filenameOnly)})`
                : ''}
            </button>
            <span className="sr-result-summary">
              {filteredByFilename.length.toLocaleString()} shown ·{' '}
              {(fileCount + (lockedFileCount ?? 0)).toLocaleString()} received ·{' '}
              {groupSimilar
                ? `${albumGroups?.length ?? 0} ${albumGroups?.length === 1 ? 'release' : 'releases'}`
                : `${folderGroups.length} ${folderGroups.length === 1 ? 'source' : 'sources'}`}
            </span>
          </div>
          {groupSimilar && (
            <p className="sr-release-note">
              Files are shown under each release. Sources can contain different
              editions or partial matches.
            </p>
          )}
          <div
            className="sr-filters"
            hidden={!refineOpen}
          >
            <div className="sr-result-filter-heading">
              <span>
                Refine received files · artist/title/year are inferred from file
                paths
              </span>
              <button
                className="sr-filter-pill"
                onClick={() => {
                  setActiveFilters(new Set());
                  setSelectedExtensions([]);
                  setFilenameOnly(false);
                  setMetaFilters({
                    artist: '',
                    folder: '',
                    title: '',
                    year: '',
                  });
                }}
                type="button"
              >
                Reset all filters
              </button>
            </div>
            <div className="sr-filter-row">
              <div className="sr-filter-pills">
                {STATIC_FILTERS.map((sf) => (
                  <button
                    className={`sr-filter-pill hover-fx${activeFilters.has(sf.key) ? ' sr-filter-pill--active' : ''}`}
                    key={sf.key}
                    onClick={() => toggleFilter(sf.key)}
                    type="button"
                  >
                    {sf.label}
                  </button>
                ))}
                {terms.length > 0 && (
                  <button
                    className={`sr-filter-pill hover-fx${filenameOnly ? ' sr-filter-pill--active' : ''}`}
                    onClick={() => setFilenameOnly((v) => !v)}
                    title="Only show files whose filename contains every search term"
                    type="button"
                  >
                    In Filename
                  </button>
                )}
                {activeFilters.size > 0 && (
                  <button
                    className="sr-filter-pill-clear hover-fx"
                    onClick={() => setActiveFilters(new Set())}
                    type="button"
                  >
                    <X size={11} />
                    Clear
                  </button>
                )}
              </div>

              {availableFormats.length > 0 && (
                <Dropdown
                  aria-label="Filter by file formats"
                  className="sr-ext-dropdown"
                  clearable
                  multiple
                  onChange={(_, { value }) => setSelectedExtensions(value)}
                  options={availableFormats.map((fmt) => ({
                    key: fmt,
                    text: fmt,
                    value: fmt,
                  }))}
                  placeholder="File formats"
                  search
                  selection
                  value={selectedExtensions}
                />
              )}
            </div>

            <div className="sr-meta-filter-row">
              {[
                { key: 'artist', placeholder: 'Artist' },
                { key: 'title', placeholder: 'Title' },
                { key: 'folder', placeholder: 'Folder' },
                { key: 'year', placeholder: 'Year' },
              ].map(({ key, placeholder }) => (
                <div
                  className="sr-meta-filter-wrap"
                  key={key}
                >
                  <input
                    aria-label={`Filter received files by ${placeholder.toLowerCase()}`}
                    className="sr-meta-filter-input"
                    onChange={(e) => {
                      const { value } = e.target;
                      setMetaFilters((previous) => ({
                        ...previous,
                        [key]: value,
                      }));
                    }}
                    placeholder={placeholder}
                    type="text"
                    value={metaFilters[key]}
                  />
                  {metaFilters[key] && (
                    <button
                      className="sr-filter-clear hover-fx"
                      onClick={() =>
                        setMetaFilters((previous) => ({
                          ...previous,
                          [key]: '',
                        }))
                      }
                      type="button"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div
            className="sr-results"
            ref={resultsScrollRef}
          >
            {folderGroups.length > 0 && (
              <>
                <div
                  className="sr-file-table-head"
                  hidden={groupSimilar}
                >
                  <div className="sr-file-check" />
                  <div className="sr-file-play" />
                  <div className="sr-file-name">File</div>
                  <div className="sr-file-quality">Quality</div>
                  <div className="sr-file-size">Size</div>
                  <div className="sr-file-length">Length</div>
                  <div className="sr-file-source">Source</div>
                </div>
                <div
                  style={{
                    height: rowVirtualizer.getTotalSize(),
                    position: 'relative',
                    width: '100%',
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((vItem) => (
                    <div
                      data-index={vItem.index}
                      key={vItem.key}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        left: 0,
                        position: 'absolute',
                        top: 0,
                        transform: `translateY(${vItem.start}px)`,
                        width: '100%',
                      }}
                    >
                      {groupSimilar && albumGroups ? (
                        <AlbumGroup
                          albumGroup={visibleGroups[vItem.index]}
                          disabled={disabled}
                          downloadedFolders={downloadedFolders}
                          onDownload={prepareDownload}
                          onToggleFile={toggleFile}
                          onToggleFolder={toggleFolder}
                          selected={selected}
                        />
                      ) : (
                        <FolderGroup
                          disabled={disabled}
                          downloadedFolders={downloadedFolders}
                          group={visibleGroups[vItem.index]}
                          initiallyOpen
                          onDownload={prepareDownload}
                          onToggleFile={toggleFile}
                          onToggleFolder={toggleFolder}
                          selected={selected}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            {folderGroups.length === 0 && isComplete && !loading && (
              <div className="sr-no-results">
                {allFiles.length > 0
                  ? `No files match your filters (${allFiles.length} received). Try resetting the filters.`
                  : 'No files received. Try fewer search words or search again.'}
              </div>
            )}
          </div>

          {selected.size > 0 && (
            <div className="sr-download-bar">
              <span className="sr-download-bar-count">
                {selected.size} {selected.size === 1 ? 'file' : 'files'}{' '}
                selected
              </span>
              <div className="sr-dest-wrap">
                <button
                  className="sr-dest-btn hover-fx"
                  onClick={() => setPickerOpen(true)}
                  title="Choose destination folder"
                  type="button"
                >
                  <Folder size={13} />
                  <span className="sr-dest-path">
                    {destinationFolder || 'Downloads root'}
                  </span>
                  <FolderSearch
                    className="sr-dest-browse-icon"
                    size={12}
                  />
                </button>
                {destinationFolder && (
                  <button
                    className="sr-dest-clear hover-fx"
                    onClick={() => {
                      setDestinationFolder('');
                      lastSuggestionRef.current = '';
                    }}
                    title="Clear destination"
                    type="button"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
              <button
                className="sr-download-bar-btn hover-fx"
                disabled={disabled}
                onClick={downloadSelected}
                type="button"
              >
                <Download size={14} />
                Download
              </button>
              <button
                className="sr-download-bar-clear hover-fx"
                onClick={() => setSelected(new Map())}
                title="Clear selection"
                type="button"
              >
                <X size={13} />
              </button>
            </div>
          )}
        </>
      )}

      <FolderPickerModal
        onClose={() => setPickerOpen(false)}
        onConfirm={(path) => {
          setDestinationFolder(path);
          lastSuggestionRef.current = path;
          if (path) saveRecentFolder(path);
          downloadSelected(path);
        }}
        open={pickerOpen}
        suggestedPath={destinationFolder || suggestion}
      />
    </div>
  );
};

export default SearchDetail;
