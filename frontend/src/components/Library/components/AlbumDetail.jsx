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

import { useLibraryActivity } from '../../../context/LibraryActivityContext';
import { usePlayer } from '../../../context/PlayerContext';
import { getTracks } from '../../../lib/musicLibrary';
import { formatSeconds } from '../../../lib/util';
import { ChevronLeft, Heart, Play, Shuffle } from 'lucide-react';
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

const AlbumDetail = ({ album, onArtist, onBack, onContextMenu }) => {
  const {
    isPlaying: playerIsPlaying,
    playQueue,
    track: currentTrack,
  } = usePlayer();
  const activity = useLibraryActivity();
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

      <div className="jb-album-detail-tracks">
        {loading ? (
          <div className="jb-state">
            <div className="jb-spinner" />
          </div>
        ) : (
          tracks.map((track, index) => {
            const isPlaying =
              currentTrack?.filename === track.path ||
              currentTrack?.localRelativePath === track.path;
            return (
              <TrackRow
                activity={activity}
                albumArtist={album.artist}
                index={index}
                isPlaying={isPlaying}
                key={track.path}
                onContextMenu={
                  onContextMenu
                    ? (e) => onContextMenu(e, toQueue(track))
                    : undefined
                }
                onPlay={() => playQueue(tracks.map(toQueue), index)}
                playerIsPlaying={playerIsPlaying}
                track={track}
              />
            );
          })
        )}
      </div>
    </div>
  );
};

const TrackRow = ({
  activity,
  albumArtist,
  index,
  isPlaying,
  onContextMenu,
  onPlay,
  playerIsPlaying,
  track,
}) => {
  const isLoved = activity?.lovedPaths?.has(track.path) ?? false;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className={`jb-track-row${isPlaying ? ' jb-track-row--playing' : ''}`}
      onContextMenu={onContextMenu}
      onDoubleClick={onPlay}
    >
      <div className="jb-track-num">
        {isPlaying ? (
          <span
            className={`jb-equalizer${playerIsPlaying ? '' : ' jb-equalizer--paused'}`}
          >
            <span />
            <span />
            <span />
          </span>
        ) : (
          <>
            <span className="jb-track-num-text">
              {track.trackNumber ?? index + 1}
            </span>
            <button
              className="jb-track-play-btn"
              onClick={onPlay}
              type="button"
            >
              <Play size={12} />
            </button>
          </>
        )}
      </div>
      <div className="jb-track-info">
        <div className="jb-track-title">{track.title || track.filename}</div>
        {track.artist && track.artist !== albumArtist && (
          <div className="jb-track-meta">{track.artist}</div>
        )}
      </div>
      <div className="jb-track-duration">
        {track.duration ? formatSeconds(track.duration) : '–'}
      </div>
      <button
        className={`jb-love-btn${isLoved ? ' jb-love-btn--loved' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          activity?.toggleLove(track.path);
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
  );
};

export default AlbumDetail;
