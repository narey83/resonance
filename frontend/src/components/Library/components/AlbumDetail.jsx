// <copyright file="AlbumDetail.jsx" company="John Narey">
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

import { usePlayer } from '../../../context/PlayerContext';
import { getTracks } from '../../../lib/musicLibrary';
import { formatSeconds } from '../../../lib/util';
import TrackTable from './TrackTable';
import { ChevronLeft, Play, Shuffle } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

const toQueue = (track) => ({
  album: track.album,
  artist: track.artist,
  filename: track.path,
  hasArtwork: track.hasArtwork,
  length: track.duration,
  localRelativePath: track.path,
  path: track.path,
  title: track.title || track.filename,
});

const AlbumDetail = ({
  album,
  onAnalyzeTracks,
  onArtist,
  onBack,
  onContextMenu,
}) => {
  const { playQueue } = usePlayer();
  const [loading, setLoading] = useState(true);
  const [tracks, setTracks] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const result = await getTracks({
          album: album.album,
          ...(album.directory
            ? { folder: album.directory }
            : { artist: album.artist }),
          limit: 5_000,
        });
        if (!cancelled) {
          const sorted = [...(result.tracks ?? [])].sort((a, b) => {
            if (a.discNumber !== b.discNumber)
              return (a.discNumber ?? 1) - (b.discNumber ?? 1);
            return (a.trackNumber ?? 999) - (b.trackNumber ?? 999);
          });
          setTracks(sorted);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [album.album, album.artist, album.directory]);

  const handlePlay = () => {
    if (tracks.length) playQueue(tracks.map(toQueue), 0);
  };

  const handleShuffle = () => {
    if (tracks.length)
      playQueue([...tracks].sort(() => Math.random() - 0.5).map(toQueue), 0);
  };

  const totalDuration = useMemo(
    () => tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0),
    [tracks],
  );
  const meta = [
    album.year,
    tracks.length ? `${tracks.length} tracks` : null,
    totalDuration ? formatSeconds(totalDuration) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="jb-album-detail">
      <div
        className="jb-album-hero"
        style={{
          background:
            'linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-primary) 100%)',
        }}
      >
        <button
          className="jb-icon-btn"
          onClick={onBack}
          style={{ alignSelf: 'flex-start', marginBottom: 'auto' }}
          title="Back"
          type="button"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="jb-album-hero-info">
          <div className="jb-album-hero-label">Album</div>
          <div className="jb-album-hero-title">
            {album.album || '(Untitled)'}
          </div>
          {album.artist && album.artist !== 'Various Artists' ? (
            <button
              className="jb-album-hero-artist"
              onClick={() => onArtist?.({ artist: album.artist })}
              type="button"
            >
              {album.artist}
            </button>
          ) : (
            <div className="jb-album-hero-artist">{album.artist}</div>
          )}
          {meta && <div className="jb-album-hero-meta">{meta}</div>}
          <div className="jb-album-hero-actions">
            <button
              className="jb-btn jb-btn--primary"
              onClick={handlePlay}
              type="button"
            >
              <Play size={14} /> Play
            </button>
            <button
              className="jb-btn"
              onClick={handleShuffle}
              type="button"
            >
              <Shuffle size={14} /> Shuffle
            </button>
          </div>
        </div>
      </div>

      <TrackTable
        loading={loading}
        onAnalyzeTracks={onAnalyzeTracks}
        onContextMenu={onContextMenu}
        tracks={tracks}
      />
    </div>
  );
};

export default AlbumDetail;
