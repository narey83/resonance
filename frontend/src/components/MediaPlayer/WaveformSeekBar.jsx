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

// Resamples a [startFrac, endFrac) slice of peaks into one value per bar slot
// (max-hold, like a hardware meter). Uses proportional (float) bucket bounds
// rather than a fixed integer stride — an integer stride leaves a truncated,
// unsampled tail whenever the slice length isn't an exact multiple of
// numberSlots, which silently compresses/misaligns the back portion relative
// to actual playback position.
const resamplePeaks = (peaks, numberSlots, startFrac = 0, endFrac = 1) => {
  const sliceStart = startFrac * peaks.length;
  const sliceLength = (endFrac - startFrac) * peaks.length;
  const out = new Float32Array(numberSlots);
  for (let slot = 0; slot < numberSlots; slot++) {
    const start = Math.floor(sliceStart + (slot / numberSlots) * sliceLength);
    const end = Math.max(
      start + 1,
      Math.floor(sliceStart + ((slot + 1) / numberSlots) * sliceLength),
    );
    let peak = 0;
    for (
      let index = Math.max(0, start);
      index < Math.min(end, peaks.length);
      index++
    ) {
      if (peaks[index] > peak) peak = peaks[index];
    }

    out[slot] = peak;
  }

  return out;
};

// Pioneer CDJ / rekordbox-style frequency colouring: blue=low, orange=mid, white=high.
const BAND_COLOURS = { high: '#f5f5f5', low: '#2f6fed', mid: '#ff8a3d' };

// SoundCloud-style mirrored bar waveform, click/drag to seek.
// Falls back to nothing (caller renders the plain bar) when no peak data exists.
// variant: 'mono' (single accent-coloured bars) or 'bands' (Pioneer-style frequency colouring).
const WaveformSeekBar = ({
  duration,
  getCurrentTime,
  height = 40,
  onReady,
  onSeek,
  progressPct,
  track,
  variant = 'mono',
  zoom = 1,
}) => {
  const canvasRef = useRef(null);
  const peaksRef = useRef(null);
  // Caches the resampled (shape) arrays so redraws triggered by playback
  // progress alone (many times a second) don't redo the max-hold resample
  // over the full peaks arrays every time — only the played/unplayed split
  // actually changes between those redraws, not the bar shape. Only used at
  // zoom=1 (whole-track view); a zoomed, playhead-following window changes
  // every frame, so there's nothing to usefully cache there.
  const resampledRef = useRef(null);
  // The currently visible [start, end] time window in seconds — read by the
  // pointer handlers so clicking/dragging seeks to the right time even when
  // zoomed into a sub-range of the track. Updated every draw() call.
  const windowRef = useRef({ end: 0, start: 0 });
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
        peaksRef.current = {
          overall: new Float32Array(data.overallPeaks),
          low: new Float32Array(data.lowPeaks),
          mid: new Float32Array(data.midPeaks),
          high: new Float32Array(data.highPeaks),
        };
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

    // Render at full device pixel density so more of the backend's 3000
    // samples-per-track actually show up as bars, instead of the canvas's
    // CSS-pixel width capping resolution well below what's available.
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    // gap=0 (fully packed, zero margin) is fragile: any tiny mismatch between
    // the canvas's device-pixel buffer and how the browser actually paints it
    // (non-100% browser zoom, sub-pixel rounding) turns a 1px-per-bar pattern
    // into visible periodic Moiré banding unrelated to the real audio. A 1px
    // gap gives enough tolerance that a scale mismatch just softens bar edges.
    const barWidth = 1;
    const gap = 1;
    const numberSlots = Math.max(1, Math.floor(pixelWidth / (barWidth + gap)));

    // Read the live audio position directly rather than the progressPct prop
    // — that prop only updates as often as the browser's throttled
    // "timeupdate" event fires (a few times a second), which makes the
    // played/unplayed boundary visibly step rather than move smoothly. This
    // runs inside a requestAnimationFrame loop (below), so it's cheap to
    // read every frame.
    const liveTime =
      getCurrentTime && duration
        ? getCurrentTime()
        : (progressPct / 100) * duration;

    // At zoom > 1, only a window of the track is visible, centred on (and
    // following) the current playback position, clamped so it never scrolls
    // past the track's start/end.
    let windowStart = 0;
    let windowEnd = duration || 0;
    if (zoom > 1 && duration) {
      const zoomedDuration = duration / zoom;
      windowStart = Math.max(
        0,
        Math.min(duration - zoomedDuration, liveTime - zoomedDuration / 2),
      );
      windowEnd = windowStart + zoomedDuration;
    }

    windowRef.current = { end: windowEnd, start: windowStart };
    const startFrac = duration ? windowStart / duration : 0;
    const endFrac = duration ? windowEnd / duration : 1;

    let resampled = resampledRef.current;
    if (
      zoom > 1 ||
      !resampled ||
      resampled.source !== peaks ||
      resampled.numberSlots !== numberSlots
    ) {
      const overallSlots = resamplePeaks(
        peaks.overall,
        numberSlots,
        startFrac,
        endFrac,
      );
      let peakMax = 1e-6;
      for (const peak of overallSlots) if (peak > peakMax) peakMax = peak;
      resampled = {
        source: peaks,
        numberSlots,
        max: peakMax,
        overall: overallSlots,
        low: resamplePeaks(peaks.low, numberSlots, startFrac, endFrac),
        mid: resamplePeaks(peaks.mid, numberSlots, startFrac, endFrac),
        high: resamplePeaks(peaks.high, numberSlots, startFrac, endFrac),
      };
      // Only worth caching the whole-track (zoom=1) view — a following
      // window changes every frame, so caching it would never hit anyway.
      if (zoom <= 1) resampledRef.current = resampled;
    }

    const { high, low, max, mid, overall } = resampled;

    const context = canvas.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    const halfH = pixelHeight / 2;
    const windowDuration = windowEnd - windowStart || 1;
    const playedSlots = Math.round(
      ((liveTime - windowStart) / windowDuration) * numberSlots,
    );

    // Theme-aware muted colour for the unplayed portion of the mono bars —
    // matches whichever theme (light/AMOLED) is active rather than a fixed
    // white that washes out on light backgrounds.
    const rootStyle = getComputedStyle(canvas);
    const dimColour =
      rootStyle.getPropertyValue('--player-text-dim').trim() ||
      'rgba(128,128,128,0.3)';

    if (variant === 'bands') {
      for (let slot = 0; slot < numberSlots; slot++) {
        const totalH = Math.max(2, (overall[slot] / max) * halfH);
        // Boost bass so kick transients dominate visually (DJ-style perceptual weighting)
        const wLow = low[slot] * 1.5;
        const wMid = mid[slot];
        const wHigh = high[slot] * 0.6;
        const bandSum = wLow + wMid + wHigh + 1e-6;
        const lowH = Math.round((totalH * wLow) / bandSum);
        const midH = Math.round((totalH * wMid) / bandSum);
        const highH = totalH - lowH - midH;
        const x = slot * (barWidth + gap);
        const played = slot < playedSlots;

        // The bands variant always sits on its own fixed dark background
        // (see .mp-waveform-seeker--bands), so dimming the real band colours
        // via alpha is safe here — unlike the mono variant, there's no
        // arbitrary/light theme surface behind it to wash out against.
        context.globalAlpha = played ? 1 : 0.35;

        // Top half — bass at centre, mids above, highs at the tip
        context.fillStyle = BAND_COLOURS.low;
        context.fillRect(x, halfH - lowH, barWidth, lowH);
        context.fillStyle = BAND_COLOURS.mid;
        context.fillRect(x, halfH - lowH - midH, barWidth, midH);
        context.fillStyle = BAND_COLOURS.high;
        context.fillRect(x, halfH - totalH, barWidth, highH);
        // Bottom half — mirror
        context.fillStyle = BAND_COLOURS.low;
        context.fillRect(x, halfH, barWidth, lowH);
        context.fillStyle = BAND_COLOURS.mid;
        context.fillRect(x, halfH + lowH, barWidth, midH);
        context.fillStyle = BAND_COLOURS.high;
        context.fillRect(x, halfH + lowH + midH, barWidth, highH);
      }

      context.globalAlpha = 1;
      return;
    }

    const accent =
      rootStyle.getPropertyValue('--art-accent').trim() ||
      rootStyle.getPropertyValue('--player-fill').trim() ||
      '#4d9fff';

    for (let slot = 0; slot < numberSlots; slot++) {
      const barH = Math.max(2, (overall[slot] / max) * halfH);
      const x = slot * (barWidth + gap);
      context.fillStyle = slot < playedSlots ? accent : dimColour;
      context.fillRect(x, halfH - barH, barWidth, barH * 2);
    }
  };

  // Always call the latest draw closure — the rAF loop below is set up once
  // (on mount / when ready toggles) rather than re-subscribing every render,
  // so it needs a stable way to reach whatever the current closure is.
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    if (!ready) return undefined;
    let frameId;
    const loop = () => {
      drawRef.current();
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [ready]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const fractionFromEvent = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  };

  // Maps a fraction across the canvas to a track time, through whatever
  // window is currently visible (the whole track at zoom=1, a following
  // sub-range at zoom>1).
  const timeFromFraction = (fraction) => {
    const { end, start } = windowRef.current;
    return start + fraction * (end - start);
  };

  const handlePointerDown = (event) => {
    if (!duration) return;
    draggingRef.current = true;
    canvasRef.current.setPointerCapture(event.pointerId);
    onSeek(timeFromFraction(fractionFromEvent(event)));
  };

  const handlePointerMove = (event) => {
    const fraction = fractionFromEvent(event);
    setHoverFraction(fraction);
    if (draggingRef.current && duration) onSeek(timeFromFraction(fraction));
  };

  const handlePointerUp = (event) => {
    draggingRef.current = false;
    canvasRef.current.releasePointerCapture(event.pointerId);
  };

  // Keyboard seek parity with the plain scrubber bar (±5s) — the canvas has
  // no native seek behaviour of its own, so without this a keyboard-only
  // user could seek the plain bar but not the waveform.
  const handleKeyDown = (event) => {
    if (!duration) return;
    const current = (progressPct / 100) * duration;
    if (event.key === 'ArrowRight') onSeek(Math.min(current + 5, duration));
    if (event.key === 'ArrowLeft') onSeek(Math.max(current - 5, 0));
  };

  if (!ready) return null;

  return (
    <div
      className={`mp-waveform-seeker${variant === 'bands' ? ' mp-waveform-seeker--bands' : ''}`}
      style={{ height }}
    >
      <canvas
        aria-label="Seek"
        aria-valuemax={duration}
        aria-valuemin={0}
        aria-valuenow={(progressPct / 100) * duration}
        className="mp-waveform-canvas"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerLeave={() => setHoverFraction(null)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={canvasRef}
        role="slider"
        tabIndex={0}
      />
      {hoverFraction !== null && (
        <div
          className="media-player-scrubber-tooltip"
          style={{ left: `${hoverFraction * 100}%` }}
        >
          {formatSeconds(timeFromFraction(hoverFraction))}
        </div>
      )}
    </div>
  );
};

export default WaveformSeekBar;
