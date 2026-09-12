// <copyright file="Library.jsx" company="John Narey">
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

import './Library.css';
import 'react-image-crop/dist/ReactCrop.css';
import { urlBase } from '../../config';
import { useLibraryActivity } from '../../context/LibraryActivityContext';
import { usePlayer } from '../../context/PlayerContext';
import useDebounce from '../../hooks/useDebounce';
import useResizablePanel from '../../hooks/useResizablePanel';
import { createMixtapesHubConnection } from '../../lib/hubFactory';
import * as mixtapesAPI from '../../lib/mixtapes';
import {
  albumKey,
  ALL_METRICS,
  analyzeFolder,
  analyzeTrack,
  cancelSync,
  deleteFolder,
  deleteTrack,
  deleteTrackBatchLocal,
  getAlbumPage,
  getArtistPage,
  getFolders,
  getGenres,
  getIssueTracks,
  getLibraryStats,
  getRecentlyAdded,
  getSyncState,
  getTrackPage,
  getYears,
  renameFolder,
  renameTrack,
  triggerSync,
} from '../../lib/musicLibrary';
import * as prefs from '../../lib/prefs';
import { create as createSearch, stripRemixInfo } from '../../lib/searches';
import {
  exportTracksToUsb,
  exportTrackToUsb,
  isUsbExportSupported,
} from '../../lib/usbExport';
import { usePagedList, usePagedTracks } from '../../lib/usePagedList';
import { formatSeconds } from '../../lib/util';
import AlbumArt from './components/AlbumArt';
import AlbumDetail from './components/AlbumDetail';
import AlbumsView from './components/AlbumsView';
import ArtistsView from './components/ArtistsView';
import FolderView from './components/FolderView';
import GenreView from './components/GenreView';
import LibraryViewHeader from './components/LibraryViewHeader';
import PlayHistoryView from './components/PlayHistoryView';
import SortButton from './components/SortButton';
import TrackTable from './components/TrackTable';
import YearView from './components/YearView';
import {
  Activity,
  AlertTriangle,
  AudioWaveform,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Disc,
  Folder,
  FolderSearch,
  FolderX,
  Globe,
  GripVertical,
  Heart,
  Home,
  KeyRound,
  LayoutGrid,
  Link2,
  List,
  ListMusic,
  Loader2,
  PanelLeft,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Share2,
  Shuffle,
  Tag,
  Trash2,
  Upload,
  Users,
  Wand2,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
// eslint-disable-next-line import/no-named-as-default
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop';
import { useHistory, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import { v4 as uuidv4 } from 'uuid';

// ── Constants ─────────────────────────────────────────────────────────────────

const VIEWS = {
  HOME: 'home',
  ARTISTS: 'artists',
  ALBUMS: 'albums',
  TRACKS: 'tracks',
  LOVED: 'loved',
  HISTORY: 'history',
  GENRES: 'genres',
  YEARS: 'years',
  FOLDERS: 'folders',
  MIXTAPES: 'mixtapes',
  SEARCH: 'search',
  ISSUES: 'issues',
};

const NAV_ITEMS = [
  { id: VIEWS.HOME, label: 'Home', icon: Home },
  { id: VIEWS.ARTISTS, label: 'Artists', icon: Users },
  { id: VIEWS.ALBUMS, label: 'Albums', icon: Disc },
  { id: VIEWS.TRACKS, label: 'Tracks', icon: List },
  { id: VIEWS.FOLDERS, label: 'Folders', icon: Folder },
  { id: VIEWS.GENRES, label: 'Genres', icon: Tag },
  { id: VIEWS.YEARS, label: 'Years', icon: Calendar },
  { id: VIEWS.MIXTAPES, label: 'Mixtapes', icon: ListMusic },
  { id: VIEWS.LOVED, label: 'Loved', icon: Heart },
  { id: VIEWS.HISTORY, label: 'History', icon: Clock },
  { id: VIEWS.ISSUES, label: 'Issues', icon: Wrench },
];

// ── Alpha strip ───────────────────────────────────────────────────────────────

const ALPHA_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

// `disabled` when the list isn't sorted alphabetically: the rail narrows the query to a
// letter bucket of the ordering column, so under a BPM or date sort its letters would answer
// a question the ordering can't ask. Left visible but inert, with the reason in the tooltip.
const AlphaStrip = ({ disabled, handlerRef }) => (
  <div
    className={`jb-alpha-strip${disabled ? ' jb-alpha-strip--disabled' : ''}`}
    title={disabled ? 'Sort by name to jump to a letter' : undefined}
  >
    {ALPHA_LETTERS.map((l) => (
      <button
        className="jb-alpha-btn hover-fx"
        disabled={disabled}
        key={l}
        onClick={() => handlerRef.current?.(l)}
        type="button"
      >
        {l}
      </button>
    ))}
  </div>
);

// ── Module-scope track helpers ────────────────────────────────────────────────

const albumTrackParams = (album) => ({
  album: album.album,
  ...(album.directory ? { folder: album.directory } : { artist: album.artist }),
});

const libraryTrackToQueue = (track) => ({
  album: track.album,
  artist: track.artist,
  filename: track.path,
  hasArtwork: track.hasArtwork,
  length: track.duration,
  localRelativePath: track.path,
  path: track.path,
  title: track.title || track.filename,
});

// ── Context menu ──────────────────────────────────────────────────────────────

const ContextMenu = ({
  onAddToPlaylist,
  onAddToQueue,
  onAnalyze,
  onAutoMix,
  onClose,
  onCreate,
  onDeleteTrack,
  onExportTrack,
  onGoToArtist,
  onPlayNext,
  onRenameTrack,
  onSearchArtist,
  onSearchRemixes,
  onSearchSimilar,
  onShowInFolders,
  playlists,
  track,
  x,
  y,
}) => {
  const ref = useRef(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    const onDown = ({ target }) => {
      if (!ref.current?.contains(target)) onClose();
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('contextmenu', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('contextmenu', onDown);
    };
  }, [onClose]);

  const commit = () => {
    if (name.trim()) {
      onCreate(name.trim());
      onClose();
    }
  };

  const plList = playlists;
  const style = {
    left: Math.min(x, window.innerWidth - 260),
    top: Math.min(y, window.innerHeight - 300),
  };

  return (
    <div
      className="jb-context-menu"
      ref={ref}
      style={style}
    >
      <div
        className="jb-context-title"
        title={track.title}
      >
        {track.title || track.filename}
      </div>
      <div className="jb-context-sep" />

      <button
        className="jb-context-item"
        onClick={() => {
          onPlayNext(track);
          onClose();
        }}
        type="button"
      >
        <Play size={13} />
        Play Next
      </button>
      <button
        className="jb-context-item"
        onClick={() => {
          onAddToQueue(track);
          onClose();
        }}
        type="button"
      >
        <ListMusic size={13} />
        Add to Queue
      </button>

      <div className="jb-context-sep" />

      <button
        className="jb-context-item"
        onClick={() => {
          onAutoMix(track);
          onClose();
        }}
        type="button"
      >
        <Wand2 size={13} />
        Start Auto Mix from here
      </button>

      <div className="jb-context-sep" />

      <button
        className="jb-context-item"
        onClick={() => {
          onAnalyze(track, { metrics: ALL_METRICS });
          onClose();
        }}
        type="button"
      >
        <AudioWaveform size={13} />
        Analyse track
      </button>

      <div className="jb-context-sep" />
      <div className="jb-context-section">Library</div>

      {track.directory && (
        <button
          className="jb-context-item"
          onClick={() => {
            const norm = track.directory
              .replaceAll('\\', '/')
              .replace(/\/$/, '');
            const lastSlash = norm.lastIndexOf('/');
            const parent = lastSlash > 0 ? norm.slice(0, lastSlash) : norm;
            onGoToArtist(parent);
            onClose();
          }}
          type="button"
        >
          <Users size={13} />
          Go to artist folder
        </button>
      )}
      <button
        className="jb-context-item"
        onClick={() => {
          onShowInFolders(track.directory);
          onClose();
        }}
        type="button"
      >
        <FolderSearch size={13} />
        Show in folder
      </button>
      <button
        className="jb-context-item"
        onClick={() => {
          onRenameTrack(track);
          onClose();
        }}
        type="button"
      >
        <Pencil size={13} />
        Rename track…
      </button>
      {isUsbExportSupported() && (
        <button
          className="jb-context-item"
          onClick={() => {
            onExportTrack(track);
            onClose();
          }}
          type="button"
        >
          <Save size={13} />
          Export to USB
        </button>
      )}

      <div className="jb-context-sep" />
      <div className="jb-context-section">Add to mixtape</div>

      {plList.map((pl) => (
        <button
          className="jb-context-item"
          key={pl.id}
          onClick={() => {
            onAddToPlaylist(pl.id, track);
            onClose();
          }}
          type="button"
        >
          <ListMusic size={13} />
          <span className="jb-context-item-name">{pl.name}</span>
          <span className="jb-context-item-count">
            {pl.tracks?.length ?? 0}
          </span>
        </button>
      ))}

      {creating ? (
        <div className="jb-context-create">
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            onChange={({ target }) => setName(target.value)}
            onKeyDown={({ key }) => {
              if (key === 'Enter') commit();
              if (key === 'Escape') setCreating(false);
            }}
            placeholder="Mixtape name"
            type="text"
            value={name}
          />
          <button
            className="jb-context-create-btn"
            disabled={!name.trim()}
            onClick={commit}
            type="button"
          >
            Add
          </button>
        </div>
      ) : (
        <button
          className="jb-context-item"
          onClick={() => setCreating(true)}
          type="button"
        >
          <Plus size={13} />
          New mixtape…
        </button>
      )}

      <div className="jb-context-sep" />

      {track.title &&
        (() => {
          const clean = stripRemixInfo(track.title);
          const label = (t) => `${t.slice(0, 24)}${t.length > 24 ? '…' : ''}`;
          return (
            <>
              <button
                className="jb-context-item"
                onClick={() => {
                  onSearchSimilar(clean);
                  onClose();
                }}
                type="button"
              >
                <Search size={13} />
                Find similar to &quot;{label(clean)}&quot;
              </button>
              <button
                className="jb-context-item"
                onClick={() => {
                  onSearchRemixes(clean);
                  onClose();
                }}
                type="button"
              >
                <Search size={13} />
                Find remixes of &quot;{label(clean)}&quot;
              </button>
            </>
          );
        })()}
      {track.artist && (
        <button
          className="jb-context-item"
          onClick={() => {
            onSearchArtist(track.artist);
            onClose();
          }}
          type="button"
        >
          <Search size={13} />
          More from {track.artist}
        </button>
      )}

      <div className="jb-context-sep" />

      {confirmingDelete ? (
        <div className="jb-context-confirm">
          <div className="jb-context-confirm-msg">
            <AlertTriangle size={12} />
            Delete file from disk? This cannot be undone.
          </div>
          <div className="jb-context-confirm-btns">
            <button
              className="jb-context-confirm-yes"
              onClick={() => {
                onDeleteTrack(track);
                onClose();
              }}
              type="button"
            >
              Yes, delete
            </button>
            <button
              className="jb-context-confirm-no"
              onClick={() => setConfirmingDelete(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="jb-context-item jb-context-item--danger"
          onClick={() => setConfirmingDelete(true)}
          type="button"
        >
          <Trash2 size={13} />
          Delete track…
        </button>
      )}
    </div>
  );
};

// ── Folder context menu ────────────────────────────────────────────────────────

const FolderContextMenu = ({
  folder,
  onAddToMixtape,
  onAnalyzeFolder,
  onClose,
  onCreateMixtape,
  onDeleteFolder,
  onExportFolder,
  onRenameFolder,
  playlists = [],
  x,
  y,
}) => {
  const ref = useRef(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [creatingMixtape, setCreatingMixtape] = useState(false);
  const [newMixtapeName, setNewMixtapeName] = useState('');

  useEffect(() => {
    const onDown = ({ target }) => {
      if (!ref.current?.contains(target)) onClose();
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('contextmenu', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('contextmenu', onDown);
    };
  }, [onClose]);

  const style = {
    left: Math.min(x, window.innerWidth - 240),
    top: Math.min(y, window.innerHeight - 200),
  };

  return (
    <div
      className="jb-context-menu"
      ref={ref}
      style={style}
    >
      <div
        className="jb-context-title"
        title={folder.name}
      >
        {folder.name}
      </div>
      {folder.trackCount > 0 && (
        <div className="jb-context-subtitle">
          {folder.trackCount} track{folder.trackCount !== 1 ? 's' : ''}
        </div>
      )}
      <div className="jb-context-sep" />

      <div className="jb-context-section">Analyse</div>
      <button
        className="jb-context-item"
        onClick={() => {
          onAnalyzeFolder(folder, { metrics: ALL_METRICS });
          onClose();
        }}
        type="button"
      >
        <AudioWaveform size={13} />
        Analyse all tracks
      </button>

      <div className="jb-context-sep" />
      <div className="jb-context-section">Add to mixtape</div>
      {playlists.map((pl) => (
        <button
          className="jb-context-item"
          key={pl.id}
          onClick={() => {
            onAddToMixtape?.(pl.id);
            onClose();
          }}
          type="button"
        >
          <ListMusic size={13} />
          <span className="jb-context-item-name">{pl.name}</span>
          <span className="jb-context-item-count">
            {pl.tracks?.length ?? 0}
          </span>
        </button>
      ))}
      {creatingMixtape ? (
        <div className="jb-context-create">
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            onChange={({ target }) => setNewMixtapeName(target.value)}
            onKeyDown={({ key }) => {
              if (key === 'Enter' && newMixtapeName.trim()) {
                onCreateMixtape?.(newMixtapeName.trim());
                onClose();
              }

              if (key === 'Escape') setCreatingMixtape(false);
            }}
            placeholder="Mixtape name"
            type="text"
            value={newMixtapeName}
          />
          <button
            className="jb-context-create-btn"
            disabled={!newMixtapeName.trim()}
            onClick={() => {
              onCreateMixtape?.(newMixtapeName.trim());
              onClose();
            }}
            type="button"
          >
            Add
          </button>
        </div>
      ) : (
        <button
          className="jb-context-item"
          onClick={() => setCreatingMixtape(true)}
          type="button"
        >
          <Plus size={13} />
          New mixtape…
        </button>
      )}

      <div className="jb-context-sep" />

      <button
        className="jb-context-item"
        onClick={() => {
          onRenameFolder(folder);
          onClose();
        }}
        type="button"
      >
        <Pencil size={13} />
        Rename folder…
      </button>
      {isUsbExportSupported() && (
        <button
          className="jb-context-item"
          onClick={() => {
            onExportFolder(folder);
            onClose();
          }}
          type="button"
        >
          <Save size={13} />
          Export to USB
        </button>
      )}

      <div className="jb-context-sep" />

      {confirmingDelete ? (
        <div className="jb-context-confirm">
          <div className="jb-context-confirm-msg">
            <AlertTriangle size={12} />
            Delete folder and all its files? This cannot be undone.
          </div>
          <div className="jb-context-confirm-btns">
            <button
              className="jb-context-confirm-yes"
              onClick={() => {
                onDeleteFolder(folder);
                onClose();
              }}
              type="button"
            >
              Yes, delete
            </button>
            <button
              className="jb-context-confirm-no"
              onClick={() => setConfirmingDelete(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="jb-context-item jb-context-item--danger"
          onClick={() => setConfirmingDelete(true)}
          type="button"
        >
          <FolderX size={13} />
          Delete folder…
        </button>
      )}
    </div>
  );
};

// ── Album context menu ────────────────────────────────────────────────────────

const AlbumContextMenu = ({
  album,
  onAddAllToQueue,
  onAddToMixtape,
  onAnalyze,
  onClose,
  onCreateMixtape,
  onDeleteAlbum,
  onExportAlbum,
  onGoToArtist,
  onPlay,
  onSearchArtist,
  onShowInFolder,
  onShuffle,
  playlists = [],
  x,
  y,
}) => {
  const ref = useRef(null);
  const [creatingMixtape, setCreatingMixtape] = useState(false);
  const [newMixtapeName, setNewMixtapeName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    const onDown = ({ target }) => {
      if (!ref.current?.contains(target)) onClose();
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('contextmenu', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('contextmenu', onDown);
    };
  }, [onClose]);

  const style = {
    left: Math.min(x, window.innerWidth - 260),
    top: Math.min(y, window.innerHeight - 400),
  };

  return (
    <div
      className="jb-context-menu"
      ref={ref}
      style={style}
    >
      <div
        className="jb-context-title"
        title={album.album}
      >
        {album.album || '(Untitled)'}
      </div>
      {album.artist && (
        <div className="jb-context-subtitle">{album.artist}</div>
      )}
      <div className="jb-context-sep" />

      <button
        className="jb-context-item"
        onClick={() => {
          onPlay(album);
          onClose();
        }}
        type="button"
      >
        <Play size={13} />
        Play
      </button>
      <button
        className="jb-context-item"
        onClick={() => {
          onShuffle(album);
          onClose();
        }}
        type="button"
      >
        <Shuffle size={13} />
        Shuffle
      </button>
      <button
        className="jb-context-item"
        onClick={() => {
          onAddAllToQueue(album);
          onClose();
        }}
        type="button"
      >
        <ListMusic size={13} />
        Add all to Queue
      </button>

      <div className="jb-context-sep" />
      <div className="jb-context-section">Analyse</div>
      <button
        className="jb-context-item"
        onClick={() => {
          onAnalyze(album, { metrics: ALL_METRICS });
          onClose();
        }}
        type="button"
      >
        <AudioWaveform size={13} />
        Analyse everything
      </button>

      <div className="jb-context-sep" />
      <div className="jb-context-section">Library</div>
      {album.artist && (
        <button
          className="jb-context-item"
          onClick={() => {
            onGoToArtist(album.artist);
            onClose();
          }}
          type="button"
        >
          <Users size={13} />
          Go to artist
        </button>
      )}
      <button
        className="jb-context-item"
        onClick={() => {
          onShowInFolder(album);
          onClose();
        }}
        type="button"
      >
        <FolderSearch size={13} />
        Show in folder
      </button>
      {isUsbExportSupported() && (
        <button
          className="jb-context-item"
          onClick={() => {
            onExportAlbum(album);
            onClose();
          }}
          type="button"
        >
          <Save size={13} />
          Export to USB
        </button>
      )}

      <div className="jb-context-sep" />
      <div className="jb-context-section">Add to mixtape</div>
      {playlists.map((pl) => (
        <button
          className="jb-context-item"
          key={pl.id}
          onClick={() => {
            onAddToMixtape?.(pl.id);
            onClose();
          }}
          type="button"
        >
          <ListMusic size={13} />
          <span className="jb-context-item-name">{pl.name}</span>
          <span className="jb-context-item-count">
            {pl.tracks?.length ?? 0}
          </span>
        </button>
      ))}
      {creatingMixtape ? (
        <div className="jb-context-create">
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            onChange={({ target }) => setNewMixtapeName(target.value)}
            onKeyDown={({ key }) => {
              if (key === 'Enter' && newMixtapeName.trim()) {
                onCreateMixtape?.(newMixtapeName.trim());
                onClose();
              }

              if (key === 'Escape') setCreatingMixtape(false);
            }}
            placeholder="Mixtape name"
            type="text"
            value={newMixtapeName}
          />
          <button
            className="jb-context-create-btn"
            disabled={!newMixtapeName.trim()}
            onClick={() => {
              onCreateMixtape?.(newMixtapeName.trim());
              onClose();
            }}
            type="button"
          >
            Add
          </button>
        </div>
      ) : (
        <button
          className="jb-context-item"
          onClick={() => setCreatingMixtape(true)}
          type="button"
        >
          <Plus size={13} />
          New mixtape…
        </button>
      )}

      {album.artist && (
        <>
          <div className="jb-context-sep" />
          <button
            className="jb-context-item"
            onClick={() => {
              onSearchArtist(album.artist);
              onClose();
            }}
            type="button"
          >
            <Search size={13} />
            Find more from {album.artist}
          </button>
        </>
      )}

      <div className="jb-context-sep" />
      {confirmingDelete ? (
        <div className="jb-context-confirm">
          <div className="jb-context-confirm-msg">
            <AlertTriangle size={12} />
            Delete all tracks in this album from disk? This cannot be undone.
          </div>
          <div className="jb-context-confirm-btns">
            <button
              className="jb-context-confirm-yes"
              onClick={() => {
                onDeleteAlbum(album);
                onClose();
              }}
              type="button"
            >
              Yes, delete
            </button>
            <button
              className="jb-context-confirm-no"
              onClick={() => setConfirmingDelete(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="jb-context-item jb-context-item--danger"
          onClick={() => setConfirmingDelete(true)}
          type="button"
        >
          <Trash2 size={13} />
          Delete album…
        </button>
      )}
    </div>
  );
};

// ── Mixtapes view ─────────────────────────────────────────────────────────────

const mixtapeTrackToQueue = (track) => ({
  album: track.album,
  artist: track.artist,
  filename: track.filePath,
  hasArtwork: false,
  length: track.duration,
  localRelativePath: track.filePath,
  path: track.filePath,
  title:
    track.title ||
    track.filePath
      ?.split(/[/\\]/u)
      .pop()
      ?.replace(/\.[^.]+$/u, '') ||
    '(Unknown)',
});

const artworkSource = (m) =>
  m.hasArtwork ? `${mixtapesAPI.artworkUrl(m.id)}?v=${m.updatedAt}` : null;

// ── Mixtape card (tile) ───────────────────────────────────────────────────────

const MixtapeCard = ({ mixtape, onPlay, onSelect }) => (
  <button
    className="jb-folder-card"
    onClick={() => onSelect(mixtape.id)}
    type="button"
  >
    <div className="jb-folder-card-art">
      <AlbumArt
        hasArtwork={mixtape.hasArtwork}
        name={mixtape.name}
        radius={0}
        size={160}
        src={artworkSource(mixtape)}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          minWidth: 'unset',
        }}
      />
      <div
        className="jb-folder-card-play"
        onClick={(e) => {
          e.stopPropagation();
          onPlay(mixtape);
        }}
        role="button"
        tabIndex={0}
        title="Play"
      >
        <Play
          fill="currentColor"
          size={18}
        />
      </div>
    </div>
    <div className="jb-folder-card-info">
      <div
        className="jb-folder-card-name"
        title={mixtape.name}
      >
        {mixtape.name}
      </div>
      <div className="jb-folder-card-meta">
        {mixtape.tracks?.length ?? 0} track
        {(mixtape.tracks?.length ?? 0) !== 1 ? 's' : ''}
        {mixtape.isPublished ? ' · 🌐' : ''}
      </div>
    </div>
  </button>
);

// ── Mixtape list row ──────────────────────────────────────────────────────────

const MixtapeListRow = ({ mixtape, onDelete, onPlay, onRename, onSelect }) => (
  <div
    className="jb-folder-row"
    onClick={() => onSelect(mixtape.id)}
  >
    <AlbumArt
      hasArtwork={mixtape.hasArtwork}
      name={mixtape.name}
      radius={5}
      size={44}
      src={artworkSource(mixtape)}
    />
    <div className="jb-folder-row-info">
      <span className="jb-folder-row-name">{mixtape.name}</span>
      <span className="jb-folder-row-meta">
        {mixtape.tracks?.length ?? 0} track
        {(mixtape.tracks?.length ?? 0) !== 1 ? 's' : ''}
        {mixtape.isPublished ? ' · 🌐' : ''}
      </span>
    </div>
    <button
      className="jb-list-play-btn"
      onClick={(e) => {
        e.stopPropagation();
        onPlay(mixtape);
      }}
      title="Play"
      type="button"
    >
      <Play size={11} />
    </button>
    <button
      className="jb-icon-btn"
      onClick={(e) => {
        e.stopPropagation();
        onRename(mixtape);
      }}
      title="Rename"
      type="button"
    >
      <Pencil size={12} />
    </button>
    <button
      className="jb-icon-btn"
      onClick={(e) => {
        e.stopPropagation();
        onDelete(mixtape.id);
      }}
      title="Delete"
      type="button"
    >
      <Trash2 size={12} />
    </button>
  </div>
);

// ── Artwork crop modal ────────────────────────────────────────────────────────

const OUTPUT_SIZE = 600;

const cropImageToBlob = (imgElement, crop) =>
  new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext('2d');
    const scaleX = imgElement.naturalWidth / imgElement.width;
    const scaleY = imgElement.naturalHeight / imgElement.height;
    context.drawImage(
      imgElement,
      crop.x * scaleX,
      crop.y * scaleY,
      crop.width * scaleX,
      crop.height * scaleY,
      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE,
    );
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
  });

const CropArtworkModal = ({ onCancel, onConfirm, src }) => {
  const [crop, setCrop] = useState(null);
  const [completedCrop, setCompletedCrop] = useState(null);
  const imgRef = useRef(null);

  const onImageLoad = (e) => {
    const { height, width } = e.currentTarget;
    const initial = centerCrop(
      makeAspectCrop({ unit: '%', width: 90 }, 1, width, height),
      width,
      height,
    );
    setCrop(initial);
    setCompletedCrop(initial);
  };

  const handleConfirm = async () => {
    if (!imgRef.current || !completedCrop) return;
    const blob = await cropImageToBlob(imgRef.current, completedCrop);
    onConfirm(blob);
  };

  return (
    <div
      className="jb-crop-overlay"
      onClick={onCancel}
    >
      <div
        className="jb-crop-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="jb-crop-header">
          <span className="jb-crop-title">Crop Artwork</span>
          <span className="jb-crop-hint">
            Drag to reposition · Resize handles to adjust
          </span>
        </div>
        <div className="jb-crop-body">
          <ReactCrop
            aspect={1}
            crop={crop}
            keepSelection
            minHeight={80}
            minWidth={80}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setCompletedCrop(c)}
          >
            <img
              alt="Crop preview"
              onLoad={onImageLoad}
              ref={imgRef}
              src={src}
              style={{ maxWidth: '100%', maxHeight: '60vh', display: 'block' }}
            />
          </ReactCrop>
        </div>
        <div className="jb-crop-actions">
          <button
            className="jb-btn"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="jb-btn jb-btn--primary"
            onClick={handleConfirm}
            type="button"
          >
            Save artwork
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Mixtape detail ────────────────────────────────────────────────────────────

const MixtapeDetail = ({ mixtape, onBack, onUpdate }) => {
  const {
    isPlaying: playerIsPlaying,
    playQueue,
    track: currentTrack,
  } = usePlayer();
  const [copied, setCopied] = useState(false);
  const [dragOverId, setDragOverId] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [cropSource, setCropSource] = useState(null);
  const dragIdRef = useRef(null);
  const artworkInputRef = useRef(null);

  const shareUrl = mixtape.publicToken
    ? `${window.location.origin}${urlBase}/mixtape/${mixtape.publicToken}`
    : null;

  const totalDur = useMemo(
    () => (mixtape.tracks ?? []).reduce((s, t) => s + (t.duration ?? 0), 0),
    [mixtape.tracks],
  );

  const handlePublish = async () => {
    try {
      if (mixtape.isPublished) await mixtapesAPI.unpublish(mixtape.id);
      else await mixtapesAPI.publish(mixtape.id);
      await onUpdate();
    } catch {
      /* ignore */
    }
  };

  const handleCopyUrl = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    });
  };

  const handleRenameCommit = async () => {
    if (!newName.trim()) {
      setRenaming(false);
      return;
    }

    try {
      await mixtapesAPI.update(mixtape.id, { name: newName.trim() });
      await onUpdate();
    } catch {
      /* ignore */
    }

    setRenaming(false);
  };

  const handleArtworkFileSelected = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCropSource(url);
    e.target.value = '';
  };

  const handleCropConfirm = async (blob) => {
    setCropSource(null);
    try {
      await mixtapesAPI.uploadArtwork(mixtape.id, blob);
      await onUpdate();
    } catch {
      /* ignore */
    }
  };

  const handleRemoveTrack = async (trackId) => {
    try {
      await mixtapesAPI.removeTrack(mixtape.id, trackId);
      await onUpdate();
    } catch {
      /* ignore */
    }
  };

  const handleClearTracks = async () => {
    try {
      await mixtapesAPI.clearTracks(mixtape.id);
      await onUpdate();
    } catch {
      /* ignore */
    }
  };

  const allQueued = useMemo(
    () => (mixtape.tracks ?? []).map(mixtapeTrackToQueue),
    [mixtape.tracks],
  );

  return (
    <div className="jb-mx-detail">
      {cropSource && (
        <CropArtworkModal
          onCancel={() => {
            URL.revokeObjectURL(cropSource);
            setCropSource(null);
          }}
          onConfirm={handleCropConfirm}
          src={cropSource}
        />
      )}
      {/* Header */}
      <div className="jb-mx-detail-header">
        <button
          className="jb-icon-btn"
          onClick={onBack}
          title="Back"
          type="button"
        >
          <svg
            fill="none"
            height="14"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="14"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        {renaming ? (
          // eslint-disable-next-line jsx-a11y/no-autofocus
          <input
            autoFocus
            className="jb-mx-rename-input"
            onBlur={handleRenameCommit}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={({ key }) => {
              if (key === 'Enter') handleRenameCommit();
              if (key === 'Escape') setRenaming(false);
            }}
            value={newName}
          />
        ) : (
          <button
            className="jb-mx-title-btn"
            onClick={() => {
              setRenaming(true);
              setNewName(mixtape.name);
            }}
            title="Click to rename"
            type="button"
          >
            {mixtape.name}
            <Pencil
              size={12}
              style={{ opacity: 0.4, marginLeft: 6 }}
            />
          </button>
        )}
      </div>

      {/* Hero */}
      <div className="jb-mx-hero">
        {/* Artwork */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className="jb-mx-artwork-wrap"
          onClick={() => artworkInputRef.current?.click()}
          title="Upload artwork"
        >
          <AlbumArt
            hasArtwork={mixtape.hasArtwork}
            name={mixtape.name}
            radius={8}
            size={160}
            src={artworkSource(mixtape)}
            style={{ width: 160, height: 160, minWidth: 160 }}
          />
          <div className="jb-mx-artwork-upload-overlay">
            <Upload size={18} />
            <span>Upload art</span>
          </div>
          <input
            accept="image/*"
            onChange={handleArtworkFileSelected}
            ref={artworkInputRef}
            style={{ display: 'none' }}
            type="file"
          />
        </div>

        {/* Info + actions */}
        <div className="jb-mx-hero-info">
          <div className="jb-mx-hero-meta">
            {mixtape.tracks?.length ?? 0} tracks
            {totalDur ? ` · ${formatSeconds(totalDur)}` : ''}
          </div>
          <div className="jb-mx-hero-actions">
            <button
              className="jb-btn jb-btn--primary"
              disabled={!mixtape.tracks?.length}
              onClick={() => playQueue(allQueued, 0)}
              type="button"
            >
              <Play size={13} /> Play
            </button>
            <button
              className="jb-btn"
              disabled={!mixtape.tracks?.length}
              onClick={() =>
                playQueue(
                  [...allQueued].sort(() => Math.random() - 0.5),
                  0,
                )
              }
              type="button"
            >
              <Shuffle size={13} /> Shuffle
            </button>
            <button
              className={`jb-btn${mixtape.isSoulseekShared ? ' jb-btn--active' : ''}`}
              onClick={async () => {
                try {
                  if (mixtape.isSoulseekShared)
                    await mixtapesAPI.soulseekUnshare(mixtape.id);
                  else await mixtapesAPI.soulseekShare(mixtape.id);
                  await onUpdate();
                } catch {
                  /* ignore */
                }
              }}
              title={
                mixtape.isSoulseekShared
                  ? 'Shared on Soulseek — click to unshare'
                  : 'Share on Soulseek network'
              }
              type="button"
            >
              <Share2 size={13} />{' '}
              {mixtape.isSoulseekShared ? 'On Soulseek' : 'Soulseek'}
            </button>
            <button
              className={`jb-btn${mixtape.isPublished ? ' jb-btn--active' : ''}`}
              onClick={handlePublish}
              type="button"
            >
              <Globe size={13} />{' '}
              {mixtape.isPublished ? 'Published' : 'Publish'}
            </button>
            {mixtape.isPublished && shareUrl && (
              <>
                {typeof navigator.share === 'function' && (
                  <button
                    className="jb-btn"
                    onClick={() =>
                      navigator
                        .share({ title: mixtape.name, url: shareUrl })
                        .catch(() => {})
                    }
                    type="button"
                  >
                    <Share2 size={13} /> Share
                  </button>
                )}
                <button
                  className="jb-btn"
                  onClick={handleCopyUrl}
                  type="button"
                >
                  {copied ? <Check size={13} /> : <Link2 size={13} />}
                  {copied ? ' Copied!' : ' Copy link'}
                </button>
              </>
            )}
            {(mixtape.tracks?.length ?? 0) > 0 && (
              <button
                className="jb-btn jb-btn--danger"
                onClick={handleClearTracks}
                type="button"
              >
                <Trash2 size={13} /> Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Track list */}
      <div className="jb-pl-tracks">
        {(!mixtape.tracks || mixtape.tracks.length === 0) && (
          <div
            className="jb-state"
            style={{ minHeight: 120 }}
          >
            No tracks yet — right-click any track to add it here.
          </div>
        )}
        {(mixtape.tracks ?? []).map((track, trackIndex) => {
          const isCurrentTrack = currentTrack?.path === track.filePath;
          return (
            <div
              className={`jb-pl-track${isCurrentTrack ? ' jb-pl-track--playing' : ''}${dragOverId === track.id ? ' jb-pl-track--drag-over' : ''}`}
              draggable
              key={track.id}
              onDoubleClick={() => playQueue(allQueued, trackIndex)}
              onDragEnd={() => {
                setDragOverId(null);
                dragIdRef.current = null;
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverId(track.id);
              }}
              onDragStart={() => {
                dragIdRef.current = track.id;
              }}
              onDrop={async (e) => {
                e.preventDefault();
                setDragOverId(null);
                const fromId = dragIdRef.current;
                if (!fromId || fromId === track.id) return;
                const tracks = mixtape.tracks ?? [];
                const fromIndex = tracks.findIndex((t) => t.id === fromId);
                const toIndex = tracks.findIndex((t) => t.id === track.id);
                if (fromIndex < 0 || toIndex < 0) return;
                const reordered = [...tracks];
                const [moved] = reordered.splice(fromIndex, 1);
                reordered.splice(toIndex, 0, moved);
                await mixtapesAPI.reorderTracks(
                  mixtape.id,
                  reordered.map((t) => t.id),
                );
                onUpdate();
              }}
            >
              <div className="jb-pl-drag-handle">
                <GripVertical size={12} />
              </div>
              <div className="jb-track-num">
                {isCurrentTrack ? (
                  <span
                    className={`jb-equalizer${playerIsPlaying ? '' : ' jb-equalizer--paused'}`}
                  >
                    <span />
                    <span />
                    <span />
                  </span>
                ) : (
                  <>
                    <span className="jb-track-num-text">{trackIndex + 1}</span>
                    <button
                      className="jb-track-play-btn"
                      onClick={() => playQueue(allQueued, trackIndex)}
                      type="button"
                    >
                      <Play size={12} />
                    </button>
                  </>
                )}
              </div>
              <AlbumArt
                hasArtwork
                name={
                  track.title ||
                  track.filePath
                    ?.split(/[/\\]/u)
                    .pop()
                    ?.replace(/\.[^.]+$/u, '') ||
                  ''
                }
                path={track.filePath}
                radius={3}
                size={32}
              />
              <div className="jb-track-info">
                <div className="jb-track-title">
                  {track.title ||
                    track.filePath
                      ?.split(/[/\\]/u)
                      .pop()
                      ?.replace(/\.[^.]+$/u, '') ||
                    '(Unknown)'}
                </div>
                {track.artist && (
                  <div className="jb-track-meta">{track.artist}</div>
                )}
              </div>
              <div className="jb-track-duration">
                {track.duration ? formatSeconds(track.duration) : '–'}
              </div>
              <button
                className="jb-pl-remove-btn"
                onClick={() => handleRemoveTrack(track.id)}
                title="Remove"
                type="button"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Mixtapes grid/list view ───────────────────────────────────────────────────

const MixtapesView = ({
  onSelectId,
  onUpdate,
  playlists,
  selectedId = null,
  viewMode,
}) => {
  const { playQueue } = usePlayer();
  const setSelectedId = onSelectId;
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [renameTarget, setRenameTarget] = useState(null); // { id, name }
  const [sortBy, setSortBy] = useState(() =>
    prefs.get('resonance-mixtapes-sort-by', 'name'),
  );
  const [sortDir, setSortDir] = useState(() =>
    prefs.get('resonance-mixtapes-sort-dir', 'asc'),
  );

  const setSort = (field) => {
    if (field === sortBy) {
      const next = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(next);
      prefs.set('resonance-mixtapes-sort-dir', next);
    } else {
      setSortBy(field);
      setSortDir('asc');
      prefs.set('resonance-mixtapes-sort-by', field);
      prefs.set('resonance-mixtapes-sort-dir', 'asc');
    }
  };

  const sorted = useMemo(() => {
    const list = [...(playlists ?? [])];
    list.sort((a, b) => {
      const cmp =
        sortBy === 'date'
          ? (a.createdAt ?? 0) - (b.createdAt ?? 0)
          : (a.name || '').localeCompare(b.name || '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [playlists, sortBy, sortDir]);

  const selected = playlists.find((p) => p.id === selectedId) ?? null;

  const handleCreate = async () => {
    if (!createName.trim()) return;
    try {
      const m = await mixtapesAPI.create({ name: createName.trim() });
      await onUpdate();
      setSelectedId(m.id);
      setCreateName('');
      setCreating(false);
    } catch {
      /* ignore */
    }
  };

  const handleDelete = async (id) => {
    try {
      await mixtapesAPI.remove(id);
      if (selectedId === id) setSelectedId(null);
      await onUpdate();
    } catch {
      /* ignore */
    }
  };

  const handleRenameCommit = async () => {
    if (!renameTarget || !renameTarget.name.trim()) {
      setRenameTarget(null);
      return;
    }

    try {
      await mixtapesAPI.update(renameTarget.id, {
        name: renameTarget.name.trim(),
      });
      await onUpdate();
    } catch {
      /* ignore */
    }

    setRenameTarget(null);
  };

  // Show detail if a mixtape is selected and still exists
  if (selected) {
    return (
      <MixtapeDetail
        key={selected.id}
        mixtape={selected}
        onBack={() => setSelectedId(null)}
        onUpdate={onUpdate}
      />
    );
  }

  const playMixtape = (m) =>
    playQueue((m.tracks ?? []).map(mixtapeTrackToQueue), 0);

  return (
    <>
      {/* Header */}
      <div className="jb-section-header">
        <span className="jb-section-title">Mixtapes</span>
        <span className="jb-section-count">{playlists.length} mixtapes</span>
        <div
          className="jb-section-controls"
          style={{ marginLeft: 'auto' }}
        >
          <button
            className="jb-btn"
            onClick={() => setCreating(true)}
            style={{ gap: 5 }}
            type="button"
          >
            <Plus size={13} /> New
          </button>
        </div>
      </div>

      {/* Sort bar */}
      {playlists.length > 0 && (
        <div className="jb-folder-sort-bar">
          <span className="jb-sort-label">Sort by</span>
          <SortButton
            field="name"
            label="Name"
            onSort={setSort}
            sortBy={sortBy}
            sortDir={sortDir}
          />
          <SortButton
            field="date"
            label={
              <>
                <Clock size={11} /> Date Added
              </>
            }
            onSort={setSort}
            sortBy={sortBy}
            sortDir={sortDir}
          />
        </div>
      )}

      {/* Inline create form */}
      {creating && (
        <div className="jb-mx-create-bar">
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            className="jb-mx-create-input"
            onBlur={() => {
              if (!createName.trim()) setCreating(false);
            }}
            onChange={({ target }) => setCreateName(target.value)}
            onKeyDown={({ key }) => {
              if (key === 'Enter') handleCreate();
              if (key === 'Escape') setCreating(false);
            }}
            placeholder="Mixtape name…"
            type="text"
            value={createName}
          />
          <button
            className="jb-btn jb-btn--primary"
            disabled={!createName.trim()}
            onClick={handleCreate}
            type="button"
          >
            Create
          </button>
          <button
            className="jb-icon-btn"
            onClick={() => setCreating(false)}
            type="button"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Inline rename form */}
      {renameTarget && (
        <div className="jb-mx-create-bar">
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            className="jb-mx-create-input"
            onBlur={handleRenameCommit}
            onChange={({ target }) =>
              setRenameTarget((r) => ({ ...r, name: target.value }))
            }
            onKeyDown={({ key }) => {
              if (key === 'Enter') handleRenameCommit();
              if (key === 'Escape') setRenameTarget(null);
            }}
            value={renameTarget.name}
          />
          <button
            className="jb-btn jb-btn--primary"
            onClick={handleRenameCommit}
            type="button"
          >
            Save
          </button>
          <button
            className="jb-icon-btn"
            onClick={() => setRenameTarget(null)}
            type="button"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Empty state */}
      {playlists.length === 0 && !creating && (
        <div className="jb-state">
          <ListMusic
            size={36}
            strokeWidth={1}
            style={{ opacity: 0.3 }}
          />
          No mixtapes yet. Create one and right-click tracks to add them.
        </div>
      )}

      {/* Tile grid */}
      {viewMode === 'tile' && sorted.length > 0 && (
        <div className="jb-folders-grid">
          {sorted.map((pl) => (
            <MixtapeCard
              key={pl.id}
              mixtape={pl}
              onPlay={playMixtape}
              onSelect={setSelectedId}
            />
          ))}
        </div>
      )}

      {/* List view */}
      {viewMode === 'list' && sorted.length > 0 && (
        <div className="jb-folder-list">
          {sorted.map((pl) => (
            <MixtapeListRow
              key={pl.id}
              mixtape={pl}
              onDelete={handleDelete}
              onPlay={playMixtape}
              onRename={(m) => setRenameTarget({ id: m.id, name: m.name })}
              onSelect={setSelectedId}
            />
          ))}
        </div>
      )}
    </>
  );
};

// ── Tracks view (full table) ──────────────────────────────────────────────────

const TracksView = ({
  alphaHandlerRef,
  onAlphaEnabled,
  onAnalyzeTracks,
  onContextMenu,
  onDeleteTracks,
  onExportTracks,
  removedPaths,
}) => {
  // Title A-Z by default. The server buckets the A-Z rail by whatever column the list is
  // ordered by, so sorting by title is what makes the rail's letters agree with the titles
  // on screen — and it's the order this view has always opened in.
  const {
    alphaApplies,
    clearLetter,
    isDefaultView,
    letter,
    reset,
    total,
    trackTableProps,
  } = usePagedTracks({}, { defaultSort: 'title' });

  useEffect(() => {
    onAlphaEnabled?.(alphaApplies);
  }, [alphaApplies, onAlphaEnabled]);

  const tracks = useMemo(
    () =>
      removedPaths.size === 0
        ? trackTableProps.tracks
        : trackTableProps.tracks.filter((t) => !removedPaths.has(t.path)),
    [removedPaths, trackTableProps.tracks],
  );

  return (
    <div className="jb-tracks-view">
      {/*
        The header's sort pills and filter drive the very same serverSort/serverFilter the
        table's own column headers do — one piece of state, two ways in — so clicking a pill
        highlights the column and vice versa. Without them this bar was the only one in the
        library with an empty right-hand side, which read as unfinished. Tracks still has no
        tile mode: dense columns are the point of it.
      */}
      <LibraryViewHeader
        filter={{
          onChange: trackTableProps.serverFilter.onChange,
          placeholder: 'Filter tracks…',
          value: trackTableProps.serverFilter.value,
        }}
        isDefault={isDefaultView}
        letter={letter}
        onClearLetter={clearLetter}
        onReset={reset}
        onSort={(field) =>
          trackTableProps.serverSort.onChange(
            field,
            field === trackTableProps.serverSort.col &&
              trackTableProps.serverSort.dir === 'asc'
              ? 'desc'
              : 'asc',
          )
        }
        sortBy={trackTableProps.serverSort.col}
        sortDir={trackTableProps.serverSort.dir}
        sorts={[
          { field: 'title', label: 'A–Z' },
          { field: 'artist', label: 'Artist' },
          { field: 'album', label: 'Album' },
          { field: 'added', label: 'Added' },
        ]}
        title="All Tracks"
        total={total}
      />
      <TrackTable
        {...trackTableProps}
        alphaHandlerRef={alphaHandlerRef}
        onAnalyzeTracks={onAnalyzeTracks}
        onContextMenu={onContextMenu}
        onDeleteTracks={onDeleteTracks}
        onExportTracks={onExportTracks}
        tracks={tracks}
      />
    </div>
  );
};

const LovedView = ({
  allTracks,
  loading,
  lovedPaths,
  onAnalyzeTracks,
  onContextMenu,
}) => {
  const activity = useLibraryActivity();
  const [confirmClear, setConfirmClear] = useState(false);
  const loved = allTracks.filter((t) => lovedPaths.has(t.path));

  const handleClearAll = async () => {
    setConfirmClear(false);
    await activity?.clearAllLoved();
  };

  return (
    <div className="jb-tracks-view">
      <div className="jb-section-header">
        <span className="jb-section-title">Loved Tracks</span>
        <span className="jb-section-count">{loved.length} tracks</span>
        <div className="jb-section-actions">
          {loved.length > 0 && !confirmClear && (
            <button
              className="jb-ph-clear-btn"
              onClick={() => setConfirmClear(true)}
              type="button"
            >
              <Trash2
                size={13}
                strokeWidth={1.75}
              />
              Clear all
            </button>
          )}
          {confirmClear && (
            <div className="jb-ph-confirm">
              <span>Remove all loved tracks?</span>
              <button
                className="jb-ph-confirm-yes"
                onClick={handleClearAll}
                type="button"
              >
                Remove
              </button>
              <button
                className="jb-ph-confirm-no"
                onClick={() => setConfirmClear(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
      <TrackTable
        loading={loading}
        onAnalyzeTracks={onAnalyzeTracks}
        onContextMenu={onContextMenu}
        tracks={loved}
      />
    </div>
  );
};

const Highlight = ({ query, text }) => {
  if (!query || !text) return text || null;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
};

const SearchSection = ({ children, count, label }) => (
  <div className="jb-search-section">
    <div className="jb-search-section-hdr">
      <span className="jb-search-section-label">{label}</span>
      {count != null && (
        <span className="jb-search-section-count">{count}</span>
      )}
    </div>
    {children}
  </div>
);

const SearchView = ({
  folders = [],
  genres = [],
  mixtapes = [],
  onAnalyzeTracks,
  onArtist,
  onContextMenu,
  onFolder,
  onGenre,
  onMixtape,
  onYear,
  query,
  years = [],
}) => {
  const q = query.toLowerCase();

  // Tracks and artists are far too many to hold client-side, so both are matched by the server.
  // Genres, years, folders and mixtapes are small enough to keep whole and filter here.
  const debouncedQuery = useDebounce(query, 250);
  const searchEnabled = Boolean(debouncedQuery);
  const libraryRevision = useLibraryActivity()?.libraryRevision ?? 0;

  const {
    items: tracks,
    loadMore,
    loading: loadingTracks,
    loadingMore,
    total: trackTotal,
  } = usePagedList(
    getTrackPage,
    { search: debouncedQuery || undefined, sort: 'title' },
    { enabled: searchEnabled, pageSize: 20, refreshToken: libraryRevision },
  );

  const { items: matchedArtists } = usePagedList(
    getArtistPage,
    { search: debouncedQuery || undefined },
    { enabled: searchEnabled, pageSize: 10 },
  );

  const matchedGenres = useMemo(() => {
    if (!q) return [];
    return genres
      .filter((g) => (g.genre || '').toLowerCase().includes(q))
      .slice(0, 10);
  }, [genres, q]);

  const matchedYears = useMemo(() => {
    if (!q) return [];
    return years.filter((y) => String(y.year || '').includes(q)).slice(0, 12);
  }, [q, years]);

  const matchedFolders = useMemo(() => {
    if (!q) return [];
    return folders
      .filter(
        (f) =>
          (f.name || '').toLowerCase().includes(q) ||
          (f.path || '').toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [folders, q]);

  const matchedMixtapes = useMemo(() => {
    if (!q) return [];
    return mixtapes
      .filter((m) => (m.name || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [mixtapes, q]);

  const matchedTracks = tracks;

  if (!query) return null;

  const hasAny =
    matchedArtists.length ||
    matchedGenres.length ||
    matchedYears.length ||
    matchedFolders.length ||
    matchedMixtapes.length ||
    matchedTracks.length;

  if (!hasAny && !loadingTracks) {
    return <div className="jb-state">No results for &quot;{query}&quot;</div>;
  }

  return (
    <div className="jb-search-results">
      {matchedArtists.length > 0 && (
        <SearchSection label="Artists">
          <div className="jb-search-chips-row">
            {matchedArtists.map((artist) => (
              <button
                className="jb-search-chip jb-search-chip--artist"
                key={artist.artist}
                onClick={() => onArtist(artist)}
                type="button"
              >
                <Highlight
                  query={q}
                  text={artist.artist}
                />
                <span className="jb-search-chip-count">
                  {artist.trackCount}
                </span>
              </button>
            ))}
          </div>
        </SearchSection>
      )}

      {matchedGenres.length > 0 && (
        <SearchSection label="Genres">
          <div className="jb-search-chips-row">
            {matchedGenres.map((genre) => (
              <button
                className="jb-search-chip jb-search-chip--genre"
                key={genre.genre}
                onClick={() => onGenre(genre)}
                type="button"
              >
                <Highlight
                  query={q}
                  text={genre.genre}
                />
                {genre.trackCount != null && (
                  <span className="jb-search-chip-count">
                    {genre.trackCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </SearchSection>
      )}

      {matchedYears.length > 0 && (
        <SearchSection label="Years">
          <div className="jb-search-chips-row">
            {matchedYears.map((year) => (
              <button
                className="jb-search-chip jb-search-chip--year"
                key={year.year}
                onClick={() => onYear(year)}
                type="button"
              >
                {year.year}
                {year.trackCount != null && (
                  <span className="jb-search-chip-count">
                    {year.trackCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </SearchSection>
      )}

      {matchedFolders.length > 0 && (
        <SearchSection label="Folders">
          <div className="jb-search-chips-row">
            {matchedFolders.map((folder) => (
              <button
                className="jb-search-chip jb-search-chip--folder"
                key={folder.path}
                onClick={() => onFolder(folder)}
                type="button"
              >
                <Folder
                  size={11}
                  style={{ flexShrink: 0 }}
                />
                <Highlight
                  query={q}
                  text={folder.name}
                />
                {folder.trackCount != null && (
                  <span className="jb-search-chip-count">
                    {folder.trackCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </SearchSection>
      )}

      {matchedMixtapes.length > 0 && (
        <SearchSection label="Mixtapes">
          <div className="jb-search-chips-row">
            {matchedMixtapes.map((mixtape) => (
              <button
                className="jb-search-chip jb-search-chip--mixtape"
                key={mixtape.id}
                onClick={() => onMixtape(mixtape)}
                type="button"
              >
                <ListMusic
                  size={11}
                  style={{ flexShrink: 0 }}
                />
                <Highlight
                  query={q}
                  text={mixtape.name}
                />
                <span className="jb-search-chip-count">
                  {mixtape.tracks?.length ?? 0}
                </span>
              </button>
            ))}
          </div>
        </SearchSection>
      )}

      {loadingTracks && (
        <div
          className="jb-state"
          style={{ minHeight: 'auto', padding: '12px 24px' }}
        >
          <div className="jb-spinner" /> Indexing tracks…
        </div>
      )}

      {!loadingTracks && matchedTracks.length > 0 && (
        <SearchSection
          count={trackTotal}
          label="Tracks"
        >
          <TrackTable
            loadingMore={loadingMore}
            onAnalyzeTracks={onAnalyzeTracks}
            onContextMenu={onContextMenu}
            onEndReached={loadMore}
            tracks={matchedTracks}
          />
        </SearchSection>
      )}
    </div>
  );
};

// ── Home view ─────────────────────────────────────────────────────────────────

const HomeRow = ({ children, count, label, onMore }) => (
  <div className="jb-home-row">
    <div className="jb-home-row-header">
      <span className="jb-home-row-title">{label}</span>
      {count != null && <span className="jb-section-count">{count}</span>}
      {onMore && (
        <button
          className="jb-home-row-more"
          onClick={onMore}
          type="button"
        >
          See all <ChevronRight size={13} />
        </button>
      )}
    </div>
    <div className="jb-home-row-content">{children}</div>
  </div>
);

const ISSUE_TYPES = [
  {
    id: 'missingKey',
    label: 'Missing Key',
    icon: KeyRound,
    analyzeDefault: { key: true, bpm: false },
  },
  {
    id: 'missingBpm',
    label: 'Missing BPM',
    icon: Activity,
    analyzeDefault: { key: false, bpm: true },
  },
  {
    id: 'missingTitle',
    label: 'No Title',
    icon: AlertTriangle,
    analyzeDefault: null,
  },
  {
    id: 'missingArtist',
    label: 'No Artist',
    icon: AlertTriangle,
    analyzeDefault: null,
  },
  {
    id: 'missingArtwork',
    label: 'No Artwork',
    icon: AlertTriangle,
    analyzeDefault: null,
  },
];

const HomeView = ({
  albumCount,
  artistCount,
  cachedCounts = {},
  issueCounts,
  mixtapes,
  onAlbumContextMenu,
  onNavigate,
  recentlyAdded,
  totalTracks,
}) => {
  const { playQueue } = usePlayer();
  const libraryActivity = useLibraryActivity();
  const lovedCount = libraryActivity?.lovedPaths?.size ?? 0;

  return (
    <div className="jb-home-view">
      {/* Stats */}
      <div className="jb-home-stats">
        <button
          className="jb-home-stat hover-fx"
          onClick={() => onNavigate(VIEWS.TRACKS)}
          type="button"
        >
          <span className="jb-home-stat-num">
            {totalTracks.toLocaleString()}
          </span>
          <span className="jb-home-stat-label">tracks</span>
        </button>
        <button
          className="jb-home-stat hover-fx"
          onClick={() => onNavigate(VIEWS.ARTISTS)}
          type="button"
        >
          <span className="jb-home-stat-num">
            {(artistCount || cachedCounts.artists || 0).toLocaleString()}
          </span>
          <span className="jb-home-stat-label">artists</span>
        </button>
        <button
          className="jb-home-stat hover-fx"
          onClick={() => onNavigate(VIEWS.ALBUMS)}
          type="button"
        >
          <span className="jb-home-stat-num">
            {(albumCount || cachedCounts.albums || 0).toLocaleString()}
          </span>
          <span className="jb-home-stat-label">albums</span>
        </button>
        <button
          className="jb-home-stat hover-fx"
          onClick={() => onNavigate(VIEWS.MIXTAPES)}
          type="button"
        >
          <span className="jb-home-stat-num">
            {mixtapes.length.toLocaleString()}
          </span>
          <span className="jb-home-stat-label">mixtapes</span>
        </button>
        {lovedCount > 0 && (
          <button
            className="jb-home-stat hover-fx"
            onClick={() => onNavigate(VIEWS.LOVED)}
            type="button"
          >
            <span className="jb-home-stat-num">
              {lovedCount.toLocaleString()}
            </span>
            <span className="jb-home-stat-label">loved</span>
          </button>
        )}
        {ISSUE_TYPES.map(({ id, label }) =>
          (issueCounts[id] ?? 0) > 0 ? (
            <button
              className="jb-home-stat hover-fx jb-home-stat--warn"
              key={id}
              onClick={() => onNavigate(VIEWS.ISSUES, { initialIssue: id })}
              type="button"
            >
              <span className="jb-home-stat-num">
                {issueCounts[id].toLocaleString()}
              </span>
              <span className="jb-home-stat-label">{label.toLowerCase()}</span>
            </button>
          ) : null,
        )}
      </div>

      {/* Recently Added */}
      {recentlyAdded.length > 0 && (
        <HomeRow
          label="Recently Added"
          onMore={() => onNavigate(VIEWS.ALBUMS)}
        >
          <div className="jb-home-album-row">
            {recentlyAdded.map((album) => (
              <button
                className="jb-home-album-card"
                key={albumKey(album)}
                onClick={() => onNavigate(VIEWS.ALBUMS, { selected: album })}
                onContextMenu={
                  onAlbumContextMenu
                    ? (e) => onAlbumContextMenu(e, album)
                    : undefined
                }
                type="button"
              >
                <div className="jb-home-album-art">
                  <AlbumArt
                    hasArtwork={album.hasArtwork}
                    name={album.album || album.artist}
                    path={album.coverPath}
                    radius={0}
                    size={130}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      minWidth: 'unset',
                    }}
                  />
                  <div
                    className="jb-folder-card-play"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const { getTracks } = await import(
                        '../../lib/musicLibrary'
                      );
                      const res = await getTracks({
                        ...albumTrackParams(album),
                        limit: 500_000,
                      });
                      playQueue((res.tracks ?? []).map(libraryTrackToQueue), 0);
                    }}
                    role="button"
                    tabIndex={0}
                    title="Play"
                  >
                    <Play
                      fill="currentColor"
                      size={14}
                    />
                  </div>
                </div>
                <div className="jb-home-album-body">
                  <div
                    className="jb-home-album-name"
                    title={album.album || '(Unknown Album)'}
                  >
                    {album.album || '(Unknown Album)'}
                  </div>
                  <div
                    className="jb-home-album-artist"
                    title={album.albumArtist || album.artist}
                  >
                    {album.albumArtist || album.artist}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </HomeRow>
      )}

      {/* Mixtapes */}
      {mixtapes.length > 0 && (
        <HomeRow
          count={mixtapes.length}
          label="Mixtapes"
          onMore={() => onNavigate(VIEWS.MIXTAPES)}
        >
          <div className="jb-home-album-row">
            {mixtapes.slice(0, 12).map((m) => (
              <button
                className="jb-home-album-card"
                key={m.id}
                onClick={() => onNavigate(VIEWS.MIXTAPES, { selectedId: m.id })}
                type="button"
              >
                <div className="jb-home-album-art">
                  <AlbumArt
                    hasArtwork={m.hasArtwork}
                    name={m.name}
                    radius={0}
                    size={130}
                    src={
                      m.hasArtwork
                        ? `${mixtapesAPI.artworkUrl(m.id)}?v=${m.updatedAt}`
                        : null
                    }
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      minWidth: 'unset',
                    }}
                  />
                  <div
                    className="jb-folder-card-play"
                    onClick={(e) => {
                      e.stopPropagation();
                      playQueue((m.tracks ?? []).map(mixtapeTrackToQueue), 0);
                    }}
                    role="button"
                    tabIndex={0}
                    title="Play"
                  >
                    <Play
                      fill="currentColor"
                      size={14}
                    />
                  </div>
                </div>
                <div className="jb-home-album-body">
                  <div
                    className="jb-home-album-name"
                    title={m.name}
                  >
                    {m.name}
                  </div>
                  <div className="jb-home-album-artist">
                    {m.tracks?.length ?? 0} track
                    {(m.tracks?.length ?? 0) !== 1 ? 's' : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </HomeRow>
      )}

      {/* Quick nav */}
      <HomeRow label="Browse">
        <div className="jb-home-nav-grid">
          {[
            { view: VIEWS.ARTISTS, label: 'Artists', icon: Users },
            { view: VIEWS.TRACKS, label: 'Tracks', icon: List },
            { view: VIEWS.FOLDERS, label: 'Folders', icon: Folder },
            { view: VIEWS.GENRES, label: 'Genres', icon: Tag },
            { view: VIEWS.YEARS, label: 'Years', icon: Calendar },
            { view: VIEWS.HISTORY, label: 'History', icon: Clock },
            { view: VIEWS.LOVED, label: 'Loved', icon: Heart },
            { view: VIEWS.ISSUES, label: 'Issues', icon: Wrench },
          ].map(({ icon: Icon, label, view }) => (
            <button
              className="jb-home-nav-card"
              key={view}
              onClick={() => onNavigate(view)}
              type="button"
            >
              <Icon
                size={20}
                strokeWidth={1.5}
              />
              {label}
            </button>
          ))}
        </div>
      </HomeRow>
    </div>
  );
};

// ── Issues view ───────────────────────────────────────────────────────────────

const IssuesView = ({
  alphaHandlerRef,
  initialIssue,
  onAlphaEnabled,
  onAnalyzeTracks,
  onContextMenu,
  onCountChange,
}) => {
  const [activeIssue, setActiveIssue] = useState(
    initialIssue ?? ISSUE_TYPES[0].id,
  );
  const [tracks, setTracks] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const { playQueue } = usePlayer();

  // Analysing from this view is the whole point of it — the missing-key and missing-BPM
  // categories are lists of tracks to analyse — so it has to reflect a finished analysis
  // rather than keep showing the rows as they were when the category was opened.
  const libraryRevision = useLibraryActivity()?.libraryRevision ?? 0;

  // Which category the rows on screen belong to — see the load effect below.
  const shownIssue = useRef(null);

  // This list is fetched whole and jumped through client-side, so the rail always applies —
  // said explicitly so a disabled rail left behind by another view doesn't persist here.
  useEffect(() => {
    onAlphaEnabled?.(true);
  }, [onAlphaEnabled]);

  useEffect(() => {
    const loadCounts = async () => {
      try {
        const results = await Promise.all(
          ISSUE_TYPES.map((t) =>
            getIssueTracks(t.id, 1)
              .then((r) => [t.id, r.total ?? 0])
              .catch(() => [t.id, 0]),
          ),
        );
        const map = Object.fromEntries(results);
        setCounts(map);
        onCountChange?.(map);
      } catch {
        // ignore
      }
    };

    loadCounts();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;

    // Switching category has nothing worth showing and blanks the table; reloading the same
    // one after a library update must not, or the list empties itself once a second for as
    // long as a scan runs.
    const changedCategory = shownIssue.current !== activeIssue;
    const load = async () => {
      if (changedCategory) {
        setLoading(true);
        setTracks([]);
      }

      try {
        const result = await getIssueTracks(activeIssue);
        if (!cancelled) {
          shownIssue.current = activeIssue;
          setTracks(result.tracks ?? []);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [activeIssue, libraryRevision]);

  const activeType = ISSUE_TYPES.find((t) => t.id === activeIssue);

  return (
    <div className="jb-issues-view">
      <div className="jb-section-header">
        <span className="jb-section-title">Library Issues</span>
      </div>

      <div className="jb-issues-chips">
        {ISSUE_TYPES.map(({ icon: Icon, id, label }) => (
          <button
            className={`jb-issue-chip${activeIssue === id ? ' jb-issue-chip--active' : ''}`}
            key={id}
            onClick={() => setActiveIssue(id)}
            type="button"
          >
            <Icon size={13} />
            {label}
            {counts[id] != null && (
              <span className="jb-issue-chip-count">
                {counts[id].toLocaleString()}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeType?.analyzeDefault && tracks.length > 0 && (
        <div className="jb-issues-actions">
          <button
            className="jb-btn jb-btn--primary"
            onClick={() => playQueue(tracks.map(libraryTrackToQueue), 0)}
            type="button"
          >
            <Play size={13} /> Play all
          </button>
          <span className="jb-issues-hint">
            Right-click any track to analyse key/BPM
          </span>
        </div>
      )}

      {loading ? (
        <div className="jb-state">
          <div className="jb-spinner" /> Loading…
        </div>
      ) : tracks.length === 0 && !loading ? (
        <div className="jb-state">
          <Check
            size={32}
            strokeWidth={1}
            style={{ opacity: 0.4 }}
          />
          No issues found for this category.
        </div>
      ) : (
        <TrackTable
          alphaHandlerRef={alphaHandlerRef}
          loading={loading}
          onAnalyzeTracks={onAnalyzeTracks}
          onContextMenu={onContextMenu}
          tracks={tracks}
        />
      )}
    </div>
  );
};

// ── Main Library component ────────────────────────────────────────────────────

const Library = () => {
  const history = useHistory();
  const location = useLocation();
  const {
    addToQueueNext,
    enqueueTrack,
    playQueue,
    queuePanelOpen,
    toggleQueuePanel,
    track: currentTrack,
  } = usePlayer();
  const libraryActivity = useLibraryActivity();
  const lovedPaths = libraryActivity?.lovedPaths ?? new Set();
  const libraryRevision = libraryActivity?.libraryRevision ?? 0;
  const syncState = libraryActivity?.syncState ?? null;
  const scanProgressPct =
    syncState?.running && syncState.progress > 0
      ? Math.round(syncState.progress * 100)
      : null;

  const [lovedTracks, setLovedTracks] = useState([]);
  const [loadingLoved, setLoadingLoved] = useState(false);

  // Only the counts, not the lists: the Artists and Albums views page their own rows now, and
  // Home just prints these two numbers. A limit=1 request answers both from X-Total-Count for
  // ~300 bytes, where fetching the lists to call .length on them cost 9MB.
  const [albumCount, setAlbumCount] = useState(0);
  const [artistCount, setArtistCount] = useState(0);
  const [libraryStats, setLibraryStats] = useState(null);
  // last-known home counts so the page doesn't flash zeros while the lists load
  const cachedCounts = useMemo(() => {
    try {
      return (
        JSON.parse(localStorage.getItem('resonance-library-home-counts')) ?? {}
      );
    } catch {
      return {};
    }
  }, []);
  const [folders, setFolders] = useState([]);
  const [genres, setGenres] = useState([]);
  const [recentlyAdded, setRecentlyAdded] = useState([]);
  const [years, setYears] = useState([]);
  const [issueCounts, setIssueCounts] = useState({});
  const [contextMenu, setContextMenu] = useState(null);
  const [folderContextMenu, setFolderContextMenu] = useState(null);
  const [albumContextMenu, setAlbumContextMenu] = useState(null);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [loadingGenres, setLoadingGenres] = useState(false);
  const [loadingYears, setLoadingYears] = useState(false);
  const [navStack, setNavStack] = useState(() => {
    try {
      const saved = sessionStorage.getItem('resonance-library-navstack');
      if (saved) return JSON.parse(saved);
    } catch {
      /* ignore */
    }

    return [{ view: VIEWS.HOME, params: {} }];
  });
  const [playlists, setPlaylists] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState(() =>
    prefs.get('resonance-library-viewmode', 'tile'),
  );
  const [tileSize, setTileSize] = useState(() =>
    Number(prefs.get('resonance-library-tilesize', 160)),
  );
  const [syncing, setSyncing] = useState(false);
  const [navOpen, setNavOpen] = useState(
    () => prefs.get('resonance-library-nav-open', true) !== false,
  );

  const toggleNav = () => {
    setNavOpen((open) => {
      const next = !open;
      prefs.set('resonance-library-nav-open', next);
      return next;
    });
  };

  const {
    containerRef: rootRef,
    onDividerMouseDown: onNavDividerMouseDown,
    width: navWidth,
  } = useResizablePanel('resonance-library-nav-width', 190, {
    min: 140,
    max: 340,
  });

  const savedScrollOffset = useMemo(() => {
    try {
      const pos = sessionStorage.getItem('resonance-library-scroll');
      return pos != null ? Number(pos) : 0;
    } catch {
      return 0;
    }
  }, []);
  const scrollRestoredRef = useRef(false);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const searchRef = useRef(null);
  const viewScrollRef = useRef(null);
  const alphaHandlerRef = useRef(null);

  // Whether the active view's current ordering makes the A-Z rail meaningful. The views own
  // their own sort state, so each reports it rather than Library trying to track theirs.
  const [alphaEnabled, setAlphaEnabled] = useState(true);
  const current = navStack[navStack.length - 1];
  const activeView = current.view;

  const reloadMixtapes = useCallback(async () => {
    try {
      const data = await mixtapesAPI.getAll();
      setPlaylists(data ?? []);
    } catch {
      // ignore
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    // apply each result as it arrives so the cheap stats call (track count)
    // isn't held up behind the other fetches
    const apply = (promise, set) =>
      promise.then((data) => {
        if (isMountedRef.current && data != null) set(data);
      });
    try {
      await Promise.all([
        apply(getArtistPage({ limit: 1 }), (p) => setArtistCount(p.total)),
        apply(getAlbumPage({ limit: 1 }), (p) => setAlbumCount(p.total)),
        apply(getGenres(), setGenres),
        apply(getRecentlyAdded(16), setRecentlyAdded),
        apply(getLibraryStats(), setLibraryStats).catch(() => {}),
      ]);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!libraryStats?.total || artistCount === 0) return;
    try {
      localStorage.setItem(
        'resonance-library-home-counts',
        JSON.stringify({
          albums: albumCount,
          artists: artistCount,
          total: libraryStats.total,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [albumCount, artistCount, libraryStats]);

  useEffect(() => {
    loadInitialData();
    reloadMixtapes();
  }, [loadInitialData, reloadMixtapes]);

  useEffect(() => {
    if (libraryRevision === 0) return;
    setGenres([]);
    setYears([]);
    setFolders([]);
    loadInitialData();
  }, [libraryRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      sessionStorage.setItem(
        'resonance-library-navstack',
        JSON.stringify(navStack),
      );
    } catch {
      /* ignore */
    }
  }, [navStack]);

  const getLibraryScrollElement = useCallback(() => {
    const outer = viewScrollRef.current;
    if (!outer) return null;
    return outer.querySelector('.jb-track-table') || outer;
  }, []);

  useEffect(() => {
    const onScroll = (e) => {
      const element = e.target;
      if (
        element === viewScrollRef.current ||
        element.classList?.contains('jb-track-table')
      ) {
        try {
          sessionStorage.setItem(
            'resonance-library-scroll',
            String(element.scrollTop),
          );
        } catch {
          /* ignore */
        }
      }
    };

    document.addEventListener('scroll', onScroll, {
      passive: true,
      capture: true,
    });
    return () =>
      document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  useEffect(() => {
    if (scrollRestoredRef.current || !savedScrollOffset) return undefined;
    let rafId;
    const tryRestore = () => {
      const element = getLibraryScrollElement();
      if (!element) {
        rafId = requestAnimationFrame(tryRestore);
        return;
      }

      // Only retry while content hasn't loaded yet (no scrollable area).
      // Once content exists, set once and stop — avoids fighting the user when
      // savedScrollOffset exceeds the current view's max scroll height.
      if (element.scrollHeight <= element.clientHeight) {
        rafId = requestAnimationFrame(tryRestore);
        return;
      }

      element.scrollTop = savedScrollOffset;
      scrollRestoredRef.current = true;
    };

    rafId = requestAnimationFrame(tryRestore);
    return () => cancelAnimationFrame(rafId);
  }, [getLibraryScrollElement, savedScrollOffset]);

  useEffect(() => {
    const hub = createMixtapesHubConnection();
    hub.on('UPDATED', reloadMixtapes);
    hub.start().catch(() => {});
    return () => {
      hub.stop();
    };
  }, [reloadMixtapes]);

  // Loved view fetches only its tracks (resolved server-side) rather than the whole library.
  // Refetch each time the view opens so newly-loved tracks appear, and whenever the library
  // reports a change so an analysis finishing fills in these rows' key, BPM and LUFS too.
  useEffect(() => {
    if (activeView === VIEWS.LOVED && !loadingLoved) {
      const loadLoved = async () => {
        // Only when there is nothing on screen yet: the spinner replaces the rows, and a
        // library update during a scan would otherwise flash it repeatedly.
        if (lovedTracks.length === 0) {
          setLoadingLoved(true);
        }

        try {
          const { getLovedTracks } = await import('../../lib/musicLibrary');
          setLovedTracks(await getLovedTracks());
        } catch {
          // ignore
        } finally {
          setLoadingLoved(false);
        }
      };

      loadLoved();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, libraryRevision]);

  useEffect(() => {
    if (activeView === VIEWS.GENRES && genres.length === 0 && !loadingGenres) {
      const load = async () => {
        setLoadingGenres(true);
        try {
          const data = await getGenres();
          setGenres(data ?? []);
        } catch {
          // ignore
        } finally {
          setLoadingGenres(false);
        }
      };

      load();
    }
  }, [activeView, genres.length, loadingGenres]);

  useEffect(() => {
    if (
      (activeView === VIEWS.YEARS || activeView === VIEWS.SEARCH) &&
      years.length === 0 &&
      !loadingYears
    ) {
      const load = async () => {
        setLoadingYears(true);
        try {
          const data = await getYears();
          setYears(data ?? []);
        } catch {
          // ignore
        } finally {
          setLoadingYears(false);
        }
      };

      load();
    }
  }, [activeView, years.length, loadingYears]);

  useEffect(() => {
    if (
      (activeView === VIEWS.FOLDERS || activeView === VIEWS.SEARCH) &&
      folders.length === 0 &&
      !loadingFolders
    ) {
      const load = async () => {
        setLoadingFolders(true);
        try {
          const data = await getFolders();
          setFolders(data ?? []);
        } catch {
          // ignore
        } finally {
          setLoadingFolders(false);
        }
      };

      load();
    }
  }, [activeView, folders.length, loadingFolders]);

  // ── Navigation helpers ───────────────────────────────────────────────────

  const navigate = useCallback((view, parameters = {}) => {
    setNavStack((stack) => [...stack, { view, params: parameters }]);
    setSearchQuery('');
  }, []);

  const goBack = useCallback(() => {
    setNavStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  }, []);

  const navTo = useCallback((view, parameters = {}) => {
    setNavStack([{ view, params: parameters }]);
    setSearchQuery('');
  }, []);

  const goToArtist = useCallback((artist) => {
    setNavStack([{ view: VIEWS.ARTISTS, params: { selected: artist } }]);
    setSearchQuery('');
  }, []);

  const goToGenre = useCallback((genre) => {
    setNavStack([{ view: VIEWS.GENRES, params: { selected: genre.genre } }]);
    setSearchQuery('');
  }, []);

  const goToYear = useCallback((year) => {
    setNavStack([{ view: VIEWS.YEARS, params: { selected: year.year } }]);
    setSearchQuery('');
  }, []);

  const goToFolder = useCallback((folder) => {
    setNavStack([
      { view: VIEWS.FOLDERS, params: { initialFolder: folder.path } },
    ]);
    setSearchQuery('');
  }, []);

  const goToMixtape = useCallback((mixtape) => {
    setNavStack([{ view: VIEWS.MIXTAPES, params: { selectedId: mixtape.id } }]);
    setSearchQuery('');
  }, []);

  // Handle navigation requests from the media player (via router state)
  useEffect(() => {
    const nav = location.state?.libraryNav;
    if (!nav) return;
    history.replace(location.pathname, null);
    if (nav.type === 'folder' && nav.folder) {
      setNavStack([
        { view: VIEWS.FOLDERS, params: { initialFolder: nav.folder } },
      ]);
      setSearchQuery('');
    } else if (nav.type === 'artist' && nav.artist) {
      setNavStack([{ view: VIEWS.ARTISTS, params: { selected: nav.artist } }]);
      setSearchQuery('');
    }
  }, [location.state, location.pathname, history]);

  // ── Search ───────────────────────────────────────────────────────────────

  const handleSearchChange = ({ target }) => {
    const searchValue = target.value;
    setSearchQuery(searchValue);
    if (searchValue && activeView !== VIEWS.SEARCH) {
      setNavStack((stack) => {
        const last = stack[stack.length - 1];
        if (last.view === VIEWS.SEARCH) return stack;
        return [...stack, { view: VIEWS.SEARCH, params: {} }];
      });
    } else if (!searchValue && activeView === VIEWS.SEARCH) {
      goBack();
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    if (activeView === VIEWS.SEARCH) goBack();
    searchRef.current?.focus();
  };

  const handleToggleViewMode = () => {
    setViewMode((previous) => {
      const next = previous === 'tile' ? 'list' : 'tile';
      prefs.set('resonance-library-viewmode', next);
      return next;
    });
  };

  const hasTileList = [
    VIEWS.ARTISTS,
    VIEWS.ALBUMS,
    VIEWS.GENRES,
    VIEWS.YEARS,
    VIEWS.FOLDERS,
    VIEWS.MIXTAPES,
  ].includes(activeView);

  const tileListDisabled =
    (activeView === VIEWS.MIXTAPES && Boolean(current.params?.selectedId)) ||
    (activeView === VIEWS.ALBUMS && Boolean(current.params?.selected));

  // Years is deliberately absent: years are numeric, so every entry buckets to '#' and the
  // rail would be permanently dead. Every other collection view has an alphabet.
  const showAlphaStrip =
    activeView === VIEWS.ARTISTS ||
    activeView === VIEWS.TRACKS ||
    activeView === VIEWS.ISSUES ||
    activeView === VIEWS.GENRES ||
    (activeView === VIEWS.ALBUMS && !current.params?.selected) ||
    (activeView === VIEWS.FOLDERS && viewMode === 'list');

  const handleRefresh = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await triggerSync();

      for (let index = 0; index < 120; index++) {
        await new Promise((resolve) => {
          setTimeout(resolve, 1_500);
        });
        const state = await getSyncState();
        if (!state.running) break;
      }

      setGenres([]);
      setYears([]);
      setFolders([]);
      await loadInitialData();
    } catch {
      // ignore
    } finally {
      setSyncing(false);
    }
  }, [loadInitialData, syncing]);

  // ── Context menu ─────────────────────────────────────────────────────────

  const openContextMenu = useCallback((mouseEvent, track) => {
    mouseEvent.preventDefault();
    setFolderContextMenu(null);
    setAlbumContextMenu(null);
    setContextMenu({ x: mouseEvent.clientX, y: mouseEvent.clientY, track });
  }, []);

  const handleAddFolderToMixtape = async (folder, mixtapeId) => {
    try {
      const { getTracks } = await import('../../lib/musicLibrary');
      const parameters = { folder: folder.path, limit: 500_000 };
      const result = await getTracks(parameters);
      await Promise.allSettled(
        (result.tracks ?? []).map((t) =>
          mixtapesAPI.addTrack(mixtapeId, t.path),
        ),
      );
      await reloadMixtapes();
    } catch {
      /* ignore */
    }
  };

  const handleCreateMixtapeFromFolder = async (folder, name) => {
    try {
      const mixtape = await mixtapesAPI.create({ name });
      await handleAddFolderToMixtape(folder, mixtape.id);
    } catch {
      /* ignore */
    }
  };

  const handleAddAlbumToMixtape = async (album, mixtapeId) => {
    try {
      const { getTracks } = await import('../../lib/musicLibrary');
      const result = await getTracks({
        ...albumTrackParams(album),
        limit: 500_000,
      });
      await Promise.allSettled(
        (result.tracks ?? []).map((t) =>
          mixtapesAPI.addTrack(mixtapeId, t.path),
        ),
      );
      await reloadMixtapes();
    } catch {
      /* ignore */
    }
  };

  const handleCreateMixtapeFromAlbum = async (album, name) => {
    try {
      const mixtape = await mixtapesAPI.create({ name });
      await handleAddAlbumToMixtape(album, mixtape.id);
    } catch {
      /* ignore */
    }
  };

  const handleAddAlbumToQueue = useCallback(
    async (album) => {
      try {
        const { getTracks } = await import('../../lib/musicLibrary');
        const result = await getTracks({
          ...albumTrackParams(album),
          limit: 500_000,
        });
        for (const t of (result.tracks ?? []).map(libraryTrackToQueue))
          enqueueTrack(t);
      } catch {
        /* ignore */
      }
    },
    [enqueueTrack],
  );

  const handleDeleteAlbum = useCallback(async (album) => {
    try {
      const { getTracks } = await import('../../lib/musicLibrary');
      const result = await getTracks({
        ...albumTrackParams(album),
        limit: 500_000,
      });
      await Promise.allSettled(
        (result.tracks ?? []).map((t) => deleteTrack(t.path)),
      );
    } catch {
      /* ignore */
    }
  }, []);

  const handleAnalyzeAlbum = useCallback(async (album, { metrics }) => {
    try {
      const { getTracks } = await import('../../lib/musicLibrary');
      const result = await getTracks({
        ...albumTrackParams(album),
        limit: 500_000,
      });
      const paths = (result.tracks ?? []).map((t) => t.path);
      if (paths.length === 0) {
        toast.info('No tracks to analyse in this album.');
        return;
      }

      // One request for the whole album — one scan, one queue.
      await analyzeTrack(paths, { metrics });
      toast.success(
        `Analysis started for ${paths.length} track${paths.length === 1 ? '' : 's'} in "${album.album || 'album'}"`,
      );
    } catch (error) {
      const message =
        error?.response?.data || error?.message || 'Analysis failed';
      toast.error(String(message));
    }
  }, []);

  const handleShowAlbumInFolder = useCallback(async (album) => {
    try {
      const { getTracks } = await import('../../lib/musicLibrary');
      const result = await getTracks({ ...albumTrackParams(album), limit: 1 });
      const first = result.tracks?.[0];
      if (first?.directory) {
        setNavStack([
          { view: VIEWS.FOLDERS, params: { initialFolder: first.directory } },
        ]);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const openFolderContextMenu = useCallback((mouseEvent, folder) => {
    mouseEvent.preventDefault();
    setContextMenu(null);
    setAlbumContextMenu(null);
    setFolderContextMenu({
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
      folder,
    });
  }, []);

  const openAlbumContextMenu = useCallback((mouseEvent, album) => {
    mouseEvent.preventDefault();
    setContextMenu(null);
    setFolderContextMenu(null);
    setAlbumContextMenu({
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
      album,
    });
  }, []);

  const handleAddToPlaylist = async (playlistId, track) => {
    const filePath = track.path ?? track.localRelativePath;
    const playlist = playlists.find((p) => p.id === playlistId);
    if (playlist?.tracks?.some((t) => t.filePath === filePath)) {
      toast.warn(`Already in "${playlist.name}"`);
      return;
    }

    try {
      await mixtapesAPI.addTrack(playlistId, filePath);
      await reloadMixtapes();
    } catch (error) {
      if (error?.response?.status === 409)
        toast.warn(`Already in "${playlist?.name ?? 'mixtape'}"`);
    }
  };

  const handleCreatePlaylistFromTrack = async (name, track) => {
    try {
      const mixtape = await mixtapesAPI.create({ name });
      await mixtapesAPI.addTrack(
        mixtape.id,
        track.path ?? track.localRelativePath,
      );
      await reloadMixtapes();
    } catch {
      // ignore
    }
  };

  const handleSearchSimilar = async (cleanTitle) => {
    try {
      await createSearch({ id: uuidv4(), searchText: `"${cleanTitle}"` });
    } catch {
      // not critical
    }

    history.push('/searches');
  };

  const handleSearchRemixes = async (cleanTitle) => {
    try {
      await createSearch({ id: uuidv4(), searchText: `"${cleanTitle}" remix` });
    } catch {
      // not critical
    }

    history.push('/searches');
  };

  const handleSearchArtist = async (artist) => {
    try {
      await createSearch({ id: uuidv4(), searchText: artist });
    } catch {
      // not critical
    }

    history.push('/searches');
  };

  const handleAnalyzeTrack = useCallback(async (track, { metrics }) => {
    try {
      await analyzeTrack(track.path, { metrics });
      toast.success(`Analysis started for "${track.title || track.filename}"`);
    } catch (error) {
      const message =
        error?.response?.data || error?.message || 'Analysis failed';
      toast.error(String(message));
    }
  }, []);

  // Fed by TrackTable's own multi-select, so this operates on whatever tracks the view
  // currently has loaded/selected rather than re-deriving a folder/album scope.
  const handleAnalyzeTracks = useCallback(async (paths) => {
    if (!paths.length) return;
    try {
      await analyzeTrack(paths, { metrics: ALL_METRICS });
      toast.success(
        `Analysis started for ${paths.length} ${paths.length === 1 ? 'track' : 'tracks'}`,
      );
    } catch (error) {
      const message =
        error?.response?.data || error?.message || 'Analysis failed';
      toast.error(String(message));
    }
  }, []);

  const handleAnalyzeFolder = useCallback(async (folder, { metrics }) => {
    try {
      await analyzeFolder(folder.path, { metrics });
      toast.success(`Analysis started for "${folder.name}"`);
    } catch (error) {
      const message =
        error?.response?.data || error?.message || 'Analysis failed';
      toast.error(String(message));
    }
  }, []);

  const USB_EXPORT_TOAST_ID = 'usb-export';

  const runBulkUsbExport = useCallback(async (tracks) => {
    if (tracks.length === 0) {
      toast.info('Nothing to export.');
      return;
    }

    toast.info(`Exporting… (0/${tracks.length})`, {
      autoClose: false,
      toastId: USB_EXPORT_TOAST_ID,
    });
    const result = await exportTracksToUsb(tracks, (done, total) =>
      toast.update(USB_EXPORT_TOAST_ID, {
        render: `Exporting… (${done}/${total})`,
      }),
    );
    toast.update(USB_EXPORT_TOAST_ID, {
      autoClose: 4_000,
      render: result.ok
        ? `Exported ${result.exported}, skipped ${result.skipped}, failed ${result.failed}.`
        : result.reason ?? 'Export failed.',
      type: result.ok ? toast.TYPE.SUCCESS : toast.TYPE.ERROR,
    });
  }, []);

  const handleExportTrack = useCallback(async (track) => {
    const result = await exportTrackToUsb(track);
    if (result.ok) toast.success(result.message ?? 'Done');
    else toast.error(result.reason ?? 'Export failed.');
  }, []);

  const handleExportFolder = useCallback(
    async (folder) => {
      const { getTracks } = await import('../../lib/musicLibrary');
      const result = await getTracks({ folder: folder.path, limit: 500_000 });
      await runBulkUsbExport(result.tracks ?? []);
    },
    [runBulkUsbExport],
  );

  const handleExportAlbum = useCallback(
    async (album) => {
      const { getTracks } = await import('../../lib/musicLibrary');
      const result = await getTracks({
        ...albumTrackParams(album),
        limit: 500_000,
      });
      await runBulkUsbExport(result.tracks ?? []);
    },
    [runBulkUsbExport],
  );

  const handleExportTracks = useCallback(
    async (tracks) => {
      await runBulkUsbExport(tracks);
    },
    [runBulkUsbExport],
  );

  // Paths removed (or renamed away) during this session. The lists are server-paged, so a
  // deleted row would otherwise come straight back on the next page fetch — the backend has
  // not necessarily reindexed yet. Views filter their window through this.
  const [removedPaths, setRemovedPaths] = useState(() => new Set());
  const forgetPaths = useCallback((paths) => {
    setRemovedPaths((previous) => new Set([...previous, ...paths]));
  }, []);

  const [renamingFolder, setRenamingFolder] = useState(null); // { folder, name }
  const [renamingTrack, setRenamingTrack] = useState(null); // { track, name }

  const handleDeleteTrack = useCallback(
    async (track) => {
      try {
        await deleteTrack(track.path);
        toast.success(`Deleted "${track.title || track.filename}"`);
        forgetPaths([track.path]);
      } catch (error) {
        const message =
          error?.response?.data || error?.message || 'Delete failed';
        toast.error(String(message));
      }
    },
    [forgetPaths],
  );

  const handleDeleteTracks = useCallback(
    async (paths) => {
      const result = await deleteTrackBatchLocal(paths);
      const n = result?.deleted ?? paths.length;
      toast.success(`Deleted ${n} ${n === 1 ? 'track' : 'tracks'}`);
      forgetPaths(paths);
    },
    [forgetPaths],
  );

  const handleDeleteFolder = useCallback(async (folder) => {
    try {
      await deleteFolder(folder.path);
      toast.success(`Deleted folder "${folder.name}"`);
      setFolders((previous) =>
        previous.filter((f) => !f.path.startsWith(folder.path)),
      );
    } catch (error) {
      const message =
        error?.response?.data || error?.message || 'Delete failed';
      toast.error(String(message));
    }
  }, []);

  const handleCommitRenameFolder = useCallback(async () => {
    if (!renamingFolder) return;
    const { folder, name } = renamingFolder;
    setRenamingFolder(null);
    if (!name.trim() || name.trim() === folder.name) return;
    try {
      await renameFolder(folder.path, name.trim());
      // Derive new path: replace the old leaf name with the new one
      const separator = folder.path.includes('/') ? '/' : '\\';
      const lastSeparator = Math.max(
        folder.path.lastIndexOf('/'),
        folder.path.lastIndexOf('\\'),
      );
      const parentPrefix =
        lastSeparator >= 0 ? folder.path.slice(0, lastSeparator + 1) : '';
      const newFolderPath = parentPrefix + name.trim();
      setFolders((previous) =>
        previous.map((f) => {
          if (
            f.path !== folder.path &&
            !f.path.startsWith(folder.path + separator)
          )
            return f;
          const newPath = newFolderPath + f.path.slice(folder.path.length);
          return {
            ...f,
            path: newPath,
            name: f.path === folder.path ? name.trim() : f.name,
          };
        }),
      );
    } catch (error) {
      const message =
        error?.response?.data || error?.message || 'Rename failed';
      toast.error(String(message));
    }
  }, [renamingFolder]);

  const handleCommitRenameTrack = useCallback(async () => {
    if (!renamingTrack) return;
    const { name, track } = renamingTrack;
    setRenamingTrack(null);
    if (!name.trim() || name.trim() === track.filename) return;
    try {
      await renameTrack(track.path, name.trim());
      // Drop the row rather than patching its path in place: the old path is dead, and the
      // renamed track reappears under its new name on the next fetch of this list.
      forgetPaths([track.path]);
    } catch (error) {
      const message =
        error?.response?.data || error?.message || 'Rename failed';
      toast.error(String(message));
    }
  }, [forgetPaths, renamingTrack]);

  const handleShowInFolders = useCallback((directory) => {
    setNavStack([
      { view: VIEWS.FOLDERS, params: { initialFolder: directory } },
    ]);
  }, []);

  // ── Auto Mix ─────────────────────────────────────────────────────────────

  const handleAutoMix = useCallback(
    async (seedTrack) => {
      try {
        const { getKeyedTracks } = await import('../../lib/musicLibrary');
        const pool = await getKeyedTracks();
        const seed = {
          bpm: seedTrack.bpm,
          key: seedTrack.key,
          path: seedTrack.path || seedTrack.localRelativePath,
        };
        if (!seed.key) {
          toast.warn('This track has no key tag — run Track Analysis first');
          return;
        }

        const { buildAutoMix } = await import('../../lib/autoMix');
        const mix = buildAutoMix(seed, pool);
        if (!mix.length) {
          toast.warn('No harmonically compatible tracks found in library');
          return;
        }

        playQueue(
          mix.map((t) => ({
            album: t.album,
            artist: t.artist,
            bpm: t.bpm,
            filename: t.path,
            hasArtwork: t.hasArtwork,
            key: t.key,
            length: t.duration,
            localRelativePath: t.path,
            path: t.path,
            title: t.title || t.filename,
          })),
          0,
        );
        toast.success(`Harmonic mix ready · ${mix.length} tracks`);
      } catch {
        toast.error('Auto Mix failed');
      }
    },
    [playQueue],
  );

  // Bounded window rather than the whole scope: "play this folder" on the 24,922-track folder
  // used to pull ~15MB to build a queue nobody reaches the end of.
  const playQuery = useCallback(
    async (parameters) => {
      const { getTracks } = await import('../../lib/musicLibrary');
      const result = await getTracks({ ...parameters, limit: 2_000 });
      playQueue((result.tracks ?? []).map(libraryTrackToQueue), 0);
    },
    [playQueue],
  );

  // ── Render current view ───────────────────────────────────────────────────

  const renderView = () => {
    switch (activeView) {
      case VIEWS.HOME:
        return (
          <HomeView
            albumCount={albumCount}
            artistCount={artistCount}
            cachedCounts={cachedCounts}
            issueCounts={issueCounts}
            mixtapes={playlists}
            onAlbumContextMenu={openAlbumContextMenu}
            onNavigate={(view, parameters = {}) => navTo(view, parameters)}
            recentlyAdded={recentlyAdded}
            totalTracks={libraryStats?.total ?? cachedCounts.total ?? 0}
          />
        );

      case VIEWS.ALBUMS: {
        const selectedAlbum = current.params?.selected ?? null;
        if (selectedAlbum) {
          return (
            <AlbumDetail
              album={selectedAlbum}
              onAnalyzeTracks={handleAnalyzeTracks}
              onArtist={(artist) => goToArtist(artist)}
              onBack={() =>
                setNavStack((s) => {
                  const top = s[s.length - 1];
                  return [...s.slice(0, -1), { ...top, params: {} }];
                })
              }
              onContextMenu={openContextMenu}
            />
          );
        }

        return (
          <AlbumsView
            alphaHandlerRef={alphaHandlerRef}
            onAlbum={(album) =>
              setNavStack((s) => {
                const top = s[s.length - 1];
                return [
                  ...s.slice(0, -1),
                  { ...top, params: { selected: album } },
                ];
              })
            }
            onAlbumContextMenu={openAlbumContextMenu}
            onAlphaEnabled={setAlphaEnabled}
            onPlayAlbum={(album) => playQuery(albumTrackParams(album))}
            onShuffleAlbum={(album) => playQuery(albumTrackParams(album))}
            scrollContainerRef={viewScrollRef}
            tileSize={tileSize}
            viewMode={viewMode}
          />
        );
      }

      case VIEWS.ISSUES:
        return (
          <IssuesView
            alphaHandlerRef={alphaHandlerRef}
            initialIssue={current.params?.initialIssue}
            onAlphaEnabled={setAlphaEnabled}
            onAnalyzeTracks={handleAnalyzeTracks}
            onContextMenu={openContextMenu}
            onCountChange={setIssueCounts}
          />
        );

      case VIEWS.ARTISTS:
        return (
          <ArtistsView
            alphaHandlerRef={alphaHandlerRef}
            onAlphaEnabled={setAlphaEnabled}
            onAnalyzeTracks={handleAnalyzeTracks}
            onContextMenu={openContextMenu}
            onPlayArtist={(a) => playQuery({ artist: a.artist })}
            scrollContainerRef={viewScrollRef}
            tileSize={tileSize}
            viewMode={viewMode}
          />
        );

      case VIEWS.TRACKS:
        return (
          <TracksView
            alphaHandlerRef={alphaHandlerRef}
            onAlphaEnabled={setAlphaEnabled}
            onAnalyzeTracks={handleAnalyzeTracks}
            onContextMenu={openContextMenu}
            onDeleteTracks={handleDeleteTracks}
            onExportTracks={
              isUsbExportSupported() ? handleExportTracks : undefined
            }
            removedPaths={removedPaths}
          />
        );

      case VIEWS.LOVED:
        return (
          <LovedView
            allTracks={lovedTracks}
            loading={loadingLoved}
            lovedPaths={lovedPaths}
            onAnalyzeTracks={handleAnalyzeTracks}
            onContextMenu={openContextMenu}
          />
        );

      case VIEWS.HISTORY:
        return <PlayHistoryView onContextMenu={openContextMenu} />;

      case VIEWS.GENRES:
        return (
          <GenreView
            alphaHandlerRef={alphaHandlerRef}
            genres={genres}
            initialSelected={current.params?.selected ?? null}
            loading={loadingGenres}
            onAlphaEnabled={setAlphaEnabled}
            onAnalyzeTracks={handleAnalyzeTracks}
            onContextMenu={openContextMenu}
            onPlayGenre={(g) => playQuery({ genre: g.genre })}
            tileSize={tileSize}
            viewMode={viewMode}
          />
        );

      case VIEWS.YEARS:
        return (
          <YearView
            initialSelected={current.params?.selected ?? null}
            loading={loadingYears}
            onAnalyzeTracks={handleAnalyzeTracks}
            onContextMenu={openContextMenu}
            onPlayYear={(y) => playQuery({ year: y.year })}
            tileSize={tileSize}
            viewMode={viewMode}
            years={years}
          />
        );

      case VIEWS.FOLDERS:
        return (
          <FolderView
            alphaHandlerRef={alphaHandlerRef}
            folders={folders}
            initialFolder={current.params?.initialFolder ?? null}
            loading={loadingFolders}
            mixtapes={playlists}
            onAlphaEnabled={setAlphaEnabled}
            onAnalyzeTracks={handleAnalyzeTracks}
            onContextMenu={openContextMenu}
            onDeleteTracks={handleDeleteTracks}
            onFolderContextMenu={openFolderContextMenu}
            onPlayFolder={(path) => playQuery({ folder: path })}
            removedPaths={removedPaths}
            scrollContainerRef={viewScrollRef}
            tileSize={tileSize}
            viewMode={viewMode}
          />
        );

      case VIEWS.MIXTAPES:
        return (
          <MixtapesView
            onSelectId={(id) =>
              setNavStack((s) => {
                const top = s[s.length - 1];
                return [
                  ...s.slice(0, -1),
                  { ...top, params: { ...top.params, selectedId: id } },
                ];
              })
            }
            onUpdate={reloadMixtapes}
            playlists={playlists}
            selectedId={current.params?.selectedId ?? null}
            viewMode={viewMode}
          />
        );

      case VIEWS.SEARCH:
        return (
          <SearchView
            folders={folders}
            genres={genres}
            mixtapes={playlists}
            onAnalyzeTracks={handleAnalyzeTracks}
            onArtist={goToArtist}
            onContextMenu={openContextMenu}
            onFolder={goToFolder}
            onGenre={goToGenre}
            onMixtape={goToMixtape}
            onYear={goToYear}
            query={searchQuery}
            years={years}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div
      className="jb-root"
      ref={rootRef}
    >
      <nav
        className={`jb-nav${navOpen ? '' : ' jb-nav--collapsed'}`}
        style={
          navOpen
            ? { width: navWidth, minWidth: navWidth, maxWidth: navWidth }
            : undefined
        }
      >
        <div className="jb-nav-section">Library</div>
        {NAV_ITEMS.map(({ icon: Icon, id, label }) => (
          <button
            className={`jb-nav-item hover-fx${activeView === id ? ' jb-nav-item--active' : ''}`}
            key={id}
            onClick={() => navTo(id)}
            title={navOpen ? undefined : label}
            type="button"
          >
            <Icon
              size={15}
              strokeWidth={1.75}
            />
            {navOpen && label}
          </button>
        ))}
      </nav>

      {navOpen && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
          className="jb-panel-divider"
          onMouseDown={onNavDividerMouseDown}
        />
      )}

      <div className="jb-content">
        <div className="jb-topbar">
          <button
            className={`jb-icon-btn hover-fx${navOpen ? ' jb-icon-btn--active' : ''}`}
            onClick={toggleNav}
            title={navOpen ? 'Hide library pane' : 'Show library pane'}
            type="button"
          >
            <PanelLeft size={15} />
          </button>

          <div
            className="jb-search-wrap"
            ref={searchRef}
          >
            <Search
              className="jb-search-icon"
              size={14}
            />
            <input
              className="jb-search"
              onChange={handleSearchChange}
              placeholder="Search library…"
              type="text"
              value={searchQuery}
            />
            {searchQuery && (
              <button
                className="jb-search-clear hover-fx"
                onClick={clearSearch}
                type="button"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="jb-topbar-right">
            <button
              className={`jb-icon-btn hover-fx${currentTrack?.key ? ' jb-icon-btn--active' : ''}`}
              onClick={() =>
                currentTrack
                  ? handleAutoMix(currentTrack)
                  : navigate(VIEWS.SEARCH)
              }
              title={
                currentTrack?.key
                  ? `Auto Mix from ${currentTrack.key}`
                  : 'Auto Mix (play a keyed track first)'
              }
              type="button"
            >
              <Wand2 size={15} />
            </button>

            <button
              className={`jb-icon-btn hover-fx${queuePanelOpen ? ' jb-icon-btn--active' : ''}`}
              onClick={toggleQueuePanel}
              title="Toggle queue"
              type="button"
            >
              <ListMusic size={15} />
            </button>

            <button
              className="jb-icon-btn hover-fx"
              disabled={syncing}
              onClick={handleRefresh}
              title="Refresh library"
              type="button"
            >
              <RefreshCw
                className={syncing ? 'jb-spin' : ''}
                size={15}
              />
            </button>

            {hasTileList && (
              <div className="jb-btn-group">
                <button
                  className="jb-icon-btn hover-fx"
                  disabled={tileListDisabled}
                  onClick={handleToggleViewMode}
                  title={
                    viewMode === 'tile'
                      ? 'Switch to list view'
                      : 'Switch to tile view'
                  }
                  type="button"
                >
                  {viewMode === 'tile' ? (
                    <LayoutGrid size={15} />
                  ) : (
                    <List size={15} />
                  )}
                </button>
                <button
                  className="jb-icon-btn hover-fx"
                  disabled={
                    tileListDisabled || viewMode !== 'tile' || tileSize <= 120
                  }
                  onClick={() => {
                    const next = Math.max(120, tileSize - 30);
                    setTileSize(next);
                    prefs.set('resonance-library-tilesize', next);
                  }}
                  title="Smaller tiles"
                  type="button"
                >
                  <ZoomOut size={15} />
                </button>
                <button
                  className="jb-icon-btn hover-fx"
                  disabled={
                    tileListDisabled || viewMode !== 'tile' || tileSize >= 300
                  }
                  onClick={() => {
                    const next = Math.min(300, tileSize + 30);
                    setTileSize(next);
                    prefs.set('resonance-library-tilesize', next);
                  }}
                  title="Larger tiles"
                  type="button"
                >
                  <ZoomIn size={15} />
                </button>
              </div>
            )}
          </div>
        </div>

        {renamingFolder && (
          <div className="jb-mx-create-bar">
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              autoFocus
              className="jb-mx-create-input"
              onBlur={handleCommitRenameFolder}
              onChange={({ target }) =>
                setRenamingFolder((r) => ({ ...r, name: target.value }))
              }
              onKeyDown={({ key }) => {
                if (key === 'Enter') handleCommitRenameFolder();
                if (key === 'Escape') setRenamingFolder(null);
              }}
              value={renamingFolder.name}
            />
            <button
              className="jb-btn jb-btn--primary"
              onClick={handleCommitRenameFolder}
              type="button"
            >
              Save
            </button>
            <button
              className="jb-icon-btn"
              onClick={() => setRenamingFolder(null)}
              type="button"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {renamingTrack && (
          <div className="jb-mx-create-bar">
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              autoFocus
              className="jb-mx-create-input"
              onBlur={handleCommitRenameTrack}
              onChange={({ target }) =>
                setRenamingTrack((r) => ({ ...r, name: target.value }))
              }
              onKeyDown={({ key }) => {
                if (key === 'Enter') handleCommitRenameTrack();
                if (key === 'Escape') setRenamingTrack(null);
              }}
              value={renamingTrack.name}
            />
            <button
              className="jb-btn jb-btn--primary"
              onClick={handleCommitRenameTrack}
              type="button"
            >
              Save
            </button>
            <button
              className="jb-icon-btn"
              onClick={() => setRenamingTrack(null)}
              type="button"
            >
              <X size={13} />
            </button>
          </div>
        )}

        <div className="jb-view">
          <div
            className="jb-view-scroll"
            ref={viewScrollRef}
          >
            {renderView()}
          </div>
          {showAlphaStrip && (
            <AlphaStrip
              disabled={!alphaEnabled}
              handlerRef={alphaHandlerRef}
            />
          )}
        </div>

        {/*
          Last child of jb-content and absolutely positioned, so it floats over the bottom-right
          of the list rather than occupying a row. As a banner above the topbar it pushed the
          whole library down the moment a scan started and let it spring back when one finished
          — and scans start on their own, so the jump arrived unprompted.
        */}
        {syncState?.running && (
          <div
            className="jb-scan-pill"
            role="status"
          >
            <Loader2
              className="jb-scan-spinner"
              size={14}
            />
            <span className="jb-scan-label">
              Scanning music library
              {scanProgressPct === null ? '…' : ` — ${scanProgressPct}%`}
            </span>
            <div className="jb-scan-track">
              <div
                className="jb-scan-fill"
                style={
                  scanProgressPct === null
                    ? undefined
                    : { width: `${scanProgressPct}%` }
                }
              />
            </div>
            <button
              className="jb-scan-stop hover-fx"
              onClick={() => cancelSync().catch(() => {})}
              title="Stop scanning"
              type="button"
            >
              Stop
            </button>
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          onAddToPlaylist={(plId, track) => handleAddToPlaylist(plId, track)}
          onAddToQueue={(track) => enqueueTrack(track)}
          onAnalyze={handleAnalyzeTrack}
          onAutoMix={handleAutoMix}
          onClose={() => setContextMenu(null)}
          onCreate={(name) =>
            handleCreatePlaylistFromTrack(name, contextMenu.track)
          }
          onDeleteTrack={handleDeleteTrack}
          onExportTrack={handleExportTrack}
          onGoToArtist={(dir) => handleShowInFolders(dir)}
          onPlayNext={(track) => addToQueueNext(track)}
          onRenameTrack={(track) =>
            setRenamingTrack({ track, name: track.filename })
          }
          onSearchArtist={handleSearchArtist}
          onSearchRemixes={handleSearchRemixes}
          onSearchSimilar={handleSearchSimilar}
          onShowInFolders={handleShowInFolders}
          playlists={playlists}
          track={contextMenu.track}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      )}

      {folderContextMenu && (
        <FolderContextMenu
          folder={folderContextMenu.folder}
          onAddToMixtape={(mixtapeId) =>
            handleAddFolderToMixtape(folderContextMenu.folder, mixtapeId)
          }
          onAnalyzeFolder={handleAnalyzeFolder}
          onClose={() => setFolderContextMenu(null)}
          onCreateMixtape={(name) =>
            handleCreateMixtapeFromFolder(folderContextMenu.folder, name)
          }
          onDeleteFolder={handleDeleteFolder}
          onExportFolder={handleExportFolder}
          onRenameFolder={(folder) =>
            setRenamingFolder({ folder, name: folder.name })
          }
          playlists={playlists}
          x={folderContextMenu.x}
          y={folderContextMenu.y}
        />
      )}

      {albumContextMenu && (
        <AlbumContextMenu
          album={albumContextMenu.album}
          onAddAllToQueue={handleAddAlbumToQueue}
          onAddToMixtape={(mixtapeId) =>
            handleAddAlbumToMixtape(albumContextMenu.album, mixtapeId)
          }
          onAnalyze={handleAnalyzeAlbum}
          onClose={() => setAlbumContextMenu(null)}
          onCreateMixtape={(name) =>
            handleCreateMixtapeFromAlbum(albumContextMenu.album, name)
          }
          onDeleteAlbum={handleDeleteAlbum}
          onExportAlbum={handleExportAlbum}
          onGoToArtist={goToArtist}
          onPlay={(album) => playQuery(albumTrackParams(album))}
          onSearchArtist={handleSearchArtist}
          onShowInFolder={handleShowAlbumInFolder}
          onShuffle={(album) => playQuery(albumTrackParams(album))}
          playlists={playlists}
          x={albumContextMenu.x}
          y={albumContextMenu.y}
        />
      )}
    </div>
  );
};

export default Library;
