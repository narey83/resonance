import { ChevronRight, Folder, Search } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

const directoryParts = (path) =>
  path.replaceAll('\\', '/').split('/').slice(0, -1).filter(Boolean);
export const exportFolderTree = (tracks) => {
  if (!tracks.length) return null;
  const directories = tracks.map((track) => directoryParts(track.path));
  let common = 0;
  while (true) {
    const index = common;
    const part = directories[0][index];
    if (!part || !directories.every((parts) => parts[index] === part)) break;
    common++;
  }

  const prefix = directories[0].slice(0, common);
  const root = {
    name: prefix.at(-1) || 'Music library',
    path: prefix.join('/'),
    folders: [],
    tracks: [],
    paths: [],
  };
  // Every track belongs to exactly one leaf; ancestor paths include descendants.
  for (const track of tracks) {
    let node = root;
    node.paths.push(track.path);
    const parts = directoryParts(track.path).slice(common);
    for (const part of parts) {
      let child = node.folders.find((folder) => folder.name === part);
      if (!child) {
        child = {
          name: part,
          path: `${node.path}/${part}`,
          folders: [],
          tracks: [],
          paths: [],
        };
        node.folders.push(child);
      }

      node = child;
      node.paths.push(track.path);
    }

    node.tracks.push(track);
  }

  const sort = (node) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.tracks.sort((a, b) => a.title.localeCompare(b.title));
    for (const folder of node.folders) sort(folder);
  };

  sort(root);
  return root;
};

const FolderSelection = ({
  depth = 0,
  disabled,
  node,
  onChange,
  searching,
  selected,
}) => {
  const [expanded, setExpanded] = useState(depth === 0 || searching);
  useEffect(() => {
    if (searching) setExpanded(true);
  }, [searching]);
  const checkbox = useRef(null);
  const count = node.paths.filter((path) => selected.includes(path)).length;
  useEffect(() => {
    if (checkbox.current)
      checkbox.current.indeterminate = count > 0 && count < node.paths.length;
  }, [count, node.paths.length]);
  const selectFolder = (checked) =>
    onChange((current) => {
      const next = new Set(current);
      for (const path of node.paths) {
        if (checked) next.add(path);
        else next.delete(path);
      }

      return [...next];
    });
  return (
    <div className="usb-picker-folder">
      <div className="usb-picker-folder-row">
        <input
          aria-label={`Select folder ${node.name}`}
          checked={count === node.paths.length}
          disabled={disabled}
          onChange={(event) => selectFolder(event.target.checked)}
          ref={checkbox}
          type="checkbox"
        />
        <button
          aria-expanded={expanded}
          className="usb-picker-folder-toggle"
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          <ChevronRight
            className={expanded ? 'is-open' : ''}
            size={14}
          />
          <Folder size={16} />
          <strong>{node.name}</strong>
        </button>
        <span>
          {count} / {node.paths.length} tracks
        </span>
      </div>
      {expanded && (
        <div className="usb-picker-folder-contents">
          {node.folders.map((folder) => (
            <FolderSelection
              depth={depth + 1}
              disabled={disabled}
              key={folder.path}
              node={folder}
              onChange={onChange}
              searching={searching}
              selected={selected}
            />
          ))}
          {node.tracks.map((track) => (
            <label
              className="usb-picker-track"
              key={track.path}
            >
              <input
                aria-label={`Export ${track.title}`}
                checked={selected.includes(track.path)}
                disabled={disabled}
                onChange={(event) => {
                  const checked = event.target.checked;
                  onChange((current) =>
                    checked
                      ? [...new Set([...current, track.path])]
                      : current.filter((path) => path !== track.path),
                  );
                }}
                type="checkbox"
              />
              <span>
                <strong>{track.title}</strong>
                <small>{track.artist || 'Unknown artist'}</small>
              </span>
              <small className="usb-picker-extension">
                {track.path.split('.').at(-1).toUpperCase()}
              </small>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

const ExportTrackPicker = ({ disabled, onChange, selected, tracks }) => {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const visible = query
    ? tracks.filter((track) =>
        `${track.title} ${track.artist || ''} ${track.path}`
          .toLowerCase()
          .includes(query),
      )
    : tracks;
  // Keep the same root and hierarchy when searching by pruning the original tree.
  const prune = (node, paths) => {
    if (!node) return null;
    return {
      ...node,
      paths: node.paths.filter((path) => paths.has(path)),
      tracks: node.tracks.filter((track) => paths.has(track.path)),
      folders: node.folders
        .map((folder) => prune(folder, paths))
        .filter((folder) => folder.paths.length),
    };
  };

  const tree = prune(
    exportFolderTree(tracks),
    new Set(visible.map((track) => track.path)),
  );
  return (
    <div className="usb-track-picker">
      <label className="usb-picker-search">
        <Search size={15} />
        <input
          aria-label="Search export folders and tracks"
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search folders, tracks or artists…"
          value={search}
        />
      </label>
      <p className="usb-picker-help">
        Folder selections include subfolders.{' '}
        {query
          ? 'While searching, folder selection applies to matching tracks only.'
          : 'Expand a folder to choose individual tracks.'}
      </p>
      {tree?.paths.length ? (
        <FolderSelection
          disabled={disabled}
          key={tree.path}
          node={tree}
          onChange={onChange}
          searching={Boolean(query)}
          selected={selected}
        />
      ) : (
        <p role="status">
          {tracks.length
            ? 'No matching folders or tracks.'
            : 'No tracks available for export.'}
        </p>
      )}
    </div>
  );
};

export default ExportTrackPicker;
