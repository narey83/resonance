// <copyright file="PlayHistoryView.jsx" company="John Narey">
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

import { useLibraryActivity } from '../../../context/LibraryActivityContext';
import { usePlayer } from '../../../context/PlayerContext';
import { getPlayHistory } from '../../../lib/libraryActivity';
import ResonanceMark from '../../Shared/ResonanceMark';
import { Heart, Play, Smartphone, Trash2, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

const formatDate = (ms) => {
  if (!ms) return '–';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const folderName = (folder) => {
  if (!folder) return null;
  return (
    folder.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? folder
  );
};

const entryToQueue = (entry) => ({
  album: '',
  artist: entry.artist || '',
  directory: entry.folder || '',
  filename: entry.path,
  hasArtwork: false,
  length: null,
  localRelativePath: entry.path,
  path: entry.path,
  title: entry.title || entry.path?.split(/[/\\]/).pop() || '',
});

const PlayHistoryView = ({ onContextMenu }) => {
  const activity = useLibraryActivity();
  const { playQueue } = usePlayer();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [filters, setFilters] = useState({ track: '', artist: '', folder: '' });
  const [activeCol, setActiveCol] = useState(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    setLoading(true);
    getPlayHistory(500, 0)
      .then((data) => {
        setEntries(data ?? []);
        loadedRef.current = true;
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    const contextHistory = activity?.playHistory ?? [];
    if (!contextHistory.length) return;
    setEntries((previous) => {
      const ids = new Set(previous.map((e) => e.id));
      const fresh = contextHistory.filter((e) => !ids.has(e.id));
      return fresh.length ? [...fresh, ...previous] : previous;
    });
  }, [activity?.playHistory]);

  const filteredEntries = useMemo(() => {
    const { artist, folder: folderF, track } = filters;
    if (!track && !artist && !folderF) return entries;
    const tl = track.toLowerCase();
    const al = artist.toLowerCase();
    const fl = folderF.toLowerCase();
    return entries.filter((e) => {
      const title = (
        e.title ||
        e.path?.split(/[/\\]/).pop() ||
        ''
      ).toLowerCase();
      const art = (e.artist || '').toLowerCase();
      const fld = (folderName(e.folder) || '').toLowerCase();
      return (
        (!tl || title.includes(tl)) &&
        (!al || art.includes(al)) &&
        (!fl || fld.includes(fl))
      );
    });
  }, [entries, filters]);

  const deleteEntry = async (id) => {
    setEntries((previous) => previous.filter((e) => e.id !== id));
    await activity?.deletePlay(id);
  };

  const handleClearAll = async () => {
    setConfirmClear(false);
    setEntries([]);
    await activity?.clearHistory();
  };

  const playFrom = (index) => {
    playQueue(filteredEntries.map(entryToQueue), index);
  };

  const setFilter = (col, value) => setFilters((f) => ({ ...f, [col]: value }));
  const clearFilter = (col) => {
    setFilter(col, '');
    setActiveCol(null);
  };

  const colHeader = (col, label, className) => {
    const isActive = activeCol === col;
    const value = filters[col];

    if (isActive) {
      return (
        <div className={`${className} jb-col-filter-wrap`}>
          <input
            autoFocus
            className="jb-col-filter-input"
            onBlur={() => setActiveCol(null)}
            onChange={(e) => setFilter(col, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') clearFilter(col);
              if (e.key === 'Enter') setActiveCol(null);
            }}
            placeholder={`Filter ${label}…`}
            value={value}
          />
          {value && (
            <button
              className="jb-col-filter-x"
              onMouseDown={(e) => {
                e.preventDefault();
                clearFilter(col);
              }}
              type="button"
            >
              <X size={9} />
            </button>
          )}
        </div>
      );
    }

    return (
      <div className={className}>
        <button
          className={`jb-col-hdr-btn${value ? ' jb-col-hdr-btn--active' : ''}`}
          onClick={() => setActiveCol(col)}
          type="button"
        >
          <span className="jb-col-hdr-value">{value || label}</span>
          {value && (
            <span
              className="jb-col-filter-x"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                clearFilter(col);
              }}
              role="button"
              tabIndex={-1}
            >
              <X size={9} />
            </span>
          )}
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="jb-state">
        <ResonanceMark size={48} />
        Loading play history…
      </div>
    );
  }

  return (
    <div className="jb-play-history">
      <div className="jb-ph-sticky-top">
        <div className="jb-play-history-toolbar">
          <span className="jb-ph-count">
            {filteredEntries.length}
            {entries.length !== filteredEntries.length
              ? ` of ${entries.length}`
              : ''}{' '}
            {entries.length === 1 ? 'play' : 'plays'}
          </span>
          {entries.length > 0 && !confirmClear && (
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
              <span>Delete all history?</span>
              <button
                className="jb-ph-confirm-yes"
                onClick={handleClearAll}
                type="button"
              >
                Delete
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

        <div className="jb-play-history-head">
          <div />
          {colHeader('track', 'Track', 'jb-ph-title')}
          {colHeader('artist', 'Artist', 'jb-ph-artist')}
          {colHeader('folder', 'Folder', 'jb-ph-folder')}
          <div className="jb-ph-when">Played</div>
          <div>
            <Heart
              size={13}
              strokeWidth={1.75}
            />
          </div>
          <div />
        </div>
      </div>

      {!filteredEntries.length && (
        <div className="jb-state">
          {entries.length
            ? 'No entries match the filter'
            : 'No play history yet. Start playing tracks!'}
        </div>
      )}

      {filteredEntries.map((entry, index) => {
        const displayTitle =
          entry.title || entry.path?.split(/[/\\]/).pop() || entry.path;
        const displayArtist = entry.artist || '–';
        const displayFolder = folderName(entry.folder) || '–';

        const isLoved = activity?.lovedPaths?.has(entry.path);
        return (
          <div
            className="jb-play-history-row"
            key={entry.id ?? entry.playedAt}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenu?.(e, entryToQueue(entry));
            }}
            onDoubleClick={() => playFrom(index)}
          >
            <div className="jb-track-num">
              <span className="jb-track-num-text">{index + 1}</span>
              <button
                className="jb-track-play-btn"
                onClick={() => playFrom(index)}
                type="button"
              >
                <Play size={12} />
              </button>
            </div>
            <div
              className="jb-ph-title"
              title={entry.path}
            >
              {entry.source === 'local' && (
                <Smartphone
                  size={11}
                  strokeWidth={1.75}
                  style={{
                    marginRight: 5,
                    opacity: 0.5,
                    flexShrink: 0,
                    verticalAlign: 'middle',
                  }}
                  title="Played from device"
                />
              )}
              {displayTitle}
            </div>
            <div className="jb-ph-artist">{displayArtist}</div>
            <div className="jb-ph-folder">{displayFolder}</div>
            <div className="jb-ph-when">{formatDate(entry.playedAt)}</div>
            <div className="jb-tt-love">
              <button
                className={`jb-love-btn${isLoved ? ' jb-love-btn--loved' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  activity?.toggleLove(entry.path);
                }}
                title={isLoved ? 'Remove from loved' : 'Love this track'}
                type="button"
              >
                <Heart
                  fill={isLoved ? 'currentColor' : 'none'}
                  size={13}
                  strokeWidth={1.75}
                />
              </button>
            </div>
            <button
              className="jb-ph-delete-btn"
              onClick={() => deleteEntry(entry.id)}
              title="Remove from history"
              type="button"
            >
              <X
                size={13}
                strokeWidth={1.75}
              />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default PlayHistoryView;
