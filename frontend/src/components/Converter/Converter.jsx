// <copyright file="Converter.jsx" company="John Narey">
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

import './Converter.css';
import { CONVERT_FORMATS } from '../../lib/converter';
import * as converterApi from '../../lib/converter';
import { getFolders, getTracks } from '../../lib/musicLibrary';
import {
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  Search,
  X,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';

const FORMATS = {
  mp3: ['MP3', 'Compact files', 'Variable bitrate · adjustable quality'],
  flac: [
    'FLAC',
    'Lossless compression',
    'Keeps the decoded audio without lossy encoding',
  ],
  wav: ['WAV', 'Uncompressed audio', '16-bit PCM · larger files'],
  opus: ['Opus', 'Efficient listening', '192 kbps · check player support'],
  m4a: ['M4A', 'AAC audio', '256 kbps AAC in an M4A container'],
  aac: ['AAC / M4A', 'AAC audio alias', '256 kbps · output extension is .m4a'],
  ogg: ['Ogg Vorbis', 'Open audio format', 'Fixed Vorbis quality 6'],
};
const QUALITIES = [
  [0, 'Best · V0'],
  [2, 'High · V2'],
  [4, 'Balanced · V4'],
  [6, 'Smaller · V6'],
  [9, 'Smallest · V9'],
];
const extensionOf = (path = '') => path.split('.').at(-1).toLowerCase();
const targetExtension = (format) => (format === 'aac' ? 'm4a' : format);
const errorMessage = (error) =>
  typeof error?.response?.data === 'string'
    ? error.response.data
    : error?.message || 'Please retry.';

const Converter = () => {
  const [folders, setFolders] = useState([]);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedFolders, setSelectedFolders] = useState(new Set());
  const [selectedTracks, setSelectedTracks] = useState(new Set());
  const [expanded, setExpanded] = useState(new Set());
  const [folderTracks, setFolderTracks] = useState({});
  const [loadingTracks, setLoadingTracks] = useState(new Set());
  const [format, setFormat] = useState('mp3');
  const [quality, setQuality] = useState(2);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const isRunning = job?.state === 'Running';
  const locked = busy || isRunning;

  useEffect(() => {
    let cancelled = false;
    getFolders()
      .then((data) => {
        if (!cancelled) setFolders(data || []);
      })
      .catch((error_) => {
        if (!cancelled)
          setError(`Could not load folders. ${errorMessage(error_)}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingFolders(false);
      });
    converterApi
      .listConversionJobs()
      .then((jobs) => {
        if (!cancelled)
          setJob((jobs || []).find((item) => item.state === 'Running') || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isRunning) return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const fresh = await converterApi.getConversionJob(job.id);
        if (!cancelled) {
          setJob(fresh);
          setError('');
        }
      } catch {
        if (!cancelled)
          setError(
            'Progress is temporarily unavailable. The server may still be converting; reconnecting…',
          );
      }
    }, 1_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isRunning, job?.id]);

  const toggle = (setter, path) =>
    setter((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const toggleExpand = async (path) => {
    toggle(setExpanded, path);
    if (folderTracks[path] || loadingTracks.has(path)) return;
    setLoadingTracks((previous) => new Set([...previous, path]));
    try {
      const result = await getTracks({ folder: path, limit: 5_000 });
      setFolderTracks((previous) => ({
        ...previous,
        [path]: result?.tracks || (Array.isArray(result) ? result : []),
      }));
    } catch (error_) {
      setError(`Could not load tracks. ${errorMessage(error_)}`);
    } finally {
      setLoadingTracks((previous) => {
        const next = new Set(previous);
        next.delete(path);
        return next;
      });
    }
  };

  // A folder already includes its tracks; don't count or submit them twice.
  const paths = [...selectedTracks].filter(
    (path) =>
      ![...selectedFolders].some((folder) =>
        path.startsWith(`${folder.replace(/\/$/, '')}/`),
      ),
  );
  const selectionCount = selectedFolders.size + paths.length;
  const selectionText = `${selectedFolders.size} ${selectedFolders.size === 1 ? 'folder' : 'folders'} · ${paths.length} individual ${paths.length === 1 ? 'track' : 'tracks'}`;
  const filtered = folders.filter((folder) =>
    `${folder.name || ''} ${folder.path || ''}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const progress = Math.min(
    100,
    job?.total > 0
      ? Math.round(
          ((job.converted + job.failed + job.skipped) / job.total) * 100,
        )
      : 0,
  );
  const handleConvert = async () => {
    if (locked || !selectionCount || !acknowledged) return;
    setBusy(true);
    setError('');
    try {
      setJob(
        await converterApi.startConversion({
          folders: [...selectedFolders],
          paths,
          format,
          quality,
        }),
      );
      setReview(false);
      setAcknowledged(false);
    } catch (error_) {
      setError(`Conversion could not start. ${errorMessage(error_)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      await converterApi.cancelConversion(job.id);
      setJob(await converterApi.getConversionJob(job.id));
    } catch (error_) {
      setError(`Could not cancel. ${errorMessage(error_)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="converter-page">
      {error && (
        <div
          className="converter-alert"
          role="alert"
        >
          {error}
        </div>
      )}
      {job && (
        <section
          aria-label="Conversion progress"
          aria-live="polite"
          className="converter-job"
        >
          <div className="converter-section-heading">
            <div>
              <span className="converter-eyebrow">CONVERSION ACTIVITY</span>
              <h2>
                {isRunning
                  ? `Converting to ${FORMATS[job.format]?.[0] || job.format}…`
                  : job.state === 'Cancelled'
                    ? 'Conversion cancelled'
                    : job.failed > 0
                      ? 'Finished with errors'
                      : 'Conversion complete'}
              </h2>
            </div>
            {isRunning && (
              <button
                disabled={busy}
                onClick={handleCancel}
                type="button"
              >
                <X size={14} /> Cancel job
              </button>
            )}
          </div>
          <progress
            aria-label="Conversion progress"
            max={100}
            value={progress}
          />
          <div className="converter-job-counts">
            <span>
              <b>{job.converted || 0}</b> converted
            </span>
            <span>
              <b>{job.skipped || 0}</b> skipped
            </span>
            <span>
              <b>{job.failed || 0}</b> failed
            </span>
            <span>{job.total || 0} total</span>
          </div>
          {isRunning && job.total === 0 && <p>Preparing the selected files…</p>}
          {job.currentFile && isRunning && (
            <p
              className="converter-current-file"
              title={job.currentFile}
            >
              {job.currentFile.split('/').at(-1)}
            </p>
          )}
          {job.errors?.length > 0 && (
            <details>
              <summary>View {job.errors.length} conversion errors</summary>
              <ul>
                {[...new Set(job.errors)].map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </details>
          )}
          {job.state === 'Cancelled' && (
            <p>
              Files already converted remain changed. Cancellation stops the
              remaining work.
            </p>
          )}
        </section>
      )}
      <div className="converter-layout">
        <section
          aria-label="Source selection"
          className="converter-source"
        >
          <div className="converter-section-heading">
            <div>
              <span className="converter-eyebrow">01 / SOURCE</span>
              <h2>Choose your music</h2>
              <p>Select a folder, or expand it to pick individual tracks.</p>
            </div>
            <Folder size={22} />
          </div>
          <label className="converter-search">
            <Search size={16} />
            <input
              aria-label="Filter folders"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a folder…"
              value={search}
            />
          </label>
          <div className="converter-selection-bar">
            <span>{selectionText}</span>
            <button
              disabled={locked || !selectionCount || review}
              onClick={() => {
                setSelectedFolders(new Set());
                setSelectedTracks(new Set());
              }}
              type="button"
            >
              Clear
            </button>
          </div>
          <div className="converter-folder-list">
            {loadingFolders ? (
              <p
                className="converter-empty"
                role="status"
              >
                Loading your library…
              </p>
            ) : filtered.length === 0 ? (
              <div className="converter-empty">
                <Folder size={24} />
                <p>
                  {search ? 'No matching folders' : 'No library folders yet'}
                </p>
                <span>
                  {search
                    ? 'Try another name or clear the filter.'
                    : 'Add music to your library to get started.'}
                </span>
              </div>
            ) : (
              filtered.map((folder) => {
                const wholeFolder = selectedFolders.has(folder.path);
                const tracks = folderTracks[folder.path] || [];
                return (
                  <div
                    className="converter-folder"
                    key={folder.path}
                  >
                    <div className="converter-folder-header">
                      <input
                        aria-label={`Select folder ${folder.name || folder.path}`}
                        checked={wholeFolder}
                        disabled={locked || review}
                        onChange={() => toggle(setSelectedFolders, folder.path)}
                        type="checkbox"
                      />
                      <button
                        aria-expanded={expanded.has(folder.path)}
                        className="converter-folder-toggle"
                        onClick={() => toggleExpand(folder.path)}
                        type="button"
                      >
                        {expanded.has(folder.path) ? (
                          <ChevronDown size={15} />
                        ) : (
                          <ChevronRight size={15} />
                        )}
                        <Folder size={16} />
                        <span>{folder.name || folder.path}</span>
                      </button>
                      <span className="converter-count">
                        {folder.trackCount} tracks
                      </span>
                    </div>
                    {expanded.has(folder.path) && (
                      <div className="converter-tracks">
                        {loadingTracks.has(folder.path) ? (
                          <p role="status">Loading tracks…</p>
                        ) : tracks.length === 0 ? (
                          <p>No tracks in this folder.</p>
                        ) : (
                          tracks.map((track) => {
                            const ext = (
                              track.extension || extensionOf(track.path)
                            )
                              .replace(/^\./, '')
                              .toLowerCase();
                            const skipped = ext === targetExtension(format);
                            return (
                              <label
                                className={`converter-track${skipped ? ' converter-track--skip' : ''}`}
                                key={track.path}
                              >
                                <input
                                  aria-label={`Select ${track.title || track.filename}`}
                                  checked={
                                    wholeFolder ||
                                    selectedTracks.has(track.path)
                                  }
                                  disabled={locked || review || wholeFolder}
                                  onChange={() =>
                                    toggle(setSelectedTracks, track.path)
                                  }
                                  type="checkbox"
                                />
                                <div>
                                  <strong>
                                    {track.title ||
                                      track.filename ||
                                      track.path.split('/').at(-1)}
                                  </strong>
                                  <span>
                                    {track.artist || track.filename || ''}
                                  </span>
                                </div>
                                <span className="converter-format-tag">
                                  {ext.toUpperCase()}
                                  {skipped && ' · skipped'}
                                </span>
                              </label>
                            );
                          })
                        )}
                        {tracks.length >= 5_000 && (
                          <p>
                            Showing the first 5,000 tracks. Select the folder to
                            include all its tracks.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
        <aside
          aria-label="Conversion settings"
          className="converter-settings"
        >
          <div className="converter-section-heading">
            <div>
              <span className="converter-eyebrow">02 / OUTPUT</span>
              <h2>Choose your format</h2>
            </div>
            <AudioLines size={22} />
          </div>
          <div
            aria-label="Output format"
            className="converter-formats"
            role="group"
          >
            {CONVERT_FORMATS.map((value) => (
              <button
                aria-pressed={format === value}
                className={format === value ? 'selected' : ''}
                disabled={locked || review}
                key={value}
                onClick={() => setFormat(value)}
                type="button"
              >
                <b>{FORMATS[value][0]}</b>
                <span>{FORMATS[value][1]}</span>
                {format === value && <Check size={14} />}
              </button>
            ))}
          </div>
          <p className="converter-format-detail">{FORMATS[format][2]}</p>
          {format === 'mp3' && (
            <label className="converter-quality">
              MP3 quality
              <select
                disabled={locked || review}
                onChange={(event) => setQuality(Number(event.target.value))}
                value={quality}
              >
                {QUALITIES.map(([value, label]) => (
                  <option
                    key={value}
                    value={value}
                  >
                    {label}
                  </option>
                ))}
              </select>
              <span>Higher quality creates larger files.</span>
            </label>
          )}
          <div className="converter-notice">
            <strong>Replaces files in your library</strong>
            <p>
              Successful conversions replace the originals, then update the
              library. Files already in the output format are skipped.
            </p>
          </div>
          {['wav', 'flac'].includes(format) && (
            <p className="converter-format-detail">
              Converting a lossy source to {format.toUpperCase()} cannot restore
              lost audio detail.
            </p>
          )}
          {!review ? (
            <button
              className="converter-primary"
              disabled={locked || !selectionCount}
              onClick={() => {
                setReview(true);
                setAcknowledged(false);
              }}
              type="button"
            >
              Review conversion <ArrowRight size={16} />
            </button>
          ) : (
            <div className="converter-review">
              <span className="converter-eyebrow">03 / REVIEW</span>
              <h3>{selectionText}</h3>
              <ul className="converter-review-files">
                {[...selectedFolders].map((path) => (
                  <li key={`folder-${path}`}>
                    Folder:{' '}
                    {folders.find((folder) => folder.path === path)?.name ||
                      path}
                  </li>
                ))}
                {paths.map((path) => (
                  <li key={path}>
                    {Object.values(folderTracks)
                      .flat()
                      .find((track) => track.path === path)?.title ||
                      path.split('/').at(-1)}
                  </li>
                ))}
              </ul>
              <p>
                Output: <strong>{FORMATS[format][0]}</strong>
                {format === 'mp3' ? ` · V${quality}` : ''} · .
                {targetExtension(format)}
              </p>
              <label>
                <input
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  type="checkbox"
                />
                I understand the original files will be replaced.
              </label>
              <button
                className="converter-primary"
                disabled={locked || !acknowledged}
                onClick={handleConvert}
                type="button"
              >
                {busy ? 'Starting…' : 'Start conversion'}
                <ArrowRight size={16} />
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setReview(false);
                  setAcknowledged(false);
                }}
                type="button"
              >
                Back to settings
              </button>
            </div>
          )}
          <p className="converter-footnote">
            For a USB export that keeps your originals, use Music → Export.
          </p>
        </aside>
      </div>
    </div>
  );
};

export default Converter;
