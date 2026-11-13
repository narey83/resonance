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

import { useLibraryActivity } from '../../context/LibraryActivityContext';
import { getWaveform } from '../../lib/analysis';
import {
  analysisToPlaybackTime,
  pixelToTime,
  playbackToAnalysisTime,
  resolveBeatAvailability,
  resolveWaveformDuration,
  timeToPixel,
} from '../../lib/analysisTimeline';
import api from '../../lib/api';
import { drawEnhanced } from '../../lib/enhancedWaveform';
import { formatSeconds } from '../../lib/util';
import {
  basicBarMarkers,
  beatGridPhase,
  beatGridSeconds,
  firstGridLineAt,
  maxOf,
  resamplePeaks,
  visibleBeatTimes,
  waveColours,
  waveformBeatBpm,
} from '../../lib/waveform';
import { analyseTrack, primeWaveformCache } from '../Shared/WaveformPreview';
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
const WaveformSeekBar = ({
  duration,
  getCurrentTime,
  height = 40,
  onAnalysing,
  onReady,
  onSeek,
  phraseMode = 'dj',
  progressPct,
  showGrid = true,
  showVocals = true,
  track,
  zoom = 1,
}) => {
  const canvasRef = useRef(null);
  const enhancedRef = useRef(null);
  const enhancedPathRef = useRef(null);
  const [enhanced, setEnhanced] = useState(null);
  const libraryRevision = useLibraryActivity()?.libraryRevision ?? 0;
  useEffect(() => {
    let cancelled = false;
    // Library-wide updates refresh this track too. Keep its current grid visible
    // until the response arrives; only a different track must clear it immediately.
    if (enhancedPathRef.current !== track?.path) {
      enhancedPathRef.current = track?.path;
      enhancedRef.current = null;
      setEnhanced(null);
    }

    if (track?.path)
      api
        .get('/analysis/candidates/enhanced', { params: { path: track.path } })
        .then(({ data }) => {
          if (!cancelled) {
            enhancedRef.current = data;
            setEnhanced(data);
          }
        })
        .catch(() => {
          if (!cancelled && !enhancedRef.current)
            setEnhanced({ available: false });
        });
    return () => {
      cancelled = true;
    };
  }, [track?.path, libraryRevision]);
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

  // The stable timeline the waveform/playhead/beat-grid are laid out against — the analysis's
  // own PCM duration whenever it's known, falling back to another already-stable track duration,
  // and only to the live media element's duration as a last resort. Deliberately NOT `duration`
  // (that prop is `HTMLAudioElement.duration`, which a browser can revise mid-playback for a
  // streamed, variable-bitrate file while `currentTime` stays accurate — dividing by a moving
  // target is what makes the playhead drift away from the waveform's own, fixed timebase). See
  // resolveWaveformDuration for why this ordering.
  const waveformDuration = resolveWaveformDuration(
    peaksRef.current?.analysisDuration,
    track?.length,
    duration,
  );

  useEffect(() => {
    setReady(false);
    onReady(false);
    peaksRef.current = null;
    if (!track?.path) {
      onAnalysing?.(false);
      return undefined;
    }

    let cancelled = false;

    const installWaveform = (data) => {
      if (cancelled || !data?.overallPeaks?.length) return false;

      // Rows already on screen showing this track pick this up via primeWaveformCache's
      // own broadcast rather than staying on their stale "not analysed" waveform.
      primeWaveformCache(track.path, data);

      const beatAvailability = resolveBeatAvailability(data);
      peaksRef.current = {
        analysisDuration: data.analysisDuration || null,
        beatOffsetSeconds: beatAvailability.offsetSeconds,
        beatsKnown: beatAvailability.known,
        beats: beatAvailability.beats,
        basicBarMarkers: basicBarMarkers(beatAvailability.beats),
        bpm: waveformBeatBpm(beatAvailability.beats),
        overall: new Float32Array(data.overallPeaks),
      };
      setReady(true);
      onReady(true);
      return true;
    };

    const loadWaveform = async () => {
      // Waveform availability is independent of BPM, key and loudness. Always
      // consume cached peaks first, including tracks whose other metrics are missing.
      const cached = await getWaveform(track.path, {
        cachedOnly: true,
      }).catch(() => null);
      const installed = installWaveform(cached);
      if (cancelled) return;
      // Existing peaks stay visible while missing beat data is filled in.
      // Missing tag metadata alone must not trigger a new decode.
      if (
        installed &&
        resolveBeatAvailability(cached).known &&
        waveformBeatBpm(cached.beats)
      )
        return;

      // Any missing metric uses the same full analysis workflow as the manual "Analyse"
      // button. skipAnalysed makes the backend retain the parts that are already present.
      onAnalysing?.(true);
      try {
        await analyseTrack(track.path);
        if (cancelled) return;

        // analyseTrack returns the reduced preview shape; the player needs the raw response's
        // duration and beat information too, so read the newly cached record once it finishes.
        const analysed = await getWaveform(track.path, {
          cachedOnly: true,
        }).catch(() => null);
        installWaveform(analysed);
      } finally {
        if (!cancelled) onAnalysing?.(false);
      }
    };

    loadWaveform();

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
      text: token('--text-primary', '#e7eef2'),
      surface: token('--bg-primary', '#11171c'),
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
    const dpr = canvas.ownerDocument.defaultView?.devicePixelRatio || 1;
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
    // The playback clock (audio.currentTime) is converted to the analysis timeline right here,
    // at the one point it enters waveform-positioning code — nothing downstream of `liveTime`
    // touches audio.currentTime directly.
    const liveTime =
      getCurrentTime && waveformDuration
        ? playbackToAnalysisTime(getCurrentTime())
        : (progressPct / 100) * waveformDuration;

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
      resampled = {
        source: peaks,
        numberSlots,
        fullSlots,
        zoom,
        // Fixed, whole-track reference so bar heights stay stable as the
        // window scrolls — recomputing this from only what's currently
        // visible would make the whole waveform rescale ("breathe") as loud
        // or quiet moments enter/leave the frame.
        max: maxOf(overallFull),
        overall: overallFull,
      };
      resampledRef.current = resampled;
    }

    const { max } = resampled;

    // At zoom > 1, only a window of the track is visible, centred on (and
    // following) the current playback position, clamped so it never scrolls
    // past the track's start/end.
    let windowStart = 0;
    let windowEnd = waveformDuration || 0;
    if (zoom > 1 && waveformDuration) {
      const zoomedDuration = waveformDuration / zoom;
      windowStart = Math.max(
        0,
        Math.min(
          waveformDuration - zoomedDuration,
          liveTime - zoomedDuration / 2,
        ),
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
    // A fraction of the stored array is the same time/duration relationship as a pixel
    // position, just measured against a width of 1 instead of the canvas — timeToPixel(t,
    // duration, 1) reduces to t/duration, so this stays the one canonical mapping rather than
    // a parallel division.
    const startFrac = waveformDuration
      ? timeToPixel(drawStart, waveformDuration, 1)
      : 0;
    const endFrac = waveformDuration
      ? timeToPixel(drawEnd, waveformDuration, 1)
      : 1;
    // Resample the window from the cached grid (fullSlots), not the raw peaks
    // — this aggregates an already-quantised, per-frame-stable set of "atoms"
    // rather than freshly re-aggregating raw high-resolution samples, which is
    // what kills the frame-to-frame jitter.
    const overall = resamplePeaks(resampled.overall, slots, startFrac, endFrac);

    const context = canvas.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    context.translate(-offsetPx, 0);
    // Reserve the timestamp strip before sizing the waveform. Painting that
    // strip over a full-height waveform hid its lower peaks and vocal lanes.
    const timelineHeight = 14 * dprScale;
    const waveformHeight = Math.max(0, pixelHeight - timelineHeight);
    const halfH = waveformHeight / 2;
    const pixelsPerSecond = barWidth / slotSeconds;
    // The pixel width the current [drawStart, drawEnd) window is actually drawn across —
    // `numberSlots`, not the `slots` overdraw count, matches `pixelsPerSecond` above exactly.
    // Paired with `windowDuration`, this is the (duration, width) span every position in this
    // window converts through via timeToPixel — the playhead and the beat grid below both use
    // it rather than each recomputing time*pixelsPerSecond independently.
    const windowWidthPx = numberSlots * barWidth;
    // Exact fractional playhead position. Colouring whole bars played/unplayed
    // instead (what this used to do) quantises the boundary to a bar, i.e. to
    // ~half a second of audio at zoom 1 — the played edge visibly hopped.
    const playedX = Math.max(
      0,
      timeToPixel(liveTime - drawStart, windowDuration, windowWidthPx),
    );
    const clipToPlayed = () => {
      context.beginPath();
      context.rect(0, 0, playedX, waveformHeight);
      context.clip();
    };

    // Colours come from the active theme's tokens rather than fixed hexes, so
    // light and AMOLED each get a palette that suits the panel they're drawn on.
    const colours = getColours(canvas);

    // Beat grid, anchored to the first REAL detected beat. Drawn only when beat analysis
    // actually exists for this track (peaks.beatsKnown) — a BPM tag alone (track?.bpm) is not
    // beat analysis, and previously drew a confident-looking grid anchored at a fabricated
    // phase of 0 for tracks that had never had real beat detection run at all.
    const drawBeatGrid = () => {
      const independent = enhancedRef.current?.available
        ? enhancedRef.current
        : null;
      if (!showGrid || (!independent && !peaks.beatsKnown)) return;
      // One line per beat at zoom 1 is a line every pixel or two — a second
      // comb at almost exactly the waveform's own period, which is where the
      // crawling Moiré came from. Widen to bar/phrase lines, or drop the grid.
      const lineSeconds = beatGridSeconds(
        independent
          ? waveformBeatBpm(independent.beats)
          : Number(track?.bpm) > 0
            ? Number(track.bpm)
            : peaks.bpm,
        pixelsPerSecond,
        8 * dprScale,
      );
      if (!lineSeconds) return;
      const phase = beatGridPhase(
        independent ? independent.beats?.[0] : peaks.beatOffsetSeconds,
        lineSeconds,
      );
      const firstBeat = firstGridLineAt(phase, lineSeconds, drawStart);
      // Detected beats are a timeline, not a constant-tempo estimate. Rebuilding
      // them from median BPM accumulates error against the saved downbeats.
      const times = [];
      const detectedBeats = independent?.beats || peaks.beats;
      if (detectedBeats?.length > 1) {
        const bpm = waveformBeatBpm(detectedBeats);
        const stride = Math.max(1, Math.round(lineSeconds / (60 / bpm)));
        const firstDownbeat = independent?.downbeats?.[0];
        const anchor =
          stride > 1 ? Math.max(0, detectedBeats.indexOf(firstDownbeat)) : 0;
        times.push(
          ...visibleBeatTimes(
            detectedBeats,
            drawStart,
            drawEnd,
            stride,
            anchor,
          ),
        );
      } else {
        for (let time = firstBeat; time < drawEnd; time += lineSeconds)
          times.push(time);
      }

      context.save();
      const detailGrid = zoom > 1;
      for (const time of times) {
        // Whole-pixel snapping only where the view is static — under a
        // scrolling sub-pixel offset it would make the grid jitter against
        // the bars it is supposed to line up with.
        const rawX = timeToPixel(
          time - drawStart,
          windowDuration,
          windowWidthPx,
        );
        const x =
          detectedBeats?.length || offsetPx ? rawX : Math.round(rawX) + 0.5;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, waveformHeight);
        // A contrasting outline keeps beats legible over both played and
        // unplayed bars, including the brighter named theme palettes.
        context.strokeStyle = detailGrid ? colours.surface : colours.grid;
        context.lineWidth = detailGrid ? 3 * dprScale : 1;
        context.stroke();
        if (detailGrid) {
          context.strokeStyle = colours.text;
          context.lineWidth = dprScale;
          context.stroke();
        }
      }

      context.restore();
    };

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
    drawEnhanced(context, enhancedRef.current, {
      start: drawStart,
      end: drawEnd,
      width: slots * barWidth,
      height: waveformHeight - 2 * dprScale,
      grid: showGrid,
      labelColour: colours.text,
      labelBackground: colours.surface,
      gridColour: zoom > 1 ? colours.text : colours.grid,
      gridOutline: zoom > 1 ? colours.surface : null,
      detailGrid: zoom > 1,
      phrases: phraseMode,
      vocals: showVocals,
      scale: dprScale,
    });

    if (showGrid && !enhancedRef.current?.available) {
      context.save();
      for (const marker of peaks.basicBarMarkers) {
        if (marker.time < drawStart || marker.time >= drawEnd) continue;
        const x = timeToPixel(
          marker.time - drawStart,
          windowDuration,
          windowWidthPx,
        );
        const lineWidth = (marker.level === 2 ? 3 : 2) * dprScale;
        context.globalAlpha = marker.level === 2 ? 0.9 : 0.55;
        context.fillStyle = colours.text;
        context.fillRect(x - lineWidth / 2, 0, lineWidth, waveformHeight);
      }

      context.restore();
    }

    // Keep timeline labels separate from the vocal lanes and use the same
    // window mapping as seeking and the grid.
    context.save();
    context.fillStyle = colours.surface;
    context.fillRect(0, waveformHeight, pixelWidth, timelineHeight);
    context.fillStyle = colours.text;
    context.font = `${9 * dprScale}px sans-serif`;
    for (let index = 0; index <= 5; index++) {
      const time = Math.min(
        waveformDuration,
        drawStart + (windowDuration * index) / 5,
      );
      const x = (pixelWidth * index) / 5;
      context.textAlign = index === 5 ? 'right' : 'left';
      context.fillText(
        formatSeconds(time),
        x + (index === 5 ? -3 : 3) * dprScale,
        pixelHeight - 3 * dprScale,
      );
    }

    context.strokeStyle = colours.text;
    context.lineWidth = dprScale;
    context.beginPath();
    context.moveTo(playedX, 0);
    context.lineTo(playedX, waveformHeight);
    context.stroke();
    context.restore();
  };

  // Always call the latest draw closure — the rAF loop below is set up once
  // (on mount / when ready toggles) rather than re-subscribing every render,
  // so it needs a stable way to reach whatever the current closure is.
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    if (!ready) return undefined;
    const animationWindow =
      canvasRef.current?.ownerDocument.defaultView || window;
    let frameId;
    const loop = () => {
      drawRef.current();
      frameId = animationWindow.requestAnimationFrame(loop);
    };

    frameId = animationWindow.requestAnimationFrame(loop);
    return () => animationWindow.cancelAnimationFrame(frameId);
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

  // Maps a fraction across the canvas to an analysis-timeline time, through whatever window is
  // currently visible (the whole track at zoom=1, a following sub-range at zoom>1). Used for
  // plain click/drag-to-seek. `fraction` is a pixel position measured against a width of 1 —
  // pixelToTime(fraction, windowDuration, 1) is the same canonical mapping as everywhere else,
  // just relative to the window's own start.
  const timeFromFraction = (fraction) => {
    const { end, start } = windowRef.current;
    return start + pixelToTime(fraction, end - start, 1);
  };

  // Times stay on the analysis timeline until the moment they're handed to onSeek — the
  // single point each converts to the playback clock via analysisToPlaybackTime, matching
  // the pixel -> pixelToTime -> analysis time -> analysisToPlaybackTime -> audio.currentTime
  // chain.
  const handlePointerDown = (event) => {
    if (!waveformDuration) return;
    draggingRef.current = true;
    canvasRef.current.setPointerCapture(event.pointerId);
    onSeek(analysisToPlaybackTime(timeFromFraction(fractionFromEvent(event))));
  };

  const handlePointerMove = (event) => {
    const fraction = fractionFromEvent(event);
    setHoverFraction(fraction);
    if (!draggingRef.current || !waveformDuration) return;
    onSeek(analysisToPlaybackTime(timeFromFraction(fraction)));
  };

  const handlePointerUp = (event) => {
    draggingRef.current = false;
    canvasRef.current.releasePointerCapture(event.pointerId);
  };

  // Keyboard seek parity with the plain scrubber bar (±5s) — the canvas has
  // no native seek behaviour of its own, so without this a keyboard-only
  // user could seek the plain bar but not the waveform.
  const handleKeyDown = (event) => {
    if (!waveformDuration) return;
    const current = (progressPct / 100) * waveformDuration;
    if (event.key === 'ArrowRight') {
      onSeek(analysisToPlaybackTime(Math.min(current + 5, waveformDuration)));
    }

    if (event.key === 'ArrowLeft') {
      onSeek(analysisToPlaybackTime(Math.max(current - 5, 0)));
    }
  };

  // Not ready yet — the caller keeps its plain scrubber live and seekable in the
  // meantime (and shows its own "analysing" label over it via onAnalysing), so
  // there is nothing for this component to render until peaks actually arrive.
  if (!ready) return null;

  return (
    <div
      className="mp-waveform-seeker"
      style={{
        height: `min(${height + (enhanced?.available ? 24 : 0)}px, var(--waveform-height-limit, 100000px))`,
        paddingTop: enhanced?.available ? 24 : 0,
      }}
    >
      {enhanced?.available && (
        <div className="mp-waveform-analysis-header">
          <span
            className="mp-waveform-analysis-status"
            title={
              enhanced.djPhraseAnalysis?.automatic
                ? 'Automatic independent analysis; neutral labels indicate uncertain sections'
                : 'Independent predictions; audition suggested'
            }
          >
            {enhanced.djPhraseAnalysis?.automatic
              ? 'Automatic DJ analysis'
              : 'Independent analysis'}{' '}
            · experimental
            {enhanced.genre?.scores?.length
              ? ` · ${[...enhanced.genre.scores].sort((a, b) => b.cosine - a.cosine)[0].label}`
              : ''}
          </span>
          {showVocals && (
            <span className="mp-vocal-legend">
              <i /> Singing <i /> Processed voice
            </span>
          )}
        </div>
      )}
      <canvas
        aria-label="Seek"
        aria-valuemax={waveformDuration}
        aria-valuemin={0}
        aria-valuenow={(progressPct / 100) * waveformDuration}
        className="mp-waveform-canvas"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerLeave={() => setHoverFraction(null)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={canvasRef}
        role="slider"
        style={{
          height: `min(${height}px, calc(var(--waveform-height-limit, 100000px) - ${enhanced?.available ? 24 : 0}px))`,
        }}
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
