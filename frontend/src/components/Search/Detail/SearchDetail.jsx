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
import * as transfers from '../../../lib/transfers';
import { getDirectoryContents, getStatus } from '../../../lib/users';
import {
  formatAttributes,
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
          checked={checked}
          className="sr-checkbox"
          disabled={disabled}
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
      <div className="sr-file-length">{formatSeconds(file.length)}</div>

      <div className="sr-file-source">
        <span
          className={`sr-slot-dot${file._hasFreeUploadSlot ? ' sr-slot-dot--free' : ''}`}
        />
        {formatBytes(file._uploadSpeed)}/s
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
  initiallyOpen = true,
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

  const allSelected = allGroupFiles.every((f) => selected.has(fileKey(f)));
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
          checked={allSelected}
          className="sr-checkbox sr-folder-checkbox"
          disabled={disabled}
          onChange={() => onToggleFolder(allGroupFiles)}
          ref={checkboxRef}
          type="checkbox"
        />
        <button
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
          {group.files.length} {group.files.length === 1 ? 'file' : 'files'}
          {' · '}
          <span
            className={`sr-slot-dot${group.hasFreeSlot ? ' sr-slot-dot--free' : ''}`}
          />
          {formatBytes(group.bestSpeed)}/s
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
    onToggleFile,
    onToggleFolder,
    selected,
  }) => {
    const [open, setOpen] = useState(true);
    const checkboxRef = useRef(null);

    const allFiles = useMemo(
      () => albumGroup.folders.flatMap((g) => g.files),
      [albumGroup.folders],
    );

    const allSelected = allFiles.every((f) => selected.has(fileKey(f)));
    const someSelected =
      !allSelected && allFiles.some((f) => selected.has(fileKey(f)));

    useEffect(() => {
      if (checkboxRef.current) checkboxRef.current.indeterminate = someSelected;
    }, [someSelected]);

    return (
      <div className="sr-album-group">
        <div className="sr-album-header">
          <input
            checked={allSelected}
            className="sr-checkbox"
            disabled={disabled}
            onChange={() => onToggleFolder(allFiles)}
            ref={checkboxRef}
            type="checkbox"
          />
          <button
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
          <span className="sr-album-name">{albumGroup.displayName}</span>
          <span className="sr-album-meta">
            {albumGroup.folders.length}{' '}
            {albumGroup.folders.length === 1 ? 'source' : 'sources'}
            {' · '}
            <span
              className={`sr-slot-dot${albumGroup.hasFreeSlot ? ' sr-slot-dot--free' : ''}`}
            />
            {formatBytes(albumGroup.bestSpeed)}/s
          </span>
        </div>

        {open && (
          <div className="sr-album-sources">
            {albumGroup.folders.map((fg) => (
              <FolderGroup
                disabled={disabled}
                downloadedFolders={downloadedFolders}
                group={fg}
                initiallyOpen={false}
                key={fg.directory}
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
  const [activeFilters, setActiveFilters] = useState(new Set());
  const [selectedExtensions, setSelectedExtensions] = useState([]);
  const [groupSimilar, setGroupSimilar] = useState(false);
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
          _uploadSpeed: r.uploadSpeed,
          _username: r.username,
        })),
      );
  }, [resultSort, results]);

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

  const folderGroups = useMemo(() => {
    const byDirectory = new Map();

    for (const file of filteredByMeta) {
      const directory = file._directory;

      if (!byDirectory.has(directory)) {
        byDirectory.set(directory, {
          bestSpeed: 0,
          directory,
          files: [],
          hasFreeSlot: false,
          label: getDirectoryName(file.displayFilename ?? file.filename),
        });
      }

      const group = byDirectory.get(directory);
      group.files.push(file);

      if (file._uploadSpeed > group.bestSpeed)
        group.bestSpeed = file._uploadSpeed;
      if (file._hasFreeUploadSlot) group.hasFreeSlot = true;
    }

    return [...byDirectory.values()].sort((a, b) => b.bestSpeed - a.bestSpeed);
  }, [filteredByMeta]);

  const albumGroups = useMemo(
    () => (groupSimilar ? groupFoldersByName(folderGroups) : null),
    [folderGroups, groupSimilar],
  );

  const visibleGroups =
    groupSimilar && albumGroups ? albumGroups : folderGroups;
  const resultsScrollRef = useRef(null);
  const rowVirtualizer = useVirtualizer({
    count: visibleGroups.length,
    estimateSize: () => 90,
    getItemKey: (index) =>
      groupSimilar && albumGroups
        ? visibleGroups[index].normalizedName
        : visibleGroups[index].directory,
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
      [...byUsername.entries()].map(([username, files]) =>
        transfers.download({ files, username, destinationFolder: destination }),
      ),
    );

    let failed = 0;

    for (const result of settled) {
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

    if (failed === 0) {
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
    setGroupSimilar(false);
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
    <div className="sr-detail">
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
          <div className="sr-filters">
            <div className="sr-filter-row">
              <select
                className="sr-filter-select"
                onChange={(e) => setResultSort(e.target.value)}
                value={resultSort}
              >
                <option value="uploadSpeed">Fastest Upload Speed</option>
                <option value="queueLength">Shortest Queue</option>
              </select>

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
                  className="sr-ext-dropdown"
                  clearable
                  multiple
                  onChange={(_, { value }) => setSelectedExtensions(value)}
                  options={availableFormats.map((fmt) => ({
                    key: fmt,
                    text: fmt,
                    value: fmt,
                  }))}
                  placeholder="Extension"
                  search
                  selection
                  value={selectedExtensions}
                />
              )}

              <button
                className={`sr-filter-adv-btn hover-fx${groupSimilar ? ' sr-filter-adv-btn--active' : ''}`}
                onClick={() => setGroupSimilar((v) => !v)}
                title="Group similar folders by album"
                type="button"
              >
                <Layers size={13} />
              </button>

              {folderGroups.length > 0 && (
                <span className="sr-file-count">
                  {filteredByMeta.length}{' '}
                  {filteredByMeta.length === 1 ? 'file' : 'files'}
                  {' · '}
                  {groupSimilar && albumGroups
                    ? `${albumGroups.length} ${albumGroups.length === 1 ? 'album' : 'albums'}`
                    : `${folderGroups.length} ${folderGroups.length === 1 ? 'folder' : 'folders'}`}
                </span>
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
                <div className="sr-file-table-head">
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
                          onToggleFile={toggleFile}
                          onToggleFolder={toggleFolder}
                          selected={selected}
                        />
                      ) : (
                        <FolderGroup
                          disabled={disabled}
                          downloadedFolders={downloadedFolders}
                          group={visibleGroups[vItem.index]}
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
              <div className="sr-no-results">No results found</div>
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
