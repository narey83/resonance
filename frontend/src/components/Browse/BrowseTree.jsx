// <copyright file="BrowseTree.jsx" company="John Narey">
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
import * as transfers from '../../lib/transfers';
import {
  formatAttributes,
  formatBytes,
  formatSeconds,
  getFileName,
} from '../../lib/util';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Folder,
  FolderOpen,
  Lock,
  MessageSquare,
  Play,
  X,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

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
const isAudio = (function_) =>
  AUDIO_EXTENSIONS.has(function_.split('.').pop().toLowerCase());

export const collectAllPaths = (nodes) => {
  const paths = new Set();
  const recurse = (node) => {
    paths.add(node.name);
    for (const child of node.children || []) recurse(child);
  };

  for (const node of nodes) recurse(node);
  return paths;
};

export const buildTree = (directories, separator_) => {
  if (directories.length === 0 || directories[0].name === undefined) return [];

  const depthMap = new Map();
  for (const d of directories) {
    const depth = d.name.split(separator_).length;
    if (!depthMap.has(depth)) depthMap.set(depth, []);
    depthMap.get(depth).push(d);
  }

  const rootDepth = Math.min(...depthMap.keys());

  const buildChildren = (map, root, s, depth) => {
    if (!map.has(depth)) return { ...root, children: [] };
    const children = map.get(depth).filter((d) => d.name.startsWith(root.name));
    return {
      ...root,
      children: children.map((c) => buildChildren(map, c, s, depth + 1)),
    };
  };

  return depthMap
    .get(rootDepth)
    .map((d) => buildChildren(depthMap, d, separator_, rootDepth + 1));
};

// ── Tree node ─────────────────────────────────────────────────────────────────

export const TreeNode = ({
  depth,
  expandedPaths,
  node,
  onSelect,
  onToggle,
  selectedName,
}) => {
  const isSelected = node.name === selectedName;
  const isExpanded = expandedPaths.has(node.name);
  const hasChildren = node.children && node.children.length > 0;
  const label = node.name.split('\\').pop().split('/').pop() || node.name;

  return (
    <>
      <div
        className={`br-tree-item${isSelected ? ' br-tree-item--active' : ''}${node.locked ? ' br-tree-item--locked' : ''}`}
        onClick={() => onSelect(node)}
        onKeyDown={(e) => e.key === 'Enter' && onSelect(node)}
        role="button"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        tabIndex={0}
      >
        <span
          className="br-tree-toggle"
          onClick={
            hasChildren
              ? (e) => {
                  e.stopPropagation();
                  onToggle(node.name);
                }
              : undefined
          }
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
        >
          {isExpanded ? (
            <ChevronDown
              size={11}
              strokeWidth={2}
            />
          ) : (
            <ChevronRight
              size={11}
              strokeWidth={2}
            />
          )}
        </span>
        <span className="br-tree-icon">
          {node.locked ? (
            <Lock
              size={12}
              strokeWidth={2}
            />
          ) : isSelected ? (
            <FolderOpen
              size={12}
              strokeWidth={1.75}
            />
          ) : (
            <Folder
              size={12}
              strokeWidth={1.75}
            />
          )}
        </span>
        <span className="br-tree-label">{label}</span>
      </div>

      {hasChildren &&
        isExpanded &&
        node.children.map((child) => (
          <TreeNode
            depth={depth + 1}
            expandedPaths={expandedPaths}
            key={child.name}
            node={child}
            onSelect={onSelect}
            onToggle={onToggle}
            selectedName={selectedName}
          />
        ))}
    </>
  );
};

// ── Files panel ───────────────────────────────────────────────────────────────

export const FilesPanel = ({
  directory,
  onChat,
  onClose,
  separator,
  username,
}) => {
  const { locked, name } = directory;
  const { play } = usePlayer() || {};
  const [selected, setSelected] = useState(new Set());
  const [downloadState, setDownloadState] = useState('idle');
  const filesScrollRef = useRef(null);

  const files = (directory.files || [])
    .map((f) => ({ ...f, fullPath: `${name}${separator}${f.filename}` }))
    .sort((a, b) => (a.filename > b.filename ? 1 : -1));

  useEffect(() => {
    setSelected(new Set());
    setDownloadState('idle');
  }, [name]);

  const filesVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => filesScrollRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  const virtualFiles = filesVirtualizer.getVirtualItems();
  const filesTotalSize = filesVirtualizer.getTotalSize();
  const filesPaddingTop = virtualFiles.length > 0 ? virtualFiles[0].start : 0;
  const filesPaddingBottom =
    virtualFiles.length > 0
      ? filesTotalSize - virtualFiles[virtualFiles.length - 1].end
      : 0;

  const allChecked = files.length > 0 && selected.size === files.length;

  const toggleAll = () =>
    setSelected(allChecked ? new Set() : new Set(files.map((f) => f.fullPath)));

  const toggleFile = (fullPath) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });

  const download = async () => {
    if (!selected.size) return;
    setDownloadState('pending');
    try {
      const requests = files
        .filter((f) => selected.has(f.fullPath))
        .map(({ fullPath: filename, size }) => ({ filename, size }));
      await transfers.download({ files: requests, username });
      setDownloadState('complete');
    } catch {
      setDownloadState('error');
    }
  };

  const dirLabel = name.split(separator).filter(Boolean).pop() || name;

  return (
    <div className="sr-detail">
      <div className="sr-detail-header">
        <span className="sr-detail-header-icon">
          {locked ? (
            <Lock
              size={15}
              strokeWidth={2}
            />
          ) : (
            <FolderOpen
              size={15}
              strokeWidth={1.75}
            />
          )}
        </span>
        <span
          className="sr-detail-header-title"
          title={name}
        >
          {dirLabel}
        </span>
        <div className="sr-detail-header-actions">
          {downloadState === 'error' && (
            <span className="br-download-error">Download failed</span>
          )}
          {selected.size > 0 && (
            <button
              className="sr-btn"
              disabled={downloadState === 'pending'}
              onClick={download}
              type="button"
            >
              <Download size={13} />
              {selected.size === 1 ? '1 file' : `${selected.size} files`}
            </button>
          )}
          {onChat && (
            <button
              className="sr-btn"
              onClick={onChat}
              type="button"
            >
              <MessageSquare size={13} /> Chat
            </button>
          )}
          {onClose && (
            <button
              className="sr-btn"
              onClick={onClose}
              title="Close"
              type="button"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div
        className="sr-results"
        ref={filesScrollRef}
      >
        {files.length === 0 ? (
          <div className="sr-no-results">No files in this folder</div>
        ) : (
          <>
            <div className="sr-file-table-head">
              <div className="sr-file-check">
                <input
                  checked={allChecked}
                  className="sr-checkbox"
                  onChange={toggleAll}
                  type="checkbox"
                />
              </div>
              <div />
              <div>File</div>
              <div>Quality</div>
              <div>Size</div>
              <div>Length</div>
              <div />
            </div>

            {filesPaddingTop > 0 && <div style={{ height: filesPaddingTop }} />}
            {virtualFiles.map((vFile) => {
              const file = files[vFile.index];
              return (
                <div
                  className="sr-file-row"
                  key={vFile.key}
                >
                  <div className="sr-file-check">
                    <input
                      checked={selected.has(file.fullPath)}
                      className="sr-checkbox"
                      onChange={() => toggleFile(file.fullPath)}
                      type="checkbox"
                    />
                  </div>

                  <div className="sr-file-play">
                    {play && isAudio(file.filename) && !locked && (
                      <button
                        className="sr-file-play-btn"
                        onClick={() =>
                          play({ ...file, filename: file.fullPath, username })
                        }
                        title="Preview"
                        type="button"
                      >
                        <Play size={12} />
                      </button>
                    )}
                  </div>

                  <div className="sr-file-name">
                    <span className="sr-file-name-text">
                      {locked && (
                        <Lock
                          className="sr-file-lock-icon"
                          size={10}
                          strokeWidth={2}
                        />
                      )}
                      {getFileName(file.filename)}
                    </span>
                  </div>

                  <div className="sr-file-quality">
                    {formatAttributes(file)}
                  </div>
                  <div className="sr-file-size">{formatBytes(file.size)}</div>
                  <div className="sr-file-length">
                    {formatSeconds(file.length)}
                  </div>
                  <div />
                </div>
              );
            })}
            {filesPaddingBottom > 0 && (
              <div style={{ height: filesPaddingBottom }} />
            )}
          </>
        )}
      </div>
    </div>
  );
};
