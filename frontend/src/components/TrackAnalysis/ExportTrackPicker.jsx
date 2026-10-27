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
  disabled,
  kind = 'folder',
  node,
  onChange,
  searching,
  selected,
}) => {
  const [expanded, setExpanded] = useState(true);
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
          aria-label={`Select ${kind} ${node.name}`}
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
              disabled={disabled}
              key={folder.path}
              kind={kind}
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
  const [view, setView] = useState('folder');
  const query = search.trim().toLowerCase();
  const visible = query
    ? tracks.filter((track) =>
        `${track.title} ${track.artist || ''} ${track.album || ''} ${track.path}`
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

  const groups = new Map();
  for (const track of tracks) {
    const name =
      view === 'tracks'
        ? 'All tracks'
        : view === 'artist'
          ? track.artist || 'Unknown artist'
          : `${track.album || 'Unknown album'} · ${track.albumArtist || track.artist || 'Unknown artist'}`;
    if (!groups.has(name))
      groups.set(name, {
        name,
        path: name,
        folders: [],
        tracks: [],
        paths: [],
      });
    groups.get(name).tracks.push(track);
    groups.get(name).paths.push(track.path);
  }

  const roots =
    view === 'folder'
      ? [exportFolderTree(tracks)].filter(Boolean)
      : [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  const trees = roots
    .map((root) => prune(root, new Set(visible.map((track) => track.path))))
    .filter((tree) => tree.paths.length);
  return (
    <div className="usb-track-picker">
      <label className="usb-picker-search">
        Browse by
        <select
          aria-label="Browse export tracks by"
          onChange={(event) => setView(event.target.value)}
          value={view}
        >
          <option value="folder">Folder</option>
          <option value="album">Album</option>
          <option value="artist">Artist</option>
          <option value="tracks">All tracks</option>
        </select>
      </label>
      <label className="usb-picker-search">
        <Search size={15} />
        <input
          aria-label="Search export folders and tracks"
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search folders, albums, tracks or artists…"
          value={search}
        />
      </label>
      <p className="usb-picker-help">
        {view === 'folder'
          ? 'Folder selections include subfolders.'
          : 'Select a group to include its tracks.'}{' '}
        {query
          ? 'While searching, folder selection applies to matching tracks only.'
          : 'Expand a group to choose individual tracks.'}
      </p>
      {trees.length ? (
        trees.map((tree) => (
          <FolderSelection
            disabled={disabled}
            key={`${view}:${tree.path}`}
            kind={view === 'tracks' ? 'group' : view}
            node={tree}
            onChange={onChange}
            searching={Boolean(query)}
            selected={selected}
          />
        ))
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
