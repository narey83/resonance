// <copyright file="WaveformSeekBar.jsx" company="John Narey">
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

import api from '../../lib/api';
import { formatSeconds } from '../../lib/util';
import React, { useEffect, useRef, useState } from 'react';

// Resamples peaks into one value per bar slot (max-hold, like a hardware meter).
// Uses proportional (float) bucket bounds rather than a fixed integer stride —
// an integer stride leaves a truncated, unsampled tail whenever peaks.length
// isn't an exact multiple of numberSlots, which silently compresses/misaligns
// the back portion of the track relative to actual playback position.
const resamplePeaks = (peaks, numberSlots) => {
  const out = new Float32Array(numberSlots);
  for (let slot = 0; slot < numberSlots; slot++) {
    const start = Math.floor((slot / numberSlots) * peaks.length);
    const end = Math.max(
      start + 1,
      Math.floor(((slot + 1) / numberSlots) * peaks.length),
    );
    let peak = 0;
    for (let index = start; index < end; index++) {
      if (peaks[index] > peak) peak = peaks[index];
    }

    out[slot] = peak;
  }

  return out;
};

// SoundCloud-style mirrored bar waveform, click/drag to seek.
// Falls back to nothing (caller renders the plain bar) when no peak data exists.
const WaveformSeekBar = ({ duration, onReady, onSeek, progressPct, track }) => {
  const canvasRef = useRef(null);
  const peaksRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [hoverFraction, setHoverFraction] = useState(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    setReady(false);
    onReady(false);
    peaksRef.current = null;
    if (!track?.path) return undefined;

    let cancelled = false;
    api
      .get('/waveform', { params: { path: track.path } })
      .then(({ data }) => {
        if (cancelled || !data?.overallPeaks?.length) return;
        peaksRef.current = new Float32Array(data.overallPeaks);
        setReady(true);
        onReady(true);
      })
      .catch(() => {
        /* no cached waveform — caller falls back to the plain bar */
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.path]);

  const draw = () => {
    const canvas = canvasRef.current;
    const peaks = peaksRef.current;
    if (!canvas || !peaks) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const barWidth = 2;
    const gap = 1;
    const numberSlots = Math.max(1, Math.floor(width / (barWidth + gap)));
    const slots = resamplePeaks(peaks, numberSlots);
    let max = 1e-6;
    for (const peak of slots) if (peak > max) max = peak;

    const context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    const halfH = height / 2;
    const playedSlots = Math.round((progressPct / 100) * numberSlots);

    const rootStyle = getComputedStyle(canvas);
    const accent =
      rootStyle.getPropertyValue('--art-accent').trim() ||
      rootStyle.getPropertyValue('--player-fill').trim() ||
      '#4d9fff';

    for (let slot = 0; slot < numberSlots; slot++) {
      const barH = Math.max(2, (slots[slot] / max) * halfH);
      const x = slot * (barWidth + gap);
      context.fillStyle =
        slot < playedSlots ? accent : 'rgba(255,255,255,0.28)';
      context.fillRect(x, halfH - barH, barWidth, barH * 2);
    }
  };

  useEffect(draw);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const fractionFromEvent = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  };

  const handlePointerDown = (event) => {
    if (!duration) return;
    draggingRef.current = true;
    canvasRef.current.setPointerCapture(event.pointerId);
    onSeek(fractionFromEvent(event) * duration);
  };

  const handlePointerMove = (event) => {
    const fraction = fractionFromEvent(event);
    setHoverFraction(fraction);
    if (draggingRef.current && duration) onSeek(fraction * duration);
  };

  const handlePointerUp = (event) => {
    draggingRef.current = false;
    canvasRef.current.releasePointerCapture(event.pointerId);
  };

  if (!ready) return null;

  return (
    <div className="mp-waveform-seeker">
      <canvas
        aria-label="Seek"
        aria-valuemax={duration}
        aria-valuemin={0}
        aria-valuenow={(progressPct / 100) * duration}
        className="mp-waveform-canvas"
        onPointerDown={handlePointerDown}
        onPointerLeave={() => setHoverFraction(null)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={canvasRef}
        role="slider"
      />
      {hoverFraction !== null && (
        <div
          className="media-player-scrubber-tooltip"
          style={{ left: `${hoverFraction * 100}%` }}
        >
          {formatSeconds(hoverFraction * duration)}
        </div>
      )}
    </div>
  );
};

export default WaveformSeekBar;
