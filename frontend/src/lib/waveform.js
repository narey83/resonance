// <copyright file="waveform.js" company="John Narey">
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

// Shared waveform rendering, so the library preview, the analysis row viewer and
// the player's seek bar all draw a track the same way.
//
// Duration resolution and time<->pixel conversion live in ./analysisTimeline.js instead of
// here — that module is the single authority for how a moment on the analysis timeline maps
// to a pixel (or vice versa); this file only turns already-resolved values into drawn pixels.

// Canvas can't read a CSS variable, so the band blend mode arrives as text like
// any other theme token — a typo there would silently break the blending, so
// only the two values that mean anything here are honoured.
const BLEND_MODES = ['lighter', 'multiply'];

/**
 * Reads the active theme's waveform palette off the element about to be drawn
 * into: rose bass, amber mids, cream air, plus the beat-grid line colour. The
 * band colours are blended rather than stacked, and which blend reads correctly
 * depends on the panel — additive on a dark screen, multiply on a light one — so
 * the mode travels with the colours instead of being fixed here. Fallbacks are
 * the dark palette, for anything rendering outside a themed tree.
 * @param {HTMLElement} element the canvas (or its wrapper) to read tokens from.
 * @returns {object} the band colours, the grid colour and the blend mode.
 */
export const waveColours = (element) => {
  const style = getComputedStyle(element);
  const token = (name, fallback) =>
    style.getPropertyValue(name).trim() || fallback;
  const blend = token('--wave-blend', 'lighter');
  return {
    blend: BLEND_MODES.includes(blend) ? blend : 'lighter',
    grid: token('--wave-grid', 'rgba(255,232,214,0.13)'),
    high: token('--wave-high', '#ffe2b0'),
    low: token('--wave-low', '#e0417a'),
    mid: token('--wave-mid', '#ffa629'),
  };
};

/**
 * Picks how much audio one beat-grid line should span, so the grid is never
 * drawn finer than it can be seen. A line per beat is only legible while
 * zoomed in: a whole 128bpm track across a 900px seek bar puts a beat every
 * ~1.4 pixels, which is a comb at the pixel grid's own frequency — it aliases
 * into Moiré bands that have nothing to do with the audio, and they crawl as
 * soon as the view scrolls. Step up to bar lines, then four-bar phrase lines,
 * then give up.
 * @param {number} bpm the track's detected tempo.
 * @param {number} pixelsPerSecond current horizontal scale, in canvas pixels.
 * @param {number} minSpacing closest two lines may sit, in canvas pixels.
 * @returns {number} seconds between lines, or 0 to skip the grid entirely.
 */
export const beatGridSeconds = (bpm, pixelsPerSecond, minSpacing) => {
  if (!bpm || !pixelsPerSecond) return 0;
  const secondsPerBeat = 60 / bpm;
  // 1 beat, 1 bar, 1 phrase — all multiples of a beat, so whatever survives is
  // still anchored to the same grid.
  for (const beats of [1, 4, 16]) {
    if (secondsPerBeat * beats * pixelsPerSecond >= minSpacing) {
      return secondsPerBeat * beats;
    }
  }

  return 0;
};

/**
 * Where the grid's first line sits within one `lineSeconds` period, anchored
 * to the track's actual first detected beat rather than to 0:00. A track's
 * rhythm rarely starts exactly at the top of the file — an intro, a pickup,
 * a moment of silence — so a grid drawn at multiples of the beat interval
 * from t=0 is offset from the real beats by a constant amount for the whole
 * track. Beat position (interval) and beat phase (origin) are independent:
 * this only ever needs the offset modulo the current line spacing, since bar
 * and phrase lines are themselves whole multiples of a beat.
 * @param {number} beatOffsetSeconds the first detected beat, in seconds from
 *   track start (0 if unknown, which reproduces the old track-start anchor).
 * @param {number} lineSeconds seconds between grid lines, from beatGridSeconds.
 * @returns {number} the phase, in [0, lineSeconds).
 */
export const beatGridPhase = (beatOffsetSeconds, lineSeconds) => {
  if (!lineSeconds) return 0;
  return ((beatOffsetSeconds % lineSeconds) + lineSeconds) % lineSeconds;
};

/**
 * The first grid line at or after `fromSeconds`, on the beat-anchored grid
 * described by `phase`/`lineSeconds` (see beatGridPhase).
 * @param {number} phase the grid's phase, from beatGridPhase.
 * @param {number} lineSeconds seconds between grid lines.
 * @param {number} fromSeconds where the caller wants the first line at or after.
 * @returns {number} the time, in seconds, of that line.
 */
export const firstGridLineAt = (phase, lineSeconds, fromSeconds) => {
  if (!lineSeconds) return fromSeconds;
  return phase + Math.ceil((fromSeconds - phase) / lineSeconds) * lineSeconds;
};

/**
 * The theoretical ("ghost") beat times within [fromSeconds, toSeconds) — the
 * idealised clock beatOffsetSeconds/bpm imply, as distinct from the beats
 * Essentia actually detected (see visibleBeats). Each position is computed
 * directly from its index rather than by repeatedly adding secondsPerBeat to
 * a running total, so float error from one line never carries into the next:
 * the 10,000th ghost beat is exactly as accurate as the first.
 * @param {number} beatOffsetSeconds the first detected beat, in seconds from
 *   track start (0 if unknown).
 * @param {number} secondsPerBeat 60 / bpm.
 * @param {number} fromSeconds start of the range, inclusive.
 * @param {number} toSeconds end of the range, exclusive.
 * @returns {number[]} ghost beat times, in seconds, ascending.
 */
export const expectedBeats = (
  beatOffsetSeconds,
  secondsPerBeat,
  fromSeconds,
  toSeconds,
) => {
  if (!secondsPerBeat || toSeconds <= fromSeconds) return [];
  const firstIndex = Math.ceil(
    (fromSeconds - beatOffsetSeconds) / secondsPerBeat,
  );
  const out = [];
  for (let index = firstIndex; ; index++) {
    const time = beatOffsetSeconds + index * secondsPerBeat;
    if (time >= toSeconds) break;
    out.push(time);
  }

  return out;
};

/**
 * The detected beats (Essentia's actual ticks) within [fromSeconds,
 * toSeconds) — never mutates `beats`, and never invents or drops a detection;
 * it only narrows to what the current viewport needs to draw. `beats` is
 * assumed sorted ascending, which is how the backend stores Essentia's ticks.
 * @param {Float32Array|number[]} beats detected beat times, in seconds, or
 *   null/undefined if none were detected.
 * @param {number} fromSeconds start of the range, inclusive.
 * @param {number} toSeconds end of the range, exclusive.
 * @returns {number[]} the detected beats inside the range, ascending.
 */
export const visibleBeats = (beats, fromSeconds, toSeconds) => {
  if (!beats || !beats.length) return [];
  const out = [];
  for (const time of beats) {
    if (time >= fromSeconds && time < toSeconds) out.push(time);
    else if (time >= toSeconds) break;
  }

  return out;
};

// Basic analysis has beat times but no saved downbeats or arrangement sections.
// In common 4/4, 64 beats span 16 bars. Keep accents on the detected ticks so
// tempo changes do not shift them away from the visible beat grid.
export const basicBarMarkers = (beats) => {
  if (!beats?.length) return [];
  const markers = [];
  for (let index = 0; index < beats.length; index += 64) {
    const time = beats[index];
    if (!Number.isFinite(time) || (index > 0 && time <= beats[index - 1]))
      return [];
    markers.push({ time, level: index % 128 === 0 ? 2 : 1 });
  }

  return markers;
};

/**
 * Diagnostic-only comparison of detected beats against the theoretical grid
 * their own bpm/beatOffsetSeconds imply — never corrects or mutates `beats`.
 * Each detected beat is matched to its nearest grid index independently
 * (rather than assuming detected beat i is grid position i), so one skipped
 * or doubled beat doesn't cascade into every comparison after it: a jump in
 * `indexGap` away from 1 is what actually reveals that skip/double, not a
 * growing error alone. Mirrors the backend's AudioAnalyzer.CompareBeatsToGrid
 * (kept independent since they run in different languages, but intentionally
 * the same algorithm) — useful client-side for a debug overlay without a
 * round trip.
 * @param {Float32Array|number[]} beats detected beat times, in seconds.
 * @param {number} bpm the track's detected tempo.
 * @param {number} beatOffsetSeconds the first detected beat, in seconds.
 * @returns {{count: number, meanAbsErrorSeconds: number, maxAbsErrorSeconds:
 *   number, skippedBeats: number, extraBeats: number, comparisons: Array<
 *   {detected: number, expected: number, errorSeconds: number,
 *   expectedIndex: number, indexGap: number}>}} the per-beat comparisons and
 *   summary statistics.
 */
export const compareBeats = (beats, bpm, beatOffsetSeconds) => {
  const count = beats ? beats.length : 0;
  if (!count || !bpm) {
    return {
      comparisons: [],
      count: 0,
      extraBeats: 0,
      maxAbsErrorSeconds: 0,
      meanAbsErrorSeconds: 0,
      skippedBeats: 0,
    };
  }

  const secondsPerBeat = 60 / bpm;
  const comparisons = [];
  let lastIndex = 0;
  let skippedBeats = 0;
  let extraBeats = 0;
  let sumAbsError = 0;
  let maxAbsErrorSeconds = 0;

  for (let index = 0; index < count; index++) {
    const detected = beats[index];
    const expectedIndex = Math.round(
      (detected - beatOffsetSeconds) / secondsPerBeat,
    );
    const expected = beatOffsetSeconds + expectedIndex * secondsPerBeat;
    const errorSeconds = detected - expected;
    const indexGap = index === 0 ? 1 : expectedIndex - lastIndex;

    if (index > 0) {
      if (indexGap > 1) skippedBeats += indexGap - 1;
      else if (indexGap < 1) extraBeats++;
    }

    comparisons.push({
      detected,
      errorSeconds,
      expected,
      expectedIndex,
      indexGap,
    });
    sumAbsError += Math.abs(errorSeconds);
    maxAbsErrorSeconds = Math.max(maxAbsErrorSeconds, Math.abs(errorSeconds));
    lastIndex = expectedIndex;
  }

  return {
    comparisons,
    count,
    extraBeats,
    maxAbsErrorSeconds,
    meanAbsErrorSeconds: sumAbsError / count,
    skippedBeats,
  };
};

// A drawn bar spanning more than a handful of stored bars is an overview, and
// there peak is the wrong summary: taking the maximum of ~1000 stored peaks lands
// near the track's loudest moment nearly every time, so every bar draws full
// height and the whole thing reads as a solid block. RMS over the span tracks how
// much energy is actually there, which is what makes an intro, a breakdown and a
// drop distinguishable. Peak still wins once a bar covers only a few milliseconds,
// where an individual transient is the thing worth seeing.
const RMS_ABOVE = 4;

/**
 * Resamples a [startFrac, endFrac) slice of stored peaks into one value per
 * drawn slot. Bucket bounds are proportional (float) rather than a fixed
 * integer stride: an integer stride leaves a truncated, unsampled tail whenever
 * the slice length isn't an exact multiple of the slot count, which silently
 * compresses the back of the picture relative to the audio.
 * @param {Float32Array} data one band of stored peaks.
 * @param {number} slots how many values to produce.
 * @param {number} [startFrac] start of the slice, as a fraction of the track.
 * @param {number} [endFrac] end of the slice, as a fraction of the track.
 * @returns {Float32Array} one summary value per slot.
 */
export const resamplePeaks = (data, slots, startFrac = 0, endFrac = 1) => {
  const sliceStart = startFrac * data.length;
  const sliceLength = (endFrac - startFrac) * data.length;
  const out = new Float32Array(slots);
  const useRms = sliceLength / slots >= RMS_ABOVE;

  for (let slot = 0; slot < slots; slot++) {
    const start = Math.max(
      0,
      Math.floor(sliceStart + (slot / slots) * sliceLength),
    );
    const end = Math.min(
      data.length,
      Math.max(
        start + 1,
        Math.floor(sliceStart + ((slot + 1) / slots) * sliceLength),
      ),
    );
    if (end <= start) continue;

    if (useRms) {
      let sum = 0;
      for (let i = start; i < end; i++) sum += data[i] * data[i];
      out[slot] = Math.sqrt(sum / (end - start));
    } else {
      let peak = 0;
      for (let i = start; i < end; i++) if (data[i] > peak) peak = data[i];
      out[slot] = peak;
    }
  }

  return out;
};

/**
 * Normalising against the raw global peak leaves every RMS bar tiny, and against
 * a track's loudest instant leaves a limited master flat. Each band is scaled by
 * the largest value actually being drawn, so the picture uses its full height
 * whatever the source material.
 * @param {Float32Array} array the values about to be drawn.
 * @returns {number} the largest, never zero.
 */
export const maxOf = (array) => {
  let max = 0;
  for (const v of array) if (v > max) max = v;
  return max || 1;
};

/**
 * Converts an API waveform response into typed arrays ready to draw.
 * @param {object} data the /analysis/waveform response.
 * @returns {object|null} the four bands, or null if the response carried no peaks.
 */
export const toPeaks = (data) => {
  if (!data?.overallPeaks?.length) return null;
  return {
    high: new Float32Array(data.highPeaks),
    low: new Float32Array(data.lowPeaks),
    mid: new Float32Array(data.midPeaks),
    overall: new Float32Array(data.overallPeaks),
  };
};

/**
 * Draws banded peaks onto a canvas, sizing it for the device pixel ratio.
 * @param {HTMLCanvasElement} canvas the target canvas.
 * @param {object} peaks the bands from toPeaks.
 * @param {object} options width/height in CSS pixels, bar geometry, and whether
 *   to colour by frequency band or draw a flat monochrome envelope.
 */
export const drawWaveform = (canvas, peaks, options) => {
  const {
    barWidth = 2,
    gap = 1,
    height,
    mono = false,
    monoColour = '#7d8590',
    width,
  } = options;
  if (!canvas || !peaks || width <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  const context = canvas.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const { high, low, mid, overall } = peaks;
  const halfH = height / 2;
  const slots = Math.max(1, Math.floor(width / (barWidth + gap)));

  const o = resamplePeaks(overall, slots);
  const l = resamplePeaks(low, slots);
  const m = resamplePeaks(mid, slots);
  const h = resamplePeaks(high, slots);

  const max = maxOf(o);
  const lowMax = maxOf(l);
  const midMax = maxOf(m);
  const highMax = maxOf(h);
  const bands = mono ? null : waveColours(canvas);
  if (bands) context.globalCompositeOperation = bands.blend;

  for (let slot = 0; slot < slots; slot++) {
    const totalH = Math.max(1, (o[slot] / max) * halfH);
    const x = slot * (barWidth + gap);

    if (mono) {
      context.fillStyle = monoColour;
      context.fillRect(x, halfH - totalH, barWidth, totalH * 2);
      continue;
    }

    // Alpha per band rather than stacked slices: a kick-heavy instant reads
    // solid blue, a hat-heavy one as the "high" colour, a full mix blends to
    // neutral. The 1.4/0.9 weights keep bass and highs perceptually level
    // against mids.
    context.globalAlpha = Math.min(1, (l[slot] / lowMax) * 1.4);
    context.fillStyle = bands.low;
    context.fillRect(x, halfH - totalH, barWidth, totalH * 2);

    context.globalAlpha = Math.min(1, m[slot] / midMax);
    context.fillStyle = bands.mid;
    context.fillRect(x, halfH - totalH, barWidth, totalH * 2);

    context.globalAlpha = Math.min(1, (h[slot] / highMax) * 0.9);
    context.fillStyle = bands.high;
    context.fillRect(x, halfH - totalH, barWidth, totalH * 2);
  }

  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
};

// A player snapshot can lack the BPM tag even though cached analysis has real
// beat ticks. Derive its display cadence from those ticks, preserving phase.
export const waveformBeatBpm = (beats) => {
  if (
    !Array.isArray(beats) ||
    beats.length < 2 ||
    beats.some(
      (beat, i) =>
        !Number.isFinite(beat) || beat < 0 || (i > 0 && beat <= beats[i - 1]),
    )
  )
    return null;
  const span = Math.min(8, beats.length - 1);
  const periods = beats
    .slice(span)
    .map((beat, i) => (beat - beats[i]) / span)
    .sort((a, b) => a - b);
  const middle = Math.floor(periods.length / 2);
  const median =
    periods.length % 2
      ? periods[middle]
      : (periods[middle - 1] + periods[middle]) / 2;
  return 60 / median;
};

// Thin a detected timeline by beat index without replacing its timing with BPM.
export const visibleBeatTimes = (beats, start, end, stride = 1, anchor = 0) =>
  beats.filter(
    (time, index) =>
      (index - anchor) % stride === 0 && time >= start && time < end,
  );
