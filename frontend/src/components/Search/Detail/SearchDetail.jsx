import { usePlayer } from '../../../context/PlayerContext';
import { groupFoldersByName } from '../../../lib/folderDedup';
import * as prefs from '../../../lib/prefs';
import {
  filterResponse,
  getResponses,
  parseFiltersFromString,
} from '../../../lib/searches';
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
import {
  ChevronDown,
  ChevronRight,
  CloudOff,
  Download,
  Filter,
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

const useDebounce = (value, delay) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [delay, value]);
  return debounced;
};

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

const RECENT_FOLDERS_KEY = 'resonance-recent-dest-folders';

const getRecentFolders = () => {
  const value = prefs.get(RECENT_FOLDERS_KEY, []);
  return Array.isArray(value) ? value : [];
};

const saveRecentFolder = (folder) => {
  if (!folder?.trim()) return;
  const recent = [
    folder,
    ...getRecentFolders().filter((f) => f !== folder),
  ].slice(0, 10);
  prefs.set(RECENT_FOLDERS_KEY, recent);
};

const getPathDepth = (filepath) => {
  const parts = filepath
    .replaceAll('\\', '/')
    .split('/')
    .filter((p) => p && !/^[A-Za-z]:$/.test(p));
  return {
    artist: parts.length >= 3 ? parts[parts.length - 3] : '',
    album: parts.length >= 2 ? parts[parts.length - 2] : '',
  };
};

const suggestDestinationFolder = (files) => {
  if (files.length === 0) return '';
  const parts = files.map((f) => getPathDepth(f.filename));
  const artists = new Set(parts.map((p) => p.artist).filter(Boolean));
  const albums = new Set(parts.map((p) => p.album).filter(Boolean));
  const album = albums.size === 1 ? [...albums][0] : '';
  const artist = artists.size === 1 ? [...artists][0] : '';
  if (artists.size > 1 && album) return `VA - Various Artists/${album}`;
  if (artist && album) return `${artist}/${album}`;
  if (artist) return artist;
  if (album) return album;
  return '';
};

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
        <span className="sr-file-name-text">
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
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [groupSimilar, setGroupSimilar] = useState(false);
  const [resultFilters, setResultFilters] = useState('');
  const debouncedFilters = useDebounce(resultFilters, 200);
  const [selected, setSelected] = useState(new Map());
  const [visibleGroupCount, setVisibleGroupCount] = useState(50);
  const [destinationFolder, setDestinationFolder] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const lastSuggestionRef = useRef('');

  const suggestion = useMemo(
    () => suggestDestinationFolder([...selected.values()]),
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
    const filters = parseFiltersFromString(debouncedFilters);

    return results
      .map((response) => filterResponse({ filters, response }))
      .filter((r) => r.fileCount + r.lockedFileCount > 0)
      .sort((a, b) =>
        order === 'asc' ? a[field] - b[field] : b[field] - a[field],
      )
      .flatMap((r) =>
        r.files.map((f) => ({
          ...f,
          _hasFreeUploadSlot: r.hasFreeUploadSlot,
          _uploadSpeed: r.uploadSpeed,
          _username: r.username,
        })),
      );
  }, [debouncedFilters, resultSort, results]);

  const availableFormats = useMemo(() => {
    const extensions = new Set();
    for (const f of allFiles) {
      const extension = f.filename.split('.').pop().toLowerCase();
      if (AUDIO_EXTENSIONS.has(extension))
        extensions.add(extension.toUpperCase());
    }

    return [...extensions].sort();
  }, [allFiles]);

  const filteredByPills = useMemo(() => {
    if (activeFilters.size === 0) return allFiles;

    const activeStatic = STATIC_FILTERS.filter((sf) =>
      activeFilters.has(sf.key),
    );
    const activeFormats = [...activeFilters].filter(
      (k) => !STATIC_FILTERS.some((sf) => sf.key === k),
    );

    return allFiles.filter((file) => {
      const extension = file.filename.split('.').pop().toUpperCase();
      const passesFormat =
        activeFormats.length === 0 || activeFormats.includes(extension);
      const passesStatic = activeStatic.every((sf) => sf.match(file));
      return passesFormat && passesStatic;
    });
  }, [activeFilters, allFiles]);

  useEffect(() => {
    setVisibleGroupCount(50);
  }, [filteredByPills, groupSimilar]);

  const folderGroups = useMemo(() => {
    const byDirectory = new Map();

    for (const file of filteredByPills) {
      const directory = getDirectoryName(file.filename);

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
  }, [filteredByPills]);

  const albumGroups = useMemo(
    () => (groupSimilar ? groupFoldersByName(folderGroups) : null),
    [folderGroups, groupSimilar],
  );

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
    setVisibleGroupCount(50);
    setDestinationFolder('');
    setPickerOpen(false);
    setActiveFilters(new Set());
    setShowAdvancedFilter(false);
    setGroupSimilar(false);
    setResultFilters('');
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
                    className={`sr-filter-pill${activeFilters.has(sf.key) ? ' sr-filter-pill--active' : ''}`}
                    key={sf.key}
                    onClick={() => toggleFilter(sf.key)}
                    type="button"
                  >
                    {sf.label}
                  </button>
                ))}
                {availableFormats.length > 0 && (
                  <>
                    <span className="sr-filter-pill-sep" />
                    {availableFormats.map((fmt) => (
                      <button
                        className={`sr-filter-pill${activeFilters.has(fmt) ? ' sr-filter-pill--active' : ''}`}
                        key={fmt}
                        onClick={() => toggleFilter(fmt)}
                        type="button"
                      >
                        {fmt}
                      </button>
                    ))}
                  </>
                )}
                {activeFilters.size > 0 && (
                  <button
                    className="sr-filter-pill-clear"
                    onClick={() => setActiveFilters(new Set())}
                    type="button"
                  >
                    <X size={11} />
                    Clear
                  </button>
                )}
              </div>

              <button
                className={`sr-filter-adv-btn${showAdvancedFilter ? ' sr-filter-adv-btn--active' : ''}`}
                onClick={() => setShowAdvancedFilter((v) => !v)}
                title="Advanced text filter"
                type="button"
              >
                <Filter size={13} />
              </button>

              <button
                className={`sr-filter-adv-btn${groupSimilar ? ' sr-filter-adv-btn--active' : ''}`}
                onClick={() => setGroupSimilar((v) => !v)}
                title="Group similar folders by album"
                type="button"
              >
                <Layers size={13} />
              </button>

              {folderGroups.length > 0 && (
                <span className="sr-file-count">
                  {filteredByPills.length}{' '}
                  {filteredByPills.length === 1 ? 'file' : 'files'}
                  {' · '}
                  {groupSimilar && albumGroups
                    ? `${albumGroups.length} ${albumGroups.length === 1 ? 'album' : 'albums'}`
                    : `${folderGroups.length} ${folderGroups.length === 1 ? 'folder' : 'folders'}`}
                </span>
              )}
            </div>

            {showAdvancedFilter && (
              <div className="sr-filter-input-wrap">
                <Filter
                  className="sr-filter-icon"
                  size={13}
                />
                <input
                  className="sr-filter-input"
                  onChange={(e) => setResultFilters(e.target.value)}
                  placeholder="lackluster container -bothersome iscbr|isvbr islossless minbitrate:320"
                  type="text"
                  value={resultFilters}
                />
                {resultFilters && (
                  <button
                    className="sr-filter-clear"
                    onClick={() => setResultFilters('')}
                    type="button"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="sr-results">
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
                {groupSimilar && albumGroups
                  ? albumGroups.slice(0, visibleGroupCount).map((ag) => (
                      <AlbumGroup
                        albumGroup={ag}
                        disabled={disabled}
                        downloadedFolders={downloadedFolders}
                        key={ag.normalizedName}
                        onToggleFile={toggleFile}
                        onToggleFolder={toggleFolder}
                        selected={selected}
                      />
                    ))
                  : folderGroups.slice(0, visibleGroupCount).map((group) => (
                      <FolderGroup
                        disabled={disabled}
                        downloadedFolders={downloadedFolders}
                        group={group}
                        key={group.directory}
                        onToggleFile={toggleFile}
                        onToggleFolder={toggleFolder}
                        selected={selected}
                      />
                    ))}
                {(() => {
                  const list =
                    groupSimilar && albumGroups ? albumGroups : folderGroups;
                  const noun = groupSimilar && albumGroups ? 'album' : 'folder';
                  return visibleGroupCount < list.length ? (
                    <button
                      className="sr-show-more-btn"
                      onClick={() => setVisibleGroupCount((n) => n + 50)}
                      type="button"
                    >
                      Show {Math.min(50, list.length - visibleGroupCount)} more{' '}
                      {noun}s ({list.length - visibleGroupCount} remaining)
                    </button>
                  ) : null;
                })()}
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
                  className="sr-dest-btn"
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
                    className="sr-dest-clear"
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
                className="sr-download-bar-btn"
                disabled={disabled}
                onClick={downloadSelected}
                type="button"
              >
                <Download size={14} />
                Download
              </button>
              <button
                className="sr-download-bar-clear"
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
