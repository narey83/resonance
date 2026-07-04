// <copyright file="AddPane.jsx" company="John Narey">
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

import { getCurrent as getOptions } from '../../lib/options';
import { DURATION_PRESETS } from '../../lib/ytdlp';
import { Plus } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

const AUDIO_FORMATS = ['best', 'mp3', 'opus', 'flac', 'wav', 'm4a'];
// Formats the backend can transcode completed folders to (ffmpeg). 'best' is the source
// download format, so the only no-op/"off" choice here is "no conversion" ('').
const CONVERT_FORMATS = ['mp3', 'opus', 'flac', 'wav', 'm4a', 'aac', 'ogg'];
const AUDIO_QUALITIES = [
  { value: 0, label: '0 — Best' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5 — Middle' },
  { value: 6, label: '6' },
  { value: 7, label: '7' },
  { value: 8, label: '8' },
  { value: 9, label: '9 — Worst' },
];

const DurationInput = ({ label, onChange, value }) => {
  const [unit, setUnit] = useState('minutes');
  const displayValue = value
    ? unit === 'seconds'
      ? value
      : unit === 'minutes'
        ? Math.round(value / 60)
        : Math.round(value / 3_600)
    : '';

  const handleChange = (e) => {
    const raw = Number.parseInt(e.target.value, 10);
    if (!e.target.value) {
      onChange(0);
      return;
    }

    if (Number.isNaN(Number(raw)) || raw < 0) return;
    const secs =
      unit === 'seconds' ? raw : unit === 'minutes' ? raw * 60 : raw * 3_600;
    onChange(secs);
  };

  return (
    <div>
      <label>{label}</label>
      <div className="ytdlp-duration-row">
        <input
          min="0"
          onChange={handleChange}
          placeholder="0"
          type="number"
          value={displayValue}
        />
        <select
          onChange={(e) => setUnit(e.target.value)}
          value={unit}
        >
          <option value="seconds">sec</option>
          <option value="minutes">min</option>
          <option value="hours">hrs</option>
        </select>
      </div>
    </div>
  );
};

const AddPane = ({ onSubmit }) => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [audioFormat, setAudioFormat] = useState('best');
  const [audioQuality, setAudioQuality] = useState(0);
  const [genre, setGenre] = useState('');
  const [minDuration, setMinDuration] = useState(0);
  const [maxDuration, setMaxDuration] = useState(0);
  const [convertFormat, setConvertFormat] = useState('');
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    getOptions()
      .then((options) => {
        const yt = options?.integrations?.yt_dlp;
        if (!yt) return;
        if (yt.audio_format) setAudioFormat(yt.audio_format);
        if (yt.audio_quality != null) setAudioQuality(yt.audio_quality);
        if (yt.default_genre) setGenre(yt.default_genre);
        if (yt.min_track_duration_seconds)
          setMinDuration(yt.min_track_duration_seconds);
        if (yt.max_track_duration_seconds)
          setMaxDuration(yt.max_track_duration_seconds);
        if (yt.convert_on_completion_format)
          setConvertFormat(yt.convert_on_completion_format);
      })
      .catch(() => {});
  }, []);

  const activePreset =
    DURATION_PRESETS.find(
      (p) => p.minSeconds === minDuration && p.maxSeconds === maxDuration,
    )?.value ?? '';

  const handlePreset = (e) => {
    const preset = DURATION_PRESETS.find((p) => p.value === e.target.value);
    if (!preset) return;
    setMinDuration(preset.minSeconds);
    setMaxDuration(preset.maxSeconds);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    try {
      await onSubmit({
        url: url.trim(),
        audioFormat,
        audioQuality,
        defaultGenre: genre || null,
        minTrackDurationSeconds: minDuration || null,
        maxTrackDurationSeconds: maxDuration || null,
        convertOnCompletionFormat: convertFormat,
      });
      if (mountedRef.current) setUrl('');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  return (
    <form
      className="ytdlp-add-form"
      onSubmit={handleSubmit}
    >
      <div>
        <label>YouTube URL (video, playlist, or channel)</label>
        <input
          autoFocus
          disabled={loading}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/playlist?list=..."
          type="text"
          value={url}
        />
      </div>

      <div className="ytdlp-add-settings">
        <div>
          <label>Audio Format</label>
          <select
            onChange={(e) => setAudioFormat(e.target.value)}
            value={audioFormat}
          >
            {AUDIO_FORMATS.map((f) => (
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
          <label>Convert on complete</label>
          <select
            onChange={(e) => setConvertFormat(e.target.value)}
            value={convertFormat}
          >
            <option value="">No conversion</option>
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
          <label>Quality</label>
          <select
            onChange={(e) => setAudioQuality(Number(e.target.value))}
            value={audioQuality}
          >
            {AUDIO_QUALITIES.map(({ label, value }) => (
              <option
                key={value}
                value={value}
              >
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Genre</label>
          <input
            onChange={(e) => setGenre(e.target.value)}
            placeholder="e.g. Techno"
            type="text"
            value={genre}
          />
        </div>
        <div>
          <label>Duration preset</label>
          <select
            onChange={handlePreset}
            value={activePreset}
          >
            <option value="">Custom</option>
            {DURATION_PRESETS.map((p) => (
              <option
                key={p.value}
                value={p.value}
              >
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <DurationInput
          label="Min Duration"
          onChange={setMinDuration}
          value={minDuration}
        />
        <DurationInput
          label="Max Duration"
          onChange={setMaxDuration}
          value={maxDuration}
        />
      </div>

      <div>
        <button
          className="ytdlp-btn hover-fx ytdlp-btn--primary"
          disabled={loading || !url.trim()}
          type="submit"
        >
          <Plus size={14} />
          {loading ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </form>
  );
};

export default AddPane;
