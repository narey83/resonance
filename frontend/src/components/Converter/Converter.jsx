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

import { CONVERT_FORMATS } from '../../lib/converter';
import * as converterApi from '../../lib/converter';
import { getFolders, getTracks } from '../../lib/musicLibrary';
import { AudioLines, ChevronDown, ChevronRight, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

const QUALITIES = [
  { value: 0, label: '0 — Best (largest)' },
  { value: 2, label: '2 — High' },
  { value: 4, label: '4 — Medium' },
  { value: 6, label: '6 — Low' },
  { value: 9, label: '9 — Smallest' },
];

const extensionOf = (path) => {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
};

const button = (extra = {}) => ({
  padding: '6px 14px',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: 13,
  ...extra,
});

const Converter = () => {
  const [folders, setFolders] = useState([]);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedFolders, setSelectedFolders] = useState(new Set());
  const [selectedTracks, setSelectedTracks] = useState(new Set());
  const [expanded, setExpanded] = useState(new Set());
  const [folderTracks, setFolderTracks] = useState({});
  const [format, setFormat] = useState('mp3');
  const [quality, setQuality] = useState(2);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    getFolders()
      .then((data) => setFolders(data || []))
      .catch((error_) => setError(`Failed to load folders: ${error_.message}`))
      .finally(() => setLoadingFolders(false));
  }, []);

  // Conversions run server-side and keep going after you leave this page. On (re)mount,
  // reattach to a job that's still running so progress shows again instead of looking stopped.
  useEffect(() => {
    converterApi
      .listConversionJobs()
      .then((jobs) => {
        const running = (jobs || []).find((j) => j.state === 'Running');
        if (running) setJob(running);
      })
      .catch(() => {});
  }, []);

  // Poll an active job until it leaves the Running state.
  useEffect(() => {
    if (!job || job.state !== 'Running') return undefined;
    pollRef.current = setInterval(async () => {
      try {
        const fresh = await converterApi.getConversionJob(job.id);
        setJob(fresh);
      } catch {
        /* keep last known state; next tick retries */
      }
    }, 1_000);
    return () => clearInterval(pollRef.current);
  }, [job]);

  const toggleFolder = (path) => {
    setSelectedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleExpand = async (path) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

    if (!folderTracks[path]) {
      try {
        const result = await getTracks({ folder: path, limit: 5_000 });
        setFolderTracks((previous) => ({
          ...previous,
          [path]: result?.tracks || result || [],
        }));
      } catch (error_) {
        setError(`Failed to load tracks: ${error_.message}`);
      }
    }
  };

  const toggleTrack = (trackPath) => {
    setSelectedTracks((previous) => {
      const next = new Set(previous);
      if (next.has(trackPath)) next.delete(trackPath);
      else next.add(trackPath);
      return next;
    });
  };

  const filtered = folders.filter((f) =>
    (f.name || f.path || '').toLowerCase().includes(search.toLowerCase()),
  );

  const selectionCount = selectedFolders.size + selectedTracks.size;

  const handleConvert = async () => {
    setError(null);
    try {
      const started = await converterApi.startConversion({
        folders: [...selectedFolders],
        paths: [...selectedTracks],
        format,
        quality,
      });
      setJob(started);
    } catch (error_) {
      setError(error_.response?.data || `Failed to start: ${error_.message}`);
    }
  };

  const handleCancel = async () => {
    if (!job) return;
    try {
      await converterApi.cancelConversion(job.id);
    } catch {
      /* ignore */
    }
  };

  const isRunning = job?.state === 'Running';
  const progressPct =
    job && job.total > 0
      ? Math.round(
          ((job.converted + job.failed + job.skipped) / job.total) * 100,
        )
      : 0;

  return (
    <div className="view">
      <div style={{ padding: 16, maxWidth: 880, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 6,
          }}
        >
          <AudioLines size={22} />
          <h2 style={{ margin: 0 }}>Converter</h2>
        </div>
        <p style={{ color: 'var(--text-muted)', marginTop: 0, fontSize: 13 }}>
          Transcode library folders or tracks to another audio format. Files are
          converted in place — the original is replaced and the library
          re-indexed. Files already in the target format are skipped.
        </p>

        {/* Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 12,
            flexWrap: 'wrap',
            margin: '12px 0',
          }}
        >
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
              Target format
            </label>
            <select
              onChange={(e) => setFormat(e.target.value)}
              value={format}
            >
              {CONVERT_FORMATS.map((f) => (
                <option
                  key={f}
                  value={f}
                >
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
              Quality (mp3/ogg)
            </label>
            <select
              onChange={(e) => setQuality(Number(e.target.value))}
              value={quality}
            >
              {QUALITIES.map((q) => (
                <option
                  key={q.value}
                  value={q.value}
                >
                  {q.label}
                </option>
              ))}
            </select>
          </div>
          <button
            className="hover-fx"
            disabled={selectionCount === 0 || isRunning}
            onClick={handleConvert}
            style={button({
              background: '#3182ce',
              border: '1px solid #3182ce',
              color: '#fff',
              opacity: selectionCount === 0 || isRunning ? 0.5 : 1,
            })}
            type="button"
          >
            Convert {selectionCount > 0 ? `(${selectionCount})` : ''}
          </button>
        </div>

        {error && (
          <div
            style={{
              color: 'var(--red, #e53e3e)',
              fontSize: 13,
              marginBottom: 10,
            }}
          >
            {String(error)}
          </div>
        )}

        {/* Active / last job */}
        {job && (
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 12,
              marginBottom: 14,
              background: 'var(--bg-elevated)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <strong style={{ fontSize: 13 }}>
                {isRunning
                  ? `Converting to ${job.format}…`
                  : job.state === 'Cancelled'
                    ? 'Cancelled'
                    : job.total === 0
                      ? 'Nothing to convert (already in target format)'
                      : `Done — converted ${job.converted} to ${job.format}`}
              </strong>
              {isRunning && (
                <button
                  className="hover-fx"
                  onClick={handleCancel}
                  style={button({ padding: '3px 10px', fontSize: 12 })}
                  type="button"
                >
                  <X size={12} /> Cancel
                </button>
              )}
            </div>
            {job.total > 0 && (
              <>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: 'var(--border)',
                    overflow: 'hidden',
                    margin: '8px 0 6px',
                  }}
                >
                  <div
                    style={{
                      width: `${progressPct}%`,
                      height: '100%',
                      background: '#38a169',
                      transition: 'width .3s',
                    }}
                  />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {job.converted} converted · {job.failed} failed ·{' '}
                  {job.skipped} skipped · {job.total} total
                  {job.currentFile ? ` · ${job.currentFile}` : ''}
                </div>
              </>
            )}
            {job.errors?.length > 0 && (
              <ul
                style={{
                  margin: '8px 0 0',
                  paddingLeft: 18,
                  fontSize: 12,
                  color: 'var(--red, #e53e3e)',
                  maxHeight: 120,
                  overflow: 'auto',
                }}
              >
                {job.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Folder picker */}
        <input
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter folders…"
          style={{ width: '100%', marginBottom: 10 }}
          type="text"
          value={search}
        />

        {loadingFolders ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Loading folders…
          </div>
        ) : (
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 6,
              maxHeight: 480,
              overflow: 'auto',
            }}
          >
            {filtered.map((folder) => {
              const isExpanded = expanded.has(folder.path);
              const tracks = folderTracks[folder.path] || [];
              return (
                <div
                  key={folder.path}
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 10px',
                    }}
                  >
                    <input
                      checked={selectedFolders.has(folder.path)}
                      onChange={() => toggleFolder(folder.path)}
                      type="checkbox"
                    />
                    <span
                      onClick={() => toggleExpand(folder.path)}
                      style={{
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        flex: 1,
                      }}
                    >
                      {isExpanded ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      {folder.name || folder.path}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {folder.trackCount} track
                      {folder.trackCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '0 10px 8px 34px' }}>
                      {tracks.length === 0 ? (
                        <div
                          style={{ fontSize: 12, color: 'var(--text-muted)' }}
                        >
                          No tracks loaded.
                        </div>
                      ) : (
                        tracks.map((track) => {
                          const ext =
                            track.extension || extensionOf(track.path);
                          const alreadyTarget =
                            ext.toLowerCase() === format.toLowerCase();
                          return (
                            <label
                              key={track.path}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                fontSize: 12,
                                padding: '2px 0',
                                opacity: alreadyTarget ? 0.5 : 1,
                              }}
                            >
                              <input
                                checked={selectedTracks.has(track.path)}
                                onChange={() => toggleTrack(track.path)}
                                type="checkbox"
                              />
                              <span style={{ flex: 1 }}>
                                {track.filename || track.path}
                              </span>
                              <span style={{ color: 'var(--text-muted)' }}>
                                {ext}
                                {alreadyTarget ? ' · skip' : ''}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div
                style={{
                  padding: 12,
                  fontSize: 13,
                  color: 'var(--text-muted)',
                }}
              >
                No folders.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Converter;
