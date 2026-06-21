import '../Browse/Browse.css';
import '../Search/Search.css';
import * as users from '../../lib/users';
import {
  buildTree,
  collectAllPaths,
  FilesPanel,
  TreeNode,
} from '../Browse/BrowseTree';
import { FolderOpen } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

const detectSeparator = (directories) => {
  for (const d of directories) {
    if (d.name.includes('\\')) return '\\';
    if (d.name.includes('/')) return '/';
  }

  return '\\';
};

const UserFilesTab = ({ onChat, username }) => {
  const [browseState, setBrowseState] = useState('idle');
  const [browseStatus, setBrowseStatus] = useState(0);
  const [tree, setTree] = useState([]);
  const [separator, setSeparator] = useState('\\');
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [selectedDirectory, setSelectedDirectory] = useState(null);
  const [info, setInfo] = useState({ directories: 0, files: 0 });

  const stateRef = useRef('idle');
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!username) return undefined;
    let cancelled = false;

    setBrowseState('pending');
    stateRef.current = 'pending';
    setTree([]);
    setSelectedDirectory(null);
    setBrowseStatus(0);

    users
      .browse({ username })
      .then((response) => {
        if (cancelled) return;
        const directories = response.directories ?? [];
        const lockedDirectories = response.lockedDirectories ?? [];
        const separator_ = detectSeparator(directories);
        const allDirectories = directories.concat(
          lockedDirectories.map((d) => ({ ...d, locked: true })),
        );
        const builtTree = buildTree(allDirectories, separator_);

        setTree(builtTree);
        setSeparator(separator_);
        setExpandedPaths(collectAllPaths(builtTree));
        setInfo({
          directories: directories.length + lockedDirectories.length,
          files:
            directories.reduce((a, d) => a + (d.fileCount ?? 0), 0) +
            lockedDirectories.reduce((a, d) => a + (d.fileCount ?? 0), 0),
        });
        setBrowseState('complete');
        stateRef.current = 'complete';
      })
      .catch(() => {
        if (cancelled) return;
        setBrowseState('error');
        stateRef.current = 'error';
      });

    intervalRef.current = window.setInterval(() => {
      if (stateRef.current !== 'pending') return;
      users
        .getBrowseStatus({ username })
        .then((res) => !cancelled && setBrowseStatus(res.data))
        .catch(() => {});
    }, 500);

    return () => {
      cancelled = true;
      clearInterval(intervalRef.current);
    };
  }, [username]);

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
    <div className="user-files-tab sr-root">
      <div className="sr-sidebar user-files-sidebar">
        <div className="sr-sidebar-top">
          <span className="sr-sidebar-title">{username}</span>
          {pending && (
            <span
              className="sr-searching-spinner"
              style={{ flexShrink: 0 }}
            />
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
            {info.files.toLocaleString()} files ·{' '}
            {info.directories.toLocaleString()} folders
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

      <div className="sr-main">
        {selectedDirectory ? (
          <FilesPanel
            directory={selectedDirectory}
            onChat={onChat}
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
              {pending
                ? 'Downloading file list…'
                : browseState === 'complete' && hasResults
                  ? 'Select a folder to view its files'
                  : browseState === 'error'
                    ? 'Could not load shared files'
                    : 'No shared files'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserFilesTab;
