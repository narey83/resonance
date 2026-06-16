import { browseDirectories, createDirectory } from '../../lib/files';
import { Check, ChevronRight, Folder, FolderPlus, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

const parseBreadcrumbs = (path) => {
  if (path === '/') return [{ label: '/', path: '/' }];
  const parts = path.split('/').filter(Boolean);
  const crumbs = [{ label: '/', path: '/' }];
  let cumulative = '';
  for (const part of parts) {
    cumulative += '/' + part;
    crumbs.push({ label: part, path: cumulative });
  }

  return crumbs;
};

const FolderPicker = ({
  initialPath = '/',
  onCancel,
  onSelect,
  title = 'Select a folder',
}) => {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [directories, setDirectories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState(null);
  const [createWorking, setCreateWorking] = useState(false);
  const newNameRef = useRef();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await browseDirectories(currentPath);
        setDirectories(result.directories);
        setCurrentPath(result.path);
      } catch {
        setError('Could not read this directory');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [currentPath]);

  useEffect(() => {
    if (creating) {
      newNameRef.current?.focus();
    }
  }, [creating]);

  const startCreating = () => {
    setNewName('');
    setCreateError(null);
    setCreating(true);
  };

  const cancelCreating = () => {
    setCreating(false);
    setNewName('');
    setCreateError(null);
  };

  const confirmCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreateWorking(true);
    setCreateError(null);
    try {
      const fullPath = currentPath.replace(/\/$/u, '') + '/' + trimmed;
      await createDirectory(fullPath);
      setCreating(false);
      setNewName('');
      setDirectories([]);
      setLoading(true);
      const result = await browseDirectories(currentPath);
      setDirectories(result.directories);
      setLoading(false);
      setCurrentPath(fullPath);
    } catch (caughtError) {
      setCreateError(
        caughtError?.response?.data ??
          caughtError?.message ??
          'Could not create folder',
      );
    } finally {
      setCreateWorking(false);
    }
  };

  const handleNewNameKey = (event) => {
    if (event.key === 'Enter') confirmCreate();
    if (event.key === 'Escape') cancelCreating();
  };

  const breadcrumbs = parseBreadcrumbs(currentPath);

  return (
    <div
      className="folder-picker-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
      role="presentation"
    >
      <div className="folder-picker">
        <div className="folder-picker-header">
          <div className="folder-picker-title-row">
            <div className="folder-picker-title">{title}</div>
            <button
              className="folder-picker-new-btn"
              onClick={startCreating}
              title="New folder"
              type="button"
            >
              <FolderPlus
                size={15}
                strokeWidth={1.75}
              />
              New Folder
            </button>
          </div>
          <div className="folder-picker-breadcrumb">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <React.Fragment key={crumb.path}>
                  {index > 0 && (
                    <ChevronRight
                      className="folder-picker-crumb-sep"
                      size={12}
                      strokeWidth={2}
                    />
                  )}
                  {isLast ? (
                    <span className="folder-picker-crumb folder-picker-crumb--current">
                      {crumb.label}
                    </span>
                  ) : (
                    <button
                      className="folder-picker-crumb"
                      onClick={() => setCurrentPath(crumb.path)}
                      type="button"
                    >
                      {crumb.label}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div className="folder-picker-list">
          {creating && (
            <div className="folder-picker-new-row">
              <Folder
                className="folder-picker-new-icon"
                size={15}
                strokeWidth={1.75}
              />
              <input
                className="folder-picker-new-input"
                disabled={createWorking}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={handleNewNameKey}
                placeholder="New folder name"
                ref={newNameRef}
                type="text"
                value={newName}
              />
              <button
                className="folder-picker-new-confirm"
                disabled={!newName.trim() || createWorking}
                onClick={confirmCreate}
                title="Create"
                type="button"
              >
                <Check
                  size={13}
                  strokeWidth={2.5}
                />
              </button>
              <button
                className="folder-picker-new-cancel"
                disabled={createWorking}
                onClick={cancelCreating}
                title="Cancel"
                type="button"
              >
                <X
                  size={13}
                  strokeWidth={2.5}
                />
              </button>
              {createError && (
                <div className="folder-picker-create-error">{createError}</div>
              )}
            </div>
          )}
          {loading && <div className="folder-picker-empty">Loading…</div>}
          {!loading && error && (
            <div className="folder-picker-empty">{error}</div>
          )}
          {!loading && !error && directories.length === 0 && !creating && (
            <div className="folder-picker-empty">No subdirectories</div>
          )}
          {!loading &&
            !error &&
            directories.map((directory) => (
              <button
                className="folder-picker-item"
                key={directory.path}
                onClick={() => setCurrentPath(directory.path)}
                type="button"
              >
                <Folder
                  size={15}
                  strokeWidth={1.75}
                />
                <span>{directory.name}</span>
              </button>
            ))}
        </div>

        <div className="folder-picker-current">
          <span className="folder-picker-current-label">Selected:</span>
          <span className="folder-picker-current-path">{currentPath}</span>
        </div>

        <div className="folder-picker-footer">
          <button
            className="auth-submit auth-submit--secondary"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="auth-submit"
            onClick={() => onSelect(currentPath)}
            type="button"
          >
            Use This Folder
          </button>
        </div>
      </div>
    </div>
  );
};

export default FolderPicker;
