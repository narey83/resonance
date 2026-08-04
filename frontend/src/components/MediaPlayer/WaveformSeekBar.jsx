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
import { analyzeTrack } from '../../lib/musicLibrary';
import { formatSeconds } from '../../lib/util';
import {
  beatGridSeconds,
  maxOf,
  resamplePeaks,
  waveColours,
} from '../../lib/waveform';
import { primeWaveformCache } from '../Shared/WaveformPreview';
import React, { useEffect, useRef, useState } from 'react';

// The cached whole-track grid is sampled finer than the bars actually drawn, so
// the per-frame window resample is a genuine N:1 aggregation. Resampling by a
// ratio close to — but not exactly — 1:1 duplicates or drops an atom at a
// regular interval, striping the waveform with a periodic beat pattern that
// crawls as the window scrolls. Aggregating several atoms per bar can't beat
// against the bar grid at all.
const GRID_OVERSAMPLE = 4;

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

    // The waveform request below only asks for waveform and loudness, so a track played
    // before it was ever scanned kept its blank BPM and key no matter how often you played
    // it. Playing is the clearest signal the user cares about this track, so top up the
    // metrics it's still missing. skipAnalysed lets the backend narrow the work to the
    // actual gaps, making this free for a track that already has both, and a 409 just means
    // a scan is already running — which will reach this track on its own.
    analyzeTrack([track.path], {
      metrics: 'Bpm, Key',
      skipAnalysed: true,
    }).catch(() => {});

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
    const token = (name, fallback) =>
      style.getPropertyValue(name).trim() || fallback;
    coloursRef.current = {
      accent:
        token('--art-accent', '') || token('--player-fill', '') || '#4d9fff',
      at: now,
      dim: token('--player-text-dim', 'rgba(128,128,128,0.3)'),
      // Band palette and blend mode come from the theme, shared with the library
      // row previews — the colours are only legible if the blend matches the
      // panel they sit on, so the two travel together.
      ...waveColours(canvas),
    };
    return coloursRef.current;
  };

  const draw = () => {
    const canvas = canvasRef.current;
    const peaks = peaksRef.current;
    if (!canvas || !peaks) return;

    // Render at full device pixel density so more of the backend's stored peaks
    // actually show up, instead of the canvas's CSS-pixel width capping
    // resolution well below what's available.
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    // One column per CSS pixel, packed edge to edge with no gap. Any gap makes
    // the waveform a comb, and a 1-device-pixel bar with a 1-device-pixel gap
    // is a comb at exactly the pixel grid's Nyquist frequency: every non-1:1
    // mapping between the canvas backing store and the physical pixels
    // (fractional devicePixelRatio, browser zoom, a scaled desktop, the
    // compositor resampling the layer) then beats against it and bands the
    // whole waveform in Moiré unrelated to the audio. A solid fill has no
    // periodic structure to beat against at all, and a whole number of device
    // pixels per column keeps every column identical to its neighbours.
    const dprScale = Math.max(1, Math.round(dpr));

    // Never draw more columns than the window actually has stored peaks for.
    // The backend stores 200 peaks a second, so at 64x a 6 minute track has
    // ~1100 peaks in view for ~2000 columns of canvas: each peak then gets
    // stretched across one or two columns in a repeating 2,2,1 pattern, which
    // paints a barcode of invented detail. Widening the column instead keeps
    // one drawn column backed by at least one real peak.
    const windowPeaks = Math.max(1, Math.floor(peaks.overall.length / zoom));
    const barWidth = Math.max(
      dprScale,
      Math.ceil(pixelWidth / windowPeaks / dprScale) * dprScale,
    );
    const numberSlots = Math.max(1, Math.floor(pixelWidth / barWidth));

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

    // Pre-resample the whole track once, at a few grid "atoms" per drawn bar at
    // the current zoom, and cache it. Re-aggregating the shape straight
    // from raw peaks every frame (60x/sec) as a following window shifts by
    // fractions of a bin causes visible jitter — quantisation boundaries land
    // slightly differently frame to frame even though nothing audible changed.
    // Against this grid the visible window is a fixed GRID_OVERSAMPLE:1 slice
    // instead, so the shape is rock stable and the per-frame scan is one pass
    // over a small multiple of what's drawn. (Sizing the grid for the
    // deepest zoom instead meant
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
      // Capped at the stored peak count: a grid finer than the source data is
      // pure interpolation, and at 64x zoom the uncapped size was half a
      // million atoms a band.
      const fullSlots = Math.min(
        numberSlots * zoom * GRID_OVERSAMPLE,
        peaks.overall.length,
      );
      const overallFull = resamplePeaks(peaks.overall, fullSlots);
      const lowFull = resamplePeaks(peaks.low, fullSlots);
      const midFull = resamplePeaks(peaks.mid, fullSlots);
      const highFull = resamplePeaks(peaks.high, fullSlots);
      resampled = {
        source: peaks,
        numberSlots,
        fullSlots,
        zoom,
        // Fixed, whole-track reference so bar heights stay stable as the
        // window scrolls — recomputing this from only what's currently
        // visible would make the whole waveform rescale ("breathe") as loud
        // or quiet moments enter/leave the frame. Each band normalises against
        // its OWN max: bass energy and hi-hat energy live at very different
        // absolute magnitudes, so a shared scale leaves one band permanently
        // faint.
        max: maxOf(overallFull),
        lowMax: maxOf(lowFull),
        midMax: maxOf(midFull),
        highMax: maxOf(highFull),
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
    // scroll only moves when it has accumulated a whole column, which at zoom 2
    // is one jerk every few hundred ms: the stutter. One extra slot is
    // sampled to cover what the shift pulls in from the right.
    const windowDuration = windowEnd - windowStart || 1;
    const slotSeconds = windowDuration / numberSlots;
    const slotStart = windowStart / slotSeconds;
    const snappedSlot = Math.floor(slotStart);
    const offsetPx = (slotStart - snappedSlot) * barWidth;
    const slots = numberSlots + 1;
    const drawStart = snappedSlot * slotSeconds;
    const drawEnd = drawStart + slots * slotSeconds;
    const startFrac = duration ? drawStart / duration : 0;
    const endFrac = duration ? drawEnd / duration : 1;
    // Resample the window from the cached grid (fullSlots), not the raw peaks
    // — this aggregates an already-quantised, per-frame-stable set of "atoms"
    // rather than freshly re-aggregating raw high-resolution samples, which is
    // what kills the frame-to-frame jitter.
    const overall = resamplePeaks(resampled.overall, slots, startFrac, endFrac);
    const low = resamplePeaks(resampled.low, slots, startFrac, endFrac);
    const mid = resamplePeaks(resampled.mid, slots, startFrac, endFrac);
    const high = resamplePeaks(resampled.high, slots, startFrac, endFrac);

    const context = canvas.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    context.translate(-offsetPx, 0);
    const halfH = pixelHeight / 2;
    const pixelsPerSecond = barWidth / slotSeconds;
    // Exact fractional playhead position. Colouring whole bars played/unplayed
    // instead (what this used to do) quantises the boundary to a bar, i.e. to
    // ~half a second of audio at zoom 1 — the played edge visibly hopped.
    const playedX = Math.max(0, (liveTime - drawStart) * pixelsPerSecond);
    const clipToPlayed = () => {
      context.beginPath();
      context.rect(0, 0, playedX, pixelHeight);
      context.clip();
    };

    // Both variants take their colours from the active theme's tokens rather
    // than fixed hexes, so light and AMOLED each get a palette that suits the
    // panel they're drawn on.
    const colours = getColours(canvas);

    // Beat grid, anchored at track start — there's no detected downbeat/phase
    // offset stored per track, only a single averaged BPM, so this assumes beat
    // 1 lands at 0:00. Correct BPM + a beat starting right at the top of the
    // track means the kicks should sit right on these lines; an intro/pickup
    // before the beat locks in will drift the two apart even with correct BPM.
    const drawBeatGrid = () => {
      // One line per beat at zoom 1 is a line every pixel or two — a second
      // comb at almost exactly the waveform's own period, which is where the
      // crawling Moiré came from. Widen to bar/phrase lines, or drop the grid.
      const lineSeconds = beatGridSeconds(
        track?.bpm,
        pixelsPerSecond,
        8 * dprScale,
      );
      if (!lineSeconds) return;
      const firstBeat = Math.ceil(drawStart / lineSeconds) * lineSeconds;
      context.save();
      context.strokeStyle = colours.grid;
      context.lineWidth = 1;
      for (let time = firstBeat; time < drawEnd; time += lineSeconds) {
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
      // Plain source-over layering muddies the three bands into a flat wash:
      // once a column covers any real span of audio most columns have all three
      // bands moderately present. Blending them instead makes an overlap mean
      // something — additively on a dark panel (bands brighten into vivid
      // combined colour), multiplied on a light one (they darken like ink).
      context.globalCompositeOperation = colours.blend;
      const drawBandBars = (playedAlpha) => {
        for (let slot = 0; slot < slots; slot++) {
          const totalH = Math.max(2, (overall[slot] / max) * halfH);
          const x = slot * barWidth;

          // Opacity per frequency band, not a fixed-height stacked slice — each
          // band's alpha is how present it is RIGHT NOW relative to its own
          // dynamic range, so a kick-heavy instant reads as solid blue and a
          // hi-hat-heavy one as the "high" colour, while a full mix blends to
          // neutral. The 1.4/0.9 weights keep bass/highs perceptually balanced
          // against mids (DJ-style).
          const lowAlpha = Math.min(1, (low[slot] / lowMax) * 1.4);
          const midAlpha = Math.min(1, mid[slot] / midMax);
          const highAlpha = Math.min(1, (high[slot] / highMax) * 0.9);

          context.globalAlpha = playedAlpha * lowAlpha;
          context.fillStyle = colours.low;
          context.fillRect(x, halfH - totalH, barWidth, totalH * 2);

          context.globalAlpha = playedAlpha * midAlpha;
          context.fillStyle = colours.mid;
          context.fillRect(x, halfH - totalH, barWidth, totalH * 2);

          context.globalAlpha = playedAlpha * highAlpha;
          context.fillStyle = colours.high;
          context.fillRect(x, halfH - totalH, barWidth, totalH * 2);
        }
      };

      // Unplayed pass over everything, then the played region on top, clipped
      // at the exact playhead pixel, so the two passes accumulate to a
      // full-strength played bar (0.35 + 0.65).
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

    const { accent, dim: dimColour } = colours;

    const drawMonoBars = (colour) => {
      context.fillStyle = colour;
      for (let slot = 0; slot < slots; slot++) {
        const barH = Math.max(2, (overall[slot] / max) * halfH);
        context.fillRect(slot * barWidth, halfH - barH, barWidth, barH * 2);
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
      className="mp-waveform-seeker"
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
