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
import { primeWaveformCache } from '../Shared/WaveformPreview';
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
  onScratchEnd,
  onScratchMove,
  onScratchStart,
  onSeek,
  progressPct,
  track,
  variant = 'mono',
  zoom = 1,
}) => {
  const canvasRef = useRef(null);
  const peaksRef = useRef(null);
  // Caches a fixed-resolution resample of the whole track (fine enough to
  // cover the highest zoom level), so per-frame redraws only need to
  // re-aggregate that stable grid down to the visible window, not re-derive
  // the shape from raw peaks every time.
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
      .get('/analysis/waveform', { params: { path: track.path } })
      .then(({ data }) => {
        if (cancelled || !data?.overallPeaks?.length) return;

        // This request analyses the track if it wasn't already (no cachedOnly),
        // so it's often the first place the peaks exist — hand them to the
        // library rows' cache rather than let them keep showing "not analysed".
        primeWaveformCache(track.path, data);

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

  // Reading CSS custom properties forces a style recalc, and these only change
  // on a theme switch or an art-accent crossfade — doing it 60 times a second
  // inside the redraw loop was spending frame budget on a constant. A few
  // reads a second is still fast enough for a crossfade to look continuous.
  const coloursRef = useRef({ at: 0 });
  const getColours = (canvas) => {
    const now = performance.now();
    if (now - coloursRef.current.at < 100) return coloursRef.current;
    const style = getComputedStyle(canvas);
    coloursRef.current = {
      accent:
        style.getPropertyValue('--art-accent').trim() ||
        style.getPropertyValue('--player-fill').trim() ||
        '#4d9fff',
      at: now,
      dim:
        style.getPropertyValue('--player-text-dim').trim() ||
        'rgba(128,128,128,0.3)',
    };
    return coloursRef.current;
  };

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

    // Pre-resample the whole track once, at exactly one grid "atom" per drawn
    // bar at the current zoom, and cache it. Re-aggregating the shape straight
    // from raw peaks every frame (60x/sec) as a following window shifts by
    // fractions of a bin causes visible jitter — quantisation boundaries land
    // slightly differently frame to frame even though nothing audible changed.
    // Against this grid the visible window is a straight 1:1 slice instead, so
    // the shape is rock stable and the per-frame scan is one pass over what's
    // actually drawn. (Sizing the grid for the deepest zoom instead meant
    // every frame at zoom 1 re-scanned an array 100x larger than it drew,
    // which is where the frame budget was going.)
    let resampled = resampledRef.current;
    if (
      !resampled ||
      resampled.source !== peaks ||
      resampled.zoom !== zoom ||
      // Tolerate small width fluctuations (e.g. the elapsed-time label's text
      // width changing by a pixel or two each second, nudging the flex
      // layout) rather than rebuilding this fairly expensive fine grid every
      // time — that was causing a visible once-a-second stutter. A real
      // resize (window resize, height change) will still be well past
      // this tolerance.
      Math.abs(resampled.numberSlots - numberSlots) > 20
    ) {
      const fullSlots = numberSlots * zoom;
      const overallFull = resamplePeaks(peaks.overall, fullSlots);
      const lowFull = resamplePeaks(peaks.low, fullSlots);
      const midFull = resamplePeaks(peaks.mid, fullSlots);
      const highFull = resamplePeaks(peaks.high, fullSlots);
      let peakMax = 1e-6;
      for (const peak of overallFull) if (peak > peakMax) peakMax = peak;
      // Each band normalises against its OWN max, not the overall max — bass
      // energy and hi-hat energy naturally live at very different absolute
      // magnitudes, so a shared scale would leave one band permanently faint.
      let lowPeakMax = 1e-6;
      let midPeakMax = 1e-6;
      let highPeakMax = 1e-6;
      for (const v of lowFull) if (v > lowPeakMax) lowPeakMax = v;
      for (const v of midFull) if (v > midPeakMax) midPeakMax = v;
      for (const v of highFull) if (v > highPeakMax) highPeakMax = v;
      resampled = {
        source: peaks,
        numberSlots,
        fullSlots,
        zoom,
        // Fixed, whole-track reference so bar heights stay stable as the
        // window scrolls — recomputing this from only what's currently
        // visible would make the whole waveform rescale ("breathe") as loud
        // or quiet moments enter/leave the frame.
        max: peakMax,
        lowMax: lowPeakMax,
        midMax: midPeakMax,
        highMax: highPeakMax,
        overall: overallFull,
        low: lowFull,
        mid: midFull,
        high: highFull,
      };
      resampledRef.current = resampled;
    }

    const { highMax, lowMax, max, midMax } = resampled;

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

    // Bars can only be sampled on whole-slot boundaries, but the window slides
    // continuously — so snap the sampled window down to the nearest slot and
    // carry the leftover as a sub-pixel canvas translation. Without this the
    // scroll only moves when it has accumulated a whole bar, which at zoom 2
    // is one 2px jerk every few hundred ms: the stutter. One extra slot is
    // sampled to cover what the shift pulls in from the right.
    const windowDuration = windowEnd - windowStart || 1;
    const slotSeconds = windowDuration / numberSlots;
    const slotStart = windowStart / slotSeconds;
    const snappedSlot = Math.floor(slotStart);
    const offsetPx = (slotStart - snappedSlot) * (barWidth + gap);
    const slots = numberSlots + 1;
    const drawStart = snappedSlot * slotSeconds;
    const drawEnd = drawStart + slots * slotSeconds;
    const startFrac = duration ? drawStart / duration : 0;
    const endFrac = duration ? drawEnd / duration : 1;
    // Resample the window from the cached grid (fullSlots), not the raw peaks
    // — this is a direct 1:1 slice of an already-quantised, per-frame-stable
    // set of "atoms" rather than a fresh aggregation of raw high-resolution
    // samples, which is what kills the frame-to-frame jitter.
    const overall = resamplePeaks(resampled.overall, slots, startFrac, endFrac);
    const low = resamplePeaks(resampled.low, slots, startFrac, endFrac);
    const mid = resamplePeaks(resampled.mid, slots, startFrac, endFrac);
    const high = resamplePeaks(resampled.high, slots, startFrac, endFrac);

    const context = canvas.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    context.translate(-offsetPx, 0);
    const halfH = pixelHeight / 2;
    const pixelsPerSecond = (barWidth + gap) / slotSeconds;
    // Exact fractional playhead position. Colouring whole bars played/unplayed
    // instead (what this used to do) quantises the boundary to a bar, i.e. to
    // ~half a second of audio at zoom 1 — the played edge visibly hopped.
    const playedX = Math.max(0, (liveTime - drawStart) * pixelsPerSecond);
    const clipToPlayed = () => {
      context.beginPath();
      context.rect(0, 0, playedX, pixelHeight);
      context.clip();
    };

    // Beat grid: a line every beat (60/bpm seconds), anchored at track start —
    // there's no detected downbeat/phase offset stored per track, only a
    // single averaged BPM, so this assumes beat 1 lands at 0:00. Correct BPM
    // + a beat starting right at the top of the track means the kicks should
    // sit right on these lines; an intro/pickup before the beat locks in will
    // drift the two apart even with correct BPM.
    const drawBeatGrid = () => {
      const bpm = track?.bpm;
      if (!bpm) return;
      const secondsPerBeat = 60 / bpm;
      const firstBeat = Math.ceil(drawStart / secondsPerBeat) * secondsPerBeat;
      context.save();
      context.strokeStyle = 'rgba(128,128,128,0.4)';
      context.lineWidth = 1;
      for (let time = firstBeat; time < drawEnd; time += secondsPerBeat) {
        // Whole-pixel snapping only where the view is static — under a
        // scrolling sub-pixel offset it would make the grid jitter against
        // the bars it is supposed to line up with.
        const rawX = (time - drawStart) * pixelsPerSecond;
        const x = offsetPx ? rawX : Math.round(rawX) + 0.5;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, pixelHeight);
        context.stroke();
      }

      context.restore();
    };

    if (variant === 'bands') {
      // Additive ("glow") blending instead of plain alpha layering — at low
      // zoom each bar max-holds thousands of samples, so most bars end up
      // with all three bands moderately present, and plain source-over
      // blending just muddies that into a flat pale wash. Additive blending
      // makes overlapping bands brighten into vivid combined colour instead
      // of muddying together, without needing to darken anything else.
      context.globalCompositeOperation = 'lighter';
      const drawBandBars = (playedAlpha) => {
        for (let slot = 0; slot < slots; slot++) {
          const totalH = Math.max(2, (overall[slot] / max) * halfH);
          const x = slot * (barWidth + gap);

          // Opacity per frequency band, not a fixed-height stacked slice — each
          // band's alpha is how present it is RIGHT NOW relative to its own
          // dynamic range, so a kick-heavy instant reads as solid blue, a
          // hi-hat-heavy instant as solid white, and a full mix blends toward
          // grey as the three semi-transparent layers overlap. The 1.4/0.9
          // weights keep bass/highs perceptually balanced against mids (DJ-style).
          const lowAlpha = Math.min(1, (low[slot] / lowMax) * 1.4);
          const midAlpha = Math.min(1, mid[slot] / midMax);
          const highAlpha = Math.min(1, (high[slot] / highMax) * 0.9);

          // The bands variant always sits on its own fixed dark background
          // (see .mp-waveform-seeker--bands), so alpha-blending the real band
          // colours straight onto it is safe here — unlike the mono variant,
          // there's no arbitrary/light theme surface behind it to wash out against.
          context.globalAlpha = playedAlpha * lowAlpha;
          context.fillStyle = BAND_COLOURS.low;
          context.fillRect(x, halfH - totalH, barWidth, totalH * 2);

          context.globalAlpha = playedAlpha * midAlpha;
          context.fillStyle = BAND_COLOURS.mid;
          context.fillRect(x, halfH - totalH, barWidth, totalH * 2);

          context.globalAlpha = playedAlpha * highAlpha;
          context.fillStyle = BAND_COLOURS.high;
          context.fillRect(x, halfH - totalH, barWidth, totalH * 2);
        }
      };

      // Unplayed pass over everything, then the played region on top, clipped
      // at the exact playhead pixel. Additive blending means the two passes
      // sum, so the top-up is the remainder (0.35 + 0.65 = the full-strength
      // played bar).
      drawBandBars(0.35);
      context.save();
      clipToPlayed();
      drawBandBars(0.65);
      context.restore();

      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      drawBeatGrid();
      return;
    }

    // Theme-aware muted colour for the unplayed bars — matches whichever theme
    // (light/AMOLED) is active rather than a fixed white that washes out on
    // light backgrounds.
    const { accent, dim: dimColour } = getColours(canvas);

    const drawMonoBars = (colour) => {
      context.fillStyle = colour;
      for (let slot = 0; slot < slots; slot++) {
        const barH = Math.max(2, (overall[slot] / max) * halfH);
        context.fillRect(
          slot * (barWidth + gap),
          halfH - barH,
          barWidth,
          barH * 2,
        );
      }
    };

    drawMonoBars(dimColour);
    context.save();
    clipToPlayed();
    drawMonoBars(accent);
    context.restore();

    drawBeatGrid();
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
  // sub-range at zoom>1). Used for plain click/drag-to-seek.
  const timeFromFraction = (fraction) => {
    const { end, start } = windowRef.current;
    return start + fraction * (end - start);
  };

  // Scratching needs a fixed, zoom-independent sensitivity — grabbing the
  // waveform should feel like grabbing a physical record: a given amount of
  // hand movement always covers the same amount of audio, regardless of how
  // zoomed in the view happens to be. Mapping through the visible window
  // (like plain seeking does) meant a tiny drag at low zoom covered minutes
  // of audio, which is what made it feel like it was "going too fast".
  const SCRATCH_PIXELS_PER_SECOND = 400;
  const dragStartRef = useRef({ clientX: 0, time: 0 });

  const handlePointerDown = (event) => {
    if (!duration) return;
    draggingRef.current = true;
    canvasRef.current.setPointerCapture(event.pointerId);
    const time = timeFromFraction(fractionFromEvent(event));
    if (onScratchStart) {
      dragStartRef.current = { clientX: event.clientX, time };
      onScratchStart(time);
    } else {
      onSeek(time);
    }
  };

  const handlePointerMove = (event) => {
    const fraction = fractionFromEvent(event);
    setHoverFraction(fraction);
    if (!draggingRef.current || !duration) return;
    if (onScratchMove) {
      const deltaTime =
        (event.clientX - dragStartRef.current.clientX) /
        SCRATCH_PIXELS_PER_SECOND;
      onScratchMove(
        Math.max(0, Math.min(duration, dragStartRef.current.time + deltaTime)),
      );
    } else {
      onSeek(timeFromFraction(fraction));
    }
  };

  const handlePointerUp = (event) => {
    draggingRef.current = false;
    canvasRef.current.releasePointerCapture(event.pointerId);
    if (!onScratchEnd) return;
    const deltaTime =
      (event.clientX - dragStartRef.current.clientX) /
      SCRATCH_PIXELS_PER_SECOND;
    onScratchEnd(
      Math.max(0, Math.min(duration, dragStartRef.current.time + deltaTime)),
    );
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
