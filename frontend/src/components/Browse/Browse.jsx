import './Browse.css';
import '../Search/Search.css';
import { usePlayer } from '../../context/PlayerContext';
import * as prefs from '../../lib/prefs';
import * as transfers from '../../lib/transfers';
import * as users from '../../lib/users';
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
  Plus,
  X,
} from 'lucide-react';
import * as lzString from 'lz-string';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { withRouter } from 'react-router-dom';
import { Modal } from 'semantic-ui-react';

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

const SIDEBAR_WIDTH_KEY = 'resonance-browse-sidebar-width';
const BROWSE_STATE_KEY = 'soulseek-example-browse-state';
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 600;

const collectAllPaths = (nodes) => {
  const paths = new Set();
  const recurse = (node) => {
    paths.add(node.name);
    for (const child of node.children || []) recurse(child);
  };

  for (const node of nodes) recurse(node);
  return paths;
};

// ── Browse modal ──────────────────────────────────────────────────────────────

const BrowseModal = ({ onBrowse, onClose, open }) => {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handle = () => {
    const u = value.trim();
    if (!u) return;
    onBrowse(u);
    onClose();
  };

  return (
    <Modal
      centered
      onClose={onClose}
      open={open}
      size="small"
    >
      <div className="smm-modal">
        <div className="smm-header">
          <span className="smm-title">Browse User</span>
          <button
            className="smm-close"
            onClick={onClose}
            type="button"
          >
            <X size={14} />
          </button>
        </div>
        <div className="smm-body">
          <div className="smm-field">
            <label className="smm-label">Username</label>
            <input
              className="smm-input"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handle()}
              placeholder="Enter a username"
              ref={inputRef}
              value={value}
            />
          </div>
        </div>
        <div className="smm-footer">
          <button
            className="smm-btn smm-btn--cancel"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="smm-btn smm-btn--send"
            disabled={!value.trim()}
            onClick={handle}
            type="button"
          >
            Browse
          </button>
        </div>
      </div>
    </Modal>
  );
};

// ── Tree node ─────────────────────────────────────────────────────────────────

const TreeNode = ({
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

const FilesPanel = ({ directory, onChat, onClose, separator, username }) => {
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
          <button
            className="sr-btn"
            onClick={onChat}
            type="button"
          >
            <MessageSquare size={13} /> Chat
          </button>
          <button
            className="sr-btn"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={13} />
          </button>
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

// ── Main component ────────────────────────────────────────────────────────────

const Browse = ({ history, location }) => {
  const [browseState, setBrowseState] = useState('idle');
  const [browseStatus, setBrowseStatus] = useState(0);
  const [username, setUsername] = useState('');
  const [tree, setTree] = useState([]);
  const [info, setInfo] = useState({
    directories: 0,
    files: 0,
    lockedDirectories: 0,
    lockedFiles: 0,
  });
  const [separator, setSeparator] = useState('\\');
  const [selectedDirectory, setSelectedDirectory] = useState(null);
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(prefs.get(SIDEBAR_WIDTH_KEY, 260));
    return Number.isFinite(saved) ? saved : 260;
  });
  const [browseModalOpen, setBrowseModalOpen] = useState(false);

  const rootRef = useRef(null);
  const dividerMoveRef = useRef(null);
  const intervalRef = useRef(null);
  const usernameRef = useRef('');
  const browseStateRef = useRef('idle');

  // ── Divider ───────────────────────────────────────────────────────────────
  const onDividerMouseDown = (e) => {
    e.preventDefault();
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    dividerMoveRef.current = (moveEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setSidebarWidth(
        Math.min(
          SIDEBAR_MAX,
          Math.max(SIDEBAR_MIN, moveEvent.clientX - rect.left),
        ),
      );
    };

    const onMouseUp = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setSidebarWidth((w) => {
        prefs.set(SIDEBAR_WIDTH_KEY, w);
        return w;
      });
      document.removeEventListener('mousemove', dividerMoveRef.current);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', dividerMoveRef.current);
    document.addEventListener('mouseup', onMouseUp);
  };

  // ── Tree builder ──────────────────────────────────────────────────────────
  const buildTree = useCallback((directories, separator_) => {
    if (directories.length === 0 || directories[0].name === undefined)
      return [];

    const depthMap = new Map();
    for (const d of directories) {
      const depth = d.name.split(separator_).length;
      if (!depthMap.has(depth)) depthMap.set(depth, []);
      depthMap.get(depth).push(d);
    }

    const rootDepth = Math.min(...depthMap.keys());

    const buildChildren = (map, root, s, depth) => {
      if (!map.has(depth)) return { ...root, children: [] };
      const children = map
        .get(depth)
        .filter((d) => d.name.startsWith(root.name));
      return {
        ...root,
        children: children.map((c) => buildChildren(map, c, s, depth + 1)),
      };
    };

    return depthMap
      .get(rootDepth)
      .map((d) => buildChildren(depthMap, d, separator_, rootDepth + 1));
  }, []);

  // ── Browse ────────────────────────────────────────────────────────────────
  const doBrowse = useCallback(
    (usernameToUse) => {
      setBrowseState('pending');
      browseStateRef.current = 'pending';
      usernameRef.current = usernameToUse;
      setUsername(usernameToUse);

      users
        .browse({ username: usernameToUse })
        .then((response) => {
          const directories = response.directories ?? [];
          const lockedDirectories = response.lockedDirectories ?? [];

          let separator_;
          for (const d of directories) {
            if (d.name.includes('\\')) {
              separator_ = '\\';
              break;
            }

            if (d.name.includes('/')) {
              separator_ = '/';
              break;
            }
          }

          separator_ = separator_ || '\\';

          const allDirectories = directories.concat(
            lockedDirectories.map((d) => ({ ...d, locked: true })),
          );
          const builtTree = buildTree(allDirectories, separator_);

          setTree(builtTree);
          setSeparator(separator_);
          setExpandedPaths(collectAllPaths(builtTree));
          setInfo({
            directories: directories.length,
            files: directories.reduce(
              (accumulator, d) => accumulator + d.fileCount,
              0,
            ),
            lockedDirectories: lockedDirectories.length,
            lockedFiles: lockedDirectories.reduce(
              (accumulator, d) => accumulator + d.fileCount,
              0,
            ),
          });
          setBrowseState('complete');
          browseStateRef.current = 'complete';
        })
        .catch(() => {
          setBrowseState('error');
          browseStateRef.current = 'error';
        });
    },
    [buildTree],
  );

  const clear = useCallback(() => {
    setBrowseState('idle');
    browseStateRef.current = 'idle';
    setTree([]);
    setSelectedDirectory(null);
    setExpandedPaths(new Set());
    setUsername('');
    usernameRef.current = '';
    setInfo({ directories: 0, files: 0, lockedDirectories: 0, lockedFiles: 0 });
  }, []);

  // ── Status polling ────────────────────────────────────────────────────────
  const fetchStatus = useCallback(() => {
    if (browseStateRef.current !== 'pending') return;
    const un = usernameRef.current;
    if (!un) return;
    users
      .getBrowseStatus({ username: un })
      .then((res) => setBrowseStatus(res.data))
      .catch(() => {});
  }, []);

  // ── Mount ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const queryUser = new URLSearchParams(location?.search).get('user');
    if (queryUser) {
      doBrowse(queryUser);
    } else if (location?.state?.user) {
      doBrowse(location.state.user);
    } else {
      try {
        const stored = JSON.parse(
          lzString.decompress(prefs.get(BROWSE_STATE_KEY, '') || ''),
        );
        if (stored) {
          if (stored.browseState === 'pending') {
            stored.browseState = stored.tree?.length > 0 ? 'complete' : 'idle';
          }

          setBrowseState(stored.browseState || 'idle');
          browseStateRef.current = stored.browseState || 'idle';
          const restoredTree = stored.tree || [];
          setTree(restoredTree);
          setSeparator(stored.separator || '\\');
          setInfo(
            stored.info || {
              directories: 0,
              files: 0,
              lockedDirectories: 0,
              lockedFiles: 0,
            },
          );
          if (stored.username && stored.browseState !== 'idle') {
            setUsername(stored.username);
            usernameRef.current = stored.username;
          }

          if (restoredTree.length > 0)
            setExpandedPaths(collectAllPaths(restoredTree));
        }
      } catch {
        // ignore
      }
    }

    intervalRef.current = window.setInterval(fetchStatus, 500);
    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist state ─────────────────────────────────────────────────────────
  useEffect(() => {
    const store = () => {
      try {
        prefs.set(
          BROWSE_STATE_KEY,
          lzString.compress(
            JSON.stringify({
              browseState,
              browseStatus,
              info,
              separator,
              tree,
              username,
            }),
          ),
        );
      } catch {
        /* ignore */
      }
    };

    if (window.requestIdleCallback) window.requestIdleCallback(store);
    else Promise.resolve().then(store);
  }, [browseState, browseStatus, info, separator, tree, username]);

  // ── Escape to clear ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') clear();
    };

    document.addEventListener('keyup', onKey, false);
    return () => document.removeEventListener('keyup', onKey, false);
  }, [clear]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleToggle = useCallback(
    (path) =>
      setExpandedPaths((previous) => {
        const next = new Set(previous);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    [],
  );

  const handleSelect = useCallback(
    (node) => setSelectedDirectory({ ...node, children: [] }),
    [],
  );

  const pending = browseState === 'pending';
  const hasResults = tree.length > 0;

  return (
    <>
      <div
        className="sr-root"
        ref={rootRef}
      >
        {/* ── Sidebar ── */}
        <div
          className="sr-sidebar"
          style={{ width: sidebarWidth, minWidth: sidebarWidth }}
        >
          <div className="sr-sidebar-top">
            <span className="sr-sidebar-title">{username || 'Browse'}</span>
            {pending && (
              <span
                className="sr-searching-spinner"
                style={{ flexShrink: 0 }}
              />
            )}
            <button
              className="sr-create-btn"
              onClick={() => setBrowseModalOpen(true)}
              title="Browse user"
              type="button"
            >
              <Plus size={15} />
            </button>
            {browseState !== 'idle' && (
              <button
                className="sr-create-btn br-clear-btn"
                onClick={clear}
                title="Clear"
                type="button"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {pending && (
            <div className="sr-sidebar-status">
              Downloading… {Math.round(browseStatus?.percentComplete || 0)}%
            </div>
          )}
          {browseState === 'error' && (
            <div className="sr-sidebar-status sr-sidebar-status--error">
              Failed to browse {username}
            </div>
          )}
          {browseState === 'complete' && hasResults && (
            <div className="br-info-bar">
              {(info.files + info.lockedFiles).toLocaleString()} files ·{' '}
              {(info.directories + info.lockedDirectories).toLocaleString()}{' '}
              folders
            </div>
          )}

          <div className="sr-search-list">
            {browseState === 'complete' && !hasResults && (
              <div className="sr-search-list-empty">
                User is not sharing any files
              </div>
            )}
            {tree.map((node) => (
              <TreeNode
                depth={0}
                expandedPaths={expandedPaths}
                key={node.name}
                node={node}
                onSelect={handleSelect}
                onToggle={handleToggle}
                selectedName={selectedDirectory?.name}
              />
            ))}
          </div>
        </div>

        {/* ── Resize divider ── */}
        <div
          aria-orientation="vertical"
          className="sr-divider"
          onMouseDown={onDividerMouseDown}
          role="separator"
        />

        {/* ── Main panel ── */}
        <div className="sr-main">
          {selectedDirectory ? (
            <FilesPanel
              directory={selectedDirectory}
              onChat={() => history.push('/chat', { user: username })}
              onClose={() => setSelectedDirectory(null)}
              separator={separator}
              username={username}
            />
          ) : (
            <div className="sr-empty">
              <FolderOpen
                size={32}
                strokeWidth={1.25}
              />
              <p>
                {browseState === 'idle'
                  ? 'Browse a user to view their shared files'
                  : pending
                    ? 'Downloading file list…'
                    : 'Select a folder to view its files'}
              </p>
              {browseState === 'idle' && (
                <button
                  className="chat-start-btn"
                  onClick={() => setBrowseModalOpen(true)}
                  type="button"
                >
                  Browse a User
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <BrowseModal
        onBrowse={doBrowse}
        onClose={() => setBrowseModalOpen(false)}
        open={browseModalOpen}
      />
    </>
  );
};

export default withRouter(Browse);
