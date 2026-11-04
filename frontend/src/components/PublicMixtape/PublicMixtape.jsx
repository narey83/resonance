// <copyright file="PublicMixtape.jsx" company="John Narey">
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

import './PublicMixtape.css';
import { urlBase } from '../../config';
import {
  downloadTrackUrl,
  getPublic,
  publicArtworkUrl,
  publicM3uUrl,
  publicZipUrl,
} from '../../lib/mixtapes';
import ResonanceMark from '../Shared/ResonanceMark';
import { Copy, Download, Link2, ListMusic, Share2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';

const formatSeconds = (s) => {
  if (!s) return '–';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const trackFilename = (track) =>
  track.title
    ? `${track.title}${track.filePath?.match(/\.[^.]+$/u)?.[0] ?? ''}`
    : track.filePath?.split(/[/\\]/u).pop() ?? 'track';

const trackDisplayTitle = (track) =>
  track.title ||
  track.filePath
    ?.split(/[/\\]/u)
    .pop()
    ?.replace(/\.[^.]+$/u, '') ||
  '(Unknown)';

const PublicMixtape = ({ token }) => {
  const [mixtape, setMixtape] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Invalid link');
      setLoading(false);
      return;
    }

    getPublic(token)
      .then((data) => {
        setMixtape(data);
        setLoading(false);
      })
      .catch(() => {
        setError('Playlist not found or no longer available.');
        setLoading(false);
      });
  }, [token]);

  const shareUrl = `${window.location.origin}${urlBase}/playlist/${token}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    });
  };

  const handleNativeShare = () => {
    if (!mixtape) return;
    navigator
      .share({
        title: mixtape.name,
        text: `Listen to "${mixtape.name}"`,
        url: shareUrl,
      })
      .catch(() => {});
  };

  return (
    <div className="pm-root">
      <div className="pm-card">
        <div className="pm-header">
          <div className="pm-brand">
            <ResonanceMark size={18} />
            <span className="pm-brand-name">Resonance</span>
          </div>
        </div>

        {loading && <div className="pm-state">Loading…</div>}
        {error && <div className="pm-state pm-state--error">{error}</div>}

        {mixtape && (
          <>
            {/* ── Meta ── */}
            <div className="pm-meta">
              {mixtape.hasArtwork ? (
                <img
                  alt={mixtape.name}
                  className="pm-meta-art"
                  src={publicArtworkUrl(token, {
                    // shown at 80px; enough for a 3x screen
                    size: 256,
                    version: mixtape.updatedAt,
                  })}
                />
              ) : (
                <ListMusic
                  className="pm-meta-icon"
                  size={28}
                  strokeWidth={1.5}
                />
              )}
              <div className="pm-meta-text">
                <div className="pm-title">{mixtape.name}</div>
                {mixtape.description && (
                  <div className="pm-description">{mixtape.description}</div>
                )}
                <div className="pm-stats">
                  {(mixtape.tracks ?? []).length} tracks
                  {' · '}
                  {formatSeconds(
                    (mixtape.tracks ?? []).reduce(
                      (s, t) => s + (t.duration ?? 0),
                      0,
                    ),
                  )}
                </div>
              </div>
            </div>

            {/* ── Share ── */}
            <div className="pm-share">
              {typeof navigator.share === 'function' ? (
                <button
                  className="pm-share-btn pm-share-btn--primary hover-fx"
                  onClick={handleNativeShare}
                  type="button"
                >
                  <Share2 size={14} />
                  Share
                </button>
              ) : (
                <button
                  className="pm-share-btn pm-share-btn--primary hover-fx"
                  onClick={handleCopy}
                  type="button"
                >
                  {copied ? <Link2 size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied!' : 'Copy link'}
                </button>
              )}
              {typeof navigator.share === 'function' && (
                <button
                  className="pm-share-btn hover-fx"
                  onClick={handleCopy}
                  type="button"
                >
                  {copied ? <Link2 size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied!' : 'Copy link'}
                </button>
              )}
            </div>

            {/* ── Download All ── */}
            {(mixtape.tracks ?? []).length > 0 && (
              <div className="pm-dl-all">
                <a
                  className="pm-dl-all-btn hover-fx"
                  download
                  href={publicM3uUrl(token)}
                  title="Download playlist file for use in any music player"
                >
                  <Download size={14} />
                  Download M3U playlist
                </a>
                <a
                  className="pm-dl-all-btn hover-fx"
                  download
                  href={publicZipUrl(token)}
                  title="Download all tracks and the M3U playlist as a zip"
                >
                  <Download size={14} />
                  Download all {(mixtape.tracks ?? []).length} tracks
                </a>
              </div>
            )}

            {/* ── Track list ── */}
            <div className="pm-tracks">
              {(mixtape.tracks ?? []).map((track, index) => (
                <div
                  className="pm-track"
                  key={track.id}
                >
                  <span className="pm-track-num">{index + 1}</span>
                  <div className="pm-track-info">
                    <div className="pm-track-title">
                      {trackDisplayTitle(track)}
                    </div>
                    {(track.artist || track.album) && (
                      <div className="pm-track-meta">
                        {[track.artist, track.album]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                  <span className="pm-track-dur">
                    {formatSeconds(track.duration)}
                  </span>
                  <a
                    className="pm-track-dl"
                    download={trackFilename(track)}
                    href={downloadTrackUrl(token, track.id)}
                    title="Download track"
                  >
                    <Download size={13} />
                  </a>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="pm-footer">Shared via Resonance</div>
      </div>
    </div>
  );
};

export default PublicMixtape;
