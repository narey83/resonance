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

// Canvas can't read a CSS variable, so the band blend mode arrives as text like
// any other theme token — a typo there would silently break the blending, so
// only the two values that mean anything here are honoured.
const BLEND_MODES = ['lighter', 'multiply'];

/**
 * Reads the active theme's waveform palette off the element about to be drawn
 * into. The Pioneer/rekordbox identity (blue lows, orange mids, bright highs) is
 * built for a dark CDJ screen and blends additively; on a light surface that
 * saturates to white, so a light theme supplies deeper hues and multiplies them
 * instead — same reading, opposite direction. Keeping the palette in the theme
 * rather than in a canvas constant is what lets both work.
 * @param {HTMLElement} element the canvas (or its wrapper) to read tokens from.
 * @returns {object} the three band colours and the blend mode to combine them.
 */
export const waveColours = (element) => {
  const style = getComputedStyle(element);
  const token = (name, fallback) =>
    style.getPropertyValue(name).trim() || fallback;
  const blend = token('--wave-blend', 'lighter');
  return {
    blend: BLEND_MODES.includes(blend) ? blend : 'lighter',
    high: token('--wave-high', '#f5f5f5'),
    low: token('--wave-low', '#2f6fed'),
    mid: token('--wave-mid', '#ff8a3d'),
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
