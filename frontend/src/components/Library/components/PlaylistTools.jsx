import { toast } from '../../../lib/activityNotices';
import * as mixtapes from '../../../lib/mixtapes';
import React, { useEffect, useRef, useState } from 'react';

export const addTracksToMixtape = async (id, paths) => {
  let added = 0;
  let duplicates = 0;
  for (const path of new Set(paths)) {
    try {
      await mixtapes.addTrack(id, path);
      added++;
    } catch (error) {
      if (error.response?.status === 409) duplicates++;
      else
        throw new Error(
          `${added} added before the request failed. Retry to add the remaining tracks.`,
        );
    }
  }

  return { added, duplicates };
};

export const MixtapeDropTarget = ({ children, mixtape, onUpdate }) => {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`library-mixtape-drop${over ? ' is-over' : ''}`}
      onDragLeave={() => setOver(false)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/resonance-track')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setOver(false);
        try {
          const track = JSON.parse(
            e.dataTransfer.getData('application/resonance-track'),
          );
          const path = track.path || track.localRelativePath || track.filename;
          if (typeof path !== 'string') return;
          const result = await addTracksToMixtape(mixtape.id, [path]);
          toast.success(
            result.added
              ? `Added to ${mixtape.name}`
              : 'Already in this playlist',
          );
          onUpdate?.();
        } catch (error) {
          toast.error(error.message || 'Could not add track');
        }
      }}
    >
      {children}
    </div>
  );
};

const PlaylistTools = ({ paths = [] }) => {
  const menuRef = useRef(null);
  useEffect(() => {
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target))
        menuRef.current.open = false;
    };

    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const [items, setItems] = useState([]);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () =>
    mixtapes
      .getAll()
      .then(setItems)
      .catch(() => setError('Could not load playlists. Reopen to retry.'));
  useEffect(() => {
    load();
  }, []);
  const add = async (create) => {
    setBusy(true);
    setError('');
    try {
      const target = create
        ? await mixtapes.create({ name: name.trim() })
        : items.find((p) => p.id === id);
      const result = await addTracksToMixtape(target.id, paths);
      toast.success(
        `${result.added} added to ${target.name}${result.duplicates ? ` · ${result.duplicates} already present` : ''}`,
      );
      setName('');
      await load();
    } catch (error_) {
      setError(error_.message || 'Could not add tracks');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details
      className="library-playlist-tools"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.currentTarget.open = false;
          e.currentTarget.querySelector('summary')?.focus();
        }
      }}
      ref={menuRef}
    >
      <summary>Add to playlist</summary>
      <div className="library-playlist-menu">
        <p>Drop a track onto a playlist, or add your selection.</p>
        {items.map((p) => (
          <MixtapeDropTarget
            key={p.id}
            mixtape={p}
            onUpdate={load}
          >
            <span>
              {p.name} · {p.tracks?.length || 0} tracks
            </span>
          </MixtapeDropTarget>
        ))}
        <label>
          Playlist
          <select
            onChange={(e) => setId(e.target.value)}
            value={id}
          >
            <option value="">Choose playlist…</option>
            {items.map((p) => (
              <option
                key={p.id}
                value={p.id}
              >
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="jb-btn"
          disabled={!id || !paths.length || busy}
          onClick={() => add(false)}
          type="button"
        >
          Add {paths.length} selected
        </button>
        <label>
          New playlist
          <input
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            placeholder="Playlist name"
            value={name}
          />
        </label>
        <button
          className="jb-btn"
          disabled={!name.trim() || !paths.length || busy}
          onClick={() => add(true)}
          type="button"
        >
          Create with selection
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
};

export default PlaylistTools;
