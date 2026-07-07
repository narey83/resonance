// <copyright file="BrowseResults.jsx" company="John Narey">
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
import useDebounce from '../../hooks/useDebounce';
import {
  saveRecentFolder,
  suggestDestinationFolder,
} from '../../lib/downloadDestination';
import { matchesMetaFilters } from '../../lib/searchMetadata';
import * as transfers from '../../lib/transfers';
import {
  formatAttributes,
  formatBytes,
  formatSeconds,
  getFileName,
} from '../../lib/util';
import FolderPickerModal from '../Search/Detail/FolderPickerModal';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Folder,
  FolderOpen,
  FoldVertical,
  Lock,
  MessageSquare,
  Play,
  UnfoldVertical,
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
  { key: 'unlocked', label: 'Unlocked', match: (f) => !f.locked },
  {
    key: 'lossless',
    label: 'Lossless',
    match: (f) => LOSSLESS_EXTS.has(f._extension),
  },
  { key: 'hq', label: '≥ 320kbps', match: (f) => (f.bitRate ?? 0) >= 320 },
  { key: 'vbr', label: 'VBR', match: (f) => f.isVariableBitRate },
];

const isAudio = (filename) =>
  AUDIO_EXTENSIONS.has(filename.split('.').pop().toLowerCase());

const leafName = (path) => path.split(/[/\\]/u).filter(Boolean).at(-1) || path;

// ── File row ──────────────────────────────────────────────────────────────────

const FileRow = React.memo(
  ({ checked, disabled, file, onToggleFile, play, username }) => {
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
          {play && audio && !file.locked && (
            <button
              className="sr-file-play-btn"
              onClick={() => play({ filename: file.fullPath, username })}
              title="Preview"
              type="button"
            >
              <Play size={12} />
            </button>
          )}
        </div>

        <div className="sr-file-name">
          <span
            className="sr-file-name-text"
            title={file.fullPath}
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
        <div />
      </div>
    );
  },
);

// ── Folder group ──────────────────────────────────────────────────────────────

const FolderGroup = ({
  disabled,
  downloadedFolders,
  group,
  onToggleFile,
  onToggleFolder,
  onToggleOpen,
  open,
  play,
  selected,
  username,
}) => {
  const checkboxRef = useRef(null);
  const dlStatus = downloadedFolders?.get(group.label.toLowerCase());

  const allSelected = group.files.every((f) => selected.has(f.fullPath));
  const someSelected =
    !allSelected && group.files.some((f) => selected.has(f.fullPath));

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = someSelected;
  }, [someSelected]);

  return (
    <div className="sr-folder-group">
      <div className="sr-folder-header">
        <input
          checked={allSelected}
          className="sr-checkbox sr-folder-checkbox"
          disabled={disabled}
          onChange={() => onToggleFolder(group.files)}
          ref={checkboxRef}
          type="checkbox"
        />
        <button
          className="sr-folder-chevron"
          onClick={onToggleOpen}
          type="button"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>

        <button
          className="sr-folder-name"
          onClick={onToggleOpen}
          type="button"
        >
          {group.locked ? (
            <Lock
              size={13}
              strokeWidth={1.75}
            />
          ) : (
            <Folder
              size={13}
              strokeWidth={1.75}
            />
          )}
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
        </span>
      </div>

      {open && (
        <div className="sr-folder-files">
          {group.files.map((file) => (
            <FileRow
              checked={selected.has(file.fullPath)}
              disabled={disabled}
              file={file}
              key={file.fullPath}
              onToggleFile={onToggleFile}
              play={play}
              username={username}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── BrowseResults ──────────────────────────────────────────────────────────────

const BrowseResults = ({ disabled, files, onChat, username }) => {
  const { play } = usePlayer() || {};
  const [downloadedFolders, setDownloadedFolders] = useState(new Map());
  const [activeFilters, setActiveFilters] = useState(new Set());
  const [selectedExtensions, setSelectedExtensions] = useState([]);
  const [collapsedFolders, setCollapsedFolders] = useState(new Set());
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
  const resultsScrollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    transfers
      .getAll({ direction: 'download' })
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return;
        const map = new Map();
        for (const user of data) {
          for (const dir of user.directories ?? []) {
            const name = leafName(dir.directory).toLowerCase();
            if (!name) continue;
            const dirFiles = dir.files ?? [];
            const allSucceeded =
              dirFiles.length > 0 &&
              dirFiles.every((f) => f.state === 'Completed, Succeeded');
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

  const availableFormats = useMemo(() => {
    const extensions = new Set();
    for (const f of files)
      if (f._extension) extensions.add(f._extension.toUpperCase());
    return [...extensions].sort();
  }, [files]);

  const filteredByPills = useMemo(() => {
    if (activeFilters.size === 0 && selectedExtensions.length === 0)
      return files;

    const activeStatic = STATIC_FILTERS.filter((sf) =>
      activeFilters.has(sf.key),
    );

    return files.filter((file) => {
      const passesFormat =
        selectedExtensions.length === 0 ||
        selectedExtensions.includes(file._extension.toUpperCase());
      const passesStatic = activeStatic.every((sf) => sf.match(file));
      return passesFormat && passesStatic;
    });
  }, [activeFilters, files, selectedExtensions]);

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
      const dir = file._directory;
      if (!byDirectory.has(dir)) {
        byDirectory.set(dir, {
          directory: dir,
          files: [],
          label: leafName(dir),
          locked: file.locked,
        });
      }

      byDirectory.get(dir).files.push(file);
    }

    return [...byDirectory.values()].sort((a, b) =>
      a.directory.localeCompare(b.directory),
    );
  }, [filteredByMeta]);

  const allCollapsed =
    folderGroups.length > 0 &&
    folderGroups.every((g) => collapsedFolders.has(g.directory));

  const toggleAllFolders = useCallback(() => {
    setCollapsedFolders(
      allCollapsed ? new Set() : new Set(folderGroups.map((g) => g.directory)),
    );
  }, [allCollapsed, folderGroups]);

  const toggleFolderOpen = useCallback((directory) => {
    setCollapsedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(directory)) next.delete(directory);
      else next.add(directory);
      return next;
    });
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: folderGroups.length,
    estimateSize: () => 90,
    getItemKey: (index) => folderGroups[index].directory,
    getScrollElement: () => resultsScrollRef.current,
    overscan: 6,
  });

  const toggleFile = useCallback((file) => {
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(file.fullPath)) next.delete(file.fullPath);
      else next.set(file.fullPath, file);
      return next;
    });
  }, []);

  const toggleFolder = useCallback((groupFiles) => {
    setSelected((previous) => {
      const next = new Map(previous);
      const allSelected = groupFiles.every((f) => previous.has(f.fullPath));
      if (allSelected) {
        for (const f of groupFiles) next.delete(f.fullPath);
      } else {
        for (const f of groupFiles) next.set(f.fullPath, f);
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

  const suggestion = useMemo(
    () =>
      suggestDestinationFolder([...selected.values()].map((f) => f.fullPath)),
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

  const downloadSelected = async (folderOverride) => {
    const filesToDownload = [...selected.values()];
    const destination = (
      typeof folderOverride === 'string' ? folderOverride : destinationFolder
    ).trim();
    setSelected(new Map());

    if (destination) saveRecentFolder(destination);

    try {
      await transfers.download({
        destinationFolder: destination,
        files: filesToDownload.map((f) => ({
          filename: f.fullPath,
          size: f.size,
        })),
        username,
      });
      const count = filesToDownload.length;
      toast.success(
        `Queued ${count} ${count === 1 ? 'file' : 'files'}${destination ? ` → ${destination}` : ''}`,
      );
    } catch (downloadError) {
      toast.error(
        downloadError?.response?.data ??
          downloadError?.message ??
          'Failed to queue some files',
      );
    }
  };

  return (
    <div className="sr-detail">
      <div className="sr-detail-header">
        <span className="sr-detail-header-icon">
          <FolderOpen
            size={15}
            strokeWidth={1.75}
          />
        </span>
        <span className="sr-detail-header-title">All Files</span>
        <div className="sr-detail-header-actions">
          {onChat && (
            <button
              className="sr-btn"
              onClick={onChat}
              type="button"
            >
              <MessageSquare size={13} /> Chat
            </button>
          )}
        </div>
      </div>

      <div className="sr-filters">
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

          {folderGroups.length > 0 && (
            <button
              className="sr-filter-adv-btn hover-fx"
              onClick={toggleAllFolders}
              title={
                allCollapsed ? 'Expand all folders' : 'Collapse all folders'
              }
              type="button"
            >
              {allCollapsed ? (
                <UnfoldVertical size={13} />
              ) : (
                <FoldVertical size={13} />
              )}
            </button>
          )}

          {folderGroups.length > 0 && (
            <span className="sr-file-count">
              {filteredByMeta.length}{' '}
              {filteredByMeta.length === 1 ? 'file' : 'files'}
              {' · '}
              {folderGroups.length}{' '}
              {folderGroups.length === 1 ? 'folder' : 'folders'}
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
                  setMetaFilters((previous) => ({ ...previous, [key]: value }));
                }}
                placeholder={placeholder}
                type="text"
                value={metaFilters[key]}
              />
              {metaFilters[key] && (
                <button
                  className="sr-filter-clear hover-fx"
                  onClick={() =>
                    setMetaFilters((previous) => ({ ...previous, [key]: '' }))
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
        {folderGroups.length > 0 ? (
          <>
            <div className="sr-file-table-head">
              <div className="sr-file-check" />
              <div className="sr-file-play" />
              <div className="sr-file-name">File</div>
              <div className="sr-file-quality">Quality</div>
              <div className="sr-file-size">Size</div>
              <div className="sr-file-length">Length</div>
              <div className="sr-file-source" />
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
                  <FolderGroup
                    disabled={disabled}
                    downloadedFolders={downloadedFolders}
                    group={folderGroups[vItem.index]}
                    onToggleFile={toggleFile}
                    onToggleFolder={toggleFolder}
                    onToggleOpen={() =>
                      toggleFolderOpen(folderGroups[vItem.index].directory)
                    }
                    open={
                      !collapsedFolders.has(folderGroups[vItem.index].directory)
                    }
                    play={play}
                    selected={selected}
                    username={username}
                  />
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="sr-no-results">
            {files.length === 0
              ? 'User is not sharing any files'
              : 'No files match the current filters'}
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sr-download-bar">
          <span className="sr-download-bar-count">
            {selected.size} {selected.size === 1 ? 'file' : 'files'} selected
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

export default BrowseResults;
