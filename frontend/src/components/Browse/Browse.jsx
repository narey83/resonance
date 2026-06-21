import './Browse.css';
import '../Search/Search.css';
import * as prefs from '../../lib/prefs';
import * as users from '../../lib/users';
import { buildTree, collectAllPaths, FilesPanel, TreeNode } from './BrowseTree';
import { FolderOpen, Plus, X } from 'lucide-react';
import * as lzString from 'lz-string';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { withRouter } from 'react-router-dom';
import { Modal } from 'semantic-ui-react';

const SIDEBAR_WIDTH_KEY = 'resonance-browse-sidebar-width';
const BROWSE_STATE_KEY = 'soulseek-example-browse-state';
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 600;

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

  // ── Browse ────────────────────────────────────────────────────────────────
  const doBrowse = useCallback((usernameToUse) => {
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
  }, []);

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
